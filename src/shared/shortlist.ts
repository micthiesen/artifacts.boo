// A shortlist's data file (data/shortlist.json, rendered by <Shortlist>): real options for one decision (a clinic,
// a router, a plan), each with a verdict, a price and when it was checked, and the evidence behind it. The Worker
// checks it on every write, so a shortlist that recommends an option it doesn't list, cites nothing for an option
// it keeps, or carries an impossible date is refused with a reason instead of shown wrong.
import { parseDay, SOURCE_KINDS, type SourceKind } from "./sources.ts";

export type Verdict = "pick" | "close" | "conditional" | "no";
export type ShortlistEvidence = { label: string; url: string; kind?: SourceKind };
export type ShortlistFact = { label: string; value: string | number };
export type ShortlistOption = {
  id: string;
  name: string;
  verdict: Verdict;
  summary: string;
  price?: string;
  priceChecked?: string;
  pros?: string[];
  cons?: string[];
  deciding?: string;
  facts?: ShortlistFact[];
  evidence?: ShortlistEvidence[];
  url?: string;
};
export type ShortlistData = {
  question: string;
  pick?: string;
  why?: string;
  checked: string;
  next?: string;
  criteria?: string[];
  options: ShortlistOption[];
  decide?: { options?: "all" | string[]; id?: string; question?: string };
};

export const SHORTLIST_LIMITS = { options: 10, summaryWords: 30, listItems: 5, itemWords: 25, criteria: 6, facts: 8, evidence: 6 } as const;

/** The order verdicts are shown in; within a verdict, the file's order stands. */
export const VERDICTS: readonly Verdict[] = ["pick", "close", "conditional", "no"];

/** An option id names a Decision choice and part of an element id, so it stays short and URL-safe. */
export const OPTION_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** As <Decision>'s own id rule. */
const DECISION_ID = /^[A-Za-z0-9_.-]{1,64}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const URL_RE = /^https?:\/\/\S+$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const day = (v: unknown) => (typeof v === "string" && DAY.test(v) ? parseDay(v) : null);

/**
 * Every problem with a shortlist's data, one line each, phrased as the fix; empty when it's fine. With `now`
 * (the Worker passes it), a "checked" date after today is refused too; the page leaves that out, since the
 * reader's clock and time zone aren't the writer's.
 */
