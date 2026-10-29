// Change guides, second version: the optional blocks are checked with fix-phrased reasons, old guides stay
// valid, and the file lists fold mirrored copies, group by directory and keep a file name when cut short.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkChangeGuide, fileCount, foldMirrors, groupFiles, mapKind, mapSteps, proofStatus, slug, splitPath, superseded, takeLines } from "../src/shared/change-guide.ts";

const recipe = readFileSync("docs/guides/change.md", "utf8");
const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(recipe)![1]);
const errs = (patch: object) => checkChangeGuide({ ...example, ...patch }).join("\n");

/** A guide written before any optional field existed. */
const old = {
  head: "abc1234",
  outcome: "Saves stay saved.",
  where: "Editor › Save",
  risk: "low",
  revert: "Safe",
  ask: { kind: "decide", text: "Keep the old button or not?" },
  before: "Lost on reload.",
  after: "Kept on reload.",
  map: "flowchart TD\n  A --> B",
  stops: [{ title: "Save writes through", why: "So it lasts.", files: ["a.ts"] }],
  proof: [{ check: "bun test", ran: true, exit: 0, head: "def5678" }],
  files: [{ path: "a.ts", add: 1, del: 1 }],
};

test("a guide written before the new fields is still fine", () => {
  expect(checkChangeGuide(old)).toEqual([]);
  expect(checkChangeGuide(example)).toEqual([]);
});

test("every new field is checked, and each reason says how to fix it", () => {
  expect(errs({ riskWhy: "" })).toContain('"riskWhy" is one sentence');
  expect(errs({ links: [{ label: "CI", url: "ftp://x" }] })).toContain('each of "links" is {label, url}');
  expect(errs({ links: Array.from({ length: 5 }, () => ({ label: "x", url: "https://x.dev" })) })).toContain("at most 4");
  expect(errs({ verify: { steps: [], expected: "ok" } })).toContain('"verify" is {steps, expected}');
  expect(errs({ verify: { steps: Array(7).fill("Open it"), expected: "ok" } })).toContain("1 to 6 steps");
  expect(errs({ verify: { steps: ["Open it"] } })).toContain('"verify" is {steps, expected}');
  expect(errs({ metrics: [{ label: "p95", before: "1.2s", after: 0.8, better: "down" }] })).toContain('metric "p95"\'s "before" and "after" are plain numbers');
  expect(errs({ metrics: [{ label: "p95", before: 1.2, after: 0.8 }] })).toContain('"better" is "up" or "down"');
  expect(errs({ metrics: Array(9).fill({ label: "x", before: 1, after: 2, better: "up" }) })).toContain("1 to 8 rows");
  expect(errs({ metricsNote: "7 days" })).toContain('add it only with "metrics"');
  expect(errs({ shots: [{ caption: "Menu" }] })).toContain("at least one image");
  expect(errs({ shots: [{ before: "https://x.dev/a.png", caption: "Menu" }] })).toContain('("assets/before.png", from artifact_asset)');
  expect(errs({ shots: Array(5).fill({ after: "assets/a.png", caption: "x" }) })).toContain("1 to 4");
  expect(errs({ decide: { question: "Which?", options: ["A"] } })).toContain("2 to 5 short options");
  expect(errs({ decide: { question: "Which?", options: ["A", "B"], recommended: "C" } })).toContain('one of "decide.options"');
  expect(errs({ decide: { question: "Which?", options: ["A", "A"] } })).toContain("each different");
  const proof = (p: object) => errs({ proof: [{ check: "bun test", ran: true, exit: 1, head: example.head, ...p }] });
  expect(proof({ expect: "red" })).toContain('"expect" is "pass", or "fail"');
  expect(proof({ env: "dev" })).toContain('"env" is one of local, ci, staging, prod');
  expect(proof({ link: "ci/run/4" })).toContain('"link" is an http(s) link');
  expect(proof({ count: 212 })).toContain('"count" is what the run reported');
});

