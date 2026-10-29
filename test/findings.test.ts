// Findings: the save check refuses data that would mislead (unknown levels, a missing benefit, an inventory
// pointing nowhere), findings rank by impact then effort, and the generated chart parses under Pele and is the
// same every time.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { checkFindings, findingsQuadrant, quadrantLabel, rankFindings, shortTitle, statusRollup, type Finding } from "../src/shared/findings.ts";
import { checkMermaid } from "../src/worker/mermaid.ts";
import { load, parse } from "pele/lazy";

const recipe = readFileSync("docs/guides/findings.md", "utf8");
const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(recipe)![1]);
const files = ["data/findings.json", "data/jobs.json"];
const check = (v: unknown) => checkFindings(v, files).join("\n");
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "f",
  title: "Cache dependencies",
  impact: "high",
  effort: "small",
  confidence: "estimated",
  change: "Cache them.",
  benefit: "Faster.",
  ...over,
});

test("the recipe's example passes the check", () => {
  expect(checkFindings(example, files)).toEqual([]);
});

test("required fields, levels and limits are each named with their fix", () => {
  expect(checkFindings(null)).toEqual(['must be a JSON object (see artifact_guide topic "findings")']);
  const { question, answer, ...rest } = example;
  void question, void answer;
  expect(check(rest)).toContain('"question" is required');
  expect(check(rest)).toContain('"answer" is required');
  expect(check({ ...example, method: undefined })).toContain('"method" is required');
  expect(check({ ...example, findings: [] })).toContain('"findings" has 1 to 12 findings (has 0)');
  const many = Array.from({ length: 13 }, (_, i) => finding({ id: `f${i}` }));
  expect(check({ ...example, findings: many })).toContain("(has 13)");
  const bad = check({ ...example, findings: [finding({ impact: "huge" as never, effort: "tiny" as never, confidence: "sure" as never, status: "done" as never })] });
  expect(bad).toContain('"impact" is one of high, medium, low');
  expect(bad).toContain('"effort" is one of small, medium, large');
  expect(bad).toContain('"confidence" is one of measured, estimated, guess');
  expect(bad).toContain('"status" is one of open, doing, shipped, skipped, decide');
  expect(check({ ...example, findings: [finding({ benefit: "" })] })).toContain('"benefit" is required');
  expect(check({ ...example, findings: [finding({ change: undefined as never })] })).toContain('"change" is required');
});

test("ids are unique and fragment-safe; titles are at most 8 words", () => {
  expect(check({ ...example, findings: [finding({ id: "a" }), finding({ id: "a" })] })).toContain('finding "a": the id is used twice');
  expect(check({ ...example, findings: [finding({ id: "has space" })] })).toContain('"id" is 1-40 letters');
  expect(check({ ...example, findings: [finding({ title: "one two three four five six seven eight nine" })] })).toContain("the title has 9 words; keep it to 8");
  expect(check({ ...example, findings: [finding({ title: "one two three four five six seven eight" })] })).toBe("");
});

test("method says what it measured over, and measured findings need a window or sample", () => {
  expect(check({ ...example, method: { head: "abc" } })).toContain('"method" says at least one of "window"');
  const setupOnly = { ...example, method: { setup: "staging" } };
  expect(check(setupOnly)).toContain('a finding is "measured", so "method" says the "window" or "sample"');
  const guesses = { ...setupOnly, findings: [finding({ confidence: "guess" })] };
  expect(check(guesses)).toBe("");
  expect(check({ ...example, method: { ...example.method, sources: [{ label: "x", url: "ftp://x" }] } })).toContain('"method.sources" is a list of {label, url}');
});

test("metrics are Delta rows with numbers", () => {
  const withMetric = (m: unknown) => check({ ...example, findings: [finding({ metrics: [m] as never })] });
  expect(withMetric({ label: "p95", before: 900, after: 400, unit: "ms", better: "down" })).toBe("");
  expect(withMetric({ label: "p95", before: "900 ms", after: 400, better: "down" })).toContain('metric "p95": "before" is a number');
  expect(withMetric({ label: "p95", before: 900, after: 400, better: "lower" })).toContain('"better" is "up" or "down"');
  expect(withMetric({ before: 1, after: 2, better: "up" })).toContain("each metric is {label, before, after");
});

test("inventory names an existing data file, given in any of the kit's spellings", () => {
  expect(check({ ...example, inventory: { title: "All", data: "missing.json" } })).toContain('"inventory.data" names data/missing.json, which doesn\'t exist');
  expect(check({ ...example, inventory: { title: "All", data: "./jobs.json" } })).toBe("");
  expect(check({ ...example, inventory: { title: "All", data: "data/jobs.json", top: 0 } })).toContain('"inventory.top"');
  // Without the file list the name isn't checked (the kit has no list when rendering an old page).
  expect(checkFindings({ ...example, inventory: { title: "All", data: "missing.json" } })).toEqual([]);
});

