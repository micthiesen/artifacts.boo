// The bodies of <Delta> and <BulletBar>, and the arithmetic behind them: numbers that changed, told as before,
// after and how much, and one number against its target. Loaded lazily; only pages with one download it.
import * as React from "react";
import { ArrowDown, ArrowUp, Minus } from "./icons.ts";
import { useRows } from "./table.tsx";
import { cn } from "./utils.ts";

export type Better = "up" | "down";
export type DeltaRow = { label: string; before: number; after: number; unit?: string; better: Better; note?: string };

// ---- Units and numbers ---------------------------------------------------------

/** Units written before the number. */
const PREFIX = new Set(["$", "€", "£", "¥"]);
/** Units written against the number, with no space. */
const TIGHT = new Set(["%", "x", "×"]);

/**
 * A value in the unit a person would say it in: 1500 ms is 1.5 s, 0.4 s is 400 ms, 150 s is 2.5 min, 1200 MB
 * is 1.2 GB. Units the kit doesn't know stay as they are.
 */
export function scaleUnit(v: number, unit = ""): [number, string] {
  const a = Math.abs(v);
  switch (unit) {
    case "ms":
      return a >= 1000 ? scaleUnit(v / 1000, "s") : [v, unit];
    case "s":
      if (a >= 120) return scaleUnit(v / 60, "min");
      return a > 0 && a < 1 ? [v * 1000, "ms"] : [v, unit];
    case "min":
      return a >= 120 ? [v / 60, "h"] : [v, unit];
    case "B":
    case "KB":
    case "MB":
    case "GB": {
      const next = { B: "KB", KB: "MB", MB: "GB", GB: "TB" }[unit];
      return a >= 1000 ? scaleUnit(v / 1000, next) : [v, unit];
    }
    default:
      return [v, unit];
  }
}

const fmt = (opts: Intl.NumberFormatOptions) => new Intl.NumberFormat(undefined, opts);
const NUM = [fmt({ maximumFractionDigits: 0 }), fmt({ maximumFractionDigits: 1 }), fmt({ maximumFractionDigits: 2 })];
const SMALL = fmt({ maximumSignificantDigits: 2 });
const CENTS = fmt({ minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A magnitude with as many decimals as it deserves: 1234, 12.3, 1.23, 0.042. */
function magnitude(a: number, money: boolean): string {
  if (money && !Number.isInteger(a) && a < 1000) return CENTS.format(a);
  if (a !== 0 && a < 1) return SMALL.format(a);
  return NUM[a >= 100 ? 0 : a >= 10 ? 1 : 2]!.format(a);
}

/** "1.2 s", "−$300", "+4 pp", "38%". `signed` puts a + on positive values; a value that rounds to zero has no sign. */
export function formatQuantity(v: number, unit = "", signed = false): string {
  const [x, u] = scaleUnit(v, unit);
  const s = magnitude(Math.abs(x), PREFIX.has(u));
  const zero = /^[0.,\s]*$/.test(s);
  const sign = zero ? "" : x < 0 ? "−" : signed && x > 0 ? "+" : "";
  if (!u) return sign + s;
  if (PREFIX.has(u)) return `${sign}${u}${s}`;
  if (TIGHT.has(u)) return `${sign}${s}${u}`;
  return `${sign}${s} ${u}`;
}

/** "−38%", "+4.5%": whole percents from 10 up, one decimal below. */
export function formatPercent(p: number): string {
  const a = Math.abs(p);
  const s = NUM[a >= 10 ? 0 : 1]!.format(a);
  const zero = /^[0.,\s]*$/.test(s);
  return `${zero ? "" : p < 0 ? "−" : "+"}${s}%`;
}

export type DeltaResult = {
  diff: number;
  /** Change relative to before, in percent; null when before is 0. */
  pct: number | null;
  direction: "up" | "down" | "flat";
  verdict: "better" | "worse" | "same";
  /** "−1.2 s · −38%", or "No change". */
  change: string;
};

/**
 * What a before → after change amounts to. A change in a percentage is told in percentage points ("−2 pp"),
 * since "−50%" of a percentage is ambiguous on its own; the relative change follows it as usual.
 */
export function computeDelta(row: Pick<DeltaRow, "before" | "after" | "unit" | "better">): DeltaResult {
  const { before, after, unit = "" } = row;
  const diff = after - before;
  const flat = Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(before), Math.abs(after));
  if (flat) return { diff: 0, pct: 0, direction: "flat", verdict: "same", change: "No change" };
  const pct = before === 0 ? null : (diff / Math.abs(before)) * 100;
  const direction = diff > 0 ? "up" : "down";
  const verdict = direction === (row.better === "down" ? "down" : "up") ? "better" : "worse";
  const abs = formatQuantity(diff, unit === "%" ? "pp" : unit, true);
  return { diff, pct, direction, verdict, change: pct === null ? abs : `${abs} · ${formatPercent(pct)}` };
}

/** A round number at or above x, for an axis end: 1, 2, 2.5 or 5 times a power of ten. */
export function niceCeil(x: number): number {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= x - 1e-9 * p) return m * p;
  return 10 * p;
}

