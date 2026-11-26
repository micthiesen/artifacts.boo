// Billing through Creem, a merchant of record: Creem is the seller, so it
// collects and remits sales tax and VAT everywhere, and we never register for
// them. A workspace pays: checkout starts from its settings, carries the
// workspace slug in metadata, and signed webhooks move it between Free,
// Personal and Team: the subscription's product says which paid plan. Off
// unless BILLING=on and the Creem keys are set (docs/BILLING.md).
//
// Everything Creem-specific is in this file (its HTTPS calls and one
// signature check), so another provider means replacing it, not the callers.
import { timingSafeEqual } from "./session.ts";
import type { PaidPlanId, PlanId } from "./plans.ts";

export type BillingEnv = {
  /** "on" turns billing on; anything else (or unset) leaves it off. */
  BILLING?: string;
  CREEM_API_KEY?: string;
  CREEM_WEBHOOK_SECRET?: string;
  /** The Team plan's product (a monthly subscription) in Creem. */
  CREEM_PRODUCT_ID?: string;
  /** The Personal plan's product (a monthly subscription) in Creem. Unset: Personal isn't sold. */
  CREEM_PERSONAL_PRODUCT_ID?: string;
};

/** What Team costs, for the pricing page and settings. Creem's product holds the real price; keep them the same. */
export const TEAM_PRICE = { amount: 25, currency: "USD", period: "month" } as const;
/** What each paid plan costs. Creem's products hold the real prices; keep them the same. */
export const PRICES: Record<PaidPlanId, { amount: number; currency: "USD"; period: "month" }> = {
  personal: { amount: 10, currency: "USD", period: "month" },
  team: TEAM_PRICE,
};

/** The Creem product that sells a plan here, if it's set up. */
export function productFor(env: BillingEnv, plan: PaidPlanId): string | null {
  return (plan === "team" ? env.CREEM_PRODUCT_ID : env.CREEM_PERSONAL_PRODUCT_ID) || null;
}

/** Which plan each of our Creem products pays for. A product that isn't here never grants a plan. */
export function productPlans(env: BillingEnv): Record<string, PaidPlanId> {
  const map: Record<string, PaidPlanId> = {};
  if (env.CREEM_PRODUCT_ID) map[env.CREEM_PRODUCT_ID] = "team";
  if (env.CREEM_PERSONAL_PRODUCT_ID) map[env.CREEM_PERSONAL_PRODUCT_ID] = "personal";
  return map;
}

export function billingOn(env: BillingEnv): boolean {
  return env.BILLING === "on";
}

/** Billing is on and can reach the provider: enough to manage a subscription that exists, whatever its plan. */
export function billingReady(env: BillingEnv): boolean {
  return billingOn(env) && Boolean(env.CREEM_API_KEY && env.CREEM_WEBHOOK_SECRET);
}

/** A plan can be bought here: billing is ready and the plan's product is set. */
export function planSold(env: BillingEnv, plan: PaidPlanId): boolean {
  return billingReady(env) && Boolean(productFor(env, plan));
}

export class BillingError extends Error {
  constructor(message: string, readonly providerStatus?: number) {
    super(message);
  }
}

/** Test keys (creem_test_…) talk to Creem's sandbox, so the whole flow can be tried without real money. */
function base(env: BillingEnv): string {
  return env.CREEM_API_KEY?.startsWith("creem_test_") ? "https://test-api.creem.io" : "https://api.creem.io";
}

async function creem<T>(env: BillingEnv, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base(env)}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "x-api-key": env.CREEM_API_KEY!, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error(`creem ${path.split("?")[0]} failed`, res.status, (await res.text().catch(() => "")).slice(0, 300));
    // A refusal (4xx) won't succeed on a second try; an outage might.
    throw new BillingError(res.status >= 400 && res.status < 500 ? "The payment provider refused that change." : "The payment provider didn't answer. Try again in a minute.", res.status);
  }
  return (await res.json()) as T;
}

/** Only ever send someone to Creem itself. */
function creemUrl(u: string | undefined, what: string): string {
  try {
    const url = new URL(u ?? "");
    if (url.protocol === "https:" && (url.hostname === "creem.io" || url.hostname.endsWith(".creem.io"))) return url.href;
  } catch {
    // falls through
  }
  throw new BillingError(`The payment provider didn't return a usable ${what} link.`);
}

