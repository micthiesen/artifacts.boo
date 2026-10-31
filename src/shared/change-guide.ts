// A change guide's data file (data/guide.json, rendered by <ChangeGuide>): what a code change does, told for
// someone with no context. The Worker checks it on every write so a guide that skips a changed file, points
// at a missing step or lights a node its picture doesn't have is refused with a reason, not shown wrong.
// Everything added after the first version is optional, so guides written before it keep saving and showing.

import { stateProblems, type DiagramStep } from "./diagram-steps.ts";
import { placeNotes, type DiffNote } from "./diff-notes.ts";

/** A file, or a whole folder (`"supabase/functions/"`, ending in "/") with how many files under it changed. */
export type GuideFile = { path: string; add?: number; del?: number; files?: number };
export type GuideStop = {
  title: string;
  why: string;
  files: string[];
  focus?: string;
  /** Values the map's nodes hold once this step has happened ("Auth.attempts": "1"); needs a `focus`. */
  state?: Record<string, string>;
  diff?: { file?: string; lines: string; notes?: DiffNote[] };
};
export type GuideProof = {
  check: string;
  ran: boolean;
  /** A command's exit code. */
  exit?: number;
  /** What a check a person watched showed (a browser walk-through, a staging run): it has no exit code. */
  result?: "passed" | "failed";
  head?: string;
  /** "fail" for red-first evidence: a test run before the fix, which should have failed. */
  expect?: "pass" | "fail";
  env?: "local" | "ci" | "staging" | "prod";
  /** The run's page (a CI run). */
  link?: string;
  /** What the run reported, in its words: "212 passed". */
  count?: string;
  /** Anything else worth a few words: what failed, what the run skipped. */
  note?: string;
};
/** Same shape as <Delta>'s rows. */
export type GuideMetric = { label: string; before: number; after: number; unit?: string; better: "up" | "down"; note?: string };
export type GuideShot = { before?: string; after?: string; caption: string };
export type ChangeGuideData = {
  head: string;
  url?: string;
  links?: { label: string; url: string }[];
  outcome: string;
  where: string;
  risk: "low" | "medium" | "high";
  riskWhy?: string;
  revert: string;
  ask: { kind: "approve" | "try" | "decide"; text: string; steps?: string[] };
  decide?: { question: string; options: string[]; recommended?: string };
  before: string;
  after: string;
  metrics?: GuideMetric[];
  metricsNote?: string;
  shots?: GuideShot[];
  /** Left out when nothing flows (a sweep, a rename): the guide then has no picture. */
  map?: string;
  lookHere?: { q: string; stop: number }[];
  stops: GuideStop[];
  alsoTouched?: string[];
  proof: GuideProof[];
  verify?: { steps: string[]; expected: string };
  files: GuideFile[];
};

export const GUIDE_LIMITS = {
  stops: 6,
  lookHere: 3,
  diffLines: 15,
  titleWords: 8,
  links: 4,
  metrics: 8,
  shots: 4,
  verifySteps: 6,
  decideOptions: 5,
} as const;

const RISKS = ["low", "medium", "high"];
const ASKS = ["approve", "try", "decide"];
const ENVS = ["local", "ci", "staging", "prod"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isCount = (v: unknown) => v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 0);
const isUrl = (v: unknown) => typeof v === "string" && /^https?:\/\/\S+$/.test(v);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
/** An image uploaded with artifact_asset; a data: URL works too (the kit harness has no asset store). */
const isImage = (v: unknown) => typeof v === "string" && (/^assets\/\S+$/.test(v) || v.startsWith("data:image/"));

/** Which kind of picture a guide's map is: a top-down flowchart, or a sequence of messages between participants. */
export function mapKind(map: string): "flowchart" | "sequence" | null {
  const first = map.replace(/^\s*(%%[^\n]*\n\s*)*/, "");
  if (/^flowchart\s+(TD|TB)\b/.test(first)) return "flowchart";
  if (/^sequenceDiagram\b/.test(first)) return "sequence";
  return null;
}