/** Validates one row from a data file; returns the problem, or null. */
export function rowProblem(r: Record<string, unknown>): string | null {
  if (typeof r.label !== "string" || !r.label) return `a row has no "label"`;
  if (typeof r.before !== "number" || !Number.isFinite(r.before)) return `"${r.label}": "before" is a number`;
  if (typeof r.after !== "number" || !Number.isFinite(r.after)) return `"${r.label}": "after" is a number`;
  if (r.better !== "up" && r.better !== "down") return `"${r.label}": "better" is "up" or "down"`;
  return null;
}

// ---- Delta -----------------------------------------------------------------------

const TONE = { better: "text-positive", worse: "text-negative", same: "text-muted-foreground" } as const;
const STROKE = { better: "var(--positive)", worse: "var(--negative)", same: "var(--muted-foreground)" } as const;

/** Before and after on one line, on a scale from zero to the larger of the two: how far it moved, not just which way. */
function Dumbbell({ before, after, verdict }: { before: number; after: number; verdict: DeltaResult["verdict"] }) {
  const lo = Math.min(0, before, after);
  const hi = Math.max(0, before, after);
  if (hi === lo) return null;
  const x = (v: number) => `${(4 + ((v - lo) / (hi - lo)) * 92).toFixed(1)}%`;
  return (
    <svg width="100%" height="14" aria-hidden className="block overflow-visible">
      <line x1="4%" x2="96%" y1="7" y2="7" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" />
      <line x1={x(before)} x2={x(after)} y1="7" y2="7" stroke={STROKE[verdict]} strokeOpacity="0.55" strokeWidth="3" strokeLinecap="round" />
      <circle cx={x(before)} cy="7" r="4" fill="var(--card)" stroke="var(--muted-foreground)" strokeWidth="1.5" />
      <circle cx={x(after)} cy="7" r="4.5" fill={STROKE[verdict]} />
    </svg>
  );
}

// On a phone a row is two lines: label and After (the answer) on the first, the change and Before under them.
// From 640 px it's a table row; cells keep DOM order Label, Before, After, Change so either reads the same aloud.
const CELL = "sm:col-auto sm:row-auto";

