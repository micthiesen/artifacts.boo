# Change guides

A change guide explains a code change (a pull request or a branch) to someone
who has no context: they manage many agents, switch tasks constantly and may not
know the codebase. They should understand the change and know what to do in
about two minutes, on a phone. It is one page that always has the same order:
verdict and next action, questions only they can judge, before and after, one
picture, 1 to 6 steps, what was checked, and what to check once it ships.
Blocks for the optional fields appear only when you fill them, so leave out
what you have nothing real for.

Skip the guide when the change is one small idea (about 50 changed lines or
fewer); the pull request's description is enough.

## Make one

1. Collect the facts from git. Never type counts or diff lines yourself:
   - `git diff --numstat <base>...HEAD`: one `files` entry per line,
     `{"path", "add", "del"}` (leave out `add` and `del` for a binary file,
     shown as `-`).
   - `git rev-parse --short HEAD`: `head`.
   - `git diff <base>...HEAD -- <file>`: lines for a step's `diff`.
2. Write two files, then `artifact_create` (private, as always):
   - `index.mdx`: `# <what changes, in plain words>` and `<ChangeGuide data="guide.json" />`. Nothing else.
   - `data/guide.json`, shaped as below.
3. Look at it once with `artifact_check` and `phone: true`.
4. Put the link first in the pull request's description.

The write is refused, with a reason per problem, when a changed file is in no
step and not in `alsoTouched`, a step names a file that isn't in `files`, a
`focus` id isn't a node in `map`, a question points at a missing step, a
check that ran has no exit code or commit, the map isn't a top-down flowchart
or a sequence diagram, or is too wide for a phone, there are more than 6 steps,
or an optional field is malformed (the reason says how to fix it).

## `data/guide.json`

```json
{
  "head": "d73de90",
  "url": "https://github.com/acme/app/pull/412",
  "outcome": "When Listen reads on an iPhone, the light should now stay on the words while you scroll.",
  "where": "Any artifact page › Listen › the small light that follows the words",
  "risk": "medium",
  "riskWhy": "Only the Listen light changes, and nobody has watched it on a phone.",
  "revert": "Safe",
  "ask": { "kind": "approve", "text": "The tests cover the logic; what's left can only be watched once it ships." },
  "before": "A full-screen canvas a script redrew after every scroll; iOS ran the script late, so it lagged.",
  "after": "A small canvas on the page that the browser scrolls with the text.",
  "map": "flowchart TD\n  S([Page scrolls]) --> H[Script moves light]:::removed\n  H --> V([Screen])\n  S --> C[Browser moves canvas]:::added\n  C --> V",
  "lookHere": [{ "q": "Could the canvas ever make a phone page scroll sideways?", "stop": 1 }],
  "stops": [
    { "title": "The canvas shrinks to fit", "why": "It covered the whole screen; now it is a small box on the page.", "files": ["src/kit/kit.css"], "diff": { "file": "src/kit/kit.css", "lines": "-  position: fixed;\n+  position: absolute;" } },
    { "title": "Scrolling no longer waits for the script", "why": "The browser moves the box with the text, so nothing lags.", "files": ["src/kit/wisp.ts", "test/wisp.test.ts"], "focus": "H C" }
  ],
  "alsoTouched": ["bun.lock"],
  "proof": [
    { "check": "bun test test/wisp.test.ts", "ran": true, "exit": 1, "head": "a41c0e2", "expect": "fail", "env": "local" },
    { "check": "bun test test/wisp.test.ts", "ran": true, "exit": 0, "head": "d73de90", "env": "local", "count": "14 passed" }
  ],
  "verify": { "steps": ["Open an artifact on an iPhone and press Listen.", "Scroll while it reads."], "expected": "The light stays on the word being read, with no lag." },
  "files": [
    { "path": "src/kit/kit.css", "add": 5, "del": 5 },
    { "path": "src/kit/wisp.ts", "add": 2, "del": 1 },
    { "path": "test/wisp.test.ts", "add": 9, "del": 0 },
    { "path": "bun.lock", "add": 3, "del": 3 }
  ]
}
```

- `outcome`: one sentence a user of the product would notice, with no code
  names. Say "should now" until someone has watched it work.
- `where`: where in the product this lives, as a path a newcomer can follow
  (`Settings › Billing › Cancel`). Explain any product word once here.
- `risk`: `low`, `medium` or `high`, with the meanings `wt status ready --risk`
  uses: low is verified in a real environment (or pure logic with tests that
  fail on the old code); medium is correct and tested but not run for real;
  high leaves material behaviour unverified. If you already gave wt a risk,
  use the same one.
- `riskWhy` (optional): one sentence saying why the risk is what it is, shown
  with it.
- `revert`: "Safe", or "No:" and the shortest true reason (a migration, data
  written in a new shape).
- `ask`: what the reader should do. `approve` when the checks cover it, `try`
  when something only a person can see must be tried before merging (give
  exact steps, with the expected result), `decide` when you need a choice
  from them. A check that can only happen once it ships is not a `try`: it
  goes in `verify`, and the ask is usually `approve`.
