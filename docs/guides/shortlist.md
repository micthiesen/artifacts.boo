# Shortlists

A shortlist helps someone choose between real options: providers (a clinic, a
dentist, a plumber), products (a router, a pram) or plans (a phone contract,
an insurance tier). It is one page that always has the same order: the
question, your pick and why, what matters, the options ranked best first as
one-line rows that open to their details, the ones you ruled out, and
optionally a place to decide. A reader on a phone should see the answer at
once and only open the rows they care about.

Use it when there are 2 to 10 concrete options with prices or facts that
someone checked. For a yes/no question or a choice between ideas, a
`<Decision>` alone is enough.

## Make one

1. Research first (below). Every option you keep needs a link the reader can
   check.
2. Write two files, then `artifact_create` (private, as always):
   - `index.mdx`: `# <the decision, in plain words>` and
     `<Shortlist data="shortlist.json" />`. Add prose only for context that
     belongs to no single option (one or two short paragraphs at most).
   - `data/shortlist.json`, shaped as below.
3. Look at it once with `artifact_check` and `phone: true`.

## Research rules

- Check prices, availability and opening hours on the provider's own site
  and write the day you did as `checked` (or an option's `priceChecked` when
  you checked it on another day). Never copy a price without a date.
- Set `next` to when the facts are likely to go stale (a promotion's end, a
  month for prices); the page says "Due for a recheck" from that day.
- Cite where each claim came from in that option's `evidence`: the official
  page first (`kind: "official"`), then independent reviews (`report`) and
  forums (`forum`). A forum post is a report of one person, so say so.
- Mark what you couldn't verify in the option itself ("Price on request",
  "Hours not listed: call first" as a con or a fact), never by leaving it out.
- Rule options out with `verdict: "no"` and a one-sentence reason as the
  summary, rather than dropping them: the reader can see you looked.

## `data/shortlist.json`

```json
{
  "question": "Which clinic for laser hair removal?",
  "pick": "lumen",
  "why": "Doctor-led, a fixed price per session, and a free test patch this month.",
  "checked": "2026-10-27",
  "next": "2026-11-30",
  "criteria": ["Safety", "Total price", "Distance"],
  "options": [
    {
      "id": "lumen",
      "name": "Lumen Skin Clinic",
      "verdict": "pick",
      "summary": "Doctor-led clinic using a diode laser suited to darker skin.",
      "price": "€90 a session",
      "pros": ["A dermatologist does the consultation", "Free test patch until 30 Nov"],
      "cons": ["Evening slots book out two weeks ahead"],
      "deciding": "Can you make a weekday morning slot?",
      "facts": [{ "label": "Distance", "value": "1.4 km" }, { "label": "Sessions", "value": "6 to 8" }],
      "evidence": [
        { "label": "Price list", "url": "https://lumen.example/prices", "kind": "official" },
        { "label": "Google reviews (4.8, 312)", "url": "https://maps.example/lumen", "kind": "report" }
      ],
      "url": "https://lumen.example"
    },
    {
      "id": "city-laser",
      "name": "City Laser",
      "verdict": "close",
      "summary": "Cheaper chain studio; trained technicians, no doctor on site.",
      "price": "€65 a session",
      "priceChecked": "2026-10-25",
      "cons": ["Package prices only; single sessions not listed"],
      "evidence": [{ "label": "Packages", "url": "https://citylaser.example/packages", "kind": "official" }]
    },
    {
      "id": "home-ipl",
      "name": "Home IPL device",
      "verdict": "conditional",
      "summary": "One-off cost; only works on light skin with dark hair.",
      "price": "€299 once",
      "deciding": "Is your hair darker than your skin?",
      "evidence": [{ "label": "Skin-tone chart", "url": "https://maker.example/ipl/suitability", "kind": "official" }]
    },
    {
      "id": "beauty-bar",
      "name": "Beauty Bar",
      "verdict": "no",
      "summary": "Uses an older IPL machine not suited to darker skin."
    }
  ],
  "decide": { "options": "all" }
}
```

- `question`: what's being decided, as the reader would ask it.
- `pick` and `why`: the option id you recommend and one sentence on why.
  Leave both out when the choice is genuinely open; the page then shows no
  pick. The option you pick has `verdict: "pick"`, and only that one.
- `checked` / `next`: when the facts were checked and when to check again,
  as `YYYY-MM-DD`.
- `criteria`: what matters, most important first, a few words each. Rank by
  them.
- `options`: 2 to 10, each:
  - `id`: lowercase letters, digits and `-`; it names the choice in `decide`.
  - `verdict`: `pick` (the one), `close` (a good alternative), `conditional`
    (right only in some case: say which in `deciding`) or `no` (ruled out).
    Rows are shown pick, then close, then conditional, in your order within
    each; ruled-out options fold away at the end.
  - `summary`: one sentence of at most 30 words. It is the row: write it for
    someone who will read nothing else.
  - `price`: as the provider states it, with its unit ("€90 a session").
  - `pros` / `cons`: up to 5 short points each (25 words at most).
  - `deciding`: the one question whose answer would decide for or against it.
  - `facts`: up to 8 `{label, value}` pairs: distance, waiting time, hours.
  - `evidence`: up to 6 `{label, url, kind?}` links; `kind` is `primary`,
    `official`, `provider`, `report`, `forum` or `owner`. `url`: the option's
    own site, shown as "Website".
- `decide`: adds a `<Decision>` under the list, its answer saved as
  `decide/shortlist` (set `decide.id` when a page has two). `options` is
  `"all"` (every option not ruled out) or a list of ids; the pick is marked
  Recommended. Read the answer with `artifact_state`.

Keep caveats in the option they belong to (a con, a fact, the deciding
question), not in page-long prose around the list. If a caveat applies to
every option, it is one short paragraph in `index.mdx`.

## What the save check refuses

The write is refused, with a reason per problem, when: `question` or
`checked` is missing; a date isn't a real `YYYY-MM-DD` day, `checked` is in
the future or `next` isn't after it; there are fewer than 2 or more than 10
options; an id is reused or isn't lowercase letters, digits and `-`; a verdict
isn't one of the four; `pick` names no option, its option's verdict isn't
`pick`, more than one option is `pick`, or `pick` has no `why`; an option that
isn't ruled out has no `evidence` link and no `url`; a link isn't http(s); a
summary runs over 30 words, or pros, cons, facts or evidence run over their
limits; `decide` names an option that doesn't exist.

## Keep it current

- When you recheck, `artifact_patch_data` the prices, `checked` and `next`,
  with a `note` ("Prices rechecked; City Laser now €70").
- Comments on the page are questions about an option. Answer with
  `artifact_comment`, or fix the data and pass `resolves`.
- Once the reader has decided, say so in the page (a line in `index.mdx`) and
  archive it when it has served its purpose.