export function DeltaImpl({ data, rows, title, chart }: { data?: string; rows?: DeltaRow[]; title?: React.ReactNode; chart?: boolean }) {
  const raw = useRows(data ?? rows ?? []);
  const cols = chart ? "sm:grid-cols-[minmax(0,1fr)_auto_auto_auto_minmax(5rem,8rem)]" : "sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]";
  return (
    <section aria-label={typeof title === "string" ? title : "Before and after"} className="art-delta my-6 overflow-hidden rounded-xl border border-border bg-card shadow-card">
      {title && <div className="border-b border-border px-4 py-3 font-semibold">{title}</div>}
      <div role="table" className={cn("grid grid-cols-[minmax(0,1fr)_auto] divide-y divide-border", cols)}>
        <div role="row" data-speak="skip" className="col-span-full hidden grid-cols-subgrid gap-x-6 px-4 py-2 text-[13px] font-medium text-muted-foreground sm:grid">
          <span role="columnheader">
            <span className="sr-only">Measure</span>
          </span>
          <span role="columnheader" className="text-right">Before</span>
          <span role="columnheader" className="text-right">After</span>
          <span role="columnheader">Change</span>
          {chart && <span role="columnheader" aria-hidden />}
        </div>
        {raw.map((r, i) => {
          const problem = rowProblem(r);
          if (problem) {
            return (
              <div role="row" key={i} className="col-span-full px-4 py-3 text-[14px] text-negative">
                <span role="cell">Can't show this row: {problem}</span>
              </div>
            );
          }
          const row = r as unknown as DeltaRow;
          const d = computeDelta(row);
          const Arrow = d.direction === "up" ? ArrowUp : d.direction === "down" ? ArrowDown : Minus;
          return (
            <div role="row" key={i} data-speak="delta" className="col-span-full grid grid-cols-subgrid items-baseline gap-x-4 gap-y-0.5 px-4 py-3 sm:gap-x-6">
              <div role="rowheader" className={cn("col-start-1 row-start-1 min-w-0 font-medium [overflow-wrap:anywhere]", CELL)}>
                {row.label}
                {row.note && <div className="text-[13px] font-normal text-muted-foreground">{row.note}</div>}
              </div>
              <div role="cell" className={cn("col-start-2 row-start-2 text-right text-[13px] whitespace-nowrap text-muted-foreground tabular-nums sm:text-[15px]", CELL)}>
                <span className="sm:hidden">was </span>
                {formatQuantity(row.before, row.unit)}
              </div>
              <div role="cell" className={cn("col-start-2 row-start-1 text-right text-[17px] font-semibold whitespace-nowrap tabular-nums sm:text-[15px]", CELL)}>
                {formatQuantity(row.after, row.unit)}
              </div>
              <div role="cell" className={cn("col-start-1 row-start-2 text-[13px] tabular-nums sm:text-[15px]", TONE[d.verdict], CELL)}>
                <span className="inline-flex flex-wrap items-baseline gap-x-1">
                  <Arrow aria-hidden className="size-3.5 shrink-0 self-center" />
                  <span className="whitespace-nowrap">{d.change}</span>
                  {d.verdict !== "same" && <span className="font-medium whitespace-nowrap">· {d.verdict}</span>}
                </span>
              </div>
              {chart && (
                <div role="cell" className={cn("col-span-2 row-start-3 pt-1.5 sm:self-center sm:pt-0", CELL)}>
                  <Dumbbell before={row.before} after={row.after} verdict={d.verdict} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ---- BulletBar -------------------------------------------------------------------

/** How a value stands against its target, in words: the bar's colour is never the only sign. */
export function targetVerdict(value: number, target: number, better: Better = "up"): "on target" | "below target" | "over target" {
  if (better === "down") return value <= target ? "on target" : "over target";
  return value >= target ? "on target" : "below target";
}

export function BulletBarImpl({
  label,
  value,
  target,
  max,
  bands = [],
  unit,
  better = "up",
}: {
  label: React.ReactNode;
  value: number;
  target?: number;
  max?: number;
  bands?: number[];
  unit?: string;
  better?: Better;
}) {
  const top = max && max > 0 ? max : niceCeil(Math.max(value, target ?? 0, ...bands) * 1.05);
  const pos = (v: number) => `${(Math.min(Math.max(v, 0), top) / top) * 100}%`;
  const edges = [0, ...bands.filter((b) => b > 0 && b < top).sort((a, b) => a - b), top];
  // Qualitative ranges in muted greys, more ink for the worse end, as in Stephen Few's bullet graph.
  const shades = [0.17, 0.12, 0.08, 0.05, 0.035];
  const segments = edges.slice(1).map((end, i) => ({ start: edges[i]!, end, shade: shades[Math.min(i, shades.length - 1)]! }));
  if (better === "down") {
    const s = segments.map((x) => x.shade).reverse();
    segments.forEach((x, i) => (x.shade = s[i]!));
  }
  const verdict = target === undefined ? null : targetVerdict(value, target, better);
  const tone = verdict === null ? "var(--foreground)" : verdict === "on target" ? "var(--positive)" : "var(--caution)";
  const text = formatQuantity(value, unit);
  const aria = `${typeof label === "string" ? `${label}: ` : ""}${text}${target === undefined ? "" : ` of ${formatQuantity(target, unit)} target`}`;
  return (
    <div className="art-bullet my-4" data-speak="bullet">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere]">{label}</span>
        <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">{text}</span>
      </div>
      <svg width="100%" height="18" role="img" aria-label={aria} className="mt-1.5 block overflow-visible">
        {segments.map((s, i) => (
          <rect key={i} x={pos(s.start)} y="0" width={`${((s.end - s.start) / top) * 100}%`} height="18" fill="var(--foreground)" fillOpacity={s.shade} />
        ))}
        <rect x="0" y="6" width={pos(value)} height="6" rx="1" fill={tone} />
        {target !== undefined && <rect x={pos(target)} y="2" width="2.5" height="14" transform="translate(-1.25 0)" fill="var(--foreground)" />}
      </svg>
      {(target !== undefined || value > top) && (
        <div className="mt-1 text-[13px] text-muted-foreground tabular-nums">
          {target !== undefined && (
            <>
              of {formatQuantity(target, unit)} target ·{" "}
              <span className={cn("font-medium", verdict === "on target" ? "text-positive" : "text-caution")}>{verdict}</span>
            </>
          )}
          {value > top && <span> · past the scale's end, {formatQuantity(top, unit)}</span>}
        </div>
      )}
    </div>
  );
}