test("well-formed new fields pass", () => {
  const full = {
    ...example,
    riskWhy: "Only the Listen tray changes.",
    links: [{ label: "Ticket", url: "https://linear.app/x/1" }],
    verify: { steps: ["Open a page on an iPhone", "Press Listen and scroll"], expected: "The light stays on the word." },
    metrics: [{ label: "Frame time", before: 24, after: 9, unit: "ms", better: "down" }],
    metricsNote: "iPhone 15, 3 runs",
    shots: [{ before: "assets/before.png", after: "assets/after.png", caption: "Listen tray" }, { after: "data:image/png;base64,AAAA", caption: "New" }],
    decide: { question: "Ship to everyone?", options: ["Yes", "Behind a flag"], recommended: "Yes" },
    proof: [
      { check: "bun test test/wisp.test.ts", ran: true, exit: 1, head: "1111111", expect: "fail", env: "local" },
      { check: "CI", ran: true, exit: 0, head: example.head, env: "ci", link: "https://github.com/a/b/actions/runs/1", count: "212 passed" },
    ],
  };
  expect(checkChangeGuide(full)).toEqual([]);
});

test("a check's row: red-first, failed, passed, and quietly on an older commit", () => {
  expect(proofStatus({ check: "t", ran: true, exit: 1, head: "old", expect: "fail" }, "new")).toEqual({ verdict: "red", older: true });
  expect(proofStatus({ check: "t", ran: true, exit: 0, head: "old", expect: "fail" }, "new")).toEqual({ verdict: "failed", older: true });
  expect(proofStatus({ check: "t", ran: true, exit: 0, head: "new" }, "new")).toEqual({ verdict: "passed", older: false });
  expect(proofStatus({ check: "t", ran: true, exit: 0, head: "old" }, "new")).toEqual({ verdict: "passed", older: true });
  expect(proofStatus({ check: "t", ran: true, exit: 2, head: "new", expect: "pass" }, "new")).toEqual({ verdict: "failed", older: false });
  expect(proofStatus({ check: "t", ran: false }, "new")).toEqual({ verdict: "not-run", older: false });
});

test("mirrored copies fold into one line that names both roots", () => {
  const items = foldMirrors([
    { path: "src/kit/ui/table.tsx", add: 3, del: 1 },
    { path: "packages/web/src/kit/ui/table.tsx", add: 3, del: 1 },
    { path: "src/index.ts", add: 1, del: 0 },
    { path: "test/index.ts", add: 1, del: 0 },
  ]);
  expect(items.map((i) => i.path)).toEqual(["src/kit/ui/table.tsx", "src/index.ts", "test/index.ts"]);
  expect(items[0]).toMatchObject({ roots: ["", "packages/web/"], add: 6, del: 2, paths: ["src/kit/ui/table.tsx", "packages/web/src/kit/ui/table.tsx"] });
  // One shared segment (a file name) is a coincidence, not a mirror.
  expect(items[1]!.roots).toBeUndefined();
});

test("a mirror is the same file under another root; two packages' own files aren't", () => {
  const items = foldMirrors([
    { path: "src/data/chat/send.ts", add: 1, del: 0 },
    { path: "packages/web/src/data/chat/send.ts", add: 2, del: 1 },
    { path: "packages/web/src/index.ts", add: 1, del: 0 },
    { path: "packages/api/src/index.ts", add: 1, del: 0 },
    { path: "logo.png" },
    { path: "web/logo.png" },
  ]);
  expect(items[0]!.paths).toEqual(["src/data/chat/send.ts", "packages/web/src/data/chat/send.ts"]);
  expect(items[0]!.add).toBe(3);
  // Same two-segment tail, different packages: different files.
  expect(items.filter((i) => i.path.endsWith("index.ts")).every((i) => i.paths?.length === 1 && !i.roots)).toBe(true);
  // One segment is a file name only, never a mirror; a binary file keeps its counts unknown.
  expect(items.find((i) => i.path === "logo.png")!.roots).toBeUndefined();
  expect(items.some((i) => i.add === undefined)).toBe(true);
});

test("files group by directory in first-seen order, and a fold keeps the first lines", () => {
  const files = ["src/a.ts", "test/a.test.ts", "src/b.ts", "src/c.ts", "docs/x.md"].map((path) => ({ path, add: 1, del: 0 }));
  const groups = groupFiles(files);
  expect(groups.map((g) => [g.dir, g.items.map((i) => i.name)])).toEqual([
    ["src/", ["a.ts", "b.ts", "c.ts"]],
    ["test/", ["a.test.ts"]],
    ["docs/", ["x.md"]],
  ]);
  expect(takeLines(groups, 4).map((g) => g.items.length)).toEqual([3, 1]);
  expect(takeLines(groups, 2).map((g) => g.items.length)).toEqual([2]);
});

