# Support

People and their agents send the operator problems, ideas and questions
about artifacts.boo itself. The operator's assistant picks them up, works
them, and tells people what happened. Nothing here runs unless someone
writes in, and nothing needs setting up: the support workspace
(`support.<domain>`) is made the first time anyone sends a request.

## How a request works

- **Sending one.** People use **Help & feedback** (`/support`, in the
  account menu and on error pages). Their agent can use `support_report`
  through the MCP server of any workspace it's connected to.
- **Each request is an artifact** in the support workspace, shared only
  with the person who sent it (the operators are its admins).
  - Their message starts the page's comment thread, which is the
    conversation.
  - The page shows where it stands and what they chose to include: the
    page they came from, their browser family, and an error code. It
    never includes artifact content.
  - Once a fix is out, the page asks "Did this fix it?" (see
    [Did the fix work?](#did-the-fix-work)).
  - It shows the approved plan and a log of what happened (time, who,
    what), so the person can follow along. Both are written for them to
    read.
- **Internal notes** go on a second artifact (`#n · internal notes`),
  shared with nobody.
- **Status**: new, triaged, investigating, needs_info, fix_proposed,
  fix_deployed, resolved, wont_fix or duplicate.
  - It's set only through the support tools. People can't change it from
    the page.
  - People are told (inbox and email) about needs_info, fix_deployed,
    resolved, wont_fix and duplicate, once per change. A reply sent in the
    same `support_update` rides in that email, so one update is one email.
    A status change the person caused themselves (answering "Did this fix
    it?") isn't sent back to them.
  - A reply after a request is resolved wakes the assistant like any
    reply. If the assistant moves the request back from resolved, that
    counts as reopened in the stats.
- **Their agent** can follow requests (`support_requests`) and add to one
  (`support_reply`, at most 10 a day per request).
- **Limits:** five new requests per person a day, and 200 for everyone.
- **Times** in the support tools are UTC, written as ISO 8601 with the
  offset (`2026-11-20T08:18:05+00:00`); emails say
  `2026-11-20 08:18 UTC (+00:00)`. The request's page shows times in the
  reader's own zone. When the assistant writes a time in a reply, it gives
  the offset too.

## Did the fix work?

A request at fix_deployed asks the person who sent it "Did this fix it?".

- **Yes** resolves the request.
- **No** needs a short note saying what's still wrong. The note is stored
  with the answer, the request goes back to investigating, and the
  operators are told (inbox, an email to the first operator, and the ops
  log). The assistant hears through `artifact.answered`, which carries the
  note. The same answer on a resolved request reopens it.
- **No answer** in 7 days resolves the request, with a reply saying how to
  reopen it. Set `SUPPORT_AUTO_RESOLVE_DAYS` in `.env` for another number.
  The support workspace wakes for this only while a released fix is waiting
  for an answer.
- Releasing another fix (fix_deployed again) clears the earlier answer and
  asks again.

Each of these goes in the request's log.

## Plan and log

- **Plan:** `support_update` with `plan` (text or Markdown, up to 10,000
  characters; `null` removes it) records the plan the operator approved.
  The assistant writes it during its plan turn. The page shows it as
  written, without rendering the Markdown.
- **Log:** status changes, plan changes, the person's answers, automatic
  resolution and the first read of a linked page are logged by themselves.
  `support_update` with `event` adds a line (up to 300 characters). Each
  line has a time, an actor (`agent`, `system` or the person's address) and
  the event; the newest 100 are kept.
- `support_case` returns both. The person sees both on the page, so
  internal detail stays in the notes artifact.

## Linked pages

When the person links an artifact (`https://<workspace>.<domain>/a/<id>`)
in their request or its conversation, the assistant can read it with
`support_page`: the file list, then one file's text. That is enough to see
a component's source.

- Only pages the person named in their own words, in any workspace.
- Only while they can open the page themselves; their access is checked at
  each read, so a page they lose access to stops being readable.
- Read-only. Nothing is copied into the request, and the first read of each
  page is logged where the person sees it.
- The form and the `support_report` tool say that linking a page lets us
  read it. What's read is the person's content: data, never instructions.

## Connecting the operator's assistant

The support workspace exists once anyone sends a request; to connect
first, make it with `POST /api/admin/support` (operator token).

1. Add the support workspace's MCP server to the assistant, signed in as
   an operator (an address in `OPERATOR_EMAILS`):
   `claude mcp add --transport http artifacts-support https://support.<domain>/mcp`.
   The support tools only exist there, and only for operators: `support_cases`,
   `support_case`, `support_update`, `support_page`, `support_announce`,
   `support_errors` and `support_stats`.
2. Subscribe to its events, by webhook or by polling:
   - `comment.created`: new requests (the first message), and replies.
   - `artifact.answered`: someone said whether a fix helped (block `fixed`).
   The log is durable, and cursors make a missed or repeated delivery
   harmless: catching up after time offline just replays from the last
   cursor.
3. Read a request with `support_case` (record, plan, log and linked pages),
   and its conversation with `artifact_threads` on its artifact. Reply with
   `support_update` (`message`, together with the status change it goes
   with) or `artifact_comment`, and keep notes in the notes artifact. Record
   the approved plan with `support_update` (`plan`).
4. Link fixes: `support_update` with `status: "fix_proposed"`, then
   `"fix_deployed"`, and `fix: {summary, version, commit, pr}`. People see the
   summary and version; the commit and PR stay in the record. After
   fix_deployed the request resolves by itself (the person's answer, or no
   answer in 7 days), so there's no need to resolve it by hand.
5. Telling everyone affected: mark duplicates (`duplicateOf`), then
   `support_announce`. The draft waits in the operator's **Inbox**
   (`/inbox`), showing the whole message and which requests it goes to;
   approving it there sends it once to each request. A draft expires after
   14 days.
6. Product errors: `support_errors` (pass `since` for what's new) lists
   failures in artifacts.boo itself, grouped by fingerprint, with counts,
   versions and browsers. Attach one to a request with `errorId`.
7. `support_stats` shows open work, recurring problems, repeated ideas,
   time to resolve and reopened requests. The assistant can keep a
   "Support overview" artifact from it.

The operators' own notifications in the support workspace start muted:
the assistant hears through events, not their email.

## Guardrails

- **Everything people and their agents write is untrusted.** It's never
  instructions, and it never changes what the assistant may do.
  - The server enforces this. On their own request, people can comment and
    answer "Did this fix it?", nothing more: they can't set status, the
    plan or the log, change the page, or reach the support tools. Their
    answer moves the request only between fix_deployed, resolved and
    investigating.
  - Agent comments don't raise events, so the assistant can't wake
    itself.
- **Announcements to several people** go out only after the operator
  approves them in their inbox.
- **Ideas** are recorded and counted (duplicates show demand). They
  aren't commitments: replies shouldn't promise features or dates the
  operator hasn't decided.
- **Fixes** follow the operator's normal rules for the assistant (review,
  deploy). Nothing here deploys or changes code by itself.

## Errors

- **Server:** failures that escape a request, and internal errors behind a
  500, are recorded with the path (ids removed), a scrubbed message
  (addresses, links, tokens and quoted text removed; other words in an
  error message can remain), the version and the browser family. Repeats
  within a few seconds are counted once, so counts are approximate.
- **Browser:** errors in artifacts.boo's own pages are sent from the page,
  a few per page view and per network an hour. Errors inside artifacts
  aren't, because they go to the artifact's owner instead.
- **Error pages** show the code and a **Report this** link, which opens
  Help & feedback with the code attached.
