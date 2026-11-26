// Billing end to end against a deployed stage with BILLING=on, in a throwaway
// workspace: sends signed webhook events the way Creem does and checks the
// workspace moves between Free, Personal and Team. With real Creem test keys
// (CREEM_API_KEY=creem_test_…) it also creates sandbox checkouts.
// Usage: CREEM_WEBHOOK_SECRET=<the stage's secret> CREEM_PRODUCT_ID=<its Team product>
//   [CREEM_PERSONAL_PRODUCT_ID=<its Personal product>] STAGE=<name> bun spikes/e2e-billing.ts
// It raises one bad-signature alert on the stage it runs against (the refused request below).
import { apex, check, cookieFor, finish, operator, origin, owner, setup, slug } from "./e2e-lib.ts";

const secret = process.env.CREEM_WEBHOOK_SECRET;
if (!secret) throw new Error("set CREEM_WEBHOOK_SECRET to the deployed stage's webhook secret");
// A subscription's product says which plan it pays for, so the events here must name the stage's own products.
const products = { team: process.env.CREEM_PRODUCT_ID, personal: process.env.CREEM_PERSONAL_PRODUCT_ID };
if (!products.team) throw new Error("set CREEM_PRODUCT_ID to the deployed stage's Team product");
await setup();
await operator(`/workspaces/${slug}/plan`, { plan: "free" });

async function sign(body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))), (b) => b.toString(16).padStart(2, "0")).join("");
}
async function send(payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  const res = await fetch(`${apex}/api/billing/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "creem-signature": signature ?? (await sign(body)) }, body });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}
const cookie = await cookieFor(owner);
const settings = async () => (await (await fetch(`${origin}/api/settings`, { headers: { Cookie: cookie } })).json()) as any;
const subId = `sub_e2e_${slug}`;
let t = Date.now();
// `updated_at` moves forward with each one made, as it does at Creem.
const sub = (status: string, metadata: Record<string, unknown> = {}, plan: "team" | "personal" = "team") => ({
  id: subId,
  object: "subscription",
  product: { id: products[plan], object: "product" },
  customer: { id: `cust_${slug}` },
  status,
  current_period_end_date: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  updated_at: new Date(++t).toISOString(),
  metadata,
});
const ev = (eventType: string, object: unknown) => ({ id: `evt_${slug}_${++t}`, eventType, created_at: t, object });

const pricing = await fetch(`${apex}/pricing`);
check("pricing page is up", pricing.status === 200 && (await pricing.text()).includes("merchant of record"), pricing.status);
const before = await settings();
check("starts on Free, with billing in settings", before.plan?.id === "free" && before.billing !== null, { plan: before.plan?.id, billing: before.billing });

check("a bad signature is refused", (await send(ev("subscription.paid", sub("active", { workspace: slug })), "00")).status === 401);
const paid = ev("checkout.completed", { id: "ch_e2e", object: "checkout", status: "completed", metadata: { workspace: slug }, subscription: { ...sub("active", { workspace: slug }), customer: `cust_${slug}` } });
const first = await send(paid);
check("checkout.completed moves it to Team", first.status === 200 && first.body?.plan === "team" && (await settings()).plan.id === "team", first);
const again = await send(paid);
check("the same delivery again changes nothing", again.body?.plan === "team" && (await settings()).plan.id === "team", again);
// A late event from before the payment can't undo it.
const late = { ...ev("subscription.canceled", sub("canceled")), created_at: t - 3_600_000 };
await send(late);
check("an older event arriving late changes nothing", (await settings()).plan.id === "team");
const after = await settings();
check("settings shows a manageable subscription", after.billing?.subscription?.manageable === true && after.billing?.subscription?.status === "active", after.billing);
await send(ev("subscription.past_due", sub("past_due")));
check("a failed payment keeps Team while it's retried", (await settings()).plan.id === "team");
const canceled = await send(ev("subscription.canceled", sub("canceled")));
const midPeriod = await settings();
check("canceling keeps Team until the paid period ends", canceled.body?.plan === "team" && midPeriod.plan.id === "team" && Boolean(midPeriod.plan.until), { canceled: canceled.body, plan: midPeriod.plan });
await send(ev("subscription.canceled", { ...sub("canceled"), current_period_end_date: new Date(Date.now() - 1000).toISOString() }));
check("once the period is over, it's Free", (await settings()).plan.id === "free");

// A real sandbox checkout for each plan sold here, when the stage has Creem test keys.
const post = async (path: string, body: unknown) => {
  const res = await fetch(`${origin}${path}`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
};
const links: string[] = [];
for (const plan of ["personal", "team"] as const) {
  const state = before.billing?.plans?.[plan];
  if (plan === "personal" && !state?.offered) continue;
  const out = await post("/api/settings/billing/checkout", { plan });
  if (state?.ready) check(`a sandbox checkout link for ${plan} comes back from Creem`, out.status === 200 && /^https:\/\//.test(out.body?.url ?? ""), out);
  else check(`without keys, checkout for ${plan} says payments aren't set up`, out.status === 503, out);
  if (out.body?.url) links.push(out.body.url);
}
if (links.length === 2) check("each plan gets its own checkout", links[0] !== links[1], links);

// Personal: the product decides the plan, one member, and changes made at Creem are followed.
if (products.personal && before.billing?.plans?.personal?.offered) {
  const personal = await send(ev("subscription.paid", sub("active", { workspace: slug }, "personal")));
  const onPersonal = await settings();
  check("a payment for the Personal product puts it on Personal", personal.body?.plan === "personal" && onPersonal.plan.id === "personal" && onPersonal.billing?.subscription?.plan === "personal", { personal, plan: onPersonal.plan });
  const member = await post("/api/settings/members", { email: `second-${slug}@example.com`, role: "member" });
  check("Personal allows one member", member.status >= 400 && /Personal plan/.test(member.body?.error ?? ""), member);
  const old = sub("active", {}, "personal");
  const moved = await send(ev("subscription.update", sub("active", {}, "team")));
  check("a plan changed at Creem is followed", moved.body?.plan === "team" && (await settings()).plan.id === "team", moved);
  // Resent by hand from Creem's dashboard: a new event id and time around the subscription as it was.
  await send(ev("subscription.paid", old));
  check("an old event resent as new changes nothing", (await settings()).plan.id === "team");
  const down = await send(ev("subscription.update", sub("active", {}, "personal")));
  check("and back to Personal", down.body?.plan === "personal" && (await settings()).plan.id === "personal", down);
  const stranger = await send(ev("subscription.update", { ...sub("active"), product: { id: "prod_not_ours" } }));
  check("a product that isn't ours changes nothing", stranger.status === 200 && (await settings()).plan.id === "personal", stranger);
  await send(ev("subscription.canceled", { ...sub("canceled", {}, "personal"), current_period_end_date: new Date(Date.now() - 1000).toISOString() }));
  check("canceled with its period over, it's Free again", (await settings()).plan.id === "free");
}
await finish();
