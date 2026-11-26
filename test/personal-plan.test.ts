// The Personal plan next to Team: which product pays for which plan, checkout
// per plan, moving between paid plans, what happens past a smaller plan's
// limits, a replaced subscription canceled for the customer, and events that
// arrive resent, out of order or changed outside the app. Same harness as
// billing.test.ts.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { ADMIN, createHub, FakeKV, type Harness } from "./support/do-harness.ts";
import { planFor, readEvent } from "../src/worker/billing.ts";
import { PLANS } from "../src/worker/plans.ts";
import { POLICY_UPDATED } from "../src/worker/pages.ts";

const { default: worker } = await import("../src/worker/index.ts");

let h: Harness;
let env: Record<string, unknown>;
let calls: { url: string; method: string; body: any }[] = [];
let creemAnswer: (url: string, body: any) => Response = () => Response.json({});
const realFetch = globalThis.fetch;
const realError = console.error;
const APEX = "https://artifacts.test";
const ACME = "https://acme.artifacts.test";
const MEMBER = "member@example.com";
const SECRET = "whsec_test_creem_secret";
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const PRODUCTS = { team: "prod_team", personal: "prod_personal" } as const;

beforeEach(async () => {
  h = await createHub({ CREEM_PERSONAL_PRODUCT_ID: "prod_personal" } as never);
  await h.hub.setPlan("free");
  calls = [];
  creemAnswer = () => Response.json({});
  env = {
    ...h.env,
    WORKSPACE: { getByName: (slug: string) => (slug === "acme" ? h.hub : null) },
    OAUTH_KV: new FakeKV(),
    EMAIL: { send: async () => {} },
    CONSENT_SECRET: "test-consent-secret-that-is-long-enough",
    OPERATOR_TOKEN: "op-token",
    OPERATOR_EMAILS: "op@corp.com",
    APEX_HOST: "artifacts.test",
    WORKSPACE_SUFFIX: ".artifacts.test",
    MAIL_FROM: "sign-in@mail.artifacts.test",
    BILLING: "on",
    CREEM_API_KEY: "creem_test_abc",
    CREEM_WEBHOOK_SECRET: SECRET,
    CREEM_PRODUCT_ID: PRODUCTS.team,
    CREEM_PERSONAL_PRODUCT_ID: PRODUCTS.personal,
  };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method: init?.method ?? "GET", body });
    return creemAnswer(String(url), body);
  }) as typeof fetch;
  console.error = () => {};
});
afterEach(() => {
  globalThis.fetch = realFetch;
  console.error = realError;
});

