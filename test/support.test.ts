// Support: requests from people and their agents, the operator's assistant working them through the support
// tools, announcements that wait for the operator, product errors, and the inbox.
import { beforeEach, expect, test } from "bun:test";
import { ADMIN, createHub, FakeCtx, FakeKV, type Harness } from "./support/do-harness.ts";
import { handleMcp, type Ctx } from "../src/worker/mcp.ts";

const { default: worker } = await import("../src/worker/index.ts");
const { Workspace } = await import("../src/worker/hub.ts");

let h: Harness;
let env: Record<string, unknown>;
let hubs: Map<string, unknown>;
let mail: { to: string; subject: string }[];
const OP = "op@corp.com";
const ANA = "ana@corp.com";
const APEX = "https://artifacts.test";
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

beforeEach(async () => {
  h = await createHub();
  await h.hub.setMember(ANA, "member", ADMIN);
  hubs = new Map([["acme", h.hub]]);
  mail = [];
  env = {
    ...h.env,
    WORKSPACE: { getByName: (slug: string) => hubs.get(slug) ?? hubs.set(slug, new Workspace(new FakeCtx() as never, h.env as never)).get(slug) },
    OAUTH_KV: new FakeKV(),
    EMAIL: { send: async (m: { to: string; subject: string }) => void mail.push(m) },
    CONSENT_SECRET: "test-consent-secret-that-is-long-enough",
    OPERATOR_TOKEN: "op-token",
    OPERATOR_EMAILS: OP,
    APEX_HOST: "artifacts.test",
    APEX_ORIGIN: APEX,
    WORKSPACE_SUFFIX: ".artifacts.test",
    MAIL_FROM: "sign-in@mail.artifacts.test",
  };
  // The hubs read the same env (the harness shares it), so they see WORKSPACE and the operator too.
  Object.assign(h.env, env);
});

function mcpCtx(slug: string, person: string): Ctx {
  return { hub: (hubs.get(slug) ?? h.hub) as never, origin: `https://${slug}.artifacts.test`, env: env as never, slug, person, actor: "agent" };
}

