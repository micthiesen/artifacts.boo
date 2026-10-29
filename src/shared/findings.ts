// An audit's or review's data file (data/findings.json, rendered by <Findings>): what was asked, the answer, how
// it was measured, and ranked findings that each say what to change, what it buys and how to tell it worked.
// The Worker checks it on every write so a finding with an unknown impact or a missing benefit is refused with
// a reason, not shown wrong. Status changes are edits to this file, so the page never needs a hand-patched note.

export type Impact = "high" | "medium" | "low";
export type Effort = "small" | "medium" | "large";
export type Confidence = "measured" | "estimated" | "guess";
export type FindingStatus = "open" | "doing" | "shipped" | "skipped" | "decide";
export type FindingLink = { label: string; url: string };
/** The same row <Delta> shows: before and after, and which way is better. */
export type FindingMetric = { label: string; before: number; after: number; unit?: string; better: "up" | "down"; note?: string; expected?: boolean };

export type Finding = {
  id: string;
  title: string;
  impact: Impact;
  effort: Effort;
  confidence: Confidence;
  status?: FindingStatus;
  change: string;
  benefit: string;
  validate?: string;
  metrics?: FindingMetric[];
  owner?: string;
  link?: FindingLink;
  /** The question put to the reader on the page, answered with <Decision> at `decide/finding-<id>`. */
  decide?: { question?: string; options: string[]; recommended?: string };
};
/** A smaller win, kept out of the ranking and the chart. */
export type MinorFinding = { title: string; change: string };

export type FindingsMethod = { window?: string; sample?: string; setup?: string; head?: string; sources?: FindingLink[]; caveats?: string[] };

export type FindingsData = {
  question: string;
  answer: string;
  method: FindingsMethod;
  findings: Finding[];
  minor?: MinorFinding[];
  notWorth?: { title: string; why: string }[];
  inventory?: { title: string; data: string; columns?: string; top?: number };
};

export const FINDINGS_LIMITS = { findings: 12, titleWords: 8, notWorth: 12, minor: 30, decideOptions: 5 } as const;

export const IMPACTS: Impact[] = ["high", "medium", "low"];
export const EFFORTS: Effort[] = ["small", "medium", "large"];
export const CONFIDENCES: Confidence[] = ["measured", "estimated", "guess"];
export const STATUSES: FindingStatus[] = ["open", "doing", "shipped", "skipped", "decide"];

