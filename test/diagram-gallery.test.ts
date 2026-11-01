// The kit harness gallery (spikes/kit-harness/samples/gallery) shows every diagram type Pele draws, so a type
// a Pele update adds is looked at in the dark theme, and given a line in src/kit/CATALOG.md, before agents use it.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { detectType } from "pele/lazy";

const ROOT = join(import.meta.dir, "..");
/** Not diagrams: pie and xychart are refused for <Chart>, and info only prints Pele's version. */
const NOT_SHOWN = new Set(["pie", "xychart", "info"]);

test("the gallery has an example of every diagram type", () => {
  const types = readFileSync(join(ROOT, "node_modules/pele/dist/detect.d.ts"), "utf8");
  const all = [...(/DiagramType = ([^;]+);/.exec(types)?.[1] ?? "").matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]);
  expect(all.length).toBeGreaterThan(20);
  const gallery = readFileSync(join(ROOT, "spikes/kit-harness/samples/gallery/index.mdx"), "utf8");
  const shown = new Set([...gallery.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => detectType(m[1])));
  expect(all.filter((t) => !shown.has(t as never) && !NOT_SHOWN.has(t))).toEqual([]);
});