test("a path splits before its file name, so the name survives a cut", () => {
  expect(splitPath("packages/web/src/kit/ui/table.tsx")).toEqual({ dir: "packages/web/src/kit/ui/", name: "table.tsx" });
  expect(splitPath("README.md")).toEqual({ dir: "", name: "README.md" });
});

test("the map: flowchart or sequence, steps only for stops that focus, numbered as the stops are", () => {
  expect(mapKind("flowchart TD\n A-->B")).toBe("flowchart");
  expect(mapKind("%% note\nsequenceDiagram\n A->>B: hi")).toBe("sequence");
  expect(mapKind("flowchart LR\n A-->B")).toBeNull();
  const { steps, stepOf } = mapSteps([
    { title: "One", why: "w1", files: [] },
    { title: "Two", why: "w2", files: [], focus: "A B" },
    { title: "Three", why: "w3", files: [], focus: "C" },
  ]);
  expect(steps).toEqual([
    { focus: "A B", title: "2. Two", text: "w2" },
    { focus: "C", title: "3. Three", text: "w3" },
  ]);
  expect([...stepOf]).toEqual([
    [1, 0],
    [2, 1],
  ]);
  // One focus is no walk-through: the map shows whole, with no "All 1 steps".
  expect(mapSteps([{ title: "Two", why: "w2", files: [], focus: "A B" }]).steps).toEqual([]);
});

test("a check someone watched has a result instead of an exit code, and reads as passed or failed", () => {
  const watched = { check: "Opened a chat on a phone", ran: true, result: "passed" as const, head: example.head, env: "local" as const };
  expect(errs({ proof: [watched] })).toBe("");
  expect(errs({ proof: [{ ...watched, result: undefined }] })).toContain('"result": "passed" or "failed"');
  expect(errs({ proof: [{ ...watched, result: "ok" }] })).toContain('"result" is "passed" or "failed"');
  expect(errs({ proof: [{ ...watched, note: "" }] })).toContain('"note" is a few words');
  expect(proofStatus(watched, example.head)).toEqual({ verdict: "passed", older: false });
  expect(proofStatus({ ...watched, result: "failed" }, example.head).verdict).toBe("failed");
  expect(proofStatus({ ...watched, result: "failed", expect: "fail" }, example.head).verdict).toBe("red");
});

test("a run superseded by the same check at the head folds away; red-first runs and lone old runs stay", () => {
  const proof = [
    { check: "bun test", ran: true, exit: 1, head: "old1", expect: "fail" as const },
    { check: "bun test", ran: true, exit: 1, head: "old1" },
    { check: "bun test ", ran: true, exit: 0, head: "new" },
    { check: "lint", ran: true, exit: 0, head: "old2" },
    { check: "e2e", ran: false },
  ];
  expect([...superseded(proof, "new")]).toEqual([1]);
});

test("a big change can list folders, which count their files; a guide may have no map", () => {
  const files = [
    { path: "supabase/functions/", files: 429, add: 10, del: 900 },
    { path: "README.md", add: 1, del: 0 },
  ];
  const stops = [{ title: "Comments go", why: "Noise.", files: ["supabase/functions/", "README.md"] }];
  expect(errs({ files, stops, alsoTouched: [], lookHere: [], map: undefined })).toBe("");
  expect(fileCount(files)).toBe(430);
  // Whether a folder has its count is checked on save (compile.ts), so a guide saved before still renders.
  expect(errs({ files: [{ path: "a/", files: 0 }], stops: [{ ...stops[0], files: ["a/"] }], alsoTouched: [], lookHere: [] })).toContain('"files" is how many files');
  expect(errs({ map: undefined })).toContain('has a "focus" but the guide has no "map"');
  expect(splitPath("supabase/functions/")).toEqual({ dir: "supabase/", name: "functions/" });
  expect(splitPath("functions/")).toEqual({ dir: "", name: "functions/" });
  const [item] = foldMirrors([
    { path: "src/hooks/", files: 3, add: 1, del: 2 },
    { path: "packages/web/src/hooks/", files: 4, add: 1, del: 2 },
  ]);
  expect(item).toMatchObject({ name: "hooks/", files: 7, roots: ["", "packages/web/"] });
});

test("section ids are kebab slugs of their headings", () => {
  expect(slug("After it ships")).toBe("after-it-ships");
  expect(slug("Only you can judge")).toBe("only-you-can-judge");
});