test("rank: impact high to low, then effort small to large, then file order", () => {
  const list = [
    finding({ id: "low-small", impact: "low", effort: "small" }),
    finding({ id: "high-large", impact: "high", effort: "large" }),
    finding({ id: "high-small-a", impact: "high", effort: "small" }),
    finding({ id: "med-medium", impact: "medium", effort: "medium" }),
    finding({ id: "high-small-b", impact: "high", effort: "small" }),
  ];
  expect(rankFindings(list).map((f) => f.id)).toEqual(["high-small-a", "high-small-b", "high-large", "med-medium", "low-small"]);
  expect(list[0]!.id).toBe("low-small"); // the input isn't reordered
});

test("status roll-up counts open by default, in a fixed order", () => {
  expect(statusRollup([{ status: "shipped" }, {}, { status: "decide" }, { status: "shipped" }, { status: "skipped" }])).toEqual([
    { status: "shipped", count: 2 },
    { status: "decide", count: 1 },
    { status: "open", count: 1 },
    { status: "skipped", count: 1 },
  ]);
});

test("labels: short, never ending on a small word, and safe inside Mermaid quotes", () => {
  expect(shortTitle("Shard the e2e suite four ways")).toBe("Shard the e2e");
  expect(shortTitle("Quarantine the three flaky tests")).toBe("Quarantine");
  expect(shortTitle("Move tests to 8 vCPU runners")).toBe("Move tests to 8");
  expect(shortTitle("Internationalisation-everywhere")).toBe("Internationalisat…");
  expect(quadrantLabel('Drop "legacy" #auth `cookie`')).toBe("Drop 'legacy' auth cookie");
});

test("the chart parses under Pele, keeps every point in its quadrant, and is deterministic", async () => {
  const titles = ['Fix "slow" #query `n+1`', "Cache dependencies between runs", "Shard the e2e suite", "Skip docs-only runs", "Rewrite fixtures", "Bigger runners"];
  const levels: [Finding["impact"], Finding["effort"]][] = [["high", "small"], ["high", "small"], ["high", "medium"], ["low", "small"], ["low", "large"], ["medium", "small"]];
  const ranked = rankFindings(titles.map((title, i) => finding({ id: `f${i}`, title, impact: levels[i]![0], effort: levels[i]![1] })));
  const code = findingsQuadrant(ranked);
  expect(findingsQuadrant(ranked)).toBe(code);
  expect(await checkMermaid("data/findings.json", [{ code, line: 0 }])).toEqual([]);
  await load("quadrantChart");
  const model = parse(code) as { points: { x: number; y: number; text: { text: string } }[] };
  expect(model.points.map((p) => p.text.text)).toEqual(["1 Fix 'slow' query", "2 Cache dependencies", "3 Shard the e2e", "4 Bigger runners", "5 Skip docs-only", "6 Rewrite fixtures"]);
  for (const [i, p] of model.points.entries()) {
    const f = ranked[i]!;
    expect(p.y > 0.5).toBe(f.impact !== "low");
    expect(p.x > 0.5).toBe(f.effort !== "small");
  }
  const spots = model.points.map((p) => `${p.x},${p.y}`);
  expect(new Set(spots).size).toBe(spots.length);
});

test("a crowded quadrant goes two abreast with rank-only labels and stays inside the chart", async () => {
  const ranked = Array.from({ length: 12 }, (_, i) => finding({ id: `f${i}`, title: `Finding number ${i}` }));
  const code = findingsQuadrant(ranked);
  expect(await checkMermaid("data/findings.json", [{ code, line: 0 }])).toEqual([]);
  await load("quadrantChart");
  const model = parse(code) as { points: { x: number; y: number; text: { text: string } }[] };
  expect(model.points.map((p) => p.text.text)).toEqual(ranked.map((_, i) => `${i + 1}`));
  for (const p of model.points) {
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(0.5);
    expect(p.y).toBeGreaterThan(0.5);
    expect(p.y).toBeLessThan(0.9);
  }
  expect(new Set(model.points.map((p) => `${p.x},${p.y}`)).size).toBe(12);
});

test("decide, minor and expected are optional and each refused with its fix", () => {
  const ok = { options: ["Yes", "No"], recommended: "Yes" };
  expect(check({ ...example, findings: [finding({ decide: ok })] })).toBe("");
  const bad = (d: unknown) => check({ ...example, findings: [finding({ decide: d as never })] });
  expect(bad({ options: ["Only"] })).toContain('"decide" is {question?, options, recommended?} with 2 to 5');
  expect(bad({ options: ["a", "b", "c", "d", "e", "f"] })).toContain("2 to 5");
  expect(bad({ options: ["a", "a"] })).toContain("each different");
  expect(bad({ ...ok, recommended: "Maybe" })).toContain("word for word");
  expect(bad({ ...ok, question: 3 })).toContain('"decide.question" is text');
  expect(check({ ...example, minor: [{ title: "Small", change: "Do it." }] })).toBe("");
  expect(check({ ...example, minor: [{ title: "Small" }] })).toContain('"minor" is a list of {title, change}');
  expect(check({ ...example, minor: Array.from({ length: 31 }, () => ({ title: "t", change: "c" })) })).toContain("at most 30");
  const metric = (expected: unknown) => check({ ...example, findings: [finding({ metrics: [{ label: "m", before: 1, after: 2, better: "up", expected } as never] })] });
  expect(metric(true)).toBe("");
  expect(metric("yes")).toContain('"expected" is true or false');
});
