// Product support, built from artifacts: each request is a page in the
// operator's support workspace (made on first use), shared only with the
// person who sent it. Their message starts the page's comment thread, which is
// the conversation; MCP events on that workspace (comment.created,
// artifact.answered) wake the operator's assistant. Status lives in the page's
// `case/status`, written only here. Announcements to several people go out only
// once the operator approves them in their inbox. Product errors are grouped by
// fingerprint (no content, no secrets) and can be attached to a request.
// A released fix asks the person whether it worked: "yes" resolves the request,
// "no" (with a note) reopens it and tells the operator, and no answer resolves
// it after a while. Each request keeps its approved plan and a log of what
// happened, both on its page.
import type { CaseEvent, DirectoryApi, SupportCase } from "./directory.ts";
import type { HubApi } from "./hub.ts";
import type { JsonValue } from "../shared/protocol.ts";
import { sendOperatorNote, sendSupportUpdate } from "./mail.ts";
import { ops } from "./ops.ts";
import { APP_VERSION } from "./pages.ts";

export type SupportEnv = {
  DIRECTORY: DurableObjectNamespace;
  WORKSPACE: DurableObjectNamespace;
  WORKSPACE_SUFFIX: string;
  APEX_ORIGIN?: string;
  OPERATOR_EMAILS?: string;
  EMAIL?: SendEmail;
  MAIL_FROM: string;
  /** Days a released fix waits for the person's answer before the request resolves by itself (default 7). */
  SUPPORT_AUTO_RESOLVE_DAYS?: string;
};

