---
name: maintain
description: >-
  Keeps artifacts.boo current: updates packages, Bun and CI tooling with
  changelogs and audits, refreshes diagram logos (pack bump, dark-theme
  treatments, gaps from real artifacts), adopts what new Pele releases add,
  then ships, deploys and verifies on prod. Use when Michael asks for updates
  or maintenance, when a task changes dependencies, logos or diagram types, or
  when the last maintenance run is over 14 days old.
argument-hint: "[packages | logos | diagrams] (default: all)"
---

# Maintain

Everything here should be current and look right without Michael noticing it
was ever stale. Each run updates what moved upstream, fills gaps real use
exposed, proves it in the gate, a deploy and a look, and records itself.
Invoking it is a request to carry it through `$autopilot`: decide, ship,
deploy and verify; ask Michael only about product calls.

Keep a running list in a scratch directory (`mktemp -d -t maintain`, never
inside the repo). Arguments narrow the run to one area.

## 1. Find the window

Each run's last commit ends with a trailer `Maintenance: <ISO time>`:

```bash
git log -1 --format='%ci %B' --grep='^Maintenance:' | rg 'Maintenance:|^\d'
```

None yet: start from the commit that added this skill. Read
`git log --since=<last run>` for what changed meanwhile.

## 2. Packages and tooling

```bash
bun outdated; bun audit; npm view bun version; npm view alchemy dist-tags
```

- **Holds come first.** Read the memories and `package.json` overrides.
  The effect family (`effect`, `@effect/*`, and the overrides for
  `@effect/platform-node-shared` and `@effect/sql-d1`) stays at 4.0.7: effect
  4.1 drops the `effect/<Module>` subpaths alchemy 2.0.0-beta.84 imports, so
  only a deploy fails. Lift a hold only once its reason is gone, and say so.
- **Read the changelog** of every package whose version changes beyond a
  patch (GitHub releases via `gh api repos/<owner>/<repo>/releases`), and of
  every patch to pele, recharts, react, tailwindcss, @base-ui/react and
  alchemy. Note what we should adopt or what could break, and act on it.
- **Update:** `bun update` for in-range versions and a refreshed lockfile,
  edit `package.json` for exact pins and majors. Keep exact pins exact.
  `onnxruntime-web` is pinned with Listen's voice build (`scripts/build.ts`):
  change it only with a Listen check in the browser.
- **Bun and CI:** `.github/workflows/ci.yml` runs the same Bun as local
  (`bun --version`); bump `bun upgrade` and the workflow together. Bring
  actions to their latest majors (`gh api repos/<action>/releases/latest`).
- **Licences:** a new dependency that ships to readers or runs in the Worker
  is MIT, Apache-2.0, BSD, ISC or CC0 (never GPL or AGPL) and gets a line in
  `THIRD_PARTY_NOTICES.md`.
- A build that changes `src/worker/kit-exports.json` (new lucide icons, say)
  is expected; commit it, since CI checks it's current.

## 3. Diagram logos

Sources: `@iconify-json/logos` (CC0) plus marks it lacks, vendored from svgl
(MIT) in `scripts/logos-extra/` (its README lists each file and the svgl
commit). `scripts/logo-icons.ts` merges them; `bun scripts/logos.ts`
measures each on the dark theme and writes `src/shared/logos.json`.

1. Bump `@iconify-json/logos` (pinned exact) when it moved, then run
   `bun scripts/logos.ts`. It throws when the pack now has a vendored mark:
   delete that extra and its README row.
2. **Find gaps from real use.** Search the workspaces Michael's agents write
   in (`artifact_grep` for `architecture-beta` and `icon:` in the personal,
   Cozee and support workspaces) for services and nodes drawn with a generic
   icon or none whose title is a product. Read only titles; nothing from an
   artifact goes into the repo beyond a product's name. Also re-check the
   brands of the modern stack: hosting, databases, auth, queues, AI
   providers and frameworks that are new or popular since the last run.
3. **Fill a gap** from the pack under another name (add a guess in
   `GUESSES` in `scripts/logos.ts`, like `postgres` → `postgresql`), else from
   svgl: clone it in scratch, take the variant drawn for light backgrounds
   (`*_light`, `*_black` or plain), crop a viewBox that pads the mark
   (measure with resvg's `getBBox`), copy it into `scripts/logos-extra/<name>.svg`
   and add its README row. Skip wordmark-only marks (much wider than tall):
   they don't read at 24 px. A brand no source has keeps a generic icon.
4. **Look at them:** `bun spikes/logo-sheet.ts <scratch>/sheet.png [names]`
   draws each logo as the kit does on the dark theme. Every mark must be
   recognisable: a plate (`p`) only where colour would vanish, one-colour
   marks (`m`) in the text colour, nothing muddy or tiny. A mark drawn wrong
   gets a better source file or a cropped viewBox, not a special case in
   code.

## 4. Diagrams

- `test/pele-theme.test.ts` fails when Pele reads a theme variable the kit
  doesn't set: map it in `.art-diagram` in `src/kit/kit.css` to the theme's
  tokens (Look in `AGENTS.md`), or list it there with why the default is right.
- `test/diagram-gallery.test.ts` fails when Pele adds a diagram type the
  gallery (`spikes/kit-harness/samples/gallery/index.mdx`) doesn't show: add
  an example, and a line in `src/kit/CATALOG.md` saying when to use it.
- For each Pele release since the last run, adopt what helps agents or
  readers: new options in `src/kit/ui/diagram-impl.tsx`, new syntax in the
  catalog, fixes that let the kit drop a workaround.
- Look at the gallery and the `logos` sample in the dark theme at desktop and
  390 px through a fresh `browser` agent on the kit harness
  (`bun run build:kit && bun spikes/kit-harness/build.ts && bun spikes/kit-harness/serve.ts`):
  text on coloured fills readable, no error callouts, no sideways scroll.

## 5. Anything else that went stale

Recharts and other component dependencies whose defaults changed (animation
must stay off), fonts from `@fontsource-variable/*`, Listen's pinned voice
files (`scripts/build-tts.ts`: change only with a listen in the browser),
and docs that name versions. Fix what a run finds rather than noting it.

## 6. Gate, ship, deploy, verify

- `bun run typecheck`, `bun run test`, `bun run build`; then `$check` over the
  change and apply what survives.
- Commit to `main` and push (fetch and rebase first), then watch CI
  (`gh run watch`) and fix it until green. CI on Linux runs test files in a
  different order: a failure that won't reproduce locally is usually state
  one file leaves for another.
- Deploy with `bun run deploy --yes`. A deploy is part of the gate: an
  alchemy or effect change can pass every test and still fail only here.
- Verify on prod with a temporary private artifact in the personal workspace
  using what changed (logos, a new diagram type), look at its render check,
  then delete it.

## 7. Record and hand back

The last commit's message ends with `Maintenance: <ISO time of this run>`
(an empty commit if nothing changed). Hand back: what moved and why, what
was held and why, gaps filled and those left, and anything only Michael can
decide, each with your recommendation.