/** A heading as an anchor: "After it ships" is "after-it-ships". */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Every problem with a guide's data, as one line each; empty when it's fine. `nodes` are the map's node ids
 * (a sequence map's participants) from Pele's parse (the Worker has them); without them a step's `focus` isn't
 * checked, since guessing ids from the source would refuse guides that are fine.
 */
export function checkChangeGuide(value: unknown, nodes?: Set<string>): string[] {
  if (!isObj(value)) return ["must be a JSON object (see artifact_guide topic \"change\")"];
  const g = value;
  const out: string[] = [];
  for (const k of ["head", "outcome", "where", "revert", "before", "after"]) if (!isText(g[k])) out.push(`"${k}" is required text`);
  if (g.map !== undefined && !isText(g.map)) out.push(`"map" is a Mermaid diagram, or leave it out when nothing flows (a sweep, a rename)`);
  if (g.url !== undefined && !isUrl(g.url)) out.push(`"url" is an http(s) link to the change`);
  if (g.links !== undefined) {
    const links = Array.isArray(g.links) ? g.links : [];
    if (!Array.isArray(g.links) || links.length > GUIDE_LIMITS.links) out.push(`"links" is a list of at most ${GUIDE_LIMITS.links} {label, url}: the ticket, the CI run, related guides`);
    for (const l of links) if (!isObj(l) || !isText(l.label) || !isUrl(l.url)) out.push(`each of "links" is {label, url} with an http(s) url`);
  }
  if (!RISKS.includes(g.risk as string)) out.push(`"risk" is one of ${RISKS.join(", ")}`);
  if (g.riskWhy !== undefined && !isText(g.riskWhy)) out.push(`"riskWhy" is one sentence saying why the risk is what it is, or leave it out`);
  if (!isObj(g.ask) || !ASKS.includes(g.ask.kind as string) || !isText(g.ask.text)) out.push(`"ask" is {kind: ${ASKS.join("|")}, text, steps?}`);
  else if (g.ask.steps !== undefined && (!Array.isArray(g.ask.steps) || !g.ask.steps.every(isText))) out.push(`"ask.steps" is a list of short instructions`);
  if (g.decide !== undefined) {
    const d = g.decide;
    const opts = isObj(d) && Array.isArray(d.options) ? d.options : [];
    if (!isObj(d) || !isText(d.question) || opts.length < 2 || opts.length > GUIDE_LIMITS.decideOptions || !opts.every(isText)) {
      out.push(`"decide" is {question, options, recommended?} with 2 to ${GUIDE_LIMITS.decideOptions} short options`);
    } else {
      if (new Set(opts).size !== opts.length) out.push(`"decide.options" are each different`);
      if (d.recommended !== undefined && !opts.includes(d.recommended)) out.push(`"decide.recommended" is one of "decide.options", word for word`);
    }
  }

  const files = Array.isArray(g.files) ? g.files : [];
  if (!files.length) out.push(`"files" lists every changed file, pasted from \`git diff --numstat\`: [{path, add, del}]`);
  const paths = new Set<string>();
  for (const f of files) {
    if (!isObj(f) || !isText(f.path) || !isCount(f.add) || !isCount(f.del)) {
      out.push(`each file is {path, add, del} with whole-number counts (leave counts out for a binary file)`);
      continue;
    }
    if (f.files !== undefined && !(Number.isInteger(f.files) && (f.files as number) > 0)) out.push(`"${f.path}": "files" is how many files under the folder changed`);
    if (paths.has(f.path as string)) out.push(`"${f.path}" is listed twice in "files"`);
    paths.add(f.path as string);
  }

  if (g.metrics !== undefined) {
    const rows = Array.isArray(g.metrics) ? g.metrics : [];
    if (!rows.length || rows.length > GUIDE_LIMITS.metrics) out.push(`"metrics" has 1 to ${GUIDE_LIMITS.metrics} rows of {label, before, after, unit?, better: "up"|"down"}`);
    for (const r of rows) {
      const name = isObj(r) && isText(r.label) ? `metric "${r.label}"` : "each metric";
      if (!isObj(r) || !isText(r.label)) out.push(`each metric is {label, before, after, unit?, better: "up"|"down", note?}`);
      else if (!isNum(r.before) || !isNum(r.after)) out.push(`${name}'s "before" and "after" are plain numbers; put the unit in "unit"`);
      else if (r.better !== "up" && r.better !== "down") out.push(`${name}'s "better" is "up" or "down": which way is an improvement`);
      else if ((r.unit !== undefined && typeof r.unit !== "string") || (r.note !== undefined && typeof r.note !== "string")) out.push(`${name}'s "unit" and "note" are text`);
    }
  }
  if (g.metricsNote !== undefined && (!isText(g.metricsNote) || g.metrics === undefined)) out.push(`"metricsNote" says how "metrics" were measured (window, sample size); add it only with "metrics"`);

  if (g.shots !== undefined) {
    const shots = Array.isArray(g.shots) ? g.shots : [];
    if (!shots.length || shots.length > GUIDE_LIMITS.shots) out.push(`"shots" has 1 to ${GUIDE_LIMITS.shots} pairs of screenshots`);
    for (const s of shots) {
      if (!isObj(s) || !isText(s.caption) || (s.before === undefined && s.after === undefined)) out.push(`each shot is {before?, after?, caption} with at least one image`);
      else if ([s.before, s.after].some((p) => p !== undefined && !isImage(p))) out.push(`shot "${s.caption}": "before" and "after" are uploaded images ("assets/before.png", from artifact_asset)`);
    }
  }

  const stops = Array.isArray(g.stops) ? g.stops : [];
  if (!stops.length || stops.length > GUIDE_LIMITS.stops) out.push(`"stops" has 1 to ${GUIDE_LIMITS.stops} steps (has ${stops.length})`);
  const covered = new Set<string>();
  stops.forEach((s, i) => {
    const at = `step ${i + 1}`;
    if (!isObj(s) || !isText(s.title) || !isText(s.why) || !Array.isArray(s.files)) {
      out.push(`${at} is {title, why, files, focus?, state?, diff?}`);
      return;
    }
    const words = (s.title as string).trim().split(/\s+/).length;
    if (words > GUIDE_LIMITS.titleWords) out.push(`${at}'s title has ${words} words; keep it to ${GUIDE_LIMITS.titleWords}`);
    for (const p of s.files as unknown[]) {
      if (typeof p !== "string" || !paths.has(p)) out.push(`${at} names "${String(p)}", which isn't in "files"`);
      else covered.add(p);
    }
    if (s.focus !== undefined) {
      if (typeof s.focus !== "string") out.push(`${at}'s "focus" is node ids separated by spaces`);
      else if (!isText(g.map) && s.focus.trim()) out.push(`${at} has a "focus" but the guide has no "map" to light`);
      else if (nodes) for (const id of s.focus.split(/\s+/).filter(Boolean)) if (!nodes.has(id)) out.push(`${at}'s focus "${id}" isn't a node in "map"`);
    }
    if (s.state !== undefined) {
      if (!(typeof s.focus === "string" && s.focus.trim())) out.push(`${at} has a "state" but no "focus": values show as the map walks through the steps with a focus`);
    }
    if (s.diff !== undefined) {
      const d = s.diff;
      if (!isObj(d) || !isText(d.lines)) out.push(`${at}'s "diff" is {file?, lines, notes?}`);
      else {
        const lines = (d.lines as string).replace(/\n$/, "").split("\n");
        if (lines.length > GUIDE_LIMITS.diffLines) out.push(`${at}'s diff has ${lines.length} lines; show at most ${GUIDE_LIMITS.diffLines}`);
        if (lines.some((l) => l.length && !"+- ".includes(l[0]))) out.push(`${at}'s diff lines each start with "+", "-" or a space, as \`git diff\` prints them`);
        if (d.file !== undefined && (typeof d.file !== "string" || !paths.has(d.file))) out.push(`${at}'s diff file "${String(d.file)}" isn't in "files"`);
        for (const p of placeNotes(lines, d.notes).problems) out.push(`${at}'s diff ${p}`);
      }
    }
  });

  if (stops.some((s) => isObj(s) && s.state !== undefined)) {
    // Fewer than two focused steps show the map whole, with no bar to list the values in.
    if (stops.filter((s) => isObj(s) && typeof s.focus === "string" && s.focus.trim()).length < 2) out.push(`"state" shows as the map walks through its steps: give two or more steps a "focus"`);
    out.push(...stateProblems(stops.map((s) => (isObj(s) ? (s as { state?: Record<string, string> }) : {})), nodes, `"map"`));
  }

  const also = Array.isArray(g.alsoTouched) ? g.alsoTouched : [];
  if (g.alsoTouched !== undefined && !Array.isArray(g.alsoTouched)) out.push(`"alsoTouched" is a list of paths`);
  for (const p of also) {
    if (typeof p !== "string" || !paths.has(p)) out.push(`"alsoTouched" names "${String(p)}", which isn't in "files"`);
    else if (covered.has(p)) out.push(`"${p}" is in a step and in "alsoTouched": keep it in one`);
    else covered.add(p);
  }
  const missing = [...paths].filter((p) => !covered.has(p));
  if (missing.length) out.push(`changed files in no step and not in "alsoTouched": ${missing.join(", ")}`);

  if (g.lookHere !== undefined) {
    const look = Array.isArray(g.lookHere) ? g.lookHere : [];
    if (!Array.isArray(g.lookHere) || look.length > GUIDE_LIMITS.lookHere) out.push(`"lookHere" has at most ${GUIDE_LIMITS.lookHere} questions`);
    for (const l of look) {
      if (!isObj(l) || !isText(l.q) || !Number.isInteger(l.stop) || (l.stop as number) < 1 || (l.stop as number) > stops.length) {
        out.push(`each "lookHere" item is {q, stop} with stop a step number from 1 to ${stops.length}`);
      }
    }
  }

  if (!Array.isArray(g.proof)) out.push(`"proof" lists checks: [{check, ran: true, exit, head}], [{check, ran: true, result, head}] for one a person watched, or [{check, ran: false}]`);
  else {
    for (const p of g.proof) {
      if (!isObj(p) || !isText(p.check) || typeof p.ran !== "boolean") {
        out.push(`each "proof" item is {check, ran, exit?, result?, head?, expect?, env?, link?, count?, note?}`);
        continue;
      }
      if (p.result !== undefined && p.result !== "passed" && p.result !== "failed") out.push(`proof "${p.check}": "result" is "passed" or "failed", what a check you watched showed`);
      else if (p.ran && ((!Number.isInteger(p.exit) && p.result === undefined) || !isText(p.head))) {
        out.push(`proof "${p.check}" ran, so it needs the "head" commit it ran at and its "exit" code, or for a check a person watched (no command), "result": "passed" or "failed"`);
      }
      if (p.expect !== undefined && p.expect !== "pass" && p.expect !== "fail") out.push(`proof "${p.check}": "expect" is "pass", or "fail" for a test run before the fix to show it failed`);
      if (p.env !== undefined && !ENVS.includes(p.env as string)) out.push(`proof "${p.check}": "env" is one of ${ENVS.join(", ")}`);
      if (p.link !== undefined && !isUrl(p.link)) out.push(`proof "${p.check}": "link" is an http(s) link to the run`);
      if (p.count !== undefined && !isText(p.count)) out.push(`proof "${p.check}": "count" is what the run reported, like "212 passed"`);
      if (p.note !== undefined && !isText(p.note)) out.push(`proof "${p.check}": "note" is a few words of text`);
    }
  }

  if (g.verify !== undefined) {
    const v = g.verify;
    const steps = isObj(v) && Array.isArray(v.steps) ? v.steps : [];
    if (!isObj(v) || !isText(v.expected) || !steps.length || steps.length > GUIDE_LIMITS.verifySteps || !steps.every(isText)) {
      out.push(`"verify" is {steps, expected}: 1 to ${GUIDE_LIMITS.verifySteps} steps to check it once it ships, and what they should show`);
    }
  }
  return [...new Set(out)];
}

// ---- File lists ----------------------------------------------------------------------------------------------

/** One line of a file list: a file, or the same file under several roots (a mirrored copy) shown once. */
export type FileItem = {
  /** The path shown: the first copy's. */
  path: string;
  dir: string;
  name: string;
  add?: number;
  del?: number;
  /** For a folder: how many files under it changed, all copies together. */
  files?: number;
  /** Mirrored copies: every root (the part before the shared tail), in list order. "" is the repository's root. */
  roots?: string[];
  /** Every full path this line stands for. */
  paths: string[];
};

/** A directory's lines, or one line on its own when it is the only file from its directory. */
export type FileGroup = { dir: string; items: FileItem[] };

/**
 * A path cut before its file name: "src/kit/ui/" and "table.tsx". The directory keeps its trailing slash, and a
 * folder keeps its own: "supabase/functions/" is "supabase/" and "functions/".
 */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf("/", path.length - 2);
  return { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

/** How many trailing path segments two paths share. */
function sharedTail(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

const sum = (xs: (number | undefined)[]) => (xs.some((x) => x == null) ? undefined : xs.reduce<number>((n, x) => n + x!, 0));

/**
 * The files as lines, with mirrored copies (the same tail of at least two segments, like `kit/ui/table.tsx`
 * under `src/` and `packages/web/src/`) folded into one line that lists both roots. Pairs sharing the longest
 * tail are matched first, so a file isn't folded into a looser match when a closer one exists.
 */
export function foldMirrors(files: GuideFile[]): FileItem[] {
  const segs = files.map((f) => f.path.split("/"));
  const pairs: [number, number, number][] = [];
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const n = sharedTail(segs[i]!, segs[j]!);
      // A mirror is the same file under another root: one whole path is the other's tail ("src/a.ts" in
      // "packages/web/src/a.ts"). Two packages' own files with a common tail ("packages/web/src/index.ts" and
      // "packages/api/src/index.ts") are different files.
      if (n >= 2 && (n === segs[i]!.length || n === segs[j]!.length)) pairs.push([n, i, j]);
    }
  }
  pairs.sort((a, b) => b[0] - a[0] || a[1] - b[1] || a[2] - b[2]);
  const cluster = new Map<number, { tail: number; members: number[] }>();
  for (const [n, i, j] of pairs) {
    const ci = cluster.get(i);
    const cj = cluster.get(j);
    if (!ci && !cj) {
      const c = { tail: n, members: [i, j] };
      cluster.set(i, c).set(j, c);
    } else if (ci && !cj && ci.tail === n) {
      ci.members.push(j);
      cluster.set(j, ci);
    } else if (cj && !ci && cj.tail === n) {
      cj.members.push(i);
      cluster.set(i, cj);
    }
  }
  const out: FileItem[] = [];
  const done = new Set<number>();
  files.forEach((f, i) => {
    if (done.has(i)) return;
    const c = cluster.get(i);
    const members = c ? [...c.members].sort((a, b) => a - b) : [i];
    for (const m of members) done.add(m);
    const group = members.map((m) => files[m]!);
    const item: FileItem = { path: f.path, ...splitPath(f.path), add: sum(group.map((x) => x.add)), del: sum(group.map((x) => x.del)), paths: group.map((x) => x.path) };
    if (f.files !== undefined) item.files = sum(group.map((x) => x.files ?? 1));
    if (c) item.roots = members.map((m) => segs[m]!.slice(0, segs[m]!.length - c.tail).join("/") + (segs[m]!.length > c.tail ? "/" : ""));
    out.push(item);
  });
  return out;
}

/** Lines grouped by directory, in the order each directory first appears (authors list files on purpose). */
export function groupFiles(files: GuideFile[]): FileGroup[] {
  const groups = new Map<string, FileGroup>();
  for (const item of foldMirrors(files)) {
    const g = groups.get(item.dir) ?? { dir: item.dir, items: [] };
    g.items.push(item);
    groups.set(item.dir, g);
  }
  return [...groups.values()];
}

/** The first `limit` lines of grouped files, keeping groups whole where they fit and cutting the last one short. */
export function takeLines(groups: FileGroup[], limit: number): FileGroup[] {
  const out: FileGroup[] = [];
  let left = limit;
  for (const g of groups) {
    if (left <= 0) break;
    out.push(g.items.length <= left ? g : { dir: g.dir, items: g.items.slice(0, left) });
    left -= g.items.length;
  }
  return out;
}

// ---- Proof -------------------------------------------------------------------------------------------------

export type ProofStatus = {
  /** "passed" / "failed": the check did what it should or didn't. "red" is a red-first test that failed as it should. */
  verdict: "passed" | "failed" | "red" | "not-run";
  /** Ran at a commit other than the guide's head. Said quietly: a red-first run always is. */
  older: boolean;
};

/** What a check's row says: did it do what it should, and was it at the commit the guide describes. */
export function proofStatus(p: GuideProof, head: string): ProofStatus {
  if (!p.ran) return { verdict: "not-run", older: false };
  const older = !!p.head && p.head !== head;
  const ok = p.result ? p.result === "passed" : p.exit === 0;
  if (p.expect === "fail") return { verdict: ok ? "failed" : "red", older };
  return { verdict: ok ? "passed" : "failed", older };
}

/** How many files a guide changed: a folder entry counts its files. */
export function fileCount(files: GuideFile[]): number {
  return files.reduce((n, f) => n + (f.files ?? 1), 0);
}

/**
 * Runs the same check also made at the guide's head, so they only say what it was before: shown folded, as
 * "Earlier runs". A red-first run is kept in view; it is evidence at its old commit.
 */
export function superseded(proof: GuideProof[], head: string): Set<number> {
  const atHead = new Set(proof.filter((p) => p.ran && p.head === head).map((p) => p.check.trim()));
  const out = new Set<number>();
  proof.forEach((p, i) => {
    if (p.ran && p.head !== head && p.expect !== "fail" && atHead.has(p.check.trim())) out.add(i);
  });
  return out;
}

/**
 * The guide's stepped map: one step per stop that has a `focus`, and which step each such stop is. One step is
 * no walk-through ("All 1 steps"), so a guide with fewer than two shows its map whole.
 */
export function mapSteps(stops: GuideStop[]): { steps: DiagramStep[]; stepOf: Map<number, number> } {
  const steps: DiagramStep[] = [];
  const stepOf = new Map<number, number>();
  if (stops.filter((s) => s.focus?.trim()).length < 2) return { steps, stepOf };
  stops.forEach((s, i) => {
    if (!s.focus?.trim()) return;
    stepOf.set(i, steps.length);
    // The bar counts map steps; the title carries the stop's own number so the two lists line up.
    steps.push({ focus: s.focus, title: `${i + 1}. ${s.title}`, text: s.why, ...(s.state && { state: s.state }) });
  });
  return { steps, stepOf };
}
