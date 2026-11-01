// A contact sheet of diagram logos as the kit draws them on the dark theme, to look at after
// bun scripts/logos.ts: each logo in its treatment on the service-box surface, with its name and
// treatment (b as is, m text colour, p plate). Needs rsvg-convert (brew install librsvg).
//   bun spikes/logo-sheet.ts [out.png] [name ...]   (default: a mix of common and vendored logos)
import table from "../src/shared/logos.json";
import { logoSvg, type LogoTreatment } from "../src/shared/logos.ts";
import { loadLogoSet } from "../scripts/logo-icons.ts";
import { readdirSync } from "node:fs";
import { join } from "node:path";

// The kit's dark tokens (src/kit/theme.css) as sRGB, since the sheet is drawn outside the page.
const CARD = "#1b1f27", SURFACE = "#262b35", BORDER = "#4a505c", FG = "#f2eee6", MUTED = "#acb1ba";

const [out = "logo-sheet.png", ...asked] = process.argv.slice(2);
const extras = readdirSync(join(import.meta.dir, "../scripts/logos-extra")).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4));
const names = asked.length
  ? asked
  : ["hono", "nextjs", "vercel", "github", "neon", "clerk", "stripe", "supabase", "cloudflare-workers", "postgresql", "redis", "bun", "aws-lambda", "github-actions", "claude", "openai", "docker", "kubernetes", "python", "typescript", "prisma", "rust", "deno", "sentry", ...extras];
const set = await loadLogoSet();
const logos = table.logos as Record<string, string>;

let cells = "";
names.forEach((name, i) => {
  const t = logos[name];
  if (!t) throw new Error(`no logo named ${name}`);
  const target = t.startsWith("=") ? t.slice(1) : name;
  const treatment = logos[target] as LogoTreatment;
  const x = 20 + (i % 8) * 120, y = 20 + Math.floor(i / 8) * 110;
  const svg = logoSvg(target, set.icons[target], set.size, treatment).replace("var(--_m)", MUTED);
  cells += `<rect x="${x + 36}" y="${y}" width="48" height="48" rx="6" fill="${SURFACE}" stroke="${BORDER}"/>`;
  cells += `<svg x="${x + 48}" y="${y + 12}" width="24" height="24" viewBox="0 0 24 24" color="${FG}" fill="none" stroke="currentColor" stroke-width="2">${svg}</svg>`;
  cells += `<text x="${x + 60}" y="${y + 68}" fill="${FG}" font-family="Inter, sans-serif" font-size="12" text-anchor="middle">${name}</text>`;
  cells += `<text x="${x + 60}" y="${y + 84}" fill="${MUTED}" font-family="sans-serif" font-size="10" text-anchor="middle">${treatment}${t.startsWith("=") ? ` (${target})` : ""}</text>`;
});
const rows = Math.ceil(names.length / 8);
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="980" height="${40 + rows * 110}"><rect width="100%" height="100%" fill="${CARD}"/>${cells}</svg>`;
const proc = Bun.spawnSync(["rsvg-convert", "-z", "1.5", "-o", out], { stdin: Buffer.from(sheet) });
if (proc.exitCode) throw new Error(`rsvg-convert failed: ${proc.stderr}`);
console.log(`${names.length} logos -> ${out}`);
