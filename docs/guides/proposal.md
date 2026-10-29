# Proposals

A proposal asks someone to choose what happens next before you build it: a
design, a plan of work, a fix with a few ways to do it. It is one page in the
same order every time: the recommendation, the evidence that it's needed,
the options, the plan, how you'll know it worked, and the questions to
answer, each one a `Decision` on the page. A reader on a phone should see
what you recommend and what you need from them on the first screen, and
answer without leaving the page.

Use a `"shortlist"` instead when the options are real products or providers
with prices, and `"findings"` when the page is a list of problems ranked by
impact. A proposal has no component of its own: it is the kit's pieces in a
fixed order.

## Make one

`index.mdx`, in this order:

1. `# <the change you propose, in plain words>`
2. `<Summary>`: what you recommend and what you need from the reader, in two
   or three sentences.
3. **Why**: the evidence, measured where you can. Numbers before and after
   go in `<Delta>` (mark projected rows in a `note`), one number against a
   target in `<BulletBar>`, what you checked and when in `<AsOf>` and
   `<Sources>`. Under a screen on a phone.
4. **Options**, when there is a real choice: a `Decision` whose options carry
   the comparison, `{value, label, detail}` with one or two sentences of
   trade-off each and `recommended` set. Don't lay the same options out again
   in a table above it.
5. **Plan**: `<Steps>`, one step per piece of work, in order. A Mermaid
   diagram when the change moves how something flows (`:::added` and
   `:::removed` marks give it a Before / After switch).
6. **How we'll know**: what you'll measure or watch once it's done, and what
   counts as success.
7. Any other question you need answered, each its own `Decision`.

## Rules

- **Every ask is a `Decision`.** Including what's outside the work itself
  ("raise the Sentry quota?"). A question in prose doesn't get answered, and
  its answer isn't kept.
- **At most about 5 Decisions.** More means the proposal is several; split it
  or decide the small ones yourself and say so. Use an `Approval` only for a
  go/no-go on the whole page, never alongside Decisions asking the same.
- **Recommend.** Every Decision has `recommended`, and the Summary says why.
- **Read the note with the answer.** An answer is `{choice, note}` at
  `decide/<id>` (`artifact_state`); the note can narrow or override the choice
  ("all in one PR"), and a question in it gets a reply with
  `artifact_comment`.

## Keep it current

Once answers are in, the page becomes the record of what was decided:

- Keep every answered `Decision` on the page with its id unchanged: removing
  it hides the answer, and a new id starts empty.
- Rewrite the `Summary` to say what was decided and where the work stands.
  Never add a Callout on top that contradicts the Summary below it.
- Record progress in a `<Log>` over `data/log.json` ("Built in one PR",
  "Shipped: 3.8 s to 1.1 s"), appending with `artifact_patch_data`.
- Replace projected numbers with measured ones when you have them.
