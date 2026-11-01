// Every colour, font and size Pele lets a page theme is set by the kit (src/kit/kit.css), so a Pele update
// that adds one can't leave diagrams on Pele's light defaults unnoticed. Map a new one in .art-diagram, or
// list it here with the reason the default is right.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
/** Left to Pele: where the zoom buttons sit, which fits our cards as is. */
const DEFAULTS = new Set(["--pele-zoom-bottom", "--pele-zoom-cursor", "--pele-zoom-left", "--pele-zoom-right", "--pele-zoom-top"]);

test("the kit themes every variable Pele reads", () => {
  const pele = readFileSync(join(ROOT, "node_modules/pele/dist/pele.js"), "utf8");
  const kit = ["src/kit/kit.css", "src/kit/diagram-steps.css"].map((f) => readFileSync(join(ROOT, f), "utf8")).join("\n");
  // `--pele-series-` is the stem of --pele-series-1 to 8, built at run time.
  const read = new Set([...pele.matchAll(/--pele-[a-z0-9-]*[a-z0-9]/g)].map((m) => m[0]));
  const set = new Set([...kit.matchAll(/(--pele-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  read.delete("--pele-series");
  for (let i = 1; i <= 8; i++) read.add(`--pele-series-${i}`);
  const missing = [...read].filter((v) => !set.has(v) && !DEFAULTS.has(v)).sort();
  expect(missing).toEqual([]);
});
