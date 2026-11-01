// Writes src/shared/logos.json from the logo sources (scripts/logo-icons.ts): every logo name a
// diagram may use (`logos:<name>`) and how it is drawn on the kit's dark surface.
// Run after bumping the pack: bun scripts/logos.ts (test/logos.test.ts fails
// until the table matches the installed version).
//
// Each logo is rasterized and measured against the surface Pele puts behind a
// service (--secondary). Under a quarter of it near-invisible: drawn as is ("b").
// More, and one colour: drawn in the diagram's text colour ("m"), as brands do
// for their black marks on dark grounds. More, in several colours: drawn on a
// small muted plate ("p"), since recolouring a multi-colour mark changes it.
import { Resvg } from "@resvg/resvg-js";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { logoPaints } from "../src/shared/logos.ts";
import { loadLogoSet, type Icon } from "./logo-icons.ts";

const ROOT = resolve(import.meta.dir, "..");
const set = await loadLogoSet();
const version = set.version;

/** Names agents reach for that the pack spells differently. */
const GUESSES: Record<string, string> = {
  postgres: "postgresql",
  node: "nodejs-icon",
  k8s: "kubernetes",
  golang: "go",
  gcp: "google-cloud",
  ts: "typescript-icon",
  js: "javascript",
  gha: "github-actions",
  "shadcn-ui": "shadcn",
};

// --secondary, oklch(0.255 0.018 262), as linear-light luminance.
function oklchLuminance(L: number, C: number, h: number): number {
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}
const SURFACE = oklchLuminance(0.255, 0.018, 262);
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function treatment(icon: Icon): "b" | "m" | "p" {
  const w = icon.width ?? set.size, h = icon.height ?? set.size;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${icon.left ?? 0} ${icon.top ?? 0} ${w} ${h}">${icon.body}</svg>`;
  const img = new Resvg(svg, { fitTo: { mode: "width", value: 64 } }).render();
  const px = img.pixels;
  let total = 0, dim = 0, solid = 0;
  const colours = new Map<number, number>();
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255;
    if (a < 0.05) continue;
    // Pixels are premultiplied; undo it for the colour.
    const [r, g, b] = [px[i], px[i + 1], px[i + 2]].map((c) => Math.min(255, c / a));
    const y = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    const contrast = (Math.max(y, SURFACE) + 0.05) / (Math.min(y, SURFACE) + 0.05);
    total += a;
    if (contrast < 2) dim += a;
    if (a > 0.9) {
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      colours.set(key, (colours.get(key) ?? 0) + 1);
      solid++;
    }
  }
  if (!total || dim / total <= 0.25) return "b";
  // Recolouring is safe only when the markup itself names one paint: a mark that is mostly one
  // colour can still carry lettering in another (.NET's white type), which recolouring would erase.
  const oneColour = solid && Math.max(...colours.values()) / solid > 0.9 && logoPaints(icon.body).size <= 1;
  return oneColour ? "m" : "p";
}

// Dark-ground variants are for wordmarks on other sites; the treatment above does that job here.
const names = Object.keys(set.icons).filter((n) => !/-(dark|light)$/.test(n)).sort();
const logos: Record<string, string> = {};
for (const name of names) logos[name] = treatment(set.icons[name]);
// A square mark reads at 24 px where a wordmark doesn't, so `logos:nextjs` draws nextjs-icon.
for (const name of names) if (logos[`${name}-icon`]) logos[name] = `=${name}-icon`;
for (const [alias, { parent }] of Object.entries(set.aliases)) if (logos[parent] && !logos[alias]) logos[alias] = `=${parent}`;
for (const [guess, target] of Object.entries(GUESSES)) {
  if (!logos[target]) throw new Error(`guess ${guess} points at missing logo ${target}`);
  if (!logos[guess]) logos[guess] = `=${target}`;
}
const sorted = Object.fromEntries(Object.entries(logos).sort(([a], [b]) => a.localeCompare(b)));
const hash = createHash("sha256").update(JSON.stringify(sorted)).digest("hex").slice(0, 8);
await writeFile(resolve(ROOT, "src/shared/logos.json"), JSON.stringify({ v: `${version}-${hash}`, logos: sorted }) + "\n");
const counts = Object.values(sorted).reduce<Record<string, number>>((c, t) => ((c[t[0] === "=" ? "alias" : t] = (c[t[0] === "=" ? "alias" : t] ?? 0) + 1), c), {});
console.log(`logos ${version}-${hash}:`, counts);