/** A finding's id becomes part of an element id (`finding-<id>`), so it keeps to characters a URL fragment leaves alone. */
export const FINDING_ID = /^[A-Za-z0-9_-]{1,40}$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown) => typeof v === "string" && v.trim().length > 0;
const isOptText = (v: unknown) => v === undefined || isText(v);
const isLink = (v: unknown) => isObj(v) && isText(v.label) && typeof v.url === "string" && /^https?:\/\/\S+$/.test(v.url);
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** As the kit resolves a component's `data` prop: "./x.json", "x.json" and "data/x.json" are the same file. */
function dataPath(name: string): string {
  const p = name.trim().replace(/^\.?\//, "");
  return p.startsWith("data/") ? p : `data/${p}`;
}

/**
 * Every problem with a findings file, as one line each phrased as the fix; empty when it's fine. `dataFiles` are
 * the artifact's data file paths ("data/latency.json"); without them `inventory.data` isn't checked.
 */
export function checkFindings(value: unknown, dataFiles?: Iterable<string>): string[] {
  if (!isObj(value)) return [`must be a JSON object (see artifact_guide topic "findings")`];
  const g = value;
  const out: string[] = [];
  if (!isText(g.question)) out.push(`"question" is required: what the audit set out to answer, in one sentence`);
  if (!isText(g.answer)) out.push(`"answer" is required: the answer in one short paragraph`);

  const m = g.method;
  if (!isObj(m)) out.push(`"method" is required: {window?, sample?, setup?, head?, sources?, caveats?}, saying at least how and over what it was measured`);
  else {
    for (const k of ["window", "sample", "setup", "head"]) if (!isOptText(m[k])) out.push(`"method.${k}" is text`);
    if (!isText(m.window) && !isText(m.sample) && !isText(m.setup)) out.push(`"method" says at least one of "window" (the period looked at), "sample" (what and how many) or "setup" (where it was run)`);
    if (m.sources !== undefined && (!Array.isArray(m.sources) || !m.sources.every(isLink))) out.push(`"method.sources" is a list of {label, url} with http(s) links`);
    if (m.caveats !== undefined && (!Array.isArray(m.caveats) || !m.caveats.every(isText))) out.push(`"method.caveats" is a list of short sentences`);
  }

  const findings = Array.isArray(g.findings) ? g.findings : [];
  if (!findings.length || findings.length > FINDINGS_LIMITS.findings) {
    out.push(`"findings" has 1 to ${FINDINGS_LIMITS.findings} findings (has ${findings.length}); put the rest in "notWorth" or an "inventory"`);
  }
  const ids = new Set<string>();
  let measured = false;
  findings.forEach((f, i) => {
    const at = isObj(f) && isText(f.id) ? `finding "${f.id}"` : `finding ${i + 1}`;
    if (!isObj(f)) return out.push(`${at} is {id, title, impact, effort, confidence, status?, change, benefit, validate?, metrics?, owner?, link?, decide?}`);
    if (typeof f.id !== "string" || !FINDING_ID.test(f.id)) out.push(`${at}: "id" is 1-40 letters, digits, "-" or "_"`);
    else if (ids.has(f.id)) out.push(`${at}: the id is used twice; give each finding its own`);
    else ids.add(f.id);
    if (!isText(f.title)) out.push(`${at}: "title" is required`);
    else {
      const words = (f.title as string).trim().split(/\s+/).length;
      if (words > FINDINGS_LIMITS.titleWords) out.push(`${at}: the title has ${words} words; keep it to ${FINDINGS_LIMITS.titleWords}`);
    }
    if (!IMPACTS.includes(f.impact as Impact)) out.push(`${at}: "impact" is one of ${IMPACTS.join(", ")}`);
    if (!EFFORTS.includes(f.effort as Effort)) out.push(`${at}: "effort" is one of ${EFFORTS.join(", ")}`);
    if (!CONFIDENCES.includes(f.confidence as Confidence)) out.push(`${at}: "confidence" is one of ${CONFIDENCES.join(", ")}`);
    if (f.confidence === "measured") measured = true;
    if (f.status !== undefined && !STATUSES.includes(f.status as FindingStatus)) out.push(`${at}: "status" is one of ${STATUSES.join(", ")}`);
    if (!isText(f.change)) out.push(`${at}: "change" is required: what to do`);
    if (!isText(f.benefit)) out.push(`${at}: "benefit" is required: what it buys, with a number if you have one`);
    if (!isOptText(f.validate)) out.push(`${at}: "validate" is text: how to tell it worked`);
    if (!isOptText(f.owner)) out.push(`${at}: "owner" is text`);
    if (f.link !== undefined && !isLink(f.link)) out.push(`${at}: "link" is {label, url} with an http(s) url`);
    if (f.decide !== undefined) {
      const d = f.decide;
      const opts = isObj(d) && Array.isArray(d.options) ? d.options : [];
      if (!isObj(d) || opts.length < 2 || opts.length > FINDINGS_LIMITS.decideOptions || !opts.every(isText)) {
        out.push(`${at}: "decide" is {question?, options, recommended?} with 2 to ${FINDINGS_LIMITS.decideOptions} short options`);
      } else {
        if (!isOptText(d.question)) out.push(`${at}: "decide.question" is text`);
        if (new Set(opts).size !== opts.length) out.push(`${at}: "decide.options" are each different`);
        if (d.recommended !== undefined && !opts.includes(d.recommended)) out.push(`${at}: "decide.recommended" is one of "decide.options", word for word`);
      }
    }
    if (f.metrics !== undefined) {
      if (!Array.isArray(f.metrics) || !f.metrics.length) out.push(`${at}: "metrics" is a list of {label, before, after, unit?, better: "up"|"down"}`);
      else for (const r of f.metrics) {
        const p = metricProblem(r);
        if (p) out.push(`${at}: ${p}`);
      }
    }
  });
  if (measured && isObj(m) && !isText(m.window) && !isText(m.sample)) {
    out.push(`a finding is "measured", so "method" says the "window" or "sample" it was measured over`);
  }

  if (g.minor !== undefined) {
    const mi = Array.isArray(g.minor) ? g.minor : null;
    if (!mi || !mi.every((n) => isObj(n) && isText(n.title) && isText(n.change))) out.push(`"minor" is a list of {title, change}: smaller wins outside the ranking`);
    else if (mi.length > FINDINGS_LIMITS.minor) out.push(`"minor" has at most ${FINDINGS_LIMITS.minor} items; drop the ones nobody would miss`);
  }

  if (g.notWorth !== undefined) {
    const nw = Array.isArray(g.notWorth) ? g.notWorth : null;
    if (!nw || !nw.every((n) => isObj(n) && isText(n.title) && isText(n.why))) out.push(`"notWorth" is a list of {title, why}`);
    else if (nw.length > FINDINGS_LIMITS.notWorth) out.push(`"notWorth" has at most ${FINDINGS_LIMITS.notWorth} items; keep the ones a reader would otherwise suggest`);
  }

  if (g.inventory !== undefined) {
    const inv = g.inventory;
    if (!isObj(inv) || !isText(inv.title) || !isText(inv.data)) out.push(`"inventory" is {title, data, columns?, top?} with "data" naming a data file of rows`);
    else {
      if (dataFiles) {
        const files = new Set([...dataFiles].map(dataPath));
        if (!files.has(dataPath(inv.data as string))) out.push(`"inventory.data" names ${dataPath(inv.data as string)}, which doesn't exist: add it as a list of rows`);
      }
      if (inv.columns !== undefined && !isText(inv.columns)) out.push(`"inventory.columns" is the columns to show, separated by spaces`);
      if (inv.top !== undefined && !(Number.isInteger(inv.top) && (inv.top as number) > 0)) out.push(`"inventory.top" is how many rows show before "Show all", a whole number from 1`);
    }
  }
  return [...new Set(out)];
}

/** Validates one before/after row (the shape <Delta> reads); returns the fix, or null. */
export function metricProblem(r: unknown): string | null {
  if (!isObj(r) || !isText(r.label)) return `each metric is {label, before, after, unit?, better: "up"|"down"}`;
  const at = `metric "${r.label}"`;
  if (!isNum(r.before)) return `${at}: "before" is a number (put the unit in "unit")`;
  if (!isNum(r.after)) return `${at}: "after" is a number (put the unit in "unit")`;
  if (r.better !== "up" && r.better !== "down") return `${at}: "better" is "up" or "down"`;
  if (r.unit !== undefined && typeof r.unit !== "string") return `${at}: "unit" is text like "ms" or "%"`;
  if (r.note !== undefined && typeof r.note !== "string") return `${at}: "note" is text`;
  if (r.expected !== undefined && typeof r.expected !== "boolean") return `${at}: "expected" is true or false`;
  return null;
}

// ---- Ranking ---------------------------------------------------------------------

const IMPACT_RANK: Record<Impact, number> = { high: 0, medium: 1, low: 2 };
const EFFORT_RANK: Record<Effort, number> = { small: 0, medium: 1, large: 2 };

/** Findings in the order to act on them: most impact first, then least effort, then as the file lists them. */
export function rankFindings<T extends Pick<Finding, "impact" | "effort">>(findings: readonly T[]): T[] {
  return findings
    .map((f, i) => ({ f, i }))
    .sort((a, b) => IMPACT_RANK[a.f.impact] - IMPACT_RANK[b.f.impact] || EFFORT_RANK[a.f.effort] - EFFORT_RANK[b.f.effort] || a.i - b.i)
    .map((x) => x.f);
}

/** "3 shipped · 1 doing · 2 open", in the order a reader asks about them; statuses no finding has are left out. */
export function statusRollup(findings: readonly Pick<Finding, "status">[]): { status: FindingStatus; count: number }[] {
  const counts = new Map<FindingStatus, number>();
  for (const f of findings) counts.set(f.status ?? "open", (counts.get(f.status ?? "open") ?? 0) + 1);
  return (["shipped", "doing", "decide", "open", "skipped"] as const).filter((s) => counts.has(s)).map((status) => ({ status, count: counts.get(status)! }));
}

// ---- Impact against effort ---------------------------------------------------------

/**
 * A label safe inside a quoted Mermaid point label: Pele's parser ends the label at a double quote and turns
 * `#…;` into an entity, and a backtick would switch it to markdown, so those go.
 */
export function quadrantLabel(s: string): string {
  return s.replace(/["“”]/g, "'").replace(/[#`]/g, "").replace(/\s+/g, " ").trim();
}

const LABEL_CHARS = 18;
const TRAILING = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "at", "by", "with", "from"]);

/**
 * A title's first words, up to 18 characters and never ending on "the" or "to", so a label in a phone-sized
 * chart reads as words and stays clear of its neighbours: "Shard the e2e suite four ways" is "Shard the e2e".
 */
export function shortTitle(title: string): string {
  const words = quadrantLabel(title).split(" ").filter(Boolean);
  const out: string[] = [];
  for (const w of words) {
    if ([...out, w].join(" ").length > LABEL_CHARS) break;
    out.push(w);
  }
  while (out.length > 1 && TRAILING.has(out[out.length - 1]!.toLowerCase())) out.pop();
  if (out.length) return out.join(" ");
  const first = words[0] ?? "";
  return `${first.slice(0, LABEL_CHARS - 1)}…`;
}

// The chart has four quadrants: impact high or medium is the top half (worth having), low the bottom; effort
// small is the left half, medium or large the right (costly). Within a quadrant the findings stack top to bottom
// in rank order down the quadrant's middle, a row apart so each label fits under its point. Points side by side
// pushed Pele's labels across the centre line into the wrong quadrant, so finer placement is left to the badges.
// Nothing sits on the centre lines, where a point would belong to no quadrant.
/** The first row's height in the top and bottom halves, below each quadrant's title. */
const TOP = { upper: 0.84, lower: 0.36 } as const;
/** A row: a point, the gap and its 12 px label, as a share of the chart's height. */
const ROW = 0.12;
/** More than this many in one quadrant and they go two abreast, labelled by rank alone. */
const CROWD = 3;

const num = (v: number) => String(Math.round(Math.min(0.97, Math.max(0.03, v)) * 1000) / 1000);

/**
 * The impact-against-effort chart as Mermaid `quadrantChart` source, from findings already in rank order. Each
 * point is labelled with its rank (as in the list) and a short title. The layout depends only on the findings and
 * their order, so the picture is the same every time the file is.
 */
export function findingsQuadrant(ranked: readonly Pick<Finding, "title" | "impact" | "effort">[]): string {
  const quadrants = new Map<string, number[]>();
  ranked.forEach((f, i) => {
    const key = `${f.impact === "low" ? "lower" : "upper"} ${f.effort === "small" ? "left" : "right"}`;
    if (!quadrants.has(key)) quadrants.set(key, []);
    quadrants.get(key)!.push(i);
  });
  const points: string[] = new Array(ranked.length);
  for (const [key, members] of quadrants) {
    const [half, side] = key.split(" ") as ["upper" | "lower", "left" | "right"];
    const crowded = members.length > CROWD;
    const rows = crowded ? Math.ceil(members.length / 2) : members.length;
    const step = rows > CROWD ? (ROW * (CROWD - 1)) / (rows - 1) : ROW;
    const centre = side === "left" ? 0.25 : 0.75;
    members.forEach((i, k) => {
      const f = ranked[i]!;
      const row = crowded ? Math.floor(k / 2) : k;
      const x = crowded ? centre + (k % 2 ? 0.11 : -0.11) : centre;
      const y = TOP[half] - row * step;
      const label = crowded ? `${i + 1}` : `${i + 1} ${shortTitle(f.title)}`;
      points[i] = `  "${label}": [${num(x)}, ${num(y)}]`;
    });
  }
  return [
    "quadrantChart",
    "  x-axis Small effort --> Large effort",
    "  y-axis Low impact --> High impact",
    "  quadrant-1 Big bets",
    "  quadrant-2 Quick wins",
    "  quadrant-3 Fill-ins",
    "  quadrant-4 Not worth it",
    ...points,
  ].join("\n");
}