/** A Creem checkout for a paid plan for this workspace; returns the URL to send the admin to. */
export async function startCheckout(env: BillingEnv, input: { workspace: string; created?: string | null; email: string; successUrl: string; plan: PaidPlanId }): Promise<string> {
  const plan = input.plan;
  if (!planSold(env, plan)) throw new BillingError("Billing isn't set up yet.");
  const r = await creem<{ checkout_url?: string }>(env, "/v1/checkouts", {
    product_id: productFor(env, plan),
    // The same for a minute, so a double click doesn't open two checkouts (per plan: the other plan is another checkout).
    request_id: `${input.workspace}-${plan}-${Math.floor(Date.now() / 60_000)}`,
    customer: { email: input.email },
    success_url: input.successUrl,
    // When the workspace was made: if it's deleted and its address reused before the payment lands, the
    // new one isn't mistaken for the payer.
    metadata: { workspace: input.workspace, ...(input.created ? { created: input.created } : {}) },
  });
  return creemUrl(r.checkout_url, "checkout");
}

/** Creem's customer portal for a paying workspace: change card, see invoices, cancel. */
export async function portalLink(env: BillingEnv, customerId: string): Promise<string> {
  if (!billingReady(env)) throw new BillingError("Billing isn't set up yet.");
  const r = await creem<{ customer_portal_link?: string }>(env, "/v1/customers/billing", { customer_id: customerId });
  return creemUrl(r.customer_portal_link, "billing");
}

/**
 * Move a live subscription to another of our products, now. Creem prorates: an upgrade charges the difference
 * for the rest of the period at once; a downgrade refunds the unused part to the card. Returns the subscription
 * as Creem has it afterwards, which the caller applies like a webhook (the webhook that follows changes nothing).
 */
export async function changeSubscriptionPlan(env: BillingEnv, subscriptionId: string, plan: PaidPlanId): Promise<unknown> {
  const product = productFor(env, plan);
  if (!planSold(env, plan) || !product) throw new BillingError("Billing isn't set up yet.");
  return creem(env, `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/upgrade`, { product_id: product, update_behavior: "proration-charge-immediately" });
}

/**
 * Cancel a subscription now, so it never charges again: for one a newer subscription replaced (someone paid for
 * the same workspace twice). Nothing is refunded; that stays with the operator.
 */
