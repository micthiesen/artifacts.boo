// The diagram logo sources, as one Iconify-shaped set: @iconify-json/logos (CC0), plus the few marks it
// lacks, vendored from svgl in scripts/logos-extra/ (MIT; see its README). Read by scripts/logos.ts,
// which measures them, and scripts/build-kit.ts, which writes them out.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export type Icon = { body: string; width?: number; height?: number; left?: number; top?: number };
export type LogoSet = { size: number; icons: Record<string, Icon>; aliases: Record<string, { parent: string }>; version: string };

const ROOT = resolve(import.meta.dir, "..");
const EXTRA = join(ROOT, "scripts/logos-extra");

/** A standalone SVG file as an Iconify icon: its viewBox and what's inside the root element. */
function fromSvg(svg: string, file: string): Icon {
  const root = /<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/.exec(svg.trim());
  const box = root && /\bviewBox="([^"]+)"/.exec(root[1]);
  if (!root || !box) throw new Error(`${file}: no <svg viewBox> root`);
  const [left, top, width, height] = box[1].trim().split(/[\s,]+/).map(Number);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) throw new Error(`${file}: viewBox "${box[1]}" isn't four numbers`);
  // Only the root's fill and stroke carry over (onto a group); anything else there would be dropped silently.
  const attrs = [...root[1].matchAll(/([\w:-]+)="([^"]*)"/g)];
  const unknown = attrs.map((m) => m[1]).filter((n) => !/^(xmlns(:\w+)?|viewBox|width|height|fill|stroke|version|class)$/.test(n));
  if (unknown.length) throw new Error(`${file}: root <svg> has ${unknown.join(", ")}; move them onto a group inside`);
  const paint = attrs.filter((m) => m[1] === "fill" || m[1] === "stroke").map((m) => `${m[1]}="${m[2]}"`).join(" ");
  const body = paint ? `<g ${paint}>${root[2]}</g>` : root[2];
  return { body, left, top, width, height };
}

export async function loadLogoSet(): Promise<LogoSet> {
  const pkg = join(ROOT, "node_modules/@iconify-json/logos");
  const pack = JSON.parse(await readFile(join(pkg, "icons.json"), "utf8"));
  const version: string = JSON.parse(await readFile(join(pkg, "package.json"), "utf8")).version;
  const size = pack.width ?? 256;
  const icons: Record<string, Icon> = { ...pack.icons };
  for (const file of (await readdir(EXTRA)).filter((f) => f.endsWith(".svg")).sort()) {
    const name = file.slice(0, -4);
    if (icons[name]) throw new Error(`scripts/logos-extra/${file}: the pack has ${name} now; delete the extra`);
    icons[name] = fromSvg(await readFile(join(EXTRA, file), "utf8"), file);
  }
  return { size, icons, aliases: pack.aliases ?? {}, version };
}
