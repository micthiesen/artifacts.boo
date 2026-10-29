# Findings

Findings is the page for an audit or a review: a question someone asked
("why is CI slow?", "where does production latency come from?", "what is
exposed to the internet?"), the answer, and a short ranked list of what to
change, each with what it buys and how to tell it worked. The reader is on a
phone and wants three things: the answer, what to do first, and whether to
trust the numbers. It always has the same order: question and answer, where
the fixes stand, impact against effort (drawn for you), ranked findings, what
isn't worth doing, how it was measured, and an optional long table.

Use it for performance, cost and latency reviews, CI and test reviews,
security and network exposure reviews, trials of a tool or setup, and the
"what to fix" part of a postmortem. Don't use it for a one-off answer with a
single recommendation (write a Summary and a paragraph), or to explain a code
change (topic "change").

## Make one

1. Measure first and write down how: the period you looked at, what you
   counted, where it ran. Keep the raw numbers; paste them, don't retype them.
2. Write the files, then `artifact_create` (private, as always):
   - `index.mdx`: `# <the answer, in plain words>` and `<Findings data="findings.json" />`.
     Add a Checklist or Comments under it if the reader should act on it.
   - `data/findings.json`, shaped as below.
   - The inventory's rows, if any, as their own data file (`data/jobs.json`).
3. Look at it once with `artifact_check` and `phone: true`.

## `data/findings.json`

```json
{
  "question": "Why does CI take 24 minutes on a typical pull request, and what would cut it most?",
  "answer": "Most of the time is the e2e suite running on one machine after the unit tests finish. Sharding it four ways and caching dependencies would bring a typical run to about 9 minutes; the other wins are small.",
  "method": {
    "window": "2026-10-01 to 2026-10-27",
    "sample": "412 CI runs on main and pull requests",
    "setup": "GitHub Actions, ubuntu-latest, 4 vCPU",
    "head": "a8ef847",
    "sources": [{ "label": "Actions usage export", "url": "https://github.com/acme/app/actions" }],
    "caveats": ["Cancelled runs are left out.", "Time waiting in the queue isn't counted."]
  },
  "findings": [
    {
      "id": "shard-e2e",
      "title": "Shard the e2e suite four ways",
      "impact": "high", "effort": "medium", "confidence": "measured", "status": "open",
      "change": "Split Playwright into 4 shards with --shard and merge the reports.",
      "benefit": "The e2e job drops from 14 to about 4 minutes.",
      "validate": "Median CI time on main over a week.",
      "metrics": [{ "label": "e2e job", "before": 840, "after": 250, "unit": "s", "better": "down", "note": "trial branch, 20 runs", "expected": true }],
      "owner": "Dana"
    },
    {
      "id": "cache-deps",
      "title": "Cache dependencies between runs",
      "impact": "high", "effort": "small", "confidence": "measured", "status": "shipped",
      "change": "Use actions/cache keyed on bun.lock.",
      "benefit": "Install drops from 95 s to 8 s.",
      "metrics": [{ "label": "Install", "before": 95, "after": 8, "unit": "s", "better": "down" }],
      "link": { "label": "PR #811", "url": "https://github.com/acme/app/pull/811" }
    },
    {
      "id": "bigger-runner",
      "title": "Move tests to 8 vCPU runners",
      "impact": "medium", "effort": "small", "confidence": "guess", "status": "decide",
      "change": "Switch the test job to the 8-core larger runner, or keep 4 cores. I'd try it for a week.",
      "benefit": "Perhaps 30% faster unit tests, at twice the price per minute.",
      "validate": "A week of runs, and the bill.",
      "decide": { "question": "Move tests to 8 vCPU runners?", "options": ["Try it for a week", "Keep 4 cores"], "recommended": "Try it for a week" }
    }
  ],
  "minor": [
    { "title": "Drop the unused lint cache step", "change": "Delete the cache step in lint.yml; it never hits." }
  ],
  "notWorth": [
    { "title": "Self-hosted runners", "why": "They save money only above about 40,000 minutes a month; we use 9,000." }
  ],
  "inventory": { "title": "Every job, slowest first", "data": "jobs.json", "columns": "job p50 p90 runs", "top": 10 }
}
```

- `question`: what the audit set out to answer, in one sentence, as the
  person asked it.
- `answer`: one short paragraph, with the main number. It is read first; the
  page's `#` heading says the same in fewer words.
- `method`: how to trust the numbers. Always say `window` (the period looked
  at) or `sample` (what was counted, and how many); add `setup` (machine,
  region, tool) and `head` (the commit or version measured) when they matter.
  `caveats` are what the numbers don't cover. Link the raw data in `sources`.
- `findings`: 1 to 12, ranked for you: impact high to low, then effort small
  to large, then your order. List them in the order you'd defend when two tie.
  - `id`: short and stable (`shard-e2e`); the row's link is `#finding-<id>`.
  - `title`: 8 words or fewer, naming the change ("Cache dependencies between
    runs"), not the symptom. Its first two words label the chart's point.
  - `impact` (`high`, `medium`, `low`) and `effort` (`small`, `medium`,
    `large`): your judgement. They place the finding on the impact-against-
    effort chart.
  - `confidence`: label it honestly. `measured` only when you ran it or read
    it from real data in the window; `estimated` when it's worked out from
    measurements; `guess` otherwise.
  - `change`: what to do, concretely enough to start. `benefit`: what it buys,
    with a number when you have one. `validate`: how someone would tell it
    worked.
  - `metrics`: measured before and after numbers, never typed into a sentence
    or a pipe table: `{label, before, after, unit?, better: "up"|"down",
    note?}`. Numbers stay numbers and units go in `unit` (`ms`, `s`, `MB`,
    `%`, `$`); the change is worked out and told as better or worse. Before
    a fix ships, `after` is what you expect: add `"expected": true` and the
    row says so.
  - `status`: `open` (the default), `doing`, `shipped`, `skipped`, or
    `decide` when it waits on the reader's choice (shown as "Your call"; the
    question goes in `decide`).
  - `decide`: `{question?, options, recommended?}`, 2 to 5 short options, on a
    finding that waits on the reader. It shows a Decision inside the finding
    (`question` defaults to the title) that remembers the answer, who gave
    it and when; read it with `artifact_state` at `decide/finding-<id>`.
    `recommended` is one of the options, word for word.
  - `owner`, and `link` (a pull request, ticket or dashboard), when there are
    any.
- `minor`: up to 30 smaller wins, `{title, change}`, that don't earn a rank.
  They show after the findings, outside the 12 and the chart. Anything that
  needs a number or a validation is a finding.
- `notWorth`: ideas a reader would suggest that you checked and rejected,
  each with the reason. It saves the next audit from redoing them.
- `inventory`: the long table behind the findings (every endpoint, every
  job). Put the rows in their own data file and name it in `data`; `columns`
  picks and orders them, `top` (default 10) is how many show before "Show
  all". Sort the rows the way you want them read.

## Keep it current

When a fix ships, set its `status` with `artifact_patch_data` (and add its
`metrics` once measured), passing a `note` ("Sharding shipped"). When a fix
ships, replace its expected numbers with measured ones and drop `expected`.
Never add a Callout, a "Shipped" table or rewritten prose for status: the
roll-up under the answer and each row's badge already say where things stand.

## What the save refuses

The write is refused, with a reason per problem, when `question`, `answer`
or `method` is missing; `method` names none of `window`, `sample` or `setup`,
or a finding is `measured` but `method` has no `window` or `sample`; there
are no findings or more than 12; two findings share an `id`, or an id has
characters other than letters, digits, `-` and `_`; a title is over 8 words;
`impact`, `effort`, `confidence` or `status` isn't one of its words; a
finding has no `change` or `benefit`; a metric isn't
`{label, before, after, unit?, better}` with numbers; a link isn't http(s); `decide` lacks 2 to 5 different options or
`recommended` isn't one of them; `minor` has over 30 items or one lacks
`title` or `change`;
or `inventory.data` names a data file that doesn't exist.