export async function cancelSubscription(env: BillingEnv, subscriptionId: string): Promise<void> {
  if (!billingReady(env)) throw new BillingError("Billing isn't set up yet.");
  await creem(env, `/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, { mode: "immediate" });
}

/** The subscription as Creem has it now: the answer when an event is ambiguous. */
export async function fetchSubscription(env: BillingEnv, subscriptionId: string): Promise<unknown> {
  return creem(env, `/v1/subscriptions?subscription_id=${encodeURIComponent(subscriptionId)}`);
}

/** `creem-signature`: hex HMAC-SHA256 of the raw body with the webhook secret. */
export async function verifyWebhook(secret: string, rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(hex, signature.trim().toLowerCase());
}

/**
 * The plan a subscription pays for, and until when. `paid` is the plan its
 * product sells. Failed payments (past_due, unpaid, expired) keep it for two
 * weeks past the period while Creem retries; a canceled or paused one keeps
 * it until the end of the period already paid for.
 */
export function planFor(paid: PaidPlanId, status: string, periodEnd: string | null = null, now = Date.now()): { plan: PlanId; until: string | null } {
  if (["active", "trialing", "paid"].includes(status)) return { plan: paid, until: null };
  // A failed payment keeps the plan while Creem retries, for at most two weeks past the paid period.
  // "incomplete" is a payment waiting on the customer (a bank's confirmation): the same.
  if (["past_due", "unpaid", "expired", "incomplete"].includes(status)) {
    if (!periodEnd) return { plan: paid, until: null };
    const grace = new Date(Date.parse(periodEnd) + PAYMENT_GRACE_MS).toISOString();
    return Date.parse(grace) > now ? { plan: paid, until: grace } : { plan: "free", until: null };
  }
  // Canceled from Creem's portal means "at the end of the period" (it says so, and sends canceled with the
  // period's end): what's paid for stays until then. Same for a scheduled cancel or a pause.
  const paidUntil = periodEnd && Date.parse(periodEnd) > now ? periodEnd : null;
  if (["canceled", "scheduled_cancel", "paused"].includes(status) && paidUntil) return { plan: paid, until: paidUntil };
  return { plan: "free", until: null };
}

/** How long a paid plan outlasts a failed payment's period while Creem retries. */
const PAYMENT_GRACE_MS = 14 * 86_400_000;

/**
 * A subscription that could still charge or be resumed: another checkout would mean paying twice.
 * Not one that's canceled, or lapsed past its grace (that workspace may start a new one).
 */
export function subscriptionLive(status: string, periodEnd: string | null, now = Date.now()): boolean {
  return status !== "canceled" && planFor("team", status, periodEnd, now).plan !== "free";
}

/**
 * Whether deleting the workspace (or its payer's account) would leave a subscription that can still charge:
 * anything but canceled, expired or set to cancel. Paused and unpaid ones count, as they can resume.
 */
export function subscriptionMayCharge(status: string): boolean {
  return !["canceled", "expired", "scheduled_cancel"].includes(status);
}

/** A provider event as it affects one workspace. */
export type BillingUpdate = {
  eventId: string;
  /** The paying customer's email, when the event carries it. */
  payerEmail: string | null;
  /** When the workspace that started the checkout was made (metadata), to tell it from a later one at the same address. */
  workspaceCreated: string | null;
  /** When the provider says it happened (ms), so an older event arriving late can't undo a newer one. */
  at: number;
  workspace: string | null;
  customerId: string | null;
  subscriptionId: string | null;
  status: string;
  periodEnd: string | null;
  /** What the event says on its own: a paid plan (it's paying for that), "free" (it ended), or null (neither, or a product that isn't ours). */
  plan: PlanId | null;
  /** The subscription's product in Creem, and the plan it pays for here (null: not one of ours). */
  productId: string | null;
  paid: PaidPlanId | null;
  /** The subscription names two of our products that pay for different plans: ask Creem which it is. */
  ambiguous: boolean;
  /** When the subscription itself last changed (ms): unlike `at`, a manual resend of an old event keeps it. */
  subAt: number | null;
};

type CreemObject = {
  id?: string;
  object?: string;
  status?: string;
  metadata?: Record<string, unknown> | null;
  customer?: string | { id?: string; email?: string } | null;
  subscription?: CreemObject | null;
  current_period_end_date?: string | null;
  product?: string | { id?: string } | null;
  items?: { product_id?: string }[] | null;
  updated_at?: string | null;
};

/**
 * Reads a Creem webhook into what it means for a workspace. `products` says
 * which plan each of our products pays for (productPlans). `plan` is what the
 * event says on its own (paid, active and trialing pay for the product's plan;
 * canceled and paused don't), used to decide whether a new subscription takes
 * over; the workspace's plan itself always comes from planFor on the stored record.
 */
export function readEvent(payload: unknown, products: Record<string, PaidPlanId>): BillingUpdate | null {
  const e = payload as { id?: string; eventType?: string; created_at?: number; object?: CreemObject } | null;
  // Without an id and a time, repeats and late arrivals couldn't be recognized.
  if (!e?.eventType || !e.object || !e.id || typeof e.created_at !== "number") return null;
  const sub: CreemObject | null = e.eventType === "checkout.completed" ? (e.object.subscription ?? null) : e.object.object === "subscription" ? e.object : null;
  if (!sub) return null;
  const meta = { ...(e.object.metadata ?? {}), ...(sub.metadata ?? {}) };
  const customer = typeof sub.customer === "string" ? sub.customer : (sub.customer?.id ?? null);
  const customerObject = [sub.customer, e.object.customer].find((c): c is { email?: string } => typeof c === "object" && c !== null);
  const payerEmail = typeof customerObject?.email === "string" ? customerObject.email.toLowerCase() : null;
  const status = sub.status ?? "";
  const ended = status === "canceled" || status === "paused" || e.eventType === "subscription.canceled";
  const idOf = (p: CreemObject["product"]) => (typeof p === "string" ? p : (p?.id ?? null));
  const productId = idOf(sub.product) ?? (e.eventType === "checkout.completed" ? idOf(e.object.product) : null);
  const planOf = (id: string | null | undefined): PaidPlanId | null => (id && Object.hasOwn(products, id) ? products[id] : null);
  const paid = planOf(productId);
  const itemPlans = new Set((sub.items ?? []).map((i) => planOf(i.product_id)).filter((p): p is PaidPlanId => p !== null));
  const ambiguous = paid !== null && itemPlans.size > 0 && !itemPlans.has(paid);
  const subAt = sub.updated_at ? Date.parse(sub.updated_at) : NaN;
  const plan: PlanId | null = ended ? "free" : ["active", "trialing", "paid"].includes(status) ? paid : null;
  return {
    productId,
    paid,
    ambiguous,
    subAt: Number.isFinite(subAt) ? subAt : null,
    eventId: e.id,
    payerEmail,
    at: e.created_at,
    workspace: typeof meta.workspace === "string" ? meta.workspace : null,
    workspaceCreated: typeof meta.created === "string" ? meta.created : null,
    customerId: customer,
    subscriptionId: sub.id ?? null,
    status: e.eventType === "subscription.canceled" ? "canceled" : status,
    periodEnd: sub.current_period_end_date ?? null,
    plan,
  };
}
