# Operations

What to watch once people depend on the service, and what to do when
something goes wrong. Everything here runs through the operator console
(`/admin` on the apex, for addresses in `OPERATOR_EMAILS`) or the operator
API with `OPERATOR_TOKEN`.

## What tells you something is wrong

- **Ops emails.** Urgent events email the first `OPERATOR_EMAILS` address,
  at most once an hour per kind (and workspace): failed backups and
  restores, billing webhooks that fail or can't be read, payments for a
  workspace that doesn't exist, sign-in emails failing, Browser Run failing,
  a workspace's database past 80% of 9.5 GB, and abuse reports. Signups and
  billing changes (subscribed, canceled, payment failed) email too.
- **Recent events** in the operator console: every event above and more
  (email caps reached, ignored billing events), the latest 500, filterable
  by reports, signups and billing. Reports are kept here even if their
  email is lost.
- **Workers Logs** (Cloudflare dashboard → Workers → artifacts → Logs).
  Ops events are one JSON line each: search for `"ops":"<kind>"` or a
  workspace's slug.
- **Uptime:** `https://<domain>/healthz?deep=1` answers `ok` only when the
  Worker and the directory are up. Point a free uptime monitor at it.
- **Cloudflare notifications:** a Billing Budget Alert (made by
  `bun scripts/spend-alert.ts`, or in the dashboard under Notifications)
  emails when the month's spend passes $20, catching a cost surprise early.

## Support

Requests from people and their agents, product errors and the operator's
assistant's workflow are described in [SUPPORT.md](SUPPORT.md).

## Payments aren't moving workspaces

1. Recent events, filtered to Billing: look for `billing apply failed`,
   `billing event unread` or `billing bad signature`.
2. **Bad signature:** `CREEM_WEBHOOK_SECRET` doesn't match the webhook's
   signing secret in Creem (Developers → Webhooks). Fix `.env`, deploy.
3. **Apply failed:** a workspace or the directory was down. Creem retries
   for about a day. If it's still wrong, press **Resync plan** on the
   workspace in the operator console: it applies what the subscription
   record says.
4. **Unread:** Creem sent a subscription event we couldn't parse (a payload
   change?). Look at the event in Creem's dashboard, fix `readEvent` in
   `src/worker/billing.ts`, deploy, and resend the event from Creem.
5. **Resending events from Creem's dashboard.** Creem's own retries keep
   the event's id, and a repeated id only re-applies the stored record. A
   manual resend is different: Creem gives it a new id and time around the
   subscription as it was when the event was first made. The webhook
   compares that subscription's `updated_at` with the one on record and
   ignores a resend that is older, so resending an old event can't undo a
   newer state, and an old payment of a subscription the workspace has
   since replaced can't take over again. Two limits remain: a resend is
   only recognised as old if Creem's payload carries `updated_at` (every
   documented one does), and a subscription record written before
   2026-11-26 has no `updated_at` until its next event. When in doubt,
   resend only the newest event for a subscription, then check the
   workspace's plan, or press **Resync plan**.
6. **Unknown product** (`billing unknown product`): a subscription is on a
   Creem product this deployment doesn't map to a plan, so it granted
   nothing. Usually `CREEM_PRODUCT_ID` or `CREEM_PERSONAL_PRODUCT_ID` is
   missing or from the other mode: fix `.env`, deploy, resend the event.
7. Bot Fight Mode can challenge webhooks: see [BILLING.md](BILLING.md).
8. To set a plan by hand for a workspace with no subscription, use the
   operator API: `POST /api/admin/workspaces/<slug>/plan` with
   `{"plan": "free" | "personal" | "team"}`. With a subscription record the
   plan follows it (`force: true` overrides until its next event).

## Plan changes and double payments

- **Replaced** (`billing replaced`): a second subscription paid for a
  workspace that already had one. The later one took over and the app
  canceled the older one at Creem, so it won't charge again. Refund the
  older one's last payment in Creem if the person paid for both. If the
  alert says canceling failed, cancel it in Creem first.
- **Change refused** (`billing change refused`): Creem wouldn't move a
  subscription between Personal and Team (a discount on it, say). Nothing
  was charged and the person was told we'd sort it out: change the product
  in Creem's dashboard, or cancel and have them subscribe to the other
  plan, and reply to them.
- **Change unconfirmed** (`billing change unconfirmed`): Creem accepted a
  plan change but its answer didn't show the subscription paid up on the
  new product (a pro-rated charge that didn't go through). The workspace
  keeps its plan until Creem's events say otherwise; look at the
  subscription in Creem.
- **Moved outside the app:** a product changed in Creem's dashboard is
  followed. If that puts a workspace with several members on Personal,
  they all stay and none can be added; the ops log has "moved from Team to
  Personal". Decide with the customer whether that's what they meant.
- **Refunds stay manual.** A plan change's own pro-rated refund is logged
  as `billing proration refund` without an alert; every other refund or
  dispute alerts, and changes no plan until you press **End billing**.

## Sign-in emails aren't arriving

1. Recent events: `signin email failed` says Cloudflare refused the send.
2. `GET /api/admin/signins?email=<address>` shows the codes sent to an
   address and any rate limits it hit.
3. Cloudflare dashboard → Email → Email Sending: check the sending
   subdomain (`mail.<domain>`) is verified, with SPF and DKIM passing, and
   that the daily send quota isn't used up.
4. People can save a passkey in their account to sign in without email.

## A workspace is abusive

1. Open the reported artifact, and if it's real, **Suspend** the workspace
   in the operator console: its pages stop opening and its agents stop
   working.
2. Download its export for the record (`bun scripts/export.ts <slug>`).
3. If it pays, cancel the subscription in Creem first, then **Delete**
   (the console refuses while a subscription is live; the API takes
   `?force=1`).
4. Reply to the reporter if they left an address.

## Restoring a workspace

1. **Backups…** on the workspace lists its runs (nightly, the latest 30).
2. **Restore** a run: a fresh backup runs first, then the workspace is
   offline until the restore has loaded, and comes back all at once. If a
   step fails it retries a few times, then gives up without changing
   anything live (and emails you).
3. **Cancel job** stops a restore that hasn't swapped in yet.

## Costs

The operator console shows each workspace's plan, storage and activity.
The pricing notes (private) estimate what a Free workspace costs; the caps
that bound it are in `src/worker/plans.ts` (per plan) and
`src/worker/directory.ts` (self-serve signups: 100 a day, one at a time and
three a month per person).
