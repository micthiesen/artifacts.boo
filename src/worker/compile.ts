// Compiles artifact source files to browser ES modules on write, so agents get
// errors in the tool result and viewers never transpile.
import { transform } from "sucrase";
import { init as initLexer, parse as parseModule } from "es-module-lexer/js";
import { compile as compileMdx } from "@mdx-js/mdx";
import remarkGfm from "remark-gfm";
import { compile as compileTailwind } from "tailwindcss";
import preflightCss from "tailwindcss/preflight.css";
import themeCss from "tailwindcss/theme.css";
import utilitiesCss from "tailwindcss/utilities.css";
import kitThemeCss from "../kit/theme.css";
import type { JsonValue } from "../shared/protocol.ts";
import kitExports from "./kit-exports.json";
import { remarkBlockIds, type BlockInfo } from "./blocks.ts";
import { checkMermaid, mermaidNodeIds, mermaidWidth, remarkMermaid, type MermaidBlock } from "./mermaid.ts";
import { checkChangeGuide, mapKind } from "../shared/change-guide.ts";
import { checkSources } from "../shared/sources.ts";
import { checkShortlist } from "../shared/shortlist.ts";
import { checkFindings, findingsQuadrant, rankFindings, type FindingsData } from "../shared/findings.ts";

export const ALLOWED_IMPORTS = new Set([
  "react",
  "react/jsx-runtime",
  "@a/ui",
  "@a/hooks",
  "lucide-react",
  "recharts",
]);

export type CompileError = { path: string; message: string; line?: number };
export type CompiledModule = { path: string; code: string; classes: string[]; blocks?: BlockInfo[] };


export async function compileFile(
  path: string,
  source: string,
  files: Set<string>,
): Promise<{ module?: CompiledModule; errors: CompileError[] }> {
  let code: string;
  let blocks: BlockInfo[] | undefined;
  const errors: CompileError[] = [];
  try {
    if (path.endsWith(".mdx") || path.endsWith(".md")) {
      blocks = [];
      const diagrams: MermaidBlock[] = [];
      const out = await compileMdx(stripFrontmatter(source), {
        jsxImportSource: "react",
        format: path.endsWith(".md") ? "md" : "mdx",
        providerImportSource: "@a/ui",
        remarkPlugins: [remarkGfm, remarkMermaid(diagrams), remarkBlockIds(blocks)],
      });
      code = String(out.value);
      errors.push(...(await checkMermaid(path, diagrams)));
    } else if (/\.(tsx|ts|jsx|js)$/.test(path)) {
      code = transform(source, {
        transforms: ["typescript", "jsx"],
        jsxRuntime: "automatic",
        production: true,
        // Keep unused imports so a bad specifier is still reported.
        keepUnusedImports: true,
        filePath: path,
      }).code;
    } else {
      return { errors: [] };
    }
  } catch (err) {
    const e = err as { message?: string; place?: { line?: number; start?: { line?: number } } };
    const message = e.message ?? String(err);
    const fromMessage = /\((\d+):\d+\)/.exec(message)?.[1];
    const line = fromMessage ? Number(fromMessage) : (e.place?.line ?? e.place?.start?.line);
    return { errors: [{ path, message, line }] };
  }

  let specs: string[];
  try {
    specs = await importSpecifiers(code);
  } catch (err) {
    return { errors: [{ path, message: `could not parse compiled module: ${(err as Error).message}` }] };
  }
  for (const spec of specs) {
    if (spec.startsWith("./") || spec.startsWith("../")) {
      if (!resolveImport(path, spec, files)) {
        errors.push({ path, message: `import "${spec}": no such file in this artifact` });
      }
    } else if (!ALLOWED_IMPORTS.has(spec)) {
      errors.push({
        path,
        message: `import "${spec}" is not available. Allowed: ${[...ALLOWED_IMPORTS].join(", ")} and relative files`,
      });
    }
  }
  errors.push(...checkNames(path, code));
  if (/\.(tsx|jsx)$/.test(path)) errors.push(...undeclaredTags(path, code));
  return { module: { path, code, classes: extractCandidates(source), blocks }, errors };
}

const MODULE_EXPORTS: Record<string, Set<string>> = Object.fromEntries(
  Object.entries(kitExports.modules).map(([m, names]) => [m, new Set(names)]),
);
const MDX_COMPONENTS = new Set(kitExports.mdxComponents);

