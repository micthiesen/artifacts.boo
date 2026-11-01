// Save checks for diagram logos (src/shared/logos.ts): a name the kit doesn't have would break the
// diagram, so it is refused with the nearest names; a service drawn with a generic icon whose title
// is a product with a logo gets a hint, since a logo reads faster than a label.
import table from "../shared/logos.json";
import { logoRefs } from "../shared/logos.ts";
import type { CompileError } from "./compile.ts";

const NAMES = Object.keys(table.logos);
const KNOWN = new Set(NAMES);
const squash = (s: string) => s.toLowerCase().replace(/-icon$/, "").replace(/[^a-z0-9]/g, "");
/** Squashed name (`githubactions`, `nextjs`) to the name to write. */
const BY_TITLE = new Map<string, string>();
for (const name of NAMES) {
  const key = squash(name);
  // Prefer the plain name (`nextjs`) over its `-icon` spelling.
  if (!BY_TITLE.has(key) || BY_TITLE.get(key)!.endsWith("-icon")) BY_TITLE.set(key, name);
}
/** Logo names that are also everyday words in a service's title. */
const GENERIC = new Set(["ai", "amp", "arc", "box", "deploy", "dev", "drone", "flux", "ink", "io", "net", "now", "pkg", "q", "rest", "sketch", "spark", "square", "terminal", "vault", "vector", "x"]);

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

/** Up to three logo names close to one that doesn't exist. */
export function nearLogos(name: string): string[] {
  const key = squash(name);
  const scored = NAMES.map((n) => {
    const k = squash(n);
    const score = k === key ? 0 : k.startsWith(key) || key.startsWith(k) ? 1 : k.includes(key) ? 2 : distance(k, key) + 1;
    return [n, score] as const;
  })
    .filter(([n, s]) => s <= Math.max(2, Math.floor(name.length / 3)) && !n.endsWith("-icon"))
    .sort((a, b) => a[1] - b[1] || a[0].length - b[0].length);
  return scored.slice(0, 3).map(([n]) => n);
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/**
 * Where a file's diagram source is, as [offset, text]: in Markdown, its ```mermaid fences and
 * <Diagram> tags, so prose about logos stays free; in code and data files (a <Diagram code>, a
 * ChangeGuide's map), all of it.
 */
function diagramSources(path: string, text: string): [number, string][] {
  if (!/\.mdx?$/.test(path)) return [[0, text]];
  const out: [number, string][] = [];
  for (const m of text.matchAll(/^[ \t]*(`{3,}|~{3,})[ \t]*mermaid[^\n]*\n[\s\S]*?^[ \t]*\1/gm)) out.push([m.index, m[0]]);
  for (const m of text.matchAll(/<Diagram\b[\s\S]*?(?:\/>|<\/Diagram>)/g)) out.push([m.index, m[0]]);
  return out;
}

/** Every `logos:<name>` in the artifact's diagrams (fences, <Diagram code>, a ChangeGuide's map) must exist. */
export function logoErrors(files: Record<string, string>): CompileError[] {
  const errors: CompileError[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (!text.includes("logos:")) continue;
    const seen = new Set<string>();
    for (const [offset, source] of diagramSources(path, text)) {
      for (const name of logoRefs(source)) {
        if (KNOWN.has(name) || seen.has(name)) continue;
        seen.add(name);
        const near = nearLogos(name);
        const at = source.indexOf(`logos:${name}`);
        errors.push({
          path,
          line: lineOf(text, offset + at),
          message: `no logo named logos:${name}${near.length ? `; did you mean ${near.map((n) => `logos:${n}`).join(", ")}?` : ""} Names are the Iconify "logos" set's, in lower case; drop the logo when none fits.`,
        });
      }
    }
  }
  return errors;
}

/**
 * architecture-beta services drawn without a logo whose title names a product that has one. Only
 * where a diagram already has a logo or names two such products: many product names are also
 * ordinary words ("Terminal", "Vault"), and one match alone is as likely a coincidence.
 */
export function logoHints(files: Record<string, string>): string[] {
  const hints: string[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (!text.includes("architecture-beta")) continue;
    for (const [offset, source] of diagramSources(path, text)) {
      if (!source.includes("architecture-beta")) continue;
      const found: string[] = [];
      for (const m of source.matchAll(/^[ \t]*service[ \t]+([\w-]+)(?:\(([^)]*)\))?\[([^\]]+)\]/gm)) {
        const [, id, icon, title] = m;
        if (icon?.startsWith("logos:")) continue;
        const key = squash(title);
        const name = BY_TITLE.get(key);
        if (!name || GENERIC.has(key)) continue;
        found.push(`${path}:${lineOf(text, offset + m.index)}: ${title} has a logo, which reads faster than its label: service ${id}(logos:${name})[${title}]`);
      }
      if (found.length >= 2 || (found.length && source.includes("logos:"))) hints.push(...found);
    }
  }
  return hints;
}
