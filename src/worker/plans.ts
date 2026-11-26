// What each plan allows a workspace. A workspace is what pays; guests (people
// an artifact is shared with) never need a plan. The operator moves a
// workspace between plans; self-serve workspaces start on Free.

export type PlanId = "free" | "personal" | "team";
/** A plan a subscription pays for. */
export type PaidPlanId = Exclude<PlanId, "free">;
/**
 * null: no limit. `changesPerDay` caps saved versions (each also runs a render
 * check) and `emailsPerDay` invitations, shares and notification emails: the
 * work that costs money.
 */
export type Limits = {
  artifacts: number | null;
  bytes: number | null;
  members: number | null;
  changesPerDay: number | null;
  emailsPerDay: number;
  /** Of emailsPerDay, how many only invitations and shares may use, so notifications can't crowd them out. */
  inviteEmailsPerDay: number;
  /** Headless-browser render checks a day (after saves, and on request): each costs browser time. */
  checksPerDay: number;
};

export const PLANS: Record<PlanId, { label: string; limits: Limits }> = {
  free: { label: "Free", limits: { artifacts: 20, bytes: 250 * 1024 * 1024, members: 3, changesPerDay: 300, emailsPerDay: 50, inviteEmailsPerDay: 20, checksPerDay: 60 } },
  // One person publishing, read by anyone: no artifact cap (the limit a person on Free reaches first), one member.
  // Guests never count. The daily caps bound what a $10 workspace can cost (saves and render checks).
  personal: { label: "Personal", limits: { artifacts: null, bytes: 2 * 1024 * 1024 * 1024, members: 1, changesPerDay: 1500, emailsPerDay: 200, inviteEmailsPerDay: 50, checksPerDay: 200 } },
  // A workspace is one Durable Object, which holds at most 10 GB: 5 GB of content leaves room for its
  // history, activity log and indexes. 5,000 saves a day is far past real use and bounds render checks.
  team: { label: "Team", limits: { artifacts: null, bytes: 5 * 1024 * 1024 * 1024, members: null, changesPerDay: 5000, emailsPerDay: 1000, inviteEmailsPerDay: 200, checksPerDay: 500 } },
};

/** A workspace without a plan set (any the operator made) is on Team. */
export const DEFAULT_PLAN: PlanId = "team";

export function isPlan(v: unknown): v is PlanId {
  return typeof v === "string" && Object.hasOwn(PLANS, v);
}

export function isPaidPlan(v: unknown): v is PaidPlanId {
  return isPlan(v) && v !== "free";
}

/** Plans from least to most room, for telling an upgrade from a downgrade. */
export const PLAN_ORDER: PlanId[] = ["free", "personal", "team"];

/** The plans a subscription can pay for, smallest first. */
export const PAID_PLANS: PaidPlanId[] = ["personal", "team"];