/** Reject named imports a module doesn't export and MDX components the kit lacks. */
function checkNames(path: string, code: string): CompileError[] {
  const errors: CompileError[] = [];
  for (const imp of lexImports(code)) {
    const exported = imp.spec ? MODULE_EXPORTS[imp.spec] : undefined;
    if (!exported || imp.ss < 0 || imp.se <= imp.ss) continue;
    const statement = code.slice(imp.ss, imp.se);
    const named = /\{([^}]*)\}/.exec(statement)?.[1];
    if (!named) continue;
    for (const part of named.split(",")) {
      const name = part.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (!name || exported.has(name)) continue;
      errors.push({ path, message: `"${name}" is not exported by ${imp.spec}.${suggest(name, exported)}` });
    }
  }
  if (path.endsWith(".mdx") || path.endsWith(".md")) {
    for (const m of code.matchAll(/_missingMdxReference\("([^"]+)"/g)) {
      const name = m[1].split(".")[0];
      if (!/^[A-Z]/.test(name) || MDX_COMPONENTS.has(name) || declaredInModule(code, name)) continue;
      errors.push({ path, message: `<${name}> is not a kit component.${suggest(name, MDX_COMPONENTS)} See artifact_guide for the list.` });
    }
  }
  return errors;
}

/**
 * A capitalized JSX tag whose name is never declared crashes at runtime ("Accordion is not defined") although
 * the save passes. In the compiled module a tag is `_jsx(Name,`; anything that declares or mentions the name
 * (import, param, destructuring, const, function, `as` rename, a string) is some other occurrence of it.
 */
function undeclaredTags(path: string, code: string): CompileError[] {
  const errors: CompileError[] = [];
  const seen = new Set<string>();
  for (const m of code.matchAll(/\b_jsxs?\(([A-Z][\w$]*)(?=[.,)])/g)) {
    const name = m[1]!;
    if (seen.has(name)) continue;
    seen.add(name);
    const id = name.replace(/\$/g, "\\$");
    const all = code.match(new RegExp(`(?<![\\w$])${id}(?![\\w$])`, "g"))?.length ?? 0;
    const asTag = code.match(new RegExp(`\\b_jsxs?\\(${id}(?![\\w$])`, "g"))?.length ?? 0;
    if (all > asTag) continue;
    const hint = name === "React" ? `write <>…</> for a fragment, or import * as React from "react"` : MODULE_EXPORTS["@a/ui"]?.has(name) ? `add it to import { … } from "@a/ui"` : `import or declare it`;
    errors.push({ path, message: `<${name}${name === "React" ? ".…" : ""}> is used but ${name} is never imported: ${hint}` });
  }
  return errors;
}

function declaredInModule(code: string, name: string): boolean {
  return new RegExp(`(?:import|export)\\s[^;]*\\b${name}\\b|(?:const|let|function)\\s+${name}\\b`).test(code);
}

function suggest(name: string, options: Set<string>): string {
  let best: string | null = null;
  let bestScore = Infinity;
  const lower = name.toLowerCase();
  for (const o of options) {
    const d = distance(lower, o.toLowerCase());
    if (d < bestScore) [best, bestScore] = [o, d];
  }
  return best && bestScore <= Math.max(2, Math.floor(name.length / 3)) ? ` Did you mean ${best}?` : "";
}

function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]++;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length];
}

const SOURCE_EXTENSIONS = ["", ".tsx", ".ts", ".jsx", ".js", ".mdx", ".md"];

export function resolveImport(from: string, spec: string, files: Set<string>): string | null {
  const base = resolveRelative(from, spec);
  for (const ext of SOURCE_EXTENSIONS) if (files.has(base + ext)) return base + ext;
  return null;
}

type LexedImport = { spec: string | undefined; s: number; e: number; ss: number; se: number };

// es-module-lexer 2.x names fields specifier/start/end; 1.x used n/s/e.
function lexImports(code: string): LexedImport[] {
  const [imports] = parseModule(code) as unknown as [Record<string, unknown>[]];
  return imports.map((i) => ({
    spec: (i.specifier ?? i.n) as string | undefined,
    s: (i.start ?? i.s) as number,
    e: (i.end ?? i.e) as number,
    ss: (i.importStart ?? i.ss) as number,
    se: (i.importEnd ?? i.se) as number,
  }));
}

/** Static and string-literal dynamic import specifiers of a JS module. */
export async function importSpecifiers(code: string): Promise<string[]> {
  await initLexer;
  return lexImports(code).map((i) => i.spec).filter((n): n is string => typeof n === "string");
}

