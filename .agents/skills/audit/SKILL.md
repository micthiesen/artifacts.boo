---
name: audit
description: >-
  Reviews every artifact Michael's agents wrote or updated since the last
  audit, across the workspaces reachable through MCP, judges what works and
  what doesn't for readers and for the agents writing them, then improves
  artifacts.boo (guide, recipes, kit components, save checks) so those kinds
  of artifacts come out better next time. Commits and pushes, recording the
  audit so the next one starts where this one ended. User-initiated via $audit.
argument-hint: "[since <date>] [focus, e.g. change guides]"
disable-model-invocation: true
---

# Audit

Agents write artifacts for Michael every day, guided by `docs/guide.md`,
`src/kit/CATALOG.md` and the recipes in `docs/guides/`. The pages they
produce are the best evidence of where that guidance, the kit and the save
checks fall short. This skill reads what's new since the last audit, finds
the patterns, and fixes them at the source: the instructions, a component,
a recipe or a check. Fixing an individual artifact is not the goal; making
the next one of its kind better is.

Invoking `$audit` is Michael's request to run `$autopilot` on the result:
decide the improvements yourself and ship them.

## 1. Find the window

Each audit commit carries a trailer `Artifact-audit: <ISO time>`, the moment
that audit listed artifacts. The newest one is the start of this window:

```bash
git log -1 --format=%B --grep='^Artifact-audit:' | rg '^Artifact-audit:'
```

With none, start at `2026-10-29T21:58Z` (the manual audit behind `e881d4e`;
an earlier one, 2026-10-28, is the artifact "Better artifacts: components,
recipes and diagrams" in the personal workspace). A date in the arguments
overrides this. Note the current time now as this audit's end.

Read `git log --since=<start>` too: what shipped since the window began is
what the new artifacts should be using.

## 2. Collect

Make a scratch directory with `mktemp -d -t audit` (the harness scratch area
when there is one), never inside the repo, and keep `<scratch>/items.md` as
the running list so it survives context summarization.

List every workspace's artifacts with `artifact_list`, following `page`
until it runs out: personal (`artifacts__*`), Cozee (`artifacts_cozee__*`)
and support (`artifacts_support__*`). Keep the ones whose `updatedAt` falls
in the window and whose owner is Michael (`michael@thiesen.dev`,
`michael@getcozee.ai`). Other people's artifacts and customers' are out of
scope, even when a tool can read them. For each, note id, workspace,
version, title and a guessed genre (change guide, findings, shortlist,
proposal, tracker, research, record, hub, plan, other).

For a page that existed before the window, only what changed in it is new
evidence; `artifact_history` shows how many saves it took and their notes.

No artifacts in the window: say so, record nothing, stop.

## 3. Review

Split the artifacts by genre into two to four batches and hand each to a
read-only `general-purpose` subagent, in one parallel launch. Each brief
says:

- Read-only: edit no artifact or file, comment on nothing.
- The workspace's tool prefix, the ids, and the genre's recipe, components
  and save checks to read first (`docs/guides/<genre>.md`, `src/kit/ui/`,
  grep `src/worker/compile.ts` for its checks), plus what shipped since the
  window began.
- For each artifact: read its files, `artifact_history` (save count, notes,
  redone saves), `artifact_threads`, `artifact_errors` and `artifact_state`
  (were Decisions and Polls answered, and how fast). Take `artifact_check`
  phone screenshots (`phone: true`, `fullPage` for long ones) of at least
  four per batch and look at them.
- Report in under about 900 words: what works, with ids; problems, with ids
  and how often they occur; ranked fixes to named files. Look especially
  for things the kit has but agents rebuilt by hand, a recipe that fits but
  wasn't used, a genre that keeps recurring with no recipe, phone layout
  failures, stale or overlong pages, questions asked in prose instead of a
  `Decision`, and runtime errors a save check should have refused.
- Personal pages hold health, money and family details: describe structure,
  not content.

While they run, read `docs/guide.md`, `src/kit/CATALOG.md` and the recipes
yourself so you can judge their suggestions.

Then step back across all reports. The best fixes are patterns seen in
several artifacts or workspaces, problems that broke a page for readers, and
whether the last audit's fixes took: if pages written since still miss them,
the guidance didn't reach the agents, and saying it louder in the same place
won't help. One-off taste problems in a single page aren't worth a rule.

## 4. Improve

Pick the changes that will matter most, and prefer the smallest that does
it: a sentence in the guide or a recipe over a new component, a save-time
warning over a refusal unless the page would break. Hold every change to
`AGENTS.md`: no fixed cost, the eager kit bundle (`ui.js`) stays tiny and
new components load lazily, Look, Controls, Motion. A product question only
Michael can answer goes in the hand-back with your recommendation, not into
the code.

Follow `~/.agents/skills/autopilot/SKILL.md` from Execute through Ship:
build, `$check`, the full gate from `AGENTS.md` (`bun run typecheck`,
`bun test`, `bun run build`), and after UI changes a look at the changed
components at phone width (`spikes/kit-harness/` samples through a fresh
`browser` agent) and `spikes/e2e-layout.ts` against a stage. Leave anyone
else's uncommitted changes alone. Deploy only when Michael asks; the guide
and kit changes reach agents once deployed.

**Privacy.** This repo is public. Nothing read from an artifact goes into a
commit, code, test fixture, sample or comment: no titles, names, numbers,
customers, or Cozee details. Describe the problem in general terms ("a
tracker updated by scheduled runs") and invent sample data.

## 5. Record the audit

The last commit of the audit ends its message with the trailer:

```
Artifact-audit: <this audit's end time, ISO>
```

Start the subject with what the reader gains, as the earlier audit did
("Kit, from a review of 33 recent artifacts: ..."). If the audit found
nothing worth changing, still record it so the next one doesn't redo the
window: `git commit --allow-empty` with a one-line subject and the trailer.
Push. Remove the scratch directory, including when you stop early.

## 6. Hand back

Lead with how many artifacts in which workspaces you reviewed and the
window. Then what's working, what wasn't (with counts), and what changed,
with the commit. Then what you left alone and why, and any questions for
Michael, one each with your recommended answer.