async function call(slug: string, person: string, name: string, args: Record<string, unknown>) {
  const res = await handleMcp(new Request(`https://${slug}.artifacts.test/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) }), mcpCtx(slug, person));
  const body = (await res.json()) as { result?: { isError: boolean; content: { text: string }[]; structuredContent?: any }; error?: { message: string } };
  if (body.error) return { error: true, text: body.error.message, data: null };
  return { error: body.result!.isError, text: body.result!.content[0].text, data: body.result!.structuredContent };
}

async function tools(slug: string, person: string): Promise<string[]> {
  const res = await handleMcp(new Request(`https://${slug}.artifacts.test/mcp`, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) }), mcpCtx(slug, person));
  return ((await res.json()) as { result: { tools: { name: string }[] } }).result.tools.map((t) => t.name);
}

/** Events the operator's assistant would get from the support workspace, from the start. */
async function poll(name: string) {
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  const r = (await support.eventsPoll(OP, { name, cursor: "s0" })) as { result: { events: { data: Record<string, unknown> }[] } };
  return r.result.events.map((e) => e.data);
}

const report = () => call("acme", ANA, "support_report", { kind: "bug", title: "Table is blank on my phone", details: "Opened the budget page; the table shows nothing.", page: "https://acme.artifacts.test/a/abcdefghijklm" });

test("an agent reports a problem: a private request page, the person's message starts its conversation, and they hear about it", async () => {
  const r = await report();
  expect(r.error).toBe(false);
  expect(r.data.number).toBe(1);
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  expect(h.directory.workspace("support")).not.toBeNull();
  const c = h.directory.supportCase(1)!;
  expect(c).toMatchObject({ reporter: ANA, viaAgent: true, kind: "bug", status: "new", workspace: "acme" });
  // Shared with the reporter only; the internal notes with nobody.
  expect(support.meta(c.artifactId)!.shares).toEqual([{ email: ANA, role: "edit" }]);
  expect(support.meta(c.notesId!)!.shares).toEqual([]);
  expect(support.list(ANA).map((a) => a.id)).toEqual([c.artifactId]);
  const [thread] = support.threads(c.artifactId);
  expect(thread.comments[0]).toMatchObject({ by: ANA });
  expect(thread.comments[0].text).toContain("the table shows nothing");
  expect(thread.comments[0].text).toContain("agent on their behalf");
  expect((support.state(c.artifactId)["case/status"] as { status: string; thread: string }).thread).toBe(thread.id);
  // The page shows what they shared: never artifact content, and ids taken out of the page address.
  const data = JSON.parse(support.files(c.artifactId)["data/case.json"]);
  expect(data.context.page).toBe("acme.artifacts.test/a/<id>");
  expect(h.directory.inbox(ANA).items[0]).toMatchObject({ kind: "support", url: `https://support.artifacts.test/a/${c.artifactId}` });
  expect(mail.some((m) => m.to === ANA && m.subject.startsWith("We got your problem"))).toBe(true);
  // Their own requests, through their agent.
  expect((await call("acme", ANA, "support_requests", {})).text).toContain("#1 [new] Table is blank");
});

test("the support tools exist only for the operator, on the support workspace; people can't set a request's status", async () => {
  await report();
  expect(await tools("acme", ANA)).toContain("support_report");
  expect(await tools("acme", ANA)).not.toContain("support_update");
  expect(await tools("acme", OP)).not.toContain("support_update");
  expect(await tools("support", OP)).toContain("support_update");
  expect((await call("support", ANA, "support_cases", {})).text).toContain("Unknown tool");
  const c = h.directory.supportCase(1)!;
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  expect(() => support.setState(c.artifactId, { "case/status": { status: "resolved" } }, ANA, undefined, { role: "edit" })).toThrow("support tools");
});

test("the assistant asks for more, then ships a fix: the person sees each step and is told once", async () => {
  await report();
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  const c = h.directory.supportCase(1)!;
  mail = [];
  const asked = await call("support", OP, "support_update", { case: 1, status: "needs_info", message: "Which phone and browser?" });
  expect(asked.error).toBe(false);
  expect((support.state(c.artifactId)["case/status"] as { status: string }).status).toBe("needs_info");
  expect(support.threads(c.artifactId)[0].comments.at(-1)).toMatchObject({ by: "agent", text: "Which phone and browser?" });
  expect(mail.filter((m) => m.to === ANA)).toHaveLength(1);
  // The same status again tells nobody again.
  await call("support", OP, "support_update", { case: 1, status: "needs_info" });
  expect(mail.filter((m) => m.to === ANA)).toHaveLength(1);
  await call("support", OP, "support_update", { case: 1, status: "fix_deployed", fix: { summary: "Tables show as cards on phones.", version: "v42", commit: "abc123" } });
  const status = support.state(c.artifactId)["case/status"] as { status: string; fix: Record<string, string>; history: unknown[] };
  expect(status).toMatchObject({ status: "fix_deployed", fix: { summary: "Tables show as cards on phones.", version: "v42" } });
  expect(JSON.stringify(status)).not.toContain("abc123");
  expect(status.history).toHaveLength(3);
  expect(h.directory.supportCase(1)!.fix).toMatchObject({ commit: "abc123" });
  // The person confirms on the page: an answer the assistant hears about.
  support.setState(c.artifactId, { [`approve/fixed/${ANA}`]: { decision: "approve" } }, ANA, undefined, { role: "edit" });
  expect((await poll("artifact.answered")).at(-1)).toMatchObject({ by: ANA, decision: "approve" });
  // Resolved, then reopened, counts in the stats.
  await call("support", OP, "support_update", { case: 1, status: "resolved" });
  await call("support", OP, "support_update", { case: 1, status: "investigating" });
  expect(h.directory.supportStats().reopened).toEqual([{ case: 1, title: "Table is blank on my phone", reopened: 1 }]);
});

test("the person's message and replies wake the assistant through events, and their agent can reply (within limits)", async () => {
  await report();
  expect((await poll("comment.created"))[0]).toMatchObject({ by: ANA });
  expect((await call("acme", ANA, "support_reply", { case: 1, message: "iPhone, Safari." })).error).toBe(false);
  expect((await call("acme", "eve@corp.com", "support_reply", { case: 1, message: "hi" })).text).toContain("no request #1 of yours");
  expect(String((await poll("comment.created")).at(-1)?.text)).toContain("iPhone, Safari.");
});

test("telling everyone affected waits for the operator's approval in their inbox, and goes once to each request", async () => {
  await report();
  await call("acme", ANA, "support_report", { kind: "bug", title: "Blank table again", details: "Same as before." });
  await call("support", OP, "support_update", { case: 2, duplicateOf: 1 });
  expect(h.directory.supportCase(2)!.status).toBe("duplicate");
  const drafted = await call("support", OP, "support_announce", { case: 1, message: "Fixed in today's release." });
  expect(drafted.data.cases).toEqual([1, 2]);
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  const replies = () => [1, 2].map((n) => support.threads(h.directory.supportCase(n)!.artifactId)[0].comments.filter((c) => c.text === "Fixed in today's release.").length);
  expect(replies()).toEqual([0, 0]);
  const item = h.directory.inbox(OP).items.find((i) => i.kind === "approve-announcement")!;
  expect(item.body).toBe("Fixed in today's release.");
  const { approveAnnouncement } = await import("../src/worker/support.ts");
  await expect(approveAnnouncement(env as never, drafted.data.draft, ANA)).rejects.toThrow("only the operator");
  expect(await approveAnnouncement(env as never, drafted.data.draft, OP)).toEqual({ sent: 2, failed: [] });
  expect(await approveAnnouncement(env as never, drafted.data.draft, OP)).toEqual({ sent: 0, failed: [] });
  expect(replies()).toEqual([1, 1]);
});

test("product errors group by fingerprint, keep no addresses or tokens, and can go with a request", async () => {
  const { recordProductError } = await import("../src/worker/support.ts");
  const e = { kind: "server" as const, place: "/api/a/aabcdefghijkl/state", browser: "Chrome on macOS" };
  const a = await recordProductError(env as never, { ...e, message: "TypeError: x is undefined for ana@corp.com at 1234" });
  const b = await recordProductError(env as never, { ...e, message: "TypeError: x is undefined for bo@corp.com at 99" });
  expect(a).toBe(b);
  const [group] = h.directory.errorGroups({ fp: a });
  // The same error again within seconds is the same group, counted once (an outage mustn't hammer the directory).
  expect(group).toMatchObject({ count: 1, place: "/api/a/<id>/state" });
  expect(group.message).not.toContain("ana@corp.com");
  const r = await call("acme", ANA, "support_report", { kind: "bug", title: "Saving failed", details: "It said error.", errorId: a });
  expect(h.directory.supportCase(r.data.number)!.errorGroup).toBe(a);
  expect(h.directory.errorGroups({ fp: a })[0].cases).toEqual([r.data.number]);
  expect((await call("support", OP, "support_errors", {})).text).toContain(a);
});

test("five requests a day per person; the web form sends one too, and lists yours", async () => {
  for (let i = 0; i < 5; i++) expect((await call("acme", ANA, "support_report", { kind: "question", title: `Q${i}`, details: "?" })).error).toBe(false);
  expect((await call("acme", ANA, "support_report", { kind: "question", title: "Q6", details: "?" })).text).toContain("a lot of requests today");
  const session = await worker.fetch(
    new Request(`${APEX}/api/admin/session`, { method: "POST", headers: { Authorization: "Bearer op-token", "Content-Type": "application/json" }, body: JSON.stringify({ email: "bo@example.com", host: "artifacts.test" }) }),
    env as never,
    ctx,
  );
  const cookie = ((await session.json()) as { cookie: string }).cookie;
  const sent = await worker.fetch(
    new Request(`${APEX}/support`, { method: "POST", headers: { Cookie: cookie, Origin: APEX }, body: new URLSearchParams({ kind: "feature", title: "Dark mode toggle", details: "Please", browser: "1" }) }),
    env as never,
    ctx,
  );
  expect(sent.status).toBe(200);
  const page = await (await worker.fetch(new Request(`${APEX}/support`, { headers: { Cookie: cookie } }), env as never, ctx)).text();
  expect(page).toContain("Dark mode toggle");
});

test("notifications land in the inbox even with no channels, and stay unread until followed or their artifact is opened", async () => {
  const r = await h.hub.create({ title: "Plan", files: { "index.mdx": "# Plan\n" }, owner: ADMIN });
  const r2 = await h.hub.create({ title: "Budget", files: { "index.mdx": "# Budget\n" }, owner: ADMIN });
  if (!r.ok || !r2.ok) throw new Error("create");
  for (const id of [r.id, r2.id]) {
    h.hub.share(id, { add: [{ email: ANA, role: "edit" }] });
    h.hub.addComment(id, ANA, { text: "Looks good" }, "https://acme.artifacts.test", undefined, "edit");
  }
  await h.hub.deliverDue(Date.now() + 3_600_000);
  expect(h.directory.inbox(ADMIN).items[0]).toMatchObject({ kind: "notification", read: false });
  expect(h.directory.unreadCount(ADMIN)).toBe(2);
  const cookieFor = async (host: string) => {
    const res = await worker.fetch(
      new Request(`${APEX}/api/admin/session`, { method: "POST", headers: { Authorization: "Bearer op-token", "Content-Type": "application/json" }, body: JSON.stringify({ email: ADMIN, host }) }),
      env as never,
      ctx,
    );
    return ((await res.json()) as { cookie: string }).cookie;
  };
  const apex = await cookieFor("artifacts.test");
  const get = (url: string, cookie: string) => worker.fetch(new Request(url, { headers: { Cookie: cookie } }), env as never, ctx);
  const unread = async (origin: string, cookie: string, body: Record<string, unknown> = {}) => {
    const res = await worker.fetch(
      new Request(`${origin}/api/me/inbox`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
      env as never,
      ctx,
    );
    return ((await res.json()) as { unread: number }).unread;
  };
  // Looking at the inbox doesn't read it; the bell's count says what's left.
  expect(await (await get(`${APEX}/inbox`, apex)).text()).toContain("Mark all read");
  expect(await unread(APEX, apex)).toBe(2);
  // Opening an artifact reads what the inbox said about it, and only that.
  const ws = "https://acme.artifacts.test";
  const wsCookie = await cookieFor("acme.artifacts.test");
  expect(await unread(ws, wsCookie, { seen: r.id })).toBe(1);
  // The bell's panel, from a workspace: the latest items, each linking to the apex's /inbox/<id>; looking reads nothing.
  const panel = async (body: Record<string, unknown>) =>
    (await (
      await worker.fetch(
        new Request(`${ws}/api/me/inbox`, { method: "POST", headers: { Cookie: wsCookie, Origin: ws, "Content-Type": "application/json" }, body: JSON.stringify(body) }),
        env as never,
        ctx,
      )
    ).json()) as { unread: number; items: { id: number; read: boolean; href: string | null }[] };
  const listed = await panel({ items: true });
  expect(listed.unread).toBe(1);
  expect(listed.items.length).toBe(2);
  expect(listed.items.filter((i) => !i.read).length).toBe(1);
  expect(listed.items.every((i) => i.href === `/inbox/${i.id}`)).toBe(true);
  expect((await panel({})).items).toBeUndefined();
  // Someone else's item goes to their own inbox and reads nothing.
  const item = h.directory.inbox(ADMIN).items.find((i) => !i.read)!;
  const theirs = await worker.fetch(
    new Request(`${APEX}/api/admin/session`, { method: "POST", headers: { Authorization: "Bearer op-token", "Content-Type": "application/json" }, body: JSON.stringify({ email: "bo@example.com", host: "artifacts.test" }) }),
    env as never,
    ctx,
  );
  const elsewhere = await get(`${APEX}/inbox/${item.id}`, ((await theirs.json()) as { cookie: string }).cookie);
  expect(elsewhere.headers.get("Location")).toBe(`${APEX}/inbox`);
  expect(await unread(APEX, apex)).toBe(1);
  // Following an item from the inbox reads it and goes where it points.
  const go = await get(`${APEX}/inbox/${item.id}`, apex);
  expect(go.status).toBe(302);
  expect(go.headers.get("Location")).toBe(item.url);
  expect(await unread(APEX, apex)).toBe(0);
  // Mark all read, from the panel.
  h.hub.addComment(r.id, ANA, { text: "One more" }, ws, undefined, "edit");
  await h.hub.deliverDue(Date.now() + 7_200_000);
  expect(await unread(APEX, apex)).toBe(1);
  expect(await unread(APEX, apex, { read: "all" })).toBe(0);
});

/** The support workspace, after everything a write started in the background has finished. */
async function settled() {
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  await Promise.all((support as unknown as { ctx: { waited: Promise<unknown>[] } }).ctx.waited);
  return support;
}

test("a status change with a reply sends the person one email, carrying both, with its time's UTC offset", async () => {
  await report();
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  const bodies: { to: string; subject: string; text?: string }[] = [];
  (env.EMAIL as { send: unknown }).send = async (m: { to: string; subject: string; text: string }) => void bodies.push(m);
  await call("support", OP, "support_update", { case: 1, status: "needs_info", message: "Which phone and browser?" });
  // The comment's own notification, due later, would have been the second email.
  await support.deliverDue(Date.now() + 3_600_000);
  const toAna = bodies.filter((m) => m.to === ANA);
  const notified = () => h.directory.inbox(ANA).items.filter((i) => i.kind === "notification").length;
  expect(toAna).toHaveLength(1);
  expect(notified()).toBe(0);
  expect(toAna[0].text).toContain("Which phone and browser?");
  expect(toAna[0].text).toMatch(/Updated \d{4}-\d\d-\d\d \d\d:\d\d UTC \(\+00:00\)\./);
  // A reply with no status email still notifies them the usual way.
  await call("support", OP, "support_update", { case: 1, message: "Thanks, looking." });
  await support.deliverDue(Date.now() + 7_200_000);
  expect(notified()).toBe(1);
});

test("the plan and the log are kept on the request and shown on its page; tool times carry their offset", async () => {
  await report();
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  const c = h.directory.supportCase(1)!;
  const r = await call("support", OP, "support_update", { case: 1, status: "investigating", plan: "1. Reproduce on a phone\n2. Render tables as cards", event: "Operator approved the plan" });
  expect(r.error).toBe(false);
  expect(r.text).toMatch(/updated \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00/);
  expect(h.directory.supportCase(1)!.plan).toContain("Render tables as cards");
  expect(h.directory.supportCase(1)!.events.map((e) => [e.actor, e.event])).toEqual([
    ["agent", "Operator approved the plan"],
    ["agent", "Status: investigating"],
    ["agent", "Plan set"],
  ]);
  expect((support.state(c.artifactId)["case/plan"] as { text: string }).text).toContain("Reproduce on a phone");
  expect(support.state(c.artifactId)["case/log"]).toHaveLength(3);
  const read = await call("support", OP, "support_case", { case: 1 });
  expect(read.text).toContain("Reproduce on a phone");
  expect(read.text).toMatch(/\+00:00 "agent": "Plan set"/);
  // Nobody writes them from the page, and null takes the plan away.
  expect(() => support.setState(c.artifactId, { "case/plan": { text: "mine" } }, ANA, undefined, { role: "edit" })).toThrow("support tools");
  await call("support", OP, "support_update", { case: 1, plan: null });
  expect(h.directory.supportCase(1)!.plan).toBeNull();
  expect(support.state(c.artifactId)["case/plan"]).toBeUndefined();
  expect((await call("support", OP, "support_update", { case: 1, plan: "x".repeat(10_001) })).text).toContain("limited to 10000");
});

test("\"fixed\" resolves the request; \"still a problem\" needs a note, reopens it and tells the operator", async () => {
  await report();
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  const c = h.directory.supportCase(1)!;
  const key = `approve/fixed/${ANA}`;
  const answer = (value: Record<string, unknown>) => support.setState(c.artifactId, { [key]: value }, ANA, undefined, { role: "edit" });
  await call("support", OP, "support_update", { case: 1, status: "fix_deployed", fix: { summary: "Tables show as cards on phones." } });
  expect(() => answer({ decision: "changes" })).toThrow("what's still wrong");
  expect(() => answer({ decision: "changes", note: "  " })).toThrow("what's still wrong");
  mail = [];
  answer({ decision: "changes", note: "Still blank on my iPhone." });
  await settled();
  expect(support.state(c.artifactId)[key]).toMatchObject({ decision: "changes", note: "Still blank on my iPhone.", by: ANA });
  expect(h.directory.supportCase(1)).toMatchObject({ status: "investigating" });
  expect((support.state(c.artifactId)["case/status"] as { status: string }).status).toBe("investigating");
  expect(h.directory.supportCase(1)!.events.slice(-2)).toMatchObject([
    { actor: ANA, event: "Still a problem: Still blank on my iPhone." },
    { actor: ANA, event: "Status: investigating" },
  ]);
  expect(h.directory.inbox(OP).items[0]).toMatchObject({ kind: "support", body: "Still blank on my iPhone.", url: `https://support.artifacts.test/a/${c.artifactId}` });
  expect(mail.filter((m) => m.to === OP && m.subject.includes("reopened"))).toHaveLength(1);
  // Their own answer isn't news to them.
  expect(mail.filter((m) => m.to === ANA)).toHaveLength(0);
  // A second fix asks again, and this time it worked.
  await call("support", OP, "support_update", { case: 1, status: "fix_deployed" });
  expect(support.state(c.artifactId)[key]).toBeUndefined();
  mail = [];
  answer({ decision: "approve" });
  await settled();
  expect(h.directory.supportCase(1)).toMatchObject({ status: "resolved" });
  expect(h.directory.supportCase(1)!.events.at(-2)).toMatchObject({ actor: ANA, event: "Confirmed the fix works" });
  expect(mail.filter((m) => m.to === ANA)).toHaveLength(0);
  // Resolved, and it comes back: saying so reopens it, which counts.
  answer({ decision: "changes", note: "It's back." });
  await settled();
  expect(h.directory.supportCase(1)).toMatchObject({ status: "investigating", reopened: 1 });
});

test("a released fix nobody answers about resolves after a week (or the days set), and says how to reopen", async () => {
  const { resolveUnanswered } = await import("../src/worker/support.ts");
  await report();
  await call("support", OP, "support_update", { case: 1, status: "fix_deployed" });
  const support = hubs.get("support") as InstanceType<typeof Workspace>;
  const c = h.directory.supportCase(1)!;
  const day = 86_400_000;
  // The workspace wakes for it when it's due, not before.
  expect(await (support as unknown as { ctx: DurableObjectState }).ctx.storage.getAlarm()).toBeGreaterThan(Date.now() + 6 * day);
  expect(await resolveUnanswered(env as never, support as never, Date.now() + 6 * day)).toEqual([]);
  expect(h.directory.supportCase(1)!.status).toBe("fix_deployed");
  mail = [];
  expect(await resolveUnanswered(env as never, support as never, Date.now() + 8 * day)).toEqual([1]);
  expect(h.directory.supportCase(1)!.status).toBe("resolved");
  expect(h.directory.supportCase(1)!.events.at(-2)).toMatchObject({ actor: "system", event: "No answer in 7 days: resolved automatically" });
  expect(support.threads(c.artifactId)[0].comments.at(-1)!.text).toContain("still a problem");
  expect(mail.filter((m) => m.to === ANA)).toHaveLength(1);
  // The number of days is the operator's to set.
  await call("support", OP, "support_update", { case: 1, status: "fix_deployed" });
  env.SUPPORT_AUTO_RESOLVE_DAYS = "2";
  expect(await resolveUnanswered(env as never, support as never, Date.now() + 3 * day)).toEqual([1]);
});

test("the assistant can read an artifact the person linked, in their own workspace, only while they can open it", async () => {
  const made = await h.hub.create({ title: "Tracker", files: { "index.mdx": "# Tracker\n", "data/board.json": '{"cards":["one"]}' }, owner: ADMIN });
  const secret = await h.hub.create({ title: "Payroll", files: { "index.mdx": "# Payroll\n" }, owner: ADMIN });
  if (!made.ok || !secret.ok) throw new Error("create");
  h.hub.share(made.id, { add: [{ email: ANA, role: "view" }] });
  const link = `https://acme.artifacts.test/a/${made.id}`;
  const other = `https://acme.artifacts.test/a/${secret.id}`;
  await call("acme", ANA, "support_report", { kind: "bug", title: "Board is blank", details: `See ${link} and ${other}.` });
  expect((await call("support", OP, "support_case", { case: 1 })).data.linked.map((l: { url: string }) => l.url)).toEqual([link, other]);
  const listed = await call("support", OP, "support_page", { case: 1, url: link });
  expect(listed.error).toBe(false);
  expect(listed.text).toContain("data/board.json");
  const source = await call("support", OP, "support_page", { case: 1, url: `${link}#top`, path: "data/board.json" });
  expect(source.text).toContain('{"cards":["one"]}');
  // Read once, logged once, where the person sees it.
  expect(h.directory.supportCase(1)!.events.filter((e) => e.event === `Read the linked page acme/a/${made.id}`)).toHaveLength(1);
  // Linking a page they can't open opens nothing; nor does a page they never linked, or losing access later.
  expect((await call("support", OP, "support_page", { case: 1, url: other })).text).toContain("can't open that page");
  const third = await h.hub.create({ title: "Plan", files: { "index.mdx": "# Plan\n" }, owner: ANA });
  if (!third.ok) throw new Error("create");
  expect((await call("support", OP, "support_page", { case: 1, url: `https://acme.artifacts.test/a/${third.id}` })).text).toContain("isn't linked");
  h.hub.share(made.id, { remove: [ANA] });
  expect((await call("support", OP, "support_page", { case: 1, url: link })).text).toContain("can't open that page");
  // Only the operator, on the support workspace.
  expect(await tools("acme", ANA)).not.toContain("support_page");
});
