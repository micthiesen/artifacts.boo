// Change guides: the save refuses a guide that would mislead its reader, and the recipe's own example passes.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildArtifact } from "../src/worker/compile.ts";
import { checkChangeGuide } from "../src/shared/change-guide.ts";

const recipe = readFileSync("docs/guides/change.md", "utf8");
const example = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(recipe)![1]);
const page = { "index.mdx": '# Light stays on the words\n\n<ChangeGuide data="guide.json" />\n' };
const build = (guide: unknown) => buildArtifact({ ...page, "data/guide.json": JSON.stringify(guide) });
const messages = async (guide: unknown) => (await build(guide)).errors.map((e) => e.message);

test("the recipe's example guide saves", async () => {
  const r = await build(example);
  expect(r.errors).toEqual([]);
  expect(r.build).toBeDefined();
});

test("a changed file left out of every step and alsoTouched is refused", async () => {
  const guide = { ...example, files: [...example.files, { path: "src/forgotten.ts", add: 4, del: 0 }] };
  expect((await messages(guide)).join("\n")).toContain("src/forgotten.ts");
});

test("steps may only name changed files, and a file sits in a step or alsoTouched, not both", async () => {
  const stops = [{ ...example.stops[0], files: ["src/kit/kit.css", "src/elsewhere.ts"] }, example.stops[1]];
  expect((await messages({ ...example, stops })).join("\n")).toContain('"src/elsewhere.ts", which isn\'t in "files"');
  const both = await messages({ ...example, alsoTouched: ["bun.lock", "src/kit/kit.css"] });
  expect(both.join("\n")).toContain("in a step and in \"alsoTouched\"");
});

test("focus ids must be nodes of the map, questions must point at a step", async () => {
  const stops = [example.stops[0], { ...example.stops[1], focus: "H Nope" }];
  expect((await messages({ ...example, stops })).join("\n")).toContain('focus "Nope" isn\'t a node');
  const look = await messages({ ...example, lookHere: [{ q: "Fine?", stop: 9 }] });
  expect(look.join("\n")).toContain("step number from 1 to 2");
});

test("a broken map is reported as the map's syntax error", async () => {
  const errs = await messages({ ...example, map: "flowchart LR\n  A[open --> B" });
  expect(errs[0]).toContain('"map"');
});

test("a check that ran needs its exit code and commit; more than six steps is too many", () => {
  const proof = [{ check: "bun test", ran: true }];
  expect(checkChangeGuide({ ...example, proof }).join("\n")).toContain("needs its \"exit\" code");
  const stops = Array.from({ length: 7 }, () => example.stops[0]);
  expect(checkChangeGuide({ ...example, stops }).join("\n")).toContain("1 to 6 steps");
});

test("a page whose guide data is missing isn't saved", async () => {
  const r = await buildArtifact(page);
  expect(r.errors[0].message).toContain("data/guide.json");
});

test("diffs are short git diff lines", () => {
  const long = { ...example.stops[0], diff: { lines: Array.from({ length: 20 }, () => "+x").join("\n") } };
  expect(checkChangeGuide({ ...example, stops: [long, example.stops[1]] }).join("\n")).toContain("at most 15");
  const prose = { ...example.stops[0], diff: { lines: "changed the thing" } };
  expect(checkChangeGuide({ ...example, stops: [prose, example.stops[1]] }).join("\n")).toContain('start with "+"');
});

test("the map is top-down and narrow enough to read on a phone", async () => {
  const sideways = await messages({ ...example, map: example.map.replace("flowchart TD", "flowchart LR") });
  expect(sideways.join("\n")).toContain("flowchart TD");
  const row = Array.from({ length: 6 }, (_, i) => `  S --> N${i}[Some longer label ${i}]`).join("\n");
  const wide = await messages({ ...example, map: `flowchart TD\n  S([Start])\n${row}\n  H[x] --> C[y]`, stops: example.stops.map((s: object) => ({ ...s, focus: undefined })) });
  expect(wide.join("\n")).toMatch(/draws \d+ px wide/);
});

test("code samples mentioning <ChangeGuide> aren't uses, and ./ paths name the same data file", async () => {
  const doc = await buildArtifact({ "index.mdx": "# Docs\n\nWrite `<ChangeGuide />`:\n\n```mdx\n<ChangeGuide data=\"guide.json\" />\n```\n" });
  expect(doc.errors).toEqual([]);
  const dotted = await buildArtifact({ "index.mdx": '# G\n\n<ChangeGuide data="./guide.json" />\n', "data/guide.json": JSON.stringify(example) });
  expect(dotted.errors).toEqual([]);
});

test("the change link must be http(s)", () => {
  expect(checkChangeGuide({ ...example, url: "javascript:alert(1)" }).join("\n")).toContain('"url"');
});

test("a sequence diagram can be the map, its steps focusing participants", async () => {
  const map = "sequenceDiagram\n  participant B as Browser\n  participant W as Worker\n  B->>W: GET /a/x\n  W-->>B: page and data";
  const stops = [example.stops[0], { ...example.stops[1], focus: "W" }];
  expect(await messages({ ...example, map, stops })).toEqual([]);
});
