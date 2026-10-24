// A change guide's data file (data/guide.json, rendered by <ChangeGuide>): what a code change does, told for
// someone with no context. The Worker checks it on every write so a guide that skips a changed file, points
// at a missing step or lights a node its picture doesn't have is refused with a reason, not shown wrong.

export type GuideFile = { path: string; add?: number; del?: number };
export type GuideStop = { title: string; why: string; files: string[]; focus?: string; diff?: { file?: string; lines: string } };
export type GuideProof = { check: string; ran: boolean; exit?: number; head?: string };
export type ChangeGuideData = {
  head: string;
  url?: string;
  outcome: string;
  where: string;
  risk: "low" | "medium" | "high";
  revert: string;
  ask: { kind: "approve" | "try" | "decide"; text: string; steps?: string[] };
  before: string;
  after: string;
  map: string;
  lookHere?: { q: string; stop: number }[];
  stops: GuideStop[];
  alsoTouched?: string[];
  proof: GuideProof[];
  files: GuideFile[];
};

export const GUIDE_LIMITS = { stops: 6, lookHere: 3, diffLines: 15, titleWords: 8 } as const;

const RISKS = ["low", "medium", "high"];
const ASKS = ["approve", "try", "decide"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isCount = (v: unknown) => v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 0);

/**
 * Every problem with a guide's data, as one line each; empty when it's fine. `nodes` are the map's node ids from
 * Pele's parse (the Worker has them); without them a step's `focus` isn't checked, since guessing ids from the
 * source would refuse guides that are fine.
 */
export function checkChangeGuide(value: unknown, nodes?: Set<string>): string[] {
  if (!isObj(value)) return ["must be a JSON object (see artifact_guide topic \"change\")"];
  const g = value;
  const out: string[] = [];
  for (const k of ["head", "outcome", "where", "revert", "before", "after", "map"]) if (!isText(g[k])) out.push(`"${k}" is required text`);
  if (g.url !== undefined && (typeof g.url !== "string" || !/^https?:\/\//.test(g.url))) out.push(`"url" is an http(s) link to the change`);
  if (!RISKS.includes(g.risk as string)) out.push(`"risk" is one of ${RISKS.join(", ")}`);
  if (!isObj(g.ask) || !ASKS.includes(g.ask.kind as string) || !isText(g.ask.text)) out.push(`"ask" is {kind: ${ASKS.join("|")}, text, steps?}`);
  else if (g.ask.steps !== undefined && (!Array.isArray(g.ask.steps) || !g.ask.steps.every(isText))) out.push(`"ask.steps" is a list of short instructions`);

  const files = Array.isArray(g.files) ? g.files : [];
  if (!files.length) out.push(`"files" lists every changed file, pasted from \`git diff --numstat\`: [{path, add, del}]`);
  const paths = new Set<string>();
  for (const f of files) {
    if (!isObj(f) || !isText(f.path) || !isCount(f.add) || !isCount(f.del)) {
      out.push(`each file is {path, add, del} with whole-number counts (leave counts out for a binary file)`);
      continue;
    }
    if (paths.has(f.path as string)) out.push(`"${f.path}" is listed twice in "files"`);
    paths.add(f.path as string);
  }

  const stops = Array.isArray(g.stops) ? g.stops : [];
  if (!stops.length || stops.length > GUIDE_LIMITS.stops) out.push(`"stops" has 1 to ${GUIDE_LIMITS.stops} steps (has ${stops.length})`);
  const covered = new Set<string>();
  stops.forEach((s, i) => {
    const at = `step ${i + 1}`;
    if (!isObj(s) || !isText(s.title) || !isText(s.why) || !Array.isArray(s.files)) {
      out.push(`${at} is {title, why, files, focus?, diff?}`);
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
      else if (nodes) for (const id of s.focus.split(/\s+/).filter(Boolean)) if (!nodes.has(id)) out.push(`${at}'s focus "${id}" isn't a node in "map"`);
    }
    if (s.diff !== undefined) {
      const d = s.diff;
      if (!isObj(d) || !isText(d.lines)) out.push(`${at}'s "diff" is {file?, lines}`);
      else {
        const lines = (d.lines as string).replace(/\n$/, "").split("\n");
        if (lines.length > GUIDE_LIMITS.diffLines) out.push(`${at}'s diff has ${lines.length} lines; show at most ${GUIDE_LIMITS.diffLines}`);
        if (lines.some((l) => l.length && !"+- ".includes(l[0]))) out.push(`${at}'s diff lines each start with "+", "-" or a space, as \`git diff\` prints them`);
        if (d.file !== undefined && (typeof d.file !== "string" || !paths.has(d.file))) out.push(`${at}'s diff file "${String(d.file)}" isn't in "files"`);
      }
    }
  });

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

  if (!Array.isArray(g.proof)) out.push(`"proof" lists checks: [{check, ran: true, exit, head}] or [{check, ran: false}]`);
  else {
    for (const p of g.proof) {
      if (!isObj(p) || !isText(p.check) || typeof p.ran !== "boolean") out.push(`each "proof" item is {check, ran, exit?, head?}`);
      else if (p.ran && (!Number.isInteger(p.exit) || !isText(p.head))) out.push(`proof "${p.check}" ran, so it needs its "exit" code and the "head" commit it ran at`);
    }
  }
  return [...new Set(out)];
}