export function resolveRelative(from: string, spec: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

// Tailwind ignores invalid candidates, so a generous token split is enough and
// avoids the native oxide scanner, which cannot run in a Worker.
export function extractCandidates(source: string): string[] {
  const out = new Set<string>();
  for (const tok of source.split(/[\s"'`{}()<>;,]+/)) {
    if (tok.length > 0 && tok.length < 120 && /^[!@\w-][\w:/.%#\[\]()=&>+*,-]*$/.test(tok)) out.add(tok);
  }
  return [...out];
}

const STYLESHEETS: Record<string, string> = {
  "tailwindcss/preflight.css": preflightCss,
  "tailwindcss/theme.css": themeCss,
  "tailwindcss/utilities.css": utilitiesCss,
};

export async function compileCss(entryCss: string, candidates: Iterable<string>): Promise<string> {
  const compiler = await compileTailwind(entryCss, {
    base: "/",
    loadStylesheet: async (id: string) => {
      const key = id.startsWith("tailwindcss/") ? id : `tailwindcss/${id.replace(/^\.\//, "")}`;
      const content = STYLESHEETS[key];
      if (content === undefined) throw new Error(`stylesheet ${id} not available`);
      return { path: key, base: "/", content };
    },
  });
  return compiler.build([...candidates]);
}

export function stripFrontmatter(source: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source);
  // Keep line numbers stable for error messages.
  return m ? "\n".repeat(m[0].split("\n").length - 1) + source.slice(m[0].length) : source;
}

export const ENTRY_FILES = ["index.mdx", "index.md", "app.tsx"];
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

export type Build = {
  entry: string;
  /** Import-map entries for this artifact's modules, as data: URLs. */
  imports: Record<string, string>;
  css: string;
  data: Record<string, JsonValue>;
  /** Top-level blocks of an MDX/MD entry, in order (empty for app.tsx). */
  blocks?: BlockInfo[];
  /** BUILD_STAMP of the compiler that produced this build; absent on old builds. */
  stamp?: string;
};

const ART_PREFIX = "@art/";

export function validatePath(path: string): string | null {
  if (!/^[A-Za-z0-9_][A-Za-z0-9_./-]*$/.test(path) || path.includes("..") || path.includes("//") || path.endsWith("/")) {
    return `invalid path "${path}": use relative paths like "app.tsx", "components/chart.tsx" or "data/rows.json"`;
  }
  if (path.startsWith("data/")) return path.endsWith(".json") ? null : `"${path}": files under data/ must be .json`;
  if (!/\.(tsx|ts|jsx|js|mdx|md)$/.test(path)) {
    return `"${path}": unsupported file type. Use .mdx/.md/.tsx/.ts/.jsx/.js for code and data/*.json for data`;
  }
  return null;
}

/** Compile a whole artifact. Returns errors instead of a build if anything fails. */
/** Phones are about 390 px wide; a page's own padding leaves a little less. */
const PHONE_PX = 360;
const BREAKPOINT = /^(sm|md|lg|xl|2xl|min-\[[^\]]+\]):/;

/** A Tailwind width class's fixed width in px, if it has one (w-[800px], min-w-[40rem], w-120). */
function fixedWidth(cls: string): number | null {
  const m = /^(?:min-)?w-(?:\[(\d+(?:\.\d+)?)(px|rem)\]|(\d+(?:\.\d+)?))$/.exec(cls);
  if (!m) return null;
  if (m[3]) return Number(m[3]) * 4; // the spacing scale: w-1 is 0.25rem
  return Number(m[1]) * (m[2] === "rem" ? 16 : 1);
}

/**
 * Widths that won't fit a phone, found while compiling, so the agent hears
 * about them on save without rendering the page again. Classes behind a
 * breakpoint (md:w-[800px]) are fine: they only apply on wider screens.
 */
export function phoneWidthWarnings(classes: Iterable<string>, sources: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const cls of classes) {
    if (BREAKPOINT.test(cls)) continue;
    const px = fixedWidth(cls.replace(/^!/, ""));
    if (px !== null && px > PHONE_PX) out.add(`${cls} is ${Math.round(px)} px wide, wider than a phone (about 390 px): use w-full or max-w-…, or put it behind md:`);
  }
  for (const [path, source] of Object.entries(sources)) {
    // Inline styles: style={{ width: 800 }} or width: "50rem".
    for (const m of source.matchAll(/\b(?:minWidth|width)\s*:\s*["']?(\d+(?:\.\d+)?)(px|rem)?["']?/g)) {
      const px = Number(m[1]) * (m[2] === "rem" ? 16 : 1);
      if (px > PHONE_PX) out.add(`${path}: ${m[0].trim()} is ${Math.round(px)} px wide, wider than a phone: use maxWidth or a percentage`);
    }
  }
  return [...out];
}

export async function buildArtifact(files: Record<string, string>): Promise<{ build?: Build; errors: CompileError[]; warnings?: string[] }> {
  const errors: CompileError[] = [];
  const paths = Object.keys(files);
  const pathSet = new Set(paths);
  let total = 0;
  for (const path of paths) {
    const bad = validatePath(path);
    if (bad) errors.push({ path, message: bad });
    const size = new TextEncoder().encode(files[path]).length;
    total += size;
    if (size > MAX_FILE_BYTES) errors.push({ path, message: `file is ${size} bytes; the limit is ${MAX_FILE_BYTES}` });
  }
  if (total > MAX_ARTIFACT_BYTES) errors.push({ path: "", message: `artifact is ${total} bytes; the limit is ${MAX_ARTIFACT_BYTES}` });
  const entries = ENTRY_FILES.filter((e) => pathSet.has(e));
  if (entries.length !== 1) {
    errors.push({
      path: "",
      message: entries.length === 0
        ? `no entry file: add exactly one of ${ENTRY_FILES.join(", ")}`
        : `several entry files (${entries.join(", ")}): keep exactly one`,
    });
  }
  if (errors.length) return { errors };

  const imports: Record<string, string> = {};
  const data: Record<string, JsonValue> = {};
  const candidates = new Set<string>();
  let blocks: BlockInfo[] = [];
  for (const path of paths) {
    if (path.startsWith("data/")) {
      try {
        data[path] = JSON.parse(files[path]);
      } catch (err) {
        errors.push({ path, message: `invalid JSON: ${(err as Error).message}` });
      }
      continue;
    }
    const result = await compileFile(path, files[path], pathSet);
    errors.push(...result.errors);
    if (!result.module) continue;
    for (const c of result.module.classes) candidates.add(c);
    if (path === entries[0] && result.module.blocks) blocks = result.module.blocks;
    const code = await rewriteRelativeImports(path, result.module.code, pathSet);
    imports[ART_PREFIX + path] = `data:text/javascript;base64,${toBase64(code)}`;
  }
  errors.push(...(await changeGuideErrors(files, data)));
  errors.push(...shortlistErrors(files, data));
  errors.push(...decisionErrors(files));
  errors.push(...(await findingsErrors(files, data)));
  const sources = sourcesErrors(files, data);
  errors.push(...sources.errors);
  if (errors.length) return { errors };

  let css: string;
  try {
    css = await compileCss(ARTIFACT_CSS_ENTRY, candidates);
  } catch (err) {
    return { errors: [{ path: "", message: `stylesheet: ${(err as Error).message}` }] };
  }
  const code = Object.fromEntries(paths.filter((p) => !p.startsWith("data/")).map((p) => [p, files[p]]));
  const warnings = [...phoneWidthWarnings(candidates, code), ...dataWarnings(code, data), ...sources.warnings];
  return { build: { entry: ART_PREFIX + entries[0], imports, css, data, blocks, stamp: BUILD_STAMP }, errors: [], ...(warnings.length ? { warnings } : {}) };
}

/**
 * A <ChangeGuide> whose data skips a changed file, points at a missing step or lights a node its picture lacks
 * would mislead the reader, so it isn't saved. Its picture is checked like any ```mermaid fence.
 */
/** As the kit resolves a component's `data` prop: "./x.json", "x.json" and "data/x.json" are the same file. */
function dataPath(name: string): string {
  const p = name.trim().replace(/^\.?\//, "");
  return p.startsWith("data/") ? p : `data/${p}`;
}

/**
 * Page files as code, without what only mentions a tag: fences and inline code in MDX, comments in TSX.
 */
function pageCode(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([path]) => /\.(mdx|tsx|jsx)$/.test(path))
    .map(([path, source]) =>
      path.endsWith(".mdx")
        ? source.replace(/^(```|~~~)[\s\S]*?^\1/gm, "").replace(/`[^`\n]*`/g, "")
        : source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<![:"'`\w\\])\/\/[^\n]*/g, ""),
    );
}

/**
 * The attribute text of every use of the kit component `name` across the page files. A file that declares
 * its own `name`, or imports one from somewhere other than the kit, is using that instead, so it's skipped.
 * Attributes are read with quotes and braces in mind, so `onPick={() => go()}` doesn't end the tag early.
 */
function kitTags(files: Record<string, string>, name: string): string[] {
  const own = new RegExp(`\\b(?:function|const|let|var|class)\\s+${name}\\b|\\bimport\\s+${name}\\b|\\bimport\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*["'](?!@a/ui["'])`);
  const out: string[] = [];
  for (const code of pageCode(files)) {
    if (own.test(code)) continue;
    for (const m of code.matchAll(new RegExp(`<${name}(?![\\w.])`, "g"))) {
      let depth = 0;
      let quote = "";
      let i = m.index! + m[0].length;
      for (; i < code.length; i++) {
        const ch = code[i]!;
        if (quote) {
          if (ch === quote && code[i - 1] !== "\\") quote = "";
        } else if (ch === '"' || ch === "'" || (ch === "`" && depth > 0)) quote = ch;
        else if (ch === "{") depth++;
        else if (ch === "}") depth = Math.max(0, depth - 1);
        else if (ch === ">" && depth === 0) break;
      }
      out.push(code.slice(m.index! + m[0].length, i));
    }
  }
  return out;
}

/** The data files a recipe component reads: its literal `data` prop, or its default when it has none. A data prop
 * computed in code (or possibly inside a spread) can't be checked here. */
function recipeFiles(files: Record<string, string>, tag: string, fallback: string): Set<string> {
  const named = new Set<string>();
  for (const attrs of kitTags(files, tag)) {
    const computed = /(?<![\w-])data=/.test(attrs) || /\{\s*\.\.\./.test(attrs);
    const name = literalProp(attrs, "data") ?? (computed ? null : fallback);
    if (name) named.add(dataPath(name));
  }
  return named;
}

/**
 * A <Shortlist> that recommends an option it doesn't list, cites nothing for one it keeps or carries an
 * impossible date would mislead the reader, so it isn't saved.
 */
function shortlistErrors(files: Record<string, string>, data: Record<string, JsonValue>): CompileError[] {
  const errors: CompileError[] = [];
  const now = new Date();
  for (const path of recipeFiles(files, "Shortlist", "shortlist.json")) {
    if (!(path in data)) {
      errors.push({ path, message: `<Shortlist> reads ${path}, which doesn't exist: add it (see artifact_guide topic "shortlist")` });
      continue;
    }
    for (const message of checkShortlist(data[path], now)) errors.push({ path, message });
  }
  return errors;
}

/**
 * A <Findings> page whose data has an unknown level, a missing benefit or an inventory pointing at no file would
 * show wrong, so it isn't saved. Its generated impact-against-effort chart is checked like any ```mermaid fence.
 */
async function findingsErrors(files: Record<string, string>, data: Record<string, JsonValue>): Promise<CompileError[]> {
  const errors: CompileError[] = [];
  for (const path of recipeFiles(files, "Findings", "findings.json")) {
    if (!(path in data)) {
      errors.push({ path, message: `<Findings> reads ${path}, which doesn't exist: add it (see artifact_guide topic "findings")` });
      continue;
    }
    const problems = checkFindings(data[path], Object.keys(data));
    errors.push(...problems.map((message) => ({ path, message })));
    if (problems.length) continue;
    const chart = findingsQuadrant(rankFindings((data[path] as unknown as FindingsData).findings));
    for (const e of await checkMermaid(path, [{ code: chart, line: 0 }])) errors.push({ path, message: `the impact-against-effort chart drawn from "findings" doesn't parse (${e.message}): simplify the titles` });
  }
  return errors;
}

/**
 * The server holds a <Decision> to its `deciders` by reading them from the page's source, so they must be
 * written there as literal emails: a list built in code would let anyone with edit access decide.
 */
function decisionErrors(files: Record<string, string>): CompileError[] {
  const errors: CompileError[] = [];
  for (const attrs of kitTags(files, "Decision")) {
    const at = attrs.search(/(?<![\w-])deciders=/);
    if (at < 0) continue;
    const list = /^deciders\s*=\s*\{\s*\[\s*((?:(?:"[^"]*"|'[^']*')\s*,?\s*)*)\]\s*\}/.exec(attrs.slice(at));
    // At least one email, or nobody could ever decide (and the page would say it's waiting).
    if (!list || !/["'][^"'\s]+@[^"'\s]+["']/.test(list[1]!)) {
      errors.push({ path: "", message: `<Decision deciders> must list emails literally, like deciders={["sam@example.com"]}: the server reads them from the page to decide who may answer` });
    }
  }
  return errors;
}

/** A literal prop on a tag's attribute text: name="x", name='x' or name={"x"}. */
function literalProp(attrs: string, name: string): string | undefined {
  // Not inside a hyphenated name: data-id= isn't id=.
  return new RegExp(`(?<![\\w-])${name}=\\{?\\s*["']([^"']+)["']`).exec(attrs)?.[1];
}

/**
 * <Sources> and <Cite> read a sources file: it must exist and be well formed, and a <Cite id> must name a
 * source in it (a citation that points nowhere would show a bare error marker). Citations into a file no
 * <Sources> on the page lists save, with a warning: their links have nothing to land on.
 */
function sourcesErrors(files: Record<string, string>, data: Record<string, JsonValue>): { errors: CompileError[]; warnings: string[] } {
  const errors: CompileError[] = [];
  const warnings: string[] = [];
  const listed = new Set<string>();
  const cites = new Map<string, Set<string>>();
  for (const attrs of kitTags(files, "Sources")) {
    const file = literalProp(attrs, "data") ?? (/(?<![\w-])data=|\{\s*\.\.\./.test(attrs) ? null : "sources.json");
    if (file) listed.add(dataPath(file));
  }
  for (const attrs of kitTags(files, "Cite")) {
    const id = literalProp(attrs, "id");
    const file = literalProp(attrs, "data") ?? (/(?<![\w-])data=|\{\s*\.\.\./.test(attrs) ? null : "sources.json");
    // A computed id or file can't be checked here; the citation shows its own marker if it's wrong.
    if (!id || !file) continue;
    const path = dataPath(file);
    if (!cites.has(path)) cites.set(path, new Set());
    cites.get(path)!.add(id);
  }
  for (const file of new Set([...listed, ...cites.keys()])) {
    if (!(file in data)) {
      errors.push({ path: file, message: `<Sources>/<Cite> read ${file}, which doesn't exist: add a list of {id, title, url?, checked?, kind?, note?}` });
      continue;
    }
    const problems = checkSources(data[file]);
    errors.push(...problems.map((message) => ({ path: file, message })));
    if (problems.length) continue;
    const ids = new Set((data[file] as { id: string }[]).map((s) => s.id));
    for (const id of cites.get(file) ?? []) if (!ids.has(id)) errors.push({ path: file, message: `<Cite id="${id}"> names no source in ${file}: add it there or fix the id` });
    if (cites.has(file) && !listed.has(file)) warnings.push(`<Cite> links into ${file}, but no <Sources data="${file}"> on the page lists it, so the links go nowhere`);
  }
  return { errors, warnings };
}

/** A guide's map is scaled to a phone's column (about 320 px); past this its 16 px labels drop under 10 px. */
const GUIDE_MAP_MAX_PX = 520;

async function changeGuideErrors(files: Record<string, string>, data: Record<string, JsonValue>): Promise<CompileError[]> {
  const errors: CompileError[] = [];
  for (const path of recipeFiles(files, "ChangeGuide", "guide.json")) {
    if (!(path in data)) {
      errors.push({ path, message: `<ChangeGuide> reads ${path}, which doesn't exist: add it (see artifact_guide topic "change")` });
      continue;
    }
    const guide = data[path] as { map?: unknown } | null;
    const map = typeof guide?.map === "string" ? guide.map : null;
    if (map) {
      const bad = await checkMermaid(path, [{ code: map, line: 0 }]);
      if (bad.length) {
        errors.push(...bad.map((e) => ({ path, message: `"map": ${e.message}` })));
        continue;
      }
      // Readers are on phones: a wide picture shrinks its labels below what anyone can read there.
      if (!mapKind(map)) errors.push({ path, message: `"map" is a top-down flowchart or a request flow: start it with \`flowchart TD\` or \`sequenceDiagram\`` });
      const width = await mermaidWidth(map);
      if (width && width > GUIDE_MAP_MAX_PX) {
        const advice = mapKind(map) === "sequence" ? "at most 3 participants, short message labels" : "at most 2 nodes side by side, labels of 2 to 4 words";
        errors.push({ path, message: `"map" draws ${Math.round(width)} px wide; on a phone its labels would shrink below 10 px. Keep it under ${GUIDE_MAP_MAX_PX}: ${advice}` });
      }
    }
    for (const message of checkChangeGuide(guide, map ? await mermaidNodeIds(map) : undefined)) errors.push({ path, message });
    // Refused here, not in checkChangeGuide, so guides saved before these rules still render. Brackets stay
    // allowed: app/[id]/page.tsx is a real path.
    const listed = (guide as { files?: unknown } | null)?.files;
    for (const f of Array.isArray(listed) ? listed : []) {
      const { path: p, files: n } = (f ?? {}) as { path?: unknown; files?: unknown };
      if (typeof p !== "string") continue;
      if (/\*|\{[^}]*,[^}]*\}/.test(p)) errors.push({ path, message: `"files" has the pattern "${p}": list a folder instead, as {"path": "dir/", "files": <how many changed>, "add", "del"}` });
      else if (p.endsWith("/") && n === undefined) errors.push({ path, message: `folder "${p}" needs "files": how many files under it changed` });
      else if (!p.endsWith("/") && n !== undefined) errors.push({ path, message: `"${p}" has "files", which only a folder (a path ending in "/") has` });
    }
  }
  return errors;
}

/** Data files kit components read when given no `data` prop. */
const DEFAULT_DATA: Record<string, string> = { "sources.json": "(?:Sources|Cite)", "log.json": "Log", "guide.json": "ChangeGuide", "shortlist.json": "Shortlist", "findings.json": "Findings" };

/**
 * Mistakes that save fine but show wrong, most often after an import: a Table naming columns its data doesn't
 * have (every cell shows —), Notion's __YES__/__NO__ standing in for booleans, markdown inside data values
 * (shown literally), and data files nothing on the page uses.
 */
export function dataWarnings(code: Record<string, string>, data: Record<string, JsonValue>): string[] {
  const out: string[] = [];
  const source = Object.values(code).join("\n");
  const dynamicData = /useData\(\s*[^"'\s)]/.test(source);
  for (const [path, value] of Object.entries(data)) {
    const name = path.slice("data/".length);
    const json = JSON.stringify(value);
    // Only what a Table shows: raw records kept for reference may hold anything.
    const tabled = new RegExp(`<Table\\b[^>]*\\bdata=["'](data/)?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(source);
    if (tabled && /"__(YES|NO)__"/.test(json)) out.push(`${path} has Notion's "__YES__"/"__NO__" placeholders, shown literally: use true/false`);
    if (tabled && /"[^"]*\*\*[^"*]+\*\*[^"]*"/.test(json)) out.push(`${path} has **markdown** inside values, which a Table shows literally: keep values plain`);
    // Only when every useData() names its file literally; a computed name could be using this one. A component
    // with no data prop reads its default file (<Sources /> reads sources.json).
    const byDefault = Object.entries(DEFAULT_DATA).some(([file, tag]) => file === name && new RegExp(`<${tag}\\b(?![^>]*\\bdata=)`).test(source));
    // A <Findings> file names its inventory's rows in "inventory.data".
    const inventory = Object.values(data).some((v) => {
      const inv = v && typeof v === "object" && !Array.isArray(v) ? (v as { inventory?: { data?: unknown } }).inventory : undefined;
      return typeof inv?.data === "string" && dataPath(inv.data) === path;
    });
    if (!byDefault && !inventory && !source.includes(name) && !source.includes(path) && !dynamicData) out.push(`${path} isn't used by any page file: show it (say, in a Table) or delete it`);
  }
  // <Table data="x.json" columns="a b c" />: names the data has in no case at all.
  for (const m of source.matchAll(/<Table\b[^>]*?\bdata=["']([^"']+)["'][^>]*?\bcolumns=["']([^"']+)["']/g)) {
    const rows = data[m[1].startsWith("data/") ? m[1] : `data/${m[1]}`];
    if (!Array.isArray(rows) || !rows.length) continue;
    const keys = new Set(rows.slice(0, 50).flatMap((r) => (r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r).map((k) => k.toLowerCase()) : [])));
    const missing = m[2].split(/[\s,]+/).filter((c) => c && !keys.has(c.toLowerCase()));
    if (missing.length) out.push(`Table data="${m[1]}" names columns its rows don't have (${missing.join(", ")}): every cell in them shows —`);
  }
  out.push(...pageProseWarnings(code, data));
  // A Notes box whose placeholder lists fields ("Date; amount; rest time…", "Date / Project / Worked on") is a log
  // kept as free text: people end up writing rows by hand that a Ledger would keep, sort and total.
  for (const m of source.matchAll(/<Notes\b[^>]*?\bplaceholder=(?:"([^"]*)"|'([^']*)'|\{["'`]([^"'`]*)["'`]\})/g)) {
    const placeholder = m[1] ?? m[2] ?? m[3] ?? "";
    const fields = placeholder.split(/\s*[;/|·]\s*|\s*,\s*(?=\p{Lu})/u).filter((f) => f.trim());
    if (fields.length >= 3 && fields.some((f) => /^(date|when)\b/i.test(f.trim()))) {
      out.push(`A Notes box asks for fields (${fields.slice(0, 4).join(", ")}${fields.length > 4 ? ", …" : ""}): that's a log; a Ledger with those fields keeps each entry as a row people add, edit and sort`);
    }
  }
  return out;
}

const MONTH = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DATE_AT_START = new RegExp(`^(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}|${MONTH}\\s+\\d{1,2})\\b`, "i");
const CHECKED_DATE = new RegExp(`\\b(?:last checked|checked on)\\s+(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}\\b|${MONTH}\\s+\\d{1,2}\\b)`, "i");

/** Log-shaped headings, hand-written freshness lines and phone-hostile tables in the page's prose and tags. */
function pageProseWarnings(code: Record<string, string>, data: Record<string, JsonValue>): string[] {
  const out: string[] = [];
  const mdx = pageCode(Object.fromEntries(Object.entries(code).filter(([p]) => p.endsWith(".mdx")))).join("\n");
  const all = pageCode(code).join("\n");
  if (!/<Log\b/.test(all)) {
    // Four at one level: a checkpoint log. Fewer, or mixed levels, is more likely an agenda or an itinerary.
    const levels = new Map<number, string[]>();
    for (const m of mdx.matchAll(/^(#{1,6})[ \t]+(.+)$/gm)) {
      const text = m[2]!.trim();
      if (DATE_AT_START.test(text)) levels.set(m[1]!.length, [...(levels.get(m[1]!.length) ?? []), text]);
    }
    const dated = [...levels.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    if (dated.length >= 4) out.push(`${dated.length} headings are dates (${dated.slice(0, 2).map((t) => `"${t}"`).join(", ")}, …): dated headings are a log; use <Log> over data/log.json and append entries`);
  }
  if (!/<AsOf\b/.test(all)) {
    const m = CHECKED_DATE.exec(mdx);
    if (m) out.push(`"${m[0]}" is a hand-written freshness line: use <AsOf checked="YYYY-MM-DD" next="…"> so it ages on its own`);
  }
  for (const attrs of kitTags(code, "Table")) {
    const file = /\bdata=["']([^"']+)["']/.exec(attrs)?.[1];
    if (!file || /\blimit=/.test(attrs) || /\bcards=["']never["']/.test(attrs)) continue;
    const rows = data[file.startsWith("data/") ? file : `data/${file}`];
    if (!Array.isArray(rows) || !rows.length) continue;
    const named = /\bcolumns=["']([^"']+)["']/.exec(attrs)?.[1];
    const cols = named
      ? named.split(/[\s,]+/).filter(Boolean).length
      : new Set(rows.slice(0, 50).flatMap((r) => (r && typeof r === "object" && !Array.isArray(r) ? Object.keys(r) : []))).size;
    if (cols > 3 && rows.length * cols > 150) {
      out.push(`Table data="${file}" is ${rows.length} rows × ${cols} columns, which on phones is ${rows.length} cards: pass limit (a "Show all" toggle), or fewer columns`);
    }
  }
  return out;
}

const ARTIFACT_CSS_ENTRY = `@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
${kitThemeCss}`;

/**
 * Identifies the stylesheet inputs baked into every build. Each build inlines
 * the kit theme, so a build made before a theme change keeps the old colours
 * until it is recompiled; the hub rebuilds any build whose stamp differs.
 * Bump BUILD_FORMAT for compiler changes that should also trigger a rebuild.
 */
const BUILD_FORMAT = 1;
export const BUILD_STAMP = `${BUILD_FORMAT}.${fnv1a(themeCss + utilitiesCss + ARTIFACT_CSS_ENTRY)}`;

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

async function rewriteRelativeImports(from: string, code: string, files: Set<string>): Promise<string> {
  await initLexer;
  let out = "";
  let last = 0;
  for (const imp of lexImports(code)) {
    if (!imp.spec || !(imp.spec.startsWith("./") || imp.spec.startsWith("../"))) continue;
    const target = resolveImport(from, imp.spec, files);
    if (!target) continue;
    // s..e spans the specifier without quotes for static imports; dynamic
    // imports with a string literal include the quotes.
    const raw = code.slice(imp.s, imp.e);
    const quoted = raw.startsWith('"') || raw.startsWith("'");
    out += code.slice(last, imp.s) + (quoted ? JSON.stringify(ART_PREFIX + target) : ART_PREFIX + target);
    last = imp.e;
  }
  return out + code.slice(last);
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
