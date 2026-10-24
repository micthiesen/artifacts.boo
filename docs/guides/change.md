# Change guides

A change guide explains a code change (a pull request or a branch) to someone
who has no context: they manage many agents, switch tasks constantly and may not
know the codebase. They should understand the change and know what to do in
about two minutes, on a phone. It is one page that always has the same order:
verdict and next action, questions only they can judge, before and after, one
picture, 1 to 6 steps, and what was checked.

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
or is too wide for a phone, or there are more than 6 steps.

## `data/guide.json`

```json
{
  "head": "d73de90",
  "url": "https://github.com/acme/app/pull/412",
  "outcome": "When Listen reads on an iPhone, the light should now stay on the words while you scroll.",
  "where": "Any artifact page › Listen › the small light that follows the words",
  "risk": "medium",
  "revert": "Safe",
  "ask": { "kind": "try", "text": "Nobody has watched it on a phone yet.", "steps": ["Open an artifact on an iPhone and press Listen.", "Scroll while it reads: the light stays on the word."] },
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
    { "check": "bun test test/wisp.test.ts", "ran": true, "exit": 0, "head": "d73de90" },
    { "check": "Watched on an iPhone", "ran": false }
  ],
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
- `revert`: "Safe", or "No:" and the shortest true reason (a migration, data
  written in a new shape).
- `ask`: what the reader should do. `approve` when the checks cover it, `try`
  when something only a person can see is unchecked (give exact steps,
  with the expected result), `decide` when you need a choice from them (say
  the options and your recommendation in `text`).
- `before` / `after`: one short sentence each, about behaviour, not code.
- `map`: one top-down Mermaid flowchart (`flowchart TD`) of the part of the
  system the change touches: under about 10 nodes, 2 to 4 word labels, and at
  most 2 nodes side by side, so it reads on a phone (a map wider than 520 px is
  refused). Mark nodes `:::added`,
  `:::changed` or `:::removed`; leave unchanged context unmarked. Draw what
  happens (requests, data, events), not the file tree. Readers can switch it
  between Before, Both and After, so the removed and added paths should each
  make sense alone.
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
  - One visual: `diff` (at most 15 lines from `git diff`, only when the lines
    read as plain English, like CSS or config; not regexes or dense logic), or
    `focus` (the `map` node ids this step is about; it should light fewer than
    half of them, or the step adds nothing to the picture above).
- `alsoTouched`: lockfiles, generated files, renames and formatting. Every file
  in `files` is in a step or here, once.
- `proof`: only commands you ran this session, at `head`, with their real exit
  code. Everything else you'd want checked is `"ran": false`. A check run at
  another commit shows as "Other commit".
- `url`: the pull request, or the branch or commit page.

## Keep it current

- New commits: rerun the git commands, then `artifact_patch_data` the `files`,
  `head` and `proof`, and edit only the steps whose files changed. Pass a
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
`<Diagram focus="A B">` to light part of a diagram, and a ```` ```diff ````
fence or `<Diff file="…" code="…" />` for a few changed lines.