export const SUPPORT_SLUG = "support";
export const CASE_KINDS = ["bug", "feature", "question"] as const;
export type CaseKind = (typeof CASE_KINDS)[number];
export const CASE_STATUSES = ["new", "triaged", "investigating", "needs_info", "fix_proposed", "fix_deployed", "resolved", "wont_fix", "duplicate"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
const KIND_LABEL: Record<CaseKind, string> = { bug: "problem", feature: "idea", question: "question" };
/** Status changes the person hears about (others show on the page only). */
const TELL: Partial<Record<CaseStatus, string>> = {
  needs_info: "We need a little more from you",
  fix_deployed: "A fix is out: does it work for you?",
  resolved: "Resolved",
  wont_fix: "Closed",
  duplicate: "Being handled with another report",
};
const TITLE_MAX = 120;
const DETAILS_MAX = 5000;
const PLAN_MAX = 10_000;
const EVENT_MAX = 300;
const AUTO_RESOLVE_DAYS = 7;
/** Linked pages looked at per request: enough for any real report. */
const LINKS_MAX = 20;

/** A stored time (UTC) as ISO 8601 with its offset written out, so nobody reads it as local time. */
export function stamp(iso: string): string {
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(iso) ? `${iso.slice(0, 19)}+00:00` : iso;
}
/** The same for an email: "2026-11-20 08:18 UTC (+00:00)". */
export function utcStamp(at: string | number): string {
  const iso = new Date(at).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC (+00:00)`;
}

export function autoResolveDays(env: Pick<SupportEnv, "SUPPORT_AUTO_RESOLVE_DAYS">): number {
  const n = Number(env.SUPPORT_AUTO_RESOLVE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : AUTO_RESOLVE_DAYS;
}

const dir = (env: SupportEnv) => env.DIRECTORY.getByName("directory") as unknown as DirectoryApi;
const hubOf = (env: SupportEnv, slug: string) => env.WORKSPACE.getByName(slug) as unknown as HubApi;
const supportOrigin = (env: SupportEnv) => `https://${SUPPORT_SLUG}${env.WORKSPACE_SUFFIX}`;
const apex = (env: SupportEnv) => (env.APEX_ORIGIN ?? "").replace(/\/+$/, "");

export function operators(env: Pick<SupportEnv, "OPERATOR_EMAILS">): string[] {
  return (env.OPERATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}
export const isOperator = (env: Pick<SupportEnv, "OPERATOR_EMAILS">, email: string | null) => Boolean(email && operators(env).includes(email.toLowerCase()));
export const caseUrl = (env: SupportEnv, c: Pick<SupportCase, "artifactId">) => `${supportOrigin(env)}/a/${c.artifactId}`;

export class SupportError extends Error {}

/**
 * The support workspace, made the first time it's needed: the operators are its admins, and hear of it through
 * their assistant (their own notifications there start muted). Safe to run again after a failure partway, and
 * from two first requests at once.
 */
export async function supportHub(env: SupportEnv): Promise<HubApi> {
  const hub = hubOf(env, SUPPORT_SLUG);
  const d = dir(env);
  const [first, ...rest] = operators(env);
  if (!first) throw new SupportError("support isn't set up: OPERATOR_EMAILS is empty");
  if (!(await d.workspace(SUPPORT_SLUG))) {
    try {
      await d.createWorkspace(SUPPORT_SLUG, "Support");
    } catch (err) {
      if (!(await d.workspace(SUPPORT_SLUG))) throw err;
    }
  }
  if (await hub.exists()) {
    // Support is never limited by a plan.
    if (!(await hub.plan()).free) await hub.setFreeTeam(true);
    return hub;
  }
  try {
    await hub.provision({ slug: SUPPORT_SLUG, name: "Support", admin: first, plan: "team" });
    await hub.setFreeTeam(true);
  } catch (err) {
    // The other first request provisioned it meanwhile.
    if (!(await hub.exists())) throw err;
    return hub;
  }
  // Nice to have; a failure here mustn't take support down.
  try {
    for (const op of rest) await hub.setMember(op, "admin", first);
    for (const op of [first, ...rest]) await hub.setWatchDefault(op, "mute");
  } catch (err) {
    console.error("setting up the support workspace's operators failed", err);
  }
  return hub;
}

export type NewCase = {
  reporter: string;
  viaAgent: boolean;
  kind: CaseKind;
  title: string;
  details: string;
  /** What the person agreed to share: never artifact content. */
  context?: { workspace?: string; page?: string; browser?: string };
  /** An error id from an error page or support_errors. */
  errorId?: string;
};

/** Opens a request: its page, the person's message as the start of the conversation, internal notes, and word to the person. */
export async function openCase(env: SupportEnv, input: NewCase): Promise<{ number: number; url: string }> {
  const reporter = input.reporter.toLowerCase();
  const title = input.title.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX);
  const details = input.details.trim().slice(0, DETAILS_MAX);
  if (!CASE_KINDS.includes(input.kind)) throw new SupportError(`kind is one of ${CASE_KINDS.join(", ")}`);
  if (!title) throw new SupportError("Give the request a short title.");
  if (!details) throw new SupportError("Say what happened, or what you'd like.");
  const d = dir(env);
  if (!(await d.allowCase(reporter))) throw new SupportError("That's a lot of requests today; reply in an open one, or try again tomorrow.");
  const hub = await supportHub(env);
  const operator = operators(env)[0];
  const error = input.errorId ? (await d.errorGroups({ fp: input.errorId }))[0] : undefined;
  const n = await d.addCase({ artifactId: "", notesId: null, reporter, viaAgent: input.viaAgent, workspace: input.context?.workspace ?? null, kind: input.kind, title, errorGroup: error?.fp ?? null });
  const made: string[] = [];
  let id: string;
  try {
    const caseData = {
      number: n,
      kind: input.kind,
      title,
      reporter,
      submittedAt: new Date().toISOString(),
      viaAgent: input.viaAgent,
      context: { ...input.context, version: APP_VERSION },
      error: error ? { id: error.fp, message: error.message } : null,
    };
    const page = await hub.create({
      title: `#${n} · ${title}`,
      description: `A ${KIND_LABEL[input.kind]} from ${reporter}`,
      files: { "index.mdx": '<SupportCase data="case.json" />\n', "data/case.json": JSON.stringify(caseData, null, 2) },
      owner: operator,
    });
    if (!page.ok) throw new SupportError(`couldn't make the request's page: ${page.errors.map((e) => e.message).join("; ")}`);
    id = page.id;
    made.push(id);
    await hub.share(id, { add: [{ email: reporter, role: "edit" }] });
    const text = input.viaAgent ? `${details}\n\n(Sent by ${reporter}'s agent on their behalf.)` : details;
    const thread = await hub.addComment(id, reporter, { text }, supportOrigin(env), undefined, "edit");
    const now = new Date().toISOString();
    await hub.setState(id, { "case/status": { status: "new", at: now, thread: thread.id, history: [{ status: "new", at: now }] } }, null);
    // Investigation notes: the operator's alone. Nothing the person wrote goes into this page's source.
    const notes = await hub.create({
      title: `#${n} · internal notes`,
      description: "Not shared with the person who sent the request",
      files: { "index.mdx": `# Request #${n}: internal notes\n\nFor [the request](/a/${id}). Not shared with the person who sent it.\n\n<Notes id="investigation" />\n` },
      owner: operator,
    });
    if (notes.ok) made.push(notes.id);
    await d.attachCase(n, id, notes.ok ? notes.id : null);
  } catch (err) {
    // Nothing half-made stays: no page the person can open for a request that isn't recorded.
    for (const a of made) await hub.delete(a).catch(() => {});
    await d.dropCase(n);
    throw err;
  }
  const url = `${supportOrigin(env)}/a/${id}`;
  // The request exists now; telling people about it is best effort, so a retry can't make a second one.
  try {
    await d.addInbox(reporter, { kind: "support", title: `We got your ${KIND_LABEL[input.kind]} (#${n})`, body: title, url, dedupe: `case:${n}:new`, slug: SUPPORT_SLUG, artifact: id });
    await sendSupportUpdate(env, reporter, {
      subject: `We got your ${KIND_LABEL[input.kind]}: ${title}`,
      lines: [`Thanks. Your request #${n} is with us.`, "Replies, questions and fixes show up on its page, and we'll let you know when something changes."],
      url,
    });
    await ops(env, { kind: "support_case", slug: SUPPORT_SLUG, message: `#${n} ${input.kind} from ${reporter}${input.viaAgent ? " (via agent)" : ""}: "${title}"`, detail: { case: n, artifactId: id } });
  } catch (err) {
    console.error("telling people about a new request failed", n, err);
  }
  return { number: n, url };
}

/** Replies a person's agent may add to one request a day: enough to answer questions, not to run a loop. */
const AGENT_REPLIES_PER_DAY = 10;

/** A person (through their agent) adds to their own request's conversation; it wakes the operator's assistant like any reply. */
export async function replyToCase(env: SupportEnv, input: { n: number; person: string; message: string }): Promise<{ url: string }> {
  const d = dir(env);
  const c = await d.supportCase(input.n);
  if (!c || !c.artifactId || c.reporter !== input.person.toLowerCase()) throw new SupportError(`no request #${input.n} of yours; see support_requests`);
  const text = input.message.trim().slice(0, DETAILS_MAX);
  if (!text) throw new SupportError("the reply is empty");
  const hub = hubOf(env, SUPPORT_SLUG);
  const thread = ((await hub.state(c.artifactId))["case/status"] as { thread?: string } | undefined)?.thread;
  const day = new Date(Date.now() - 86_400_000).toISOString();
  const threads = (await hub.threads(c.artifactId)) as { id: string; comments: { by: string; at: string; text: string }[] }[];
  const recentReplies = threads.flatMap((t) => t.comments).filter((x) => x.by === c.reporter && x.at > day && x.text.endsWith("(Sent by their agent.)")).length;
  if (recentReplies >= AGENT_REPLIES_PER_DAY) throw new SupportError("that's enough replies from an agent for today; the person can reply on the request's page");
  await hub.addComment(c.artifactId, c.reporter, { ...(thread ? { thread } : {}), text: `${text}\n\n(Sent by their agent.)` }, supportOrigin(env), undefined, "edit");
  return { url: caseUrl(env, c) };
}

export type CaseUpdate = {
  n: number;
  status?: CaseStatus;
  /** Shown to the person in the conversation (as the assistant). */
  message?: string;
  /** What fixed it, for the page and the record: a summary the person can read, the version, the change. */
  fix?: { summary?: string; version?: string; commit?: string; pr?: string };
  duplicateOf?: number | null;
  errorId?: string | null;
  /** The approved plan for working it (text or Markdown), shown on the request's page; null removes it. */
  plan?: string | null;
  /** A line for the request's log, shown on its page. */
  event?: string;
  /** Who is making the change, for the log: "agent" (the default), "system", or the person's address. */
  actor?: string;
};

/**
 * Moves a request along. The person sees status changes on the page; some (TELL) they're also told about, in one
 * email that carries the message too. `hub` is the support workspace when the caller is that workspace itself.
 */
export async function updateCase(env: SupportEnv, u: CaseUpdate, hub: HubApi = hubOf(env, SUPPORT_SLUG)): Promise<SupportCase> {
  const d = dir(env);
  const before = await d.supportCase(u.n);
  if (!before || !before.artifactId) throw new SupportError(`no request #${u.n}`);
  if (u.status && !CASE_STATUSES.includes(u.status)) throw new SupportError(`status is one of ${CASE_STATUSES.join(", ")}`);
  if (u.duplicateOf !== undefined && u.duplicateOf !== null) {
    if (u.duplicateOf === u.n || !(await d.supportCase(u.duplicateOf))) throw new SupportError(`no other request #${u.duplicateOf}`);
  }
  if (u.errorId && !(await d.errorGroups({ fp: u.errorId })).length) throw new SupportError(`no error ${u.errorId}`);
  // Marking a duplicate makes it one, unless a status is given or it's already closed.
  const closed = ["resolved", "wont_fix"].includes(before.status);
  const status: CaseStatus = u.status ?? (u.duplicateOf && !closed ? "duplicate" : (before.status as CaseStatus));
  const plan = u.plan === undefined ? undefined : u.plan?.trim() || null;
  if (plan && plan.length > PLAN_MAX) throw new SupportError(`the plan is limited to ${PLAN_MAX} characters; keep the detail in the notes artifact`);
  const actor = u.actor ?? "agent";
  const page = await hub.state(before.artifactId);
  const state = page["case/status"] as { status?: string; at?: string; thread?: string; history?: { status: string; at: string }[] } | undefined;
  const answer = `approve/fixed/${before.reporter}`;
  const now = new Date().toISOString();
  // Against the record and what the page shows, so a retry after a failure partway (the page written, the record
  // not) still logs the change and tells the person.
  const shown = (state?.status ?? before.status) !== status;
  const changed = before.status !== status || shown;
  const fix = u.fix ? { ...(before.fix ?? {}), ...u.fix } : before.fix;
  const history = shown ? [...(state?.history ?? []), { status, at: now }] : (state?.history ?? []);
  // The page first, the record after: what the person sees is never behind what the record says.
  await hub.setState(
    before.artifactId,
    {
      "case/status": {
        status,
        at: shown ? now : (state?.at ?? now),
        thread: state?.thread ?? null,
        history,
        // What the person sees: no commit or PR, just what changed and in which version.
        ...(fix?.summary || fix?.version ? { fix: { summary: String(fix.summary ?? ""), version: String(fix.version ?? "") } } : {}),
      } as JsonValue,
      // A fix released again asks again: what they said about the last one no longer stands.
      ...(changed && status === "fix_deployed" && page[answer] !== undefined ? { [answer]: null } : {}),
    },
    null,
  );
  // The person hears of a change they didn't make themselves.
  const tell = changed && actor !== before.reporter ? TELL[status] : undefined;
  const message = u.message?.trim().slice(0, DETAILS_MAX);
  let emailed = false;
  if (tell) {
    const url = caseUrl(env, before);
    // Once per change (the same status later, after something else, is a new change).
    const fresh = await d.addInbox(before.reporter, { kind: "support", title: `${tell} (#${u.n})`, body: before.title, url, dedupe: `case:${u.n}:${status}:${history.length}`, slug: SUPPORT_SLUG, artifact: before.artifactId });
    if (fresh) {
      const lines = [
        `Your request #${u.n}: ${tell.toLowerCase()}${/[?.!]$/.test(tell) ? "" : "."}`,
        ...(message ? [message] : []),
        ...(status === "fix_deployed"
          ? [`If we don't hear from you by ${utcStamp(Date.parse(now) + autoResolveDays(env) * 86_400_000)}, we'll mark it resolved. You can still reply after that and we'll pick it up again.`]
          : []),
        `Updated ${utcStamp(now)}.`,
      ];
      emailed = await sendSupportUpdate(env, before.reporter, { subject: `${tell}: ${before.title}`, lines, url }).then(
        () => true,
        (err) => (console.error("support email failed", err), false),
      );
    }
  }
  if (message) {
    // The status email carried the message, so the comment's own notification to them is left out; if that email
    // didn't go, the comment notifies as usual.
    await hub.addComment(before.artifactId, "agent", { thread: state?.thread, text: message, ...(emailed ? { onBehalf: before.reporter } : {}) }, supportOrigin(env));
  }
  const planChanged = plan !== undefined && plan !== before.plan;
  const said = u.event?.trim().replace(/\s+/g, " ").slice(0, EVENT_MAX);
  const added: CaseEvent[] = [
    ...(said ? [{ at: now, actor, event: said }] : []),
    ...(changed ? [{ at: now, actor, event: `Status: ${status}`, status }] : []),
    ...(planChanged ? [{ at: now, actor, event: plan === null ? "Plan removed" : before.plan ? "Plan changed" : "Plan set" }] : []),
  ];
  const after = (await d.updateCase(u.n, {
    status,
    ...(u.duplicateOf !== undefined ? { duplicateOf: u.duplicateOf } : {}),
    ...(u.fix ? { fix: fix as Record<string, unknown> } : {}),
    ...(u.errorId !== undefined ? { errorGroup: u.errorId } : {}),
    ...(planChanged ? { plan } : {}),
    ...(added.length ? { addEvents: added } : {}),
  }))!;
  if (added.length || planChanged) {
    await hub.setState(before.artifactId, { ...(planChanged ? { "case/plan": plan ? { text: plan, at: now } : null } : {}), ...(added.length ? { "case/log": after.events as unknown as JsonValue } : {}) }, null);
  }
  await armFixChecks(env, hub).catch((err) => console.error("scheduling the fix check failed", err));
  return after;
}

// ---- did the fix work? -----------------------------------------------------------------

/** Wakes the support workspace when the oldest unanswered fix is due to resolve; nothing is scheduled while none waits. */
async function armFixChecks(env: SupportEnv, hub: HubApi, notBefore = 0): Promise<void> {
  const waiting = await dir(env).supportCases({ status: "fix_deployed", limit: 200 });
  const due = waiting.map((c) => Date.parse(c.statusAt) + autoResolveDays(env) * 86_400_000);
  await hub.setFixCheckAt(due.length ? Math.max(Math.min(...due), notBefore) : null);
}

/**
 * The person answered "Did this fix it?" on their request's page (the support workspace calls this). Yes resolves
 * it. No comes with a note saying what's still wrong: the request reopens and the operators are told.
 */
export async function fixAnswered(env: SupportEnv, hub: HubApi, artifactId: string, by: string, value: unknown): Promise<void> {
  const d = dir(env);
  const c = await d.supportCaseByArtifact(artifactId);
  if (!c || c.reporter !== by.toLowerCase() || !value || typeof value !== "object") return;
  const v = value as { decision?: unknown; note?: unknown };
  if (v.decision === "approve") {
    if (c.status === "fix_deployed") await updateCase(env, { n: c.n, status: "resolved", actor: c.reporter, event: "Confirmed the fix works" }, hub);
    return;
  }
  if (v.decision !== "changes" || !["fix_deployed", "resolved"].includes(c.status)) return;
  const note = String(v.note ?? "").trim();
  const after = await updateCase(env, { n: c.n, status: "investigating", actor: c.reporter, event: `Still a problem: ${note}` }, hub);
  const url = caseUrl(env, c);
  try {
    for (const op of operators(env)) {
      await d.addInbox(op, { kind: "support", title: `Reopened: the fix didn't work (#${c.n})`, body: note, url, dedupe: `case:${c.n}:reopened:${after.statusAt}`, slug: SUPPORT_SLUG, artifact: c.artifactId });
    }
    await sendOperatorNote(env, `Request #${c.n} reopened: the fix didn't work`, [`${c.reporter} says request #${c.n} (${c.title}) is still a problem:`, note, `Answered ${utcStamp(after.statusAt)}.`], {
      href: url,
      label: "Open the request",
    });
    await ops(env, { kind: "support_reopened", slug: SUPPORT_SLUG, message: `#${c.n} reopened by ${c.reporter}: the fix didn't work`, detail: { case: c.n, artifactId: c.artifactId } });
  } catch (err) {
    console.error("telling the operators about a reopened request failed", c.n, err);
  }
}

/**
 * Resolves requests whose released fix nobody answered about in SUPPORT_AUTO_RESOLVE_DAYS, telling the person
 * how to reopen. Run by the support workspace's alarm, which then waits for the next one due.
 */
export async function resolveUnanswered(env: SupportEnv, hub: HubApi = hubOf(env, SUPPORT_SLUG), now = Date.now()): Promise<number[]> {
  const days = autoResolveDays(env);
  const resolved: number[] = [];
  for (const c of await dir(env).supportCases({ status: "fix_deployed", limit: 200 })) {
    if (!c.artifactId || Date.parse(c.statusAt) + days * 86_400_000 > now) continue;
    try {
      // They did answer, and acting on it failed at the time: act on it now rather than call it unanswered.
      const said = (await hub.state(c.artifactId))[`approve/fixed/${c.reporter}`];
      if (said) {
        await fixAnswered(env, hub, c.artifactId, c.reporter, said);
        continue;
      }
      await updateCase(
        env,
        {
          n: c.n,
          status: "resolved",
          actor: "system",
          event: `No answer in ${days} ${days === 1 ? "day" : "days"}: resolved automatically`,
          message: `We haven't heard back in ${days} ${days === 1 ? "day" : "days"}, so we've marked this resolved. If it's still a problem, say so here or with "No, still a problem" on this page, and we'll pick it up again.`,
        },
        hub,
      );
      resolved.push(c.n);
    } catch (err) {
      console.error("resolving an unanswered request failed", c.n, err);
    }
  }
  // One that keeps failing is tried again in an hour, not every second.
  await armFixChecks(env, hub, Date.now() + 3_600_000).catch(() => hub.setFixCheckAt(Date.now() + 3_600_000));
  return resolved;
}

// ---- pages the person linked ---------------------------------------------------------------

export type LinkedPage = { url: string; slug: string; id: string };

/** This deployment's artifact pages named in `text`. */
function pageLinks(env: SupportEnv, text: string): LinkedPage[] {
  const suffix = env.WORKSPACE_SUFFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out: LinkedPage[] = [];
  for (const m of text.matchAll(new RegExp(`https://([a-z0-9-]+)${suffix}/a/(a[a-z0-9]{12})(?![a-z0-9])`, "g"))) {
    if (!out.some((l) => l.slug === m[1] && l.id === m[2])) out.push({ url: `https://${m[1]}${env.WORKSPACE_SUFFIX}/a/${m[2]}`, slug: m[1], id: m[2] });
  }
  return out;
}

/** The artifacts the person who sent a request linked in it or in its conversation (their own words only). */
export async function linkedPages(env: SupportEnv, c: SupportCase, hub: HubApi = hubOf(env, SUPPORT_SLUG)): Promise<LinkedPage[]> {
  if (!c.artifactId) return [];
  const threads = (await hub.threads(c.artifactId)) as { comments: { by: string; text: string }[] }[];
  const theirs = threads.flatMap((t) => t.comments).filter((x) => x.by === c.reporter);
  return pageLinks(env, theirs.map((x) => x.text).join("\n")).slice(0, LINKS_MAX);
}

/**
 * Reads an artifact the person linked, for the operator's assistant: only a page they named themselves, and only
 * while they can open it (their access is checked now, not when they linked it). Nothing is copied or kept; the
 * first read of each page goes in the request's log, which they see.
 */
export async function readLinkedPage(env: SupportEnv, n: number, url: string): Promise<LinkedPage & { title: string; version: number; files: Record<string, string> }> {
  const d = dir(env);
  const c = await d.supportCase(n);
  if (!c || !c.artifactId) throw new SupportError(`no request #${n}`);
  const [want] = pageLinks(env, url);
  const link = want && (await linkedPages(env, c)).find((l) => l.slug === want.slug && l.id === want.id);
  if (!link) throw new SupportError(`that page isn't linked in request #${n} by the person who sent it`);
  const gone = new SupportError("the person who sent the request can't open that page, so it can't be read for them");
  if (!(await d.workspace(link.slug))) throw gone;
  const target = hubOf(env, link.slug);
  if (!(await target.roleFor(link.id, c.reporter))) throw gone;
  const meta = await target.meta(link.id);
  if (!meta) throw gone;
  const files = await target.files(link.id);
  const event = `Read the linked page ${link.slug}/a/${link.id}`;
  if (!c.events.some((e) => e.event === event)) {
    const after = await d.updateCase(n, { addEvents: [{ at: new Date().toISOString(), actor: "agent", event }] });
    if (after) await hubOf(env, SUPPORT_SLUG).setState(c.artifactId, { "case/log": after.events as unknown as JsonValue }, null);
  }
  return { ...link, title: meta.title, version: meta.version, files };
}

/**
 * Drafts one message to a request and every request marked as its duplicate. It waits in the operator's inbox
 * until they approve it there; approving sends it, once, to each.
 */
export async function draftAnnouncement(env: SupportEnv, n: number, message: string): Promise<{ draft: string; cases: number[] }> {
  const d = dir(env);
  const main = await d.supportCase(n);
  if (!main) throw new SupportError(`no request #${n}`);
  const text = message.trim().slice(0, DETAILS_MAX);
  if (!text) throw new SupportError("the announcement is empty");
  const cases = [n, ...(await d.supportCases({ duplicateOf: n, limit: 200 })).map((c) => c.n)];
  const draft = `d${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  await d.addDraft({ id: draft, n, message: text, cases });
  for (const op of operators(env)) {
    await d.addInbox(op, {
      kind: "approve-announcement",
      title: `Approve a message to ${cases.length} ${cases.length === 1 ? "request" : "requests"} about #${n}`,
      body: text,
      url: `${apex(env)}/inbox#${draft}`,
      dedupe: `draft:${draft}`,
    });
  }
  return { draft, cases };
}