async function send(path: string, init: RequestInit & { as?: string; host?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.as) {
    const res = await worker.fetch(
      new Request(`${APEX}/api/admin/session`, { method: "POST", headers: { Authorization: "Bearer op-token", "Content-Type": "application/json" }, body: JSON.stringify({ email: init.as, host: new URL(init.host ?? ACME).hostname }) }),
      env as never,
      ctx,
    );
    headers.set("Cookie", ((await res.json()) as { cookie: string }).cookie);
    headers.set("Origin", init.host ?? ACME);
  }
  return worker.fetch(new Request(`${init.host ?? ACME}${path}`, { ...init, headers }), env as never, ctx);
}
const post = (path: string, body: unknown = {}, as = ADMIN) => send(path, { as, method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

async function sign(body: string, secret = SECRET) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function webhook(payload: unknown, secret = SECRET) {
  const body = JSON.stringify(payload);
  return send("/api/billing/webhook", { host: APEX, method: "POST", body, headers: { "creem-signature": await sign(body, secret), "Content-Type": "application/json" } });
}

let clock = Date.parse("2026-11-26T12:00:00.000Z");
/** A subscription as Creem sends it; `updated_at` moves forward each time one is made, as it does at Creem. */
const sub = (plan: "team" | "personal", status = "active", over: Record<string, unknown> = {}) => ({
  id: "sub_1",
  object: "subscription",
  mode: "test",
  product: { id: PRODUCTS[plan], object: "product" },
  customer: { id: "cust_1", email: ADMIN },
  items: [{ object: "subscription_item", id: "sitem_1", product_id: PRODUCTS[plan], units: 1 }],
  status,
  current_period_end_date: new Date(Date.now() + 20 * 86_400_000).toISOString(),
  updated_at: new Date((clock += 1000)).toISOString(),
  metadata: { workspace: "acme" },
  ...over,
});
let n = 0;
const event = (eventType: string, object: unknown) => ({ id: `evt_${++n}`, eventType, created_at: Date.now() + n, object });
const kinds = () => (h.directory.opsEvents({}) as { kind: string }[]).map((e) => e.kind);
const opsOf = (kind: string) => h.directory.opsEvents({ kind }) as { message: string; detail: Record<string, unknown> | null }[];

test("Personal sits between Free and Team: no artifact cap, one member, less room than Team", () => {
  const { free, personal, team } = PLANS;
  expect(personal.limits).toMatchObject({ artifacts: null, members: 1 });
  expect(personal.limits.bytes!).toBeGreaterThan(free.limits.bytes!);
  expect(personal.limits.bytes!).toBeLessThan(team.limits.bytes!);
  for (const k of ["changesPerDay", "emailsPerDay", "checksPerDay"] as const) {
    expect(personal.limits[k]!).toBeGreaterThan(free.limits[k]!);
    expect(personal.limits[k]!).toBeLessThan(team.limits[k]!);
  }
  expect(planFor("personal", "active")).toEqual({ plan: "personal", until: null });
});

test("Free to Personal: the checkout is for Personal's product, and its payment puts the workspace on Personal", async () => {
  creemAnswer = () => Response.json({ checkout_url: "https://checkout.creem.io/ch_p" });
  expect(await (await post("/api/settings/billing/checkout", { plan: "personal" })).json()).toEqual({ url: "https://checkout.creem.io/ch_p" });
  expect(calls[0].body).toMatchObject({ product_id: PRODUCTS.personal, metadata: { workspace: "acme" } });
  expect(await (await webhook(event("subscription.paid", sub("personal")))).json()).toEqual({ ok: true, workspace: "acme", plan: "personal" });
  expect(h.hub.plan()).toMatchObject({ id: "personal", label: "Personal" });
  expect(h.directory.billing("acme")).toMatchObject({ plan: "personal", productId: PRODUCTS.personal, status: "active" });
  // One member: nobody else can be added, and the message points at Team.
  await expect(h.hub.setMember(MEMBER, "member", ADMIN)).rejects.toThrow(/Personal plan, which allows 1 members.*Team/);
  const settings = (await (await send("/api/settings", { as: ADMIN })).json()) as { plan: { id: string }; billing: { plans: Record<string, { ready: boolean; price: { amount: number } }>; subscription: { plan: string } } };
  expect(settings.billing.plans).toMatchObject({ personal: { ready: true, price: { amount: 10 } }, team: { ready: true, price: { amount: 25 } } });
  expect(settings.billing.subscription.plan).toBe("personal");
});

test("Personal is refused to a workspace with more than one member, at checkout", async () => {
  await h.hub.setMember(MEMBER, "member", ADMIN);
  const r = await post("/api/settings/billing/checkout", { plan: "personal" });
  expect(r.status).toBe(409);
  expect(((await r.json()) as { error: string }).error).toContain("Personal is for one person, and this workspace has 2 members");
  expect(calls).toHaveLength(0);
  // Team is still on offer.
  creemAnswer = () => Response.json({ checkout_url: "https://checkout.creem.io/ch_t" });
  expect((await post("/api/settings/billing/checkout", { plan: "team" })).status).toBe(200);
});

test("an abandoned Personal checkout isn't reopened when Team is chosen a minute later", async () => {
  let i = 0;
  creemAnswer = () => Response.json({ checkout_url: `https://checkout.creem.io/ch_${++i}` });
  const personal = (await (await post("/api/settings/billing/checkout", { plan: "personal" })).json()) as { url: string };
  const team = (await (await post("/api/settings/billing/checkout", { plan: "team" })).json()) as { url: string };
  expect(team.url).not.toBe(personal.url);
  expect(calls.map((c) => c.body.product_id)).toEqual([PRODUCTS.personal, PRODUCTS.team]);
  expect(calls[0].body.request_id).not.toBe(calls[1].body.request_id);
  // The same plan again does reopen its own.
  expect(((await (await post("/api/settings/billing/checkout", { plan: "team" })).json()) as { url: string }).url).toBe(team.url);
  expect(calls).toHaveLength(2);
});

test("Personal to Team: one call to Creem, charged pro rata now, Team at once; the webhook that follows changes nothing", async () => {
  await webhook(event("subscription.paid", sub("personal")));
  const after = sub("team");
  creemAnswer = () => Response.json(after);
  const r = await post("/api/settings/billing/plan", { plan: "team" });
  expect(await r.json()).toEqual({ plan: "team", upgraded: true, confirmed: true });
  expect(calls.at(-1)).toMatchObject({ url: "https://test-api.creem.io/v1/subscriptions/sub_1/upgrade", method: "POST", body: { product_id: PRODUCTS.team, update_behavior: "proration-charge-immediately" } });
  expect(h.hub.plan().id).toBe("team");
  await h.hub.setMember(MEMBER, "member", ADMIN);
  expect(await (await webhook(event("subscription.update", after))).json()).toEqual({ ok: true, workspace: "acme", plan: "team" });
  expect(h.hub.plan().id).toBe("team");
  expect(opsOf("billing").map((e) => e.message).filter((m) => m.includes("moved from"))).toEqual([`acme moved from Personal to Team (billed to ${ADMIN}). Plan now: team.`]);
});

test("Team to Personal: refused while there is more than one member; then at once, and Creem's refund of the unused part isn't an alert", async () => {
  await webhook(event("subscription.paid", sub("team")));
  await h.hub.setMember(MEMBER, "member", ADMIN);
  const blocked = await post("/api/settings/billing/plan", { plan: "personal" });
  expect(blocked.status).toBe(409);
  expect(calls).toHaveLength(0);
  await h.hub.setMember(MEMBER, null, ADMIN);
  const after = sub("personal");
  creemAnswer = () => Response.json(after);
  expect(await (await post("/api/settings/billing/plan", { plan: "personal" })).json()).toEqual({ plan: "personal", upgraded: false, confirmed: true });
  expect(h.hub.plan().id).toBe("personal");
  await webhook(event("refund.created", { id: "ref_1", object: "refund", subscription: { id: "sub_1", object: "subscription", metadata: { workspace: "acme" } } }));
  expect(kinds()).toContain("billing_proration_refund");
  expect(kinds()).not.toContain("billing_refund_or_dispute");
  // Only that one: the next refund, with no plan change behind it, alerts.
  await webhook(event("refund.created", { id: "ref_2", object: "refund", subscription: { id: "sub_1", object: "subscription", metadata: { workspace: "acme" } } }));
  expect(kinds()).toContain("billing_refund_or_dispute");
});

test("only the payer changes the plan, and only on a subscription that is paid up", async () => {
  expect((await post("/api/settings/billing/plan", { plan: "team" })).status).toBe(409); // no subscription
  await h.hub.setMember("payer@example.com", "admin", ADMIN);
  await webhook(event("subscription.paid", sub("team", "active", { customer: { id: "cust_1", email: "payer@example.com" } })));
  await h.hub.setMember("payer@example.com", null, ADMIN);
  expect((await post("/api/settings/billing/plan", { plan: "personal" })).status).toBe(403); // not the payer
  await webhook(event("subscription.past_due", sub("team", "past_due", { customer: { id: "cust_1", email: ADMIN } })));
  const overdue = await post("/api/settings/billing/plan", { plan: "personal" });
  expect(overdue.status).toBe(409);
  expect(((await overdue.json()) as { error: string }).error).toContain("Update the card");
  await webhook(event("subscription.scheduled_cancel", sub("team", "scheduled_cancel")));
  expect(((await (await post("/api/settings/billing/plan", { plan: "personal" })).json()) as { error: string }).error).toContain("canceled");
  expect(calls).toHaveLength(0);
});

test("Creem refusing a plan change (a discounted subscription) charges nothing and tells the operator; an outage asks to retry", async () => {
  await webhook(event("subscription.paid", sub("personal")));
  creemAnswer = () => new Response('{"message":"discount"}', { status: 400 });
  const refused = await post("/api/settings/billing/plan", { plan: "team" });
  expect(refused.status).toBe(409);
  expect(h.hub.plan().id).toBe("personal");
  expect(kinds()).toContain("billing_change_refused");
  creemAnswer = () => new Response("down", { status: 502 });
  expect((await post("/api/settings/billing/plan", { plan: "team" })).status).toBe(503);
  expect(h.hub.plan().id).toBe("personal");
});

test("canceling Personal keeps it until the paid period ends; a failed payment keeps it while Creem retries; then Free", async () => {
  await webhook(event("subscription.paid", sub("personal")));
  const end = new Date(Date.now() + 9 * 86_400_000).toISOString();
  expect(await (await webhook(event("subscription.scheduled_cancel", sub("personal", "scheduled_cancel", { current_period_end_date: end })))).json()).toEqual({ ok: true, workspace: "acme", plan: "personal", until: end });
  expect(h.hub.plan()).toMatchObject({ id: "personal", until: end });
  const realNow = Date.now;
  Date.now = () => Date.parse(end) + 1000;
  try {
    expect(h.hub.plan().id).toBe("free");
  } finally {
    Date.now = realNow;
  }
  // Resumed from the portal before the end: Personal again, with no end.
  await webhook(event("subscription.active", sub("personal")));
  expect(h.hub.plan()).toMatchObject({ id: "personal", until: null });
  const lapsed = new Date(Date.now() - 86_400_000).toISOString();
  await webhook(event("subscription.past_due", sub("personal", "past_due", { current_period_end_date: lapsed })));
  expect(h.hub.plan().id).toBe("personal");
  await webhook(event("subscription.canceled", sub("personal", "canceled", { current_period_end_date: lapsed })));
  expect(h.hub.plan().id).toBe("free");
  // Over Free's limits nothing is removed: the one member stays, and the record keeps which plan it was.
  expect(h.directory.billing("acme")).toMatchObject({ plan: "personal", status: "canceled" });
});

test("a product that isn't ours never grants a plan, and the operator hears", async () => {
  const stranger = sub("team", "active", { product: { id: "prod_other" }, items: [{ product_id: "prod_other" }] });
  expect(await (await webhook(event("subscription.paid", stranger))).json()).toEqual({ ok: true, ignored: true });
  expect(h.hub.plan().id).toBe("free");
  expect(opsOf("billing_unknown_product")[0]?.detail).toMatchObject({ productId: "prod_other" });
  // An existing subscription moved to such a product in Creem's dashboard keeps the plan it had.
  await webhook(event("subscription.paid", sub("personal")));
  await webhook(event("subscription.update", sub("personal", "active", { product: { id: "prod_other" }, items: [{ product_id: "prod_other" }] })));
  expect(h.hub.plan().id).toBe("personal");
});

test("a subscription that names two of our products is settled by asking Creem", async () => {
  await webhook(event("subscription.paid", sub("personal")));
  const mixed = sub("team", "active", { items: [{ product_id: PRODUCTS.personal }] });
  creemAnswer = () => Response.json(sub("team"));
  expect(readEvent(event("subscription.update", mixed), { [PRODUCTS.team]: "team", [PRODUCTS.personal]: "personal" })?.ambiguous).toBe(true);
  expect(await (await webhook(event("subscription.update", mixed))).json()).toEqual({ ok: true, workspace: "acme", plan: "team" });
  expect(calls.at(-1)).toMatchObject({ method: "GET", url: "https://test-api.creem.io/v1/subscriptions?subscription_id=sub_1" });
  // If Creem can't be asked, the delivery fails and its retry asks again.
  creemAnswer = () => new Response("down", { status: 500 });
  expect((await webhook(event("subscription.update", sub("personal", "active", { items: [{ product_id: PRODUCTS.team }] })))).status).toBe(500);
  expect(h.hub.plan().id).toBe("team");
});

test("a plan changed outside the app (Creem's dashboard or portal) is followed, and nobody is removed", async () => {
  await webhook(event("subscription.paid", sub("team")));
  await h.hub.setMember(MEMBER, "member", ADMIN);
  await h.hub.setMember("third@example.com", "member", ADMIN);
  expect(await (await webhook(event("subscription.update", sub("personal")))).json()).toMatchObject({ plan: "personal" });
  expect(h.hub.plan()).toMatchObject({ id: "personal", usage: { members: 3 } });
  await expect(h.hub.setMember("fourth@example.com", "member", ADMIN)).rejects.toThrow(/Personal plan/);
});

test("a manual resend of an old event (new id and time, old subscription) no longer undoes a newer one", async () => {
  const old = sub("personal", "past_due", { current_period_end_date: "2020-01-01T00:00:00.000Z" });
  await webhook(event("subscription.paid", sub("personal")));
  expect(h.hub.plan().id).toBe("personal");
  // Resent from Creem's dashboard: a fresh event id and created_at around the subscription as it was back then.
  await webhook(event("subscription.past_due", old));
  expect(h.hub.plan().id).toBe("personal");
  expect(h.directory.billing("acme")?.status).toBe("active");
  // A real later change still applies.
  await webhook(event("subscription.past_due", sub("personal", "past_due", { current_period_end_date: "2020-01-01T00:00:00.000Z" })));
  expect(h.hub.plan().id).toBe("free");
});

test("without Personal's product set, Personal isn't sold and Team works as before", async () => {
  delete env.CREEM_PERSONAL_PRODUCT_ID;
  expect((await post("/api/settings/billing/checkout", { plan: "personal" })).status).toBe(503);
  creemAnswer = () => Response.json({ checkout_url: "https://checkout.creem.io/ch_t" });
  expect((await post("/api/settings/billing/checkout", { plan: "team" })).status).toBe(200);
  expect(calls[0].body.product_id).toBe(PRODUCTS.team);
  // The pricing page and settings don't offer it, and the public pages don't mention it.
  const settings = (await (await send("/api/settings", { as: ADMIN })).json()) as { billing: { plans: Record<string, { ready: boolean; offered: boolean }> } };
  expect(settings.billing.plans).toMatchObject({ personal: { ready: false, offered: false }, team: { ready: true, offered: true } });
  const pricing = await (await send("/pricing", { host: APEX })).text();
  expect(pricing).not.toContain("Personal");
  expect(pricing).toContain(`href="/workspaces?plan=team">Get Team</a>`);
  expect((await send("/workspaces?plan=personal", { host: APEX, redirect: "manual" })).headers.get("Location")).toBe(`${APEX}/login?return=/workspaces`);
  await webhook(event("subscription.paid", sub("team")));
  expect(h.hub.plan().id).toBe("team");
  // Someone already on Personal keeps it while the id is missing: the unknown product never changes a plan.
  await webhook(event("subscription.update", sub("personal")));
  expect(h.hub.plan().id).toBe("team");
  expect(kinds()).toContain("billing_unknown_product");
});

test("a subscription recorded before Personal existed is Team", async () => {
  h.directory.ctx.storage.sql.exec(
    `INSERT INTO billing (slug, provider, customer_id, subscription_id, status, period_end, event_at, updated_at) VALUES ('acme', 'creem', 'cust_1', 'sub_1', 'active', NULL, 1, ?)`,
    new Date().toISOString(),
  );
  expect(h.directory.billing("acme")).toMatchObject({ plan: "team", productId: null });
  expect(h.directory.billingPlan("acme")).toEqual({ plan: "team", until: null });
});

test("two subscriptions for one workspace: the later one takes over and the app cancels the one it replaced", async () => {
  await webhook(event("subscription.paid", sub("personal")));
  // The other plan's checkout, opened before the first payment landed, gets paid too.
  const second = sub("team", "active", { id: "sub_2" });
  expect(await (await webhook(event("subscription.paid", second))).json()).toEqual({ ok: true, workspace: "acme", plan: "team" });
  expect(calls.at(-1)).toMatchObject({ url: "https://test-api.creem.io/v1/subscriptions/sub_1/cancel", method: "POST", body: { mode: "immediate" } });
  expect(opsOf("billing_replaced")[0]).toMatchObject({ message: expect.stringContaining("was canceled automatically. If they paid for both, refund the replaced one in Creem."), detail: { replaced: "sub_1", canceled: "now" } });
  // Creem's canceled event for the old one, and its old payment event resent by hand, change nothing.
  await webhook(event("subscription.canceled", sub("personal", "canceled")));
  await webhook(event("subscription.paid", sub("personal")));
  expect(h.directory.billing("acme")).toMatchObject({ subscriptionId: "sub_2", plan: "team", status: "active" });
  expect(h.hub.plan().id).toBe("team");
  expect(calls.filter((c) => c.url.endsWith("/cancel"))).toHaveLength(1);
});

test("a replaced subscription that can't be canceled alerts the operator; one already canceled isn't canceled again", async () => {
  await webhook(event("subscription.paid", sub("team")));
  creemAnswer = () => new Response("down", { status: 502 });
  await webhook(event("subscription.paid", sub("team", "active", { id: "sub_2" })));
  expect(h.hub.plan().id).toBe("team");
  expect(opsOf("billing_replaced")[0]).toMatchObject({ message: expect.stringContaining("which it replaces, failed. Cancel that one in Creem"), detail: { canceled: "failed" } });
  // Canceled with paid time left, then subscribed again (to Personal this time): nothing to cancel.
  calls = [];
  await webhook(event("subscription.canceled", sub("team", "canceled", { id: "sub_2" })));
  expect(h.hub.plan()).toMatchObject({ id: "team", until: expect.any(String) });
  creemAnswer = () => Response.json({ checkout_url: "https://checkout.creem.io/ch_again" });
  expect((await post("/api/settings/billing/checkout", { plan: "personal" })).status).toBe(200);
  await webhook(event("subscription.paid", sub("personal", "active", { id: "sub_3" })));
  expect(h.hub.plan()).toMatchObject({ id: "personal", until: null });
  expect(calls.filter((c) => c.url.endsWith("/cancel"))).toHaveLength(0);
  expect(h.directory.opsEvents({ kind: "billing_replaced" })[0].detail).toMatchObject({ replaced: "sub_2", canceled: "already" });
});

test("a plan change Creem accepts but doesn't show as paid up on the new product isn't applied; its events settle it", async () => {
  await webhook(event("subscription.paid", sub("personal")));
  // The pro-rated charge didn't go through: the answer is still the old product.
  creemAnswer = () => Response.json(sub("personal"));
  expect(await (await post("/api/settings/billing/plan", { plan: "team" })).json()).toEqual({ plan: "personal", upgraded: true, confirmed: false });
  // Or it names the new product, overdue.
  creemAnswer = () => Response.json(sub("team", "past_due"));
  expect(await (await post("/api/settings/billing/plan", { plan: "team" })).json()).toEqual({ plan: "personal", upgraded: true, confirmed: false });
  expect(h.directory.billing("acme")).toMatchObject({ plan: "personal", status: "active" });
  expect(opsOf("billing_change_unconfirmed")).toHaveLength(1);
  // The charge succeeds later: Creem's event moves it.
  await webhook(event("subscription.update", sub("team")));
  expect(h.hub.plan().id).toBe("team");
});

test("after a plan change, an older event that arrives late doesn't undo it, and a refund after an upgrade still alerts", async () => {
  const before = sub("personal");
  await webhook(event("subscription.paid", before));
  creemAnswer = () => Response.json(sub("team"));
  await post("/api/settings/billing/plan", { plan: "team" });
  // Creem's own event for the Personal period, delivered late (a retry): the subscription in it is from before the change.
  await webhook(event("subscription.active", before));
  expect(h.hub.plan().id).toBe("team");
  await webhook(event("refund.created", { id: "ref_up", object: "refund", subscription: { id: "sub_1", object: "subscription", metadata: { workspace: "acme" } } }));
  expect(kinds()).toContain("billing_refund_or_dispute");
  expect(kinds()).not.toContain("billing_proration_refund");
});

test("moving to a smaller plan keeps everything; past its limits nothing new is added until it's back under", async () => {
  await webhook(event("subscription.paid", sub("team")));
  const files = { "index.mdx": "# One\n" };
  const first = await h.hub.create({ title: "One", files, owner: ADMIN });
  const second = await h.hub.create({ title: "Two", files, owner: ADMIN });
  if (!first.ok || !second.ok) throw new Error("create");
  const limits = PLANS.personal.limits;
  const free = PLANS.free.limits;
  const real = { bytes: limits.bytes, artifacts: free.artifacts };
  limits.bytes = 1;
  free.artifacts = 1;
  try {
    // Team to Personal over Personal's storage: both artifacts stay and open, and nothing more can be stored.
    creemAnswer = () => Response.json(sub("personal"));
    expect(await (await post("/api/settings/billing/plan", { plan: "personal" })).json()).toMatchObject({ plan: "personal", confirmed: true });
    expect(h.hub.list(ADMIN)).toHaveLength(2);
    await expect(h.hub.create({ title: "Three", files, owner: ADMIN })).rejects.toThrow(/Personal plan, which allows .* of storage.*move the workspace to Team/);
    // The new plan's daily caps apply from the next save.
    expect(h.hub.plan().limits).toMatchObject({ changesPerDay: 1500, checksPerDay: 200, emailsPerDay: 200 });
    limits.bytes = real.bytes;
    // Personal to Free over Free's artifact limit: the same rule, and deleting makes room.
    await webhook(event("subscription.canceled", sub("personal", "canceled", { current_period_end_date: new Date(Date.now() - 1000).toISOString() })));
    expect(h.hub.plan()).toMatchObject({ id: "free", usage: { artifacts: 2 } });
    await expect(h.hub.create({ title: "Three", files, owner: ADMIN })).rejects.toThrow(/Free plan, which allows 1 artifacts.*move the workspace to Personal \(10 USD a month\) or Team \(25 USD a month\)/);
    h.hub.delete(first.id);
    h.hub.delete(second.id);
    expect((await h.hub.create({ title: "Three", files, owner: ADMIN })).ok).toBe(true);
  } finally {
    limits.bytes = real.bytes;
    free.artifacts = real.artifacts;
  }
});

test("on Personal, someone from a join domain stays a guest, and a trial or a payment waiting on the bank keeps the plan", async () => {
  expect(await (await webhook(event("subscription.trialing", sub("personal", "trialing")))).json()).toMatchObject({ plan: "personal" });
  await h.hub.setJoinDomains(["example.com"], ADMIN);
  expect(await h.hub.autoJoin("newcomer@example.com")).toBeNull();
  expect(h.hub.plan().usage.members).toBe(1);
  // "incomplete": not paid yet, but not ended either. The plan is kept for the same two weeks as a failed payment.
  const end = new Date(Date.now() - 86_400_000).toISOString();
  await webhook(event("subscription.update", sub("personal", "incomplete", { current_period_end_date: end })));
  expect(h.hub.plan()).toMatchObject({ id: "personal", until: new Date(Date.parse(end) + 14 * 86_400_000).toISOString() });
  expect(planFor("personal", "incomplete", end, Date.parse(end) + 15 * 86_400_000)).toEqual({ plan: "free", until: null });
});

test("a paid workspace changes plan instead of checking out again; a paused one resumes first; one arranged with us has nothing to change", async () => {
  await webhook(event("subscription.paid", sub("personal")));
  const again = await post("/api/settings/billing/checkout", { plan: "team" });
  expect(again.status).toBe(400);
  expect(((await again.json()) as { error: string }).error).toBe("This workspace is already on Personal. Change its plan from Plan and billing instead.");
  expect((await post("/api/settings/billing/plan", { plan: "personal" })).status).toBe(400); // already on it
  expect((await post("/api/settings/billing/plan", { plan: "gold" })).status).toBe(400);
  await webhook(event("subscription.paused", sub("personal", "paused")));
  expect(((await (await post("/api/settings/billing/plan", { plan: "team" })).json()) as { error: string }).error).toContain("paused");
  await webhook(event("subscription.active", sub("personal")));
  await h.hub.setFreeTeam(true);
  expect(((await (await post("/api/settings/billing/plan", { plan: "team" })).json()) as { error: string }).error).toContain("arranged with us");
  expect(calls).toHaveLength(0);
  // An abandoned checkout records nothing.
  await h.hub.setFreeTeam(false);
});

test("an abandoned checkout leaves no record and the workspace as it was", async () => {
  creemAnswer = () => Response.json({ checkout_url: "https://checkout.creem.io/ch_p" });
  await post("/api/settings/billing/checkout", { plan: "personal" });
  expect(h.directory.billing("acme")).toBeNull();
  expect(h.hub.plan().id).toBe("free");
});

test("the pricing page leads with Personal between Free and Team, and carries the chosen plan to the workspace's settings", async () => {
  env.SELF_SERVE = "on";
  const page = await (await send("/pricing", { host: APEX })).text();
  const cards = [...page.matchAll(/<div class="splash-card pricing-card"><h2>([^<]+)<\/h2><p class="pricing-price">\$(\d+)/g)].map((m) => [m[1], m[2]]);
  expect(cards).toEqual([["Free", "0"], ["Personal", "10"], ["Team", "25"]]);
  // Personal's button is the page's one primary button.
  expect(page).toContain(`<a class="button" href="/workspaces?plan=personal">Get Personal</a>`);
  expect(page).toContain(`<a class="button secondary" href="/workspaces?plan=team">Get Team</a>`);
  expect(page).toContain("2 GB of storage, 1,500 saves, 200 render checks and 200 emails a day");
  expect(page).toContain("Personal at $10 a month for one person, Team at $25 a month");
  const home = await (await send("/", { host: APEX })).text();
  expect(home).toContain(`"name":"Personal","price":"10","priceCurrency":"USD"`);
  const terms = await (await send("/terms", { host: APEX })).text();
  expect(terms).toContain("Each workspace is on Free, Personal or Team.");
  expect(terms).toContain(`Last updated ${POLICY_UPDATED}`);
  expect(POLICY_UPDATED >= "2026-11-26").toBe(true);
  // Signed out, the choice survives sign-in (so does coming back from checkout); signed in, each workspace's settings link carries it.
  expect((await send("/settings?billing=done", { redirect: "manual" })).headers.get("Location")).toBe(`${ACME}/login?return=${encodeURIComponent("/settings?billing=done")}`);
  expect((await send("/workspaces?plan=personal", { host: APEX, redirect: "manual" })).headers.get("Location")).toBe(`${APEX}/login?return=${encodeURIComponent("/workspaces?plan=personal")}`);
  expect((await send("/workspaces?plan=gold", { host: APEX, redirect: "manual" })).headers.get("Location")).toBe(`${APEX}/login?return=/workspaces`);
  await h.directory.setMembership("acme", ADMIN, "admin");
  const mine = await (await send("/workspaces?plan=personal", { host: APEX, as: ADMIN })).text();
  expect(mine).toContain(`/settings?plan=personal#plan-and-billing"`);
  expect(mine).toContain("Choose the workspace to put on Personal");
});

test("a second subscription whose payment is delivered late is the one canceled, not left charging unseen", async () => {
  // Two checkouts both paid. The first one's event failed its first delivery, so the second's arrives first.
  const first = event("subscription.paid", sub("personal"));
  const second = event("subscription.paid", sub("team", "active", { id: "sub_2" }));
  await webhook(second);
  expect(await (await webhook(first)).json()).toEqual({ ok: true, workspace: "acme", plan: "team" });
  expect(h.directory.billing("acme")).toMatchObject({ subscriptionId: "sub_2", plan: "team" });
  expect(calls.at(-1)).toMatchObject({ url: "https://test-api.creem.io/v1/subscriptions/sub_1/cancel", body: { mode: "immediate" } });
  expect(opsOf("billing_replaced")[0]).toMatchObject({ message: expect.stringContaining("it keeps sub_2, and sub_1, which it replaces, was canceled automatically"), detail: { subscriptionId: "sub_2", replaced: "sub_1" } });
  // The retry of that delivery, and anything else the canceled one sends, changes nothing more.
  await webhook(first);
  await webhook(event("subscription.paid", sub("personal")));
  expect(h.directory.billing("acme")).toMatchObject({ subscriptionId: "sub_2", plan: "team" });
  expect(calls.filter((c) => c.url.endsWith("/cancel"))).toHaveLength(1);
});

test("an event made before a plan change loses to it even when it carries no updated_at", async () => {
  await webhook(event("subscription.paid", sub("personal")));
  const late = event("subscription.active", sub("personal", "active", { updated_at: undefined }));
  late.created_at = Date.now() - 60_000;
  creemAnswer = () => Response.json(sub("team"));
  await post("/api/settings/billing/plan", { plan: "team" });
  await webhook(late);
  expect(h.hub.plan().id).toBe("team");
});

test("where Personal isn't sold, the limit message and the terms don't name it", async () => {
  delete env.CREEM_PERSONAL_PRODUCT_ID;
  const terms = await (await send("/terms", { host: APEX })).text();
  expect(terms).toContain("Each workspace is on Free or Team.");
  expect(terms).toContain("Team is $25 a month per workspace");
  expect(terms).not.toContain("Personal");
  env.CREEM_PERSONAL_PRODUCT_ID = PRODUCTS.personal;
  expect(await (await send("/terms", { host: APEX })).text()).toContain("Personal is $10 a month per workspace, for one member");
});
