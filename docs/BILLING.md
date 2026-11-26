# Billing

Workspaces pay for Personal or Team through [Creem](https://creem.io), a
merchant of record: Creem is the seller on every invoice, so it collects and
remits sales tax and VAT worldwide and we never register for them. It's the
cheapest merchant of record we found (3.9% + $0.40 a payment, plus an
international payout fee, the greater of $7 or 1%). All of Creem's API is
in `src/worker/billing.ts`, so another provider means replacing that file.

Billing is off until `BILLING=on`. Off, there's no pricing page, no
webhook and no billing in settings; the operator sets plans by hand.

## Plans

| | Free | Personal | Team |
|---|---|---|---|
| Price (USD, tax on top) | $0 | $10 a workspace a month | $25 a workspace a month |
| Members | 3 | 1 | no limit |
| Guests | free, no limit | free, no limit | free, no limit |
| Artifacts | 20 (archived count) | no limit | no limit |
| Storage | 250 MB | 2 GB | 5 GB |
| Saves a day | 300 | 1,500 | 5,000 |
| Render checks a day | 60 | 200 | 500 |
| Emails a day (kept for invitations and shares) | 50 (20) | 200 (50) | 1,000 (200) |

Limits are in `src/worker/plans.ts` and prices in `PRICES`
(`billing.ts`), which must match the Creem products. Each paid plan is one
Creem product: `CREEM_PRODUCT_ID` is Team's and `CREEM_PERSONAL_PRODUCT_ID`
Personal's. **A subscription's product decides the plan**, never the fact
that something was paid. Without `CREEM_PERSONAL_PRODUCT_ID`, Personal isn't
offered anywhere and Team works as before. There is no annual plan.

## How it works

- **Pricing** (`/pricing`, on the apex) shows Free, Personal and Team, with
  Personal's button as the primary one. "Get Personal" and "Get Team" lead
  to `/workspaces?plan=<plan>`, which carries the choice through sign-in
  and making a workspace to that workspace's settings, where the plan's
  button has focus. Paying always starts with a click in settings.
- **Subscribe:** a workspace admin presses "Upgrade to Personal" or
  "Upgrade to Team" in settings. We create a Creem checkout for that plan's
  product with the workspace's slug in its metadata and send them there;
  afterwards Creem sends them back to settings. The same button reopens the
  same checkout for 15 minutes; the other plan's button opens its own.
- **Personal is one member.** Its checkout is refused, with the reason,
  while the workspace has more than one member (guests don't count); so is
  moving to it. Nobody is ever removed automatically.
- **Change plan:** on a paid-up subscription, whoever pays presses "Move to
  Team" or "Move to Personal" (with no payer on record, any admin). We call
  Creem's subscription upgrade with the other product and
  `proration-charge-immediately`, and apply Creem's answer at once, so the
  page shows the new plan; the `subscription.update` webhook that follows
  changes nothing.
  - Personal to Team charges the pro-rated difference for the rest of the
    period now, then $25 from the next renewal on the same date.
  - Team to Personal takes effect now, and Creem refunds the unused part of
    Team. That refund's event is logged (`billing_proration_refund`)
    without an alert for an hour after the move.
  - The answer's product and status decide, never what was asked. If the
    answer isn't the subscription paid up on the product asked for (a
    pro-rated charge that didn't go through), nothing is applied, the
    operator is alerted (`billing_change_unconfirmed`) and Creem's events
    settle it.
  - Creem refusing the change (4xx: a subscription with a discount, say)
    changes nothing, charges nothing and alerts the operator
    (`billing_change_refused`); Creem being down asks them to try again.
  - Refused with what to do first while the subscription is overdue,
    paused or canceled, and for a plan arranged with us.
- **Webhooks** (`POST https://<apex>/api/billing/webhook`) are checked
  against the `creem-signature` header (HMAC-SHA256 of the body with the
  webhook secret). Each workspace has one subscription record in the
  directory's `billing` table (status, period end, payer, the plan its
  product pays for), and its plan always follows that record, never an
  event on its own:
  - a repeated delivery re-applies the record (so a plan change that failed
    is healed by Creem's retry), and an event older than the last one applied
    changes nothing;
  - an event **resent by hand** from Creem's dashboard gets a new id and
    time, so it's recognised by the subscription inside it: one last changed
    (`updated_at`) before the subscription already applied changes nothing;
  - events from a subscription the workspace has since replaced can't
    downgrade it or take over again, even resent;
  - a workspace on a plan set by the operator, with no subscription, is
    never touched by stray events;
  - a subscription on a product that isn't ours never grants a plan, and an
    existing subscription moved to one keeps the plan it had; the operator
    is alerted (`billing_unknown_product`). If a subscription names two of
    our products (its `product` and its `items` disagree), we ask Creem for
    the subscription and use its product; if Creem can't be asked the
    delivery fails, so its retry asks again.
  - `checkout.completed`, `subscription.active`, `.paid`, `.trialing`,
    `.update` (status active or trialing): the product's plan.
  - `subscription.canceled`, `.paused`: the plan stays until the end of the
    period already paid for, then Free on its own (Creem's portal cancels at
    period end but sends `canceled` straight away, with the period's end);
    `.scheduled_cancel` likewise.
  - `subscription.past_due`, `.unpaid`, `.expired` (and a status of
    `incomplete`): the plan stays while Creem retries the payment, for up
    to 14 days past the paid period, then Free. Settings asks the payer to
    update their card.
- **A plan changed at Creem** (its dashboard, or its portal if a product
  bundle ever allows it) is followed: the workspace is on what is paid for.
  That can put a workspace with several members on Personal. They all stay,
  none can be added, and the ops log records the move. Don't create a
  product bundle with self-service plan changes: plan changes then happen
  only in the app, where the one-member rule is checked first.
- **Manage billing** in settings opens Creem's customer portal (card,
  invoices, cancel), for the person who paid only: the portal shows their
  card and everything they pay for. Other admins see who that is. To move
  billing to someone else, they cancel and the new person subscribes.
- **Cancel and resubscribe:** canceling in the portal keeps the plan until
  the period's end. Before then, Resume in the portal brings it back, or
  "Subscribe again" in settings starts a new subscription that takes over.
  After it has ended, it's an ordinary upgrade from Free.
- **No paying twice:** the upgrade buttons are hidden while a subscription
  exists (even a paused or overdue one) and stay off right after a checkout
  until the payment is confirmed; the server refuses a second checkout too.
  If two subscriptions still end up paid for one workspace (two checkouts
  open at once), the later one takes over and **we cancel the one it
  replaced at Creem, at once**, so it never charges again. The operator is
  alerted (`billing_replaced`) and refunds the replaced one by hand; if
  the cancel fails, the alert says so and the operator cancels it too.
- **An abandoned checkout** records nothing: the workspace stays as it was.
- Deleting a workspace with a live subscription is refused (cancel it in
  Creem first, or delete with `?force=1`); deleting removes its billing
  record, so a later workspace with the same address starts clean. Whoever
  made a self-serve workspace can delete it from settings once nothing is
  billed, and then make another.
- **Free Team:** the operator console's **Give Team free** keeps a workspace
  on Team at no charge whatever billing says (your own workspaces, say);
  settings shows "Team, free: arranged with us" and offers no upgrade.
  **End free Team** hands the plan back to billing, or to the plan set by
  hand. The support workspace always has it. Refunds and disputes alert the
  operator; **End billing** in the console ends paid time at once.
- **Moving to a smaller plan keeps everything:** every artifact still
  opens, can be edited, shared and commented on, and every member stays.
  Past the new plan's limits nothing new can be added (artifacts, members,
  storage) until it trims or moves up again; replacing a file with one no
  bigger still works. The new plan's daily caps apply from the next save,
  check or email, counting what was already used today. Free also keeps 7
  backups instead of 30, from the next prune.
- **Later:** a price change in Creem applies to new checkouts only. A
  coupon works at checkout with no code change, but Creem may refuse a plan
  change on a discounted subscription, so don't give Personal a "forever"
  discount. There are no trials (Free is the trial); a `trialing`
  subscription already counts as paid if a product ever gets one.

## Turning it on

1. **Sign up** at creem.io. First check that Creem pays out to your country
   and bank (Canada wasn't confirmed in their docs as of 2026-10-18); if not,
   stop here and we switch provider.
2. **In test mode**, create two products: "Team", subscription, monthly,
   USD 25.00, and "Personal", subscription, monthly, USD 10.00, both tax
   category SaaS with tax added on top. Copy their ids (`prod_…`). Or by
   API: `POST /v1/products` with `price` in cents, `billing_type:
   "recurring"`, `billing_period: "every-month"`, `tax_mode: "exclusive"`,
   `tax_category: "saas"`.
3. **Developers → API keys:** copy the test key (`creem_test_…`).
4. **Developers → Webhooks:** add `https://dev.artifacts.boo/api/billing/webhook`
   with all events; copy the signing secret.
5. **Try it on a stage** (nothing touches production):

   ```sh
   BILLING=on SELF_SERVE=on CREEM_API_KEY=creem_test_… CREEM_WEBHOOK_SECRET=… CREEM_PRODUCT_ID=prod_… CREEM_PERSONAL_PRODUCT_ID=prod_… \
     alchemy deploy --stage dev --yes
   CREEM_WEBHOOK_SECRET=… CREEM_PRODUCT_ID=prod_… CREEM_PERSONAL_PRODUCT_ID=prod_… STAGE=dev bun spikes/e2e-billing.ts
   ```

   The script checks signed webhooks move a workspace between Free,
   Personal and Team, that a resent old event and an unknown product change
   nothing, and that a real sandbox checkout link comes back for each plan
   (it raises one bad-signature alert on the stage). Then do it by hand:
   make a workspace at `https://dev.artifacts.boo/workspaces`, press Upgrade,
   pay with Creem's test card (4111 1111 1111 1111, any future date and CVC; 4507 9900 0000 0028 is declined),
   and watch settings say Team. Then cancel from Manage billing: settings
   says Team until the end of the paid period, then Free. (Verified in the
   sandbox on 2026-10-18.) Destroy the stage afterwards.
6. **Live:** repeat steps 2 to 4 in live mode, with the webhook at
   `https://artifacts.boo/api/billing/webhook`. Put the live values in
   `.env` (`BILLING=on`, `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`,
   `CREEM_PRODUCT_ID`, `CREEM_PERSONAL_PRODUCT_ID`) and `bun run deploy`. Also set `SELF_SERVE=on` if
   new people should be able to make workspaces themselves.
7. **Check** `https://artifacts.boo/pricing`, then upgrade a workspace of
   your own and refund yourself from Creem's dashboard. A refund doesn't
   cancel the subscription: cancel it too, and the workspace moves to Free.

If Cloudflare's Bot Fight Mode is on for the zone, it can challenge Creem's
webhooks: turn it off, or use Super Bot Fight Mode with a skip rule for
`/api/billing/webhook`.

To turn billing off again, unset `BILLING` and deploy. Paying workspaces
keep their plan, but webhooks are refused until it's back on, and Creem
stops retrying after a day. When you turn it back on, resend the events
from that time from Creem's dashboard, oldest first (a resent event that is
older than what a workspace's record already holds changes nothing), or fix
plans by hand with the operator API.

To stop selling Personal before anyone has bought it, unset
`CREEM_PERSONAL_PRODUCT_ID` and deploy. Once someone has, keep the id:
their subscription's events need it to be read as Personal.