export function checkShortlist(value: unknown, now?: Date): string[] {
  if (!isObj(value)) return [`must be a JSON object (see artifact_guide topic "shortlist")`];
  const s = value;
  const out: string[] = [];
  // A day's slack: "today" where the writer is can be tomorrow in UTC.
  const latest = now ? new Date(now.getTime() + 86_400_000) : null;
  const date = (v: unknown, what: string) => {
    const d = day(v);
    if (!d) out.push(`${what} is a real date written YYYY-MM-DD, like 2026-10-28`);
    else if (latest && d > latest) out.push(`${what} is in the future: use the day it was actually checked`);
    return d;
  };

  if (!isText(s.question)) out.push(`"question" is required: what's being decided, in plain words`);
  const checked = date(s.checked, `"checked" (when prices and availability were last checked)`);
  if (s.next !== undefined) {
    const next = day(s.next);
    if (!next) out.push(`"next" (when to recheck) is a real date written YYYY-MM-DD`);
    else if (checked && next < checked) out.push(`"next" is on or after "checked": it's when to check again`);
  }
  if (s.criteria !== undefined) {
    if (!Array.isArray(s.criteria) || !s.criteria.every(isText)) out.push(`"criteria" is a list of short phrases, most important first`);
    else if (s.criteria.length > SHORTLIST_LIMITS.criteria) out.push(`"criteria" has ${s.criteria.length} entries; keep the ${SHORTLIST_LIMITS.criteria} that matter most`);
  }

  const options = Array.isArray(s.options) ? s.options : [];
  if (!Array.isArray(s.options) || options.length < 2 || options.length > SHORTLIST_LIMITS.options) {
    out.push(`"options" lists 2 to ${SHORTLIST_LIMITS.options} options (has ${options.length}); leave out ones not worth a row`);
  }
  const ids = new Set<string>();
  const picks: string[] = [];
  options.forEach((o, i) => {
    if (!isObj(o)) {
      out.push(`option ${i + 1} is {id, name, verdict, summary, ...}`);
      return;
    }
    const at = isText(o.id) ? `option "${o.id}"` : `option ${i + 1}`;
    if (typeof o.id !== "string" || !OPTION_ID.test(o.id)) out.push(`${at}: "id" is 1 to 40 lowercase letters, digits and "-", starting with a letter or digit`);
    else if (ids.has(o.id)) out.push(`${at}: id "${o.id}" is used twice; give each option its own`);
    else ids.add(o.id);
    if (!isText(o.name)) out.push(`${at}: "name" is required`);
    if (!VERDICTS.includes(o.verdict as Verdict)) out.push(`${at}: "verdict" is one of ${VERDICTS.join(", ")}`);
    else if (o.verdict === "pick" && typeof o.id === "string") picks.push(o.id);
    if (!isText(o.summary)) out.push(`${at}: "summary" is one sentence on what it is and why it's here`);
    else if (words(o.summary) > SHORTLIST_LIMITS.summaryWords) {
      out.push(`${at}: "summary" has ${words(o.summary)} words; keep it to ${SHORTLIST_LIMITS.summaryWords} and move detail into pros, cons or facts`);
    }
    if (o.price !== undefined && !isText(o.price)) out.push(`${at}: "price" is text as the provider states it, like "€120 a session"`);
    if (o.priceChecked !== undefined) date(o.priceChecked, `${at}: "priceChecked"`);
    for (const k of ["pros", "cons"] as const) {
      const list = o[k];
      if (list === undefined) continue;
      if (!Array.isArray(list) || !list.every(isText)) out.push(`${at}: "${k}" is a list of short points`);
      else {
        if (list.length > SHORTLIST_LIMITS.listItems) out.push(`${at}: "${k}" has ${list.length} points; keep the ${SHORTLIST_LIMITS.listItems} that matter`);
        const long = list.find((p) => words(p) > SHORTLIST_LIMITS.itemWords);
        if (long) out.push(`${at}: a point in "${k}" has ${words(long)} words; keep each to ${SHORTLIST_LIMITS.itemWords}`);
      }
    }
    if (o.deciding !== undefined && !isText(o.deciding)) out.push(`${at}: "deciding" is the one question that would decide for or against it`);
    else if (isText(o.deciding) && words(o.deciding) > SHORTLIST_LIMITS.summaryWords) out.push(`${at}: "deciding" is one question of at most ${SHORTLIST_LIMITS.summaryWords} words`);
    if (o.facts !== undefined) {
      if (!Array.isArray(o.facts) || !o.facts.every((f) => isObj(f) && isText(f.label) && (isText(f.value) || typeof f.value === "number"))) {
        out.push(`${at}: "facts" is a list of {label, value}, like {"label": "Distance", "value": "1.2 km"}`);
      } else if (o.facts.length > SHORTLIST_LIMITS.facts) out.push(`${at}: "facts" has ${o.facts.length} entries; keep the ${SHORTLIST_LIMITS.facts} that matter`);
    }
    if (o.url !== undefined && (typeof o.url !== "string" || !URL_RE.test(o.url))) out.push(`${at}: "url" is an http(s) link to the option's own page`);
    let cited = typeof o.url === "string" && URL_RE.test(o.url);
    if (o.evidence !== undefined) {
      if (!Array.isArray(o.evidence)) out.push(`${at}: "evidence" is a list of {label, url, kind?}`);
      else {
        if (o.evidence.length > SHORTLIST_LIMITS.evidence) out.push(`${at}: "evidence" has ${o.evidence.length} links; keep the ${SHORTLIST_LIMITS.evidence} best`);
        for (const e of o.evidence) {
          if (!isObj(e) || !isText(e.label) || typeof e.url !== "string" || !URL_RE.test(e.url)) {
            out.push(`${at}: each "evidence" item is {label, url} with an http(s) url`);
            continue;
          }
          if (e.kind !== undefined && !(typeof e.kind === "string" && Object.hasOwn(SOURCE_KINDS, e.kind))) {
            out.push(`${at}: an evidence "kind" is one of ${Object.keys(SOURCE_KINDS).join(", ")}`);
          }
          cited = true;
        }
      }
    }
    if (!cited && o.verdict !== "no") out.push(`${at}: add at least one "evidence" link or a "url", so the reader can check it`);
  });

  if (s.pick !== undefined) {
    if (typeof s.pick !== "string" || !ids.has(s.pick)) out.push(`"pick" names an option id (has "${String(s.pick)}")`);
    else if (!picks.includes(s.pick)) out.push(`option "${s.pick}" is the "pick", so its "verdict" is "pick"`);
    if (!isText(s.why)) out.push(`"why" says in one sentence why "pick" is the one`);
  }
  if (picks.length > 1) out.push(`only one option has the verdict "pick" (${picks.join(", ")} do); make the others "close" or "conditional"`);
  else if (picks.length === 1 && s.pick === undefined) out.push(`option "${picks[0]}" has the verdict "pick": set "pick" to "${picks[0]}" and say "why"`);
  if (s.why !== undefined && s.pick === undefined && isText(s.why)) out.push(`"why" explains "pick": set "pick" too, or leave "why" out`);

  if (s.decide !== undefined) {
    const d = s.decide;
    if (!isObj(d)) out.push(`"decide" is {options?: "all" or a list of option ids, id?, question?}`);
    else {
      if (d.options !== undefined && d.options !== "all") {
        if (!Array.isArray(d.options) || d.options.length < 2) out.push(`"decide.options" is "all" or a list of at least 2 option ids`);
        else for (const id of d.options) if (typeof id !== "string" || !ids.has(id)) out.push(`"decide.options" names "${String(id)}", which isn't an option id`);
      }
      if (d.id !== undefined && (typeof d.id !== "string" || !DECISION_ID.test(d.id))) out.push(`"decide.id" is letters, digits, "-", "_" or "." (it names the saved answer)`);
      if (d.question !== undefined && !isText(d.question)) out.push(`"decide.question" is text, or leave it out to ask "question"`);
    }
  }
  return [...new Set(out)];
}