- `decide` (optional): `{question, options, recommended?}`, 2 to 5 short
  options, `recommended` copied word for word from them. The reader answers
  on the page, and the answer is kept: read it with `artifact_state` (key
  `decide/guide`). Use it with `ask.kind: "decide"`, and keep `ask.text` to
  why it matters.
- `before` / `after`: one short sentence each, about behaviour, not code.
- `metrics` (optional): numbers you measured before and after, as `<Delta>`
  rows: `[{"label", "before", "after", "unit"?, "better": "up"|"down",
  "note"?}]`, at most 8. Only real measurements; say how in `metricsNote`
  (window, sample size, machine).
- `shots` (optional): up to 4 screenshots, `[{"before"?, "after"?,
  "caption"}]`, each an image you uploaded with `artifact_asset`
  (`"assets/menu-before.png"`). With both, phones get a Before / After switch
  and wide screens show them side by side. Use them when the change is
  something you see; capture both at the same size.
- `links` (optional): up to 4 more links beside `url`, `[{"label", "url"}]`:
  the ticket, the CI run, related guides.
- `map`: one top-down Mermaid flowchart (`flowchart TD`) of the part of the
  system the change touches: under about 10 nodes, 2 to 4 word labels, and at
  most 2 nodes side by side, so it reads on a phone (a map wider than 520 px is
  refused). Mark nodes `:::added`,
  `:::changed` or `:::removed`; leave unchanged context unmarked. Draw what
  happens (requests, data, events), not the file tree. Readers can switch it
  between Before, Both and After, so the removed and added paths should each
  make sense alone. When the change is really a request flow between a few
  parts, a `sequenceDiagram` (at most 4 participants) can be the map instead;
  it has no marks, and a step's `focus` names participants.
- `lookHere`: 0 to 3 yes/no questions only a person can answer (product
  judgement, an unverified risk), each pointing at its step. Zero is fine; never
  pad. Don't repeat what "Checked" already says.
- `stops`: 1 to 6 steps, in the order a reader understands them: start where a
  person notices the change and follow it to the cause. Put tests in the step
  of the code they cover.
  - `title`: 8 words or fewer.
  - `why`: one or two sentences saying why, never "updated X" or "refactored
    Y". Plain words; code names belong in file chips, not sentences.
  - `files`: the files this step changes.
  - `diff` (optional): at most 15 lines from `git diff`, only when the lines
    read as plain English, like CSS or config; not regexes or dense logic.
  - `focus` (optional): the `map` node ids this step is about; it should
    light fewer than half of them, or the step adds nothing. The map is drawn
    once: steps with a `focus` become its walk-through, and each gets an "On
    the map" button that lights its part.
  - Big steps are fine: files are grouped by folder, folded past 8, and a
    file mirrored under two roots (`src/x/y.ts` and `web/src/x/y.ts`) shows
    once with "×2".
- `alsoTouched`: lockfiles, generated files, renames and formatting. Every file
  in `files` is in a step or here, once.
- `proof`: only commands you ran, with their real exit code and the commit
  they ran at. A check run at another commit than `head` says so. Optional:
  `env` (`local`, `ci`, `staging`, `prod`), `count` (what it reported, "212
  passed"), `link` (the CI run). A test you ran before the fix to show it
  failed is `"expect": "fail"`: it shows as "Failed first", evidence, not a
  failure. Something you'd want checked before merging that nobody ran is
  `"ran": false`.
- `verify` (optional): `{steps, expected}`, 1 to 6 steps to check it once it
  ships, and what they should show. Post-merge checks go in `verify`, not
  `proof`: "watched on production" is never a `ran: false` proof row. Use the
  same steps as `wt status --verify-after-merge` when you have them.
- `url`: the pull request, or the branch or commit page.

## Keep it current

- New commits: rerun the git commands, then `artifact_patch_data` the `files`,
  `head` and `proof`, and edit only the steps whose files changed. Keep red-first
  rows: they stay true at their old commit. Pass a
  `note` ("Covers the retry fix"): readers see it in the page's history and in
  update notifications.
- Comments on the page are questions about the change. Answer them with
  `artifact_comment`, or fix the code and the guide and pass `resolves`.
- When the change merges or is dropped, archive the guide (`artifact_update`
  with `archived: true`), or delete it if the user's standing instructions say
  to.

## Diagram marks and diffs elsewhere

Any artifact can use the same pieces: `:::added`, `:::changed` and
`:::removed` on flowchart nodes (with a Before / Both / After switch),
`<Diagram focus="A B">` to light part of a diagram, `<Diagram steps>` to walk
through one, and a ```` ```diff ```` fence or `<Diff file="…" code="…" />` for a
few changed lines.

Each section has an id, so you can link straight to it: `#the-picture`,
`#step-by-step`, `#checked`, `#after-it-ships`, `#before-and-after`, and
`#step-2` for a step.