/** The operator approved a draft (from their inbox): send it to each request once. */
export async function approveAnnouncement(env: SupportEnv, draft: string, by: string): Promise<{ sent: number; failed: number[] }> {
  if (!isOperator(env, by)) throw new SupportError("only the operator approves announcements");
  const d = dir(env);
  const found = await d.draft(draft);
  if (!found) throw new SupportError("no such draft");
  if (!(await d.approveDraft(draft, by))) return { sent: 0, failed: [] };
  const hub = hubOf(env, SUPPORT_SLUG);
  let sent = 0;
  const failed: number[] = [];
  // One request failing doesn't stop the rest; the ones that failed are named, to send by hand.
  for (const n of found.cases) {
    try {
      const c = await d.supportCase(n);
      if (!c?.artifactId) continue;
      const thread = ((await hub.state(c.artifactId))["case/status"] as { thread?: string } | undefined)?.thread;
      await hub.addComment(c.artifactId, "agent", { thread, text: found.message }, supportOrigin(env));
      sent++;
    } catch (err) {
      console.error("sending an announcement failed", draft, n, err);
      failed.push(n);
    }
  }
  if (failed.length) await ops(env, { kind: "support_announce_failed", message: `An announcement didn't reach ${failed.map((n) => `#${n}`).join(", ")}.`, detail: { draft }, alert: true });
  return { sent, failed };
}

// ---- product errors ------------------------------------------------------------------

/** What a message says once ids, addresses, numbers and links are taken out: the same bug reads the same. */
function shape(message: string): string {
  return scrub(message)
    .replace(/\b[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, "N")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, "…")
    .slice(0, 300);
}

/** No addresses, links, tokens or long ids in what's kept. */
export function scrub(message: string): string {
  return message
    // Quoted text is often someone's content (a value that failed to parse, a title): keep its shape, not its words.
    .replace(/"[^"]{0,200}"|'[^']{0,200}'|`[^`]{0,200}`/g, "…")
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "<email>")
    .replace(/https?:\/\/\S+/g, "<url>")
    .replace(/\b[A-Za-z0-9_-]{24,}\b/g, "<token>")
    .slice(0, 500);
}

/** A page or API path with ids taken out ("/a/<id>"). */
export function placeOf(path: string): string {
  return path
    .replace(/\/a\/a[a-z0-9]{12}/g, "/a/<id>")
    .replace(/\/[A-Za-z0-9_-]{16,}/g, "/<id>")
    .slice(0, 200);
}

/** A browser family, not its full user agent. */
export function browserOf(ua: string | null): string {
  if (!ua) return "unknown";
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "other";
  const name = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "other";
  return `${name} on ${os}`;
}

/** One occurrence of a product error, grouped with the same ones before it. Returns the group's id (shown to people as an error code). */
/** Groups this isolate wrote in the last few seconds: an outage repeats one error on every request, and the
 * directory doesn't need each one (counts are then approximate, which is fine for "how often"). */
const recent = new Map<string, number>();
const RECENT_MS = 10_000;

export async function recordProductError(env: SupportEnv, e: { kind: "server" | "client"; place: string; message: string; browser: string }): Promise<string> {
  const place = scrub(placeOf(e.place.split(/[?#]/)[0]));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${e.kind}\n${place}\n${shape(e.message)}`)));
  const fp = `e${Array.from(bytes.slice(0, 5), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  const last = recent.get(fp);
  if (last && Date.now() - last < RECENT_MS) return fp;
  if (recent.size > 500) recent.clear();
  recent.set(fp, Date.now());
  try {
    const r = await dir(env).recordErrorGroup({ fp, kind: e.kind, place, message: scrub(e.message), version: APP_VERSION, browser: e.browser });
    // Only our own failures go in the ops log: anyone can send a browser error, and they mustn't push real events out.
    if (r.first && e.kind === "server") await ops(env, { kind: "product_error", message: `New server error at ${place}: ${scrub(e.message).slice(0, 200)}`, detail: { error: fp } });
  } catch (err) {
    console.error("recording a product error failed", err);
  }
  return fp;
}