export type Ranked = { option: ShortlistOption; rank: number };

/**
 * The rows as shown: options still in the running, by verdict (pick, close, conditional) and then in the file's
 * order, numbered from 1; and the ruled-out ones, in the file's order, unnumbered at the end.
 */
export function arrangeShortlist(options: readonly ShortlistOption[]): { ranked: Ranked[]; ruledOut: ShortlistOption[] } {
  const order = (o: ShortlistOption) => VERDICTS.indexOf(o.verdict);
  const live = options
    .map((option, i) => ({ option, i }))
    .filter(({ option }) => option.verdict !== "no")
    .sort((a, b) => order(a.option) - order(b.option) || a.i - b.i);
  return { ranked: live.map(({ option }, i) => ({ option, rank: i + 1 })), ruledOut: options.filter((o) => o.verdict === "no") };
}

/** The choices the Decision under the list offers: "all" (the default) is every option not ruled out, in rank order. */
export function decisionChoices(data: ShortlistData): { value: string; label: string; detail?: string }[] {
  const { ranked } = arrangeShortlist(data.options);
  const wanted = data.decide?.options;
  const chosen = Array.isArray(wanted) ? wanted.map((id) => data.options.find((o) => o.id === id)!).filter(Boolean) : ranked.map((r) => r.option);
  return chosen.map((o) => ({ value: o.id, label: o.name, ...(o.price ? { detail: o.price } : {}) }));
}
