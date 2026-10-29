// Data table with sortable headers, search, and value-aware formatting.
import { ScrollX } from "./scroll-x.tsx";
import { ArrowDown, ArrowUp, Check, ChevronsUpDown, Minus, Search } from "./icons.ts";
import * as React from "react";
import { useSyncExternalStore } from "react";
import * as store from "../store.ts";
import { linkTitle } from "../store.ts";
import { ErrorBoundary } from "./error.tsx";
import { Input } from "./primitives.tsx";
import { cn, humanize, isUrl } from "./utils.ts";

export type Row = Record<string, unknown>;
export type Format = "text" | "number" | "integer" | "currency" | `currency:${string}` | "percent" | "date" | "url" | "bool" | ((value: unknown, row: Row) => React.ReactNode);
export type ColumnSpec = { key: string; label?: React.ReactNode; format?: Format; align?: "left" | "right" | "center" };
export type ColumnsProp = string | (string | ColumnSpec)[];

/** Rows from a data path ("repos.json") or an inline array. Throws a clear error if missing. */
export function useRows(data: string | unknown[] | undefined): Row[] {
  useSyncExternalStore(store.subscribe, store.getBoot);
  if (data === undefined) return [];
  const raw = typeof data === "string" ? store.getData(data) : data;
  if (!Array.isArray(raw)) {
    throw new Error(`Expected an array of rows${typeof data === "string" ? ` in ${store.resolveDataPath(data)}` : ""}, got ${raw === null ? "null" : typeof raw}`);
  }
  return raw.map((r) => (r !== null && typeof r === "object" && !Array.isArray(r) ? (r as Row) : { value: r }));
}

export function parseColumns(columns: ColumnsProp | undefined, rows: Row[]): ColumnSpec[] {
  if (columns === undefined) {
    const keys: string[] = [];
    for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) if (!keys.includes(k)) keys.push(k);
    return keys.map((key) => ({ key }));
  }
  const list = typeof columns === "string" ? columns.split(/[\s,]+/).filter(Boolean) : columns;
  // A column named in another case than the data ("Name" for "name") still finds its values.
  const keys = new Map<string, string>();
  for (const r of rows.slice(0, 50)) for (const k of Object.keys(r)) if (!keys.has(k.toLowerCase())) keys.set(k.toLowerCase(), k);
  const resolve = (key: string) => (rows.some((r) => key in r) ? key : (keys.get(key.toLowerCase()) ?? key));
  return list.map((c) => (typeof c === "string" ? { key: resolve(c), label: c === resolve(c) ? undefined : humanize(c) } : { ...c, key: resolve(c.key) }));
}

/** A link cell: { label, url } (or href). */
function linkOf(v: unknown): { label: string; url: string } | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const url = typeof o.url === "string" ? o.url : typeof o.href === "string" ? o.href : null;
  if (!url || !(url.startsWith("/") || url.startsWith("#") || isUrl(url))) return null;
  return { label: typeof o.label === "string" ? o.label : typeof o.title === "string" ? o.title : url, url };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/;

function inferFormat(key: string, rows: Row[]): Format {
  let kind: string | null = null;
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined || v === "") continue;
    const k =
      typeof v === "number" ? "number" : typeof v === "boolean" ? "bool" : isUrl(v) || linkOf(v) ? "url" : typeof v === "string" && ISO_DATE.test(v) ? "date" : "text";
    if (kind === null) kind = k;
    else if (kind !== k) return "text";
  }
  return (kind ?? "text") as Format;
}

const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

/**
 * Money in the reader's number style. A bare "$" is only ever US dollars: Canadian, Australian and other dollars
 * read as CA$, A$ and so on (where the reader's locale would write just "$" for its own).
 */
export function money(v: number, currency: string): string {
  const parts = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).formatToParts(v);
  const prefix = currency === "USD" ? null : (new Intl.NumberFormat("en-US", { style: "currency", currency }).formatToParts(0).find((p) => p.type === "currency")?.value ?? currency);
  return parts.map((p) => (p.type === "currency" && p.value === "$" && prefix ? prefix : p.value)).join("");
}

export function formatValue(v: unknown, format: Format, row: Row): React.ReactNode {
  if (typeof format === "function") return format(v, row);
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground/60">—</span>;
  switch (format) {
    case "number":
      return typeof v === "number" ? numberFmt.format(v) : String(v);
    case "integer":
      return typeof v === "number" ? Math.round(v).toLocaleString() : String(v);
    case "percent":
      return typeof v === "number" ? `${numberFmt.format(v * 100)}%` : String(v);
    case "date": {
      // A bare date ("2026-10-04") is that calendar day wherever the reader is, not UTC midnight.
      const dateOnly = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
      const d = new Date(v as string | number);
      return Number.isNaN(d.getTime())
        ? String(v)
        : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
    }
    case "bool":
      return v ? (
        <Check className="inline size-4 text-positive" aria-label="yes" />
      ) : (
        <Minus className="inline size-4 text-muted-foreground/60" aria-label="no" />
      );
    case "url": {
      const link = linkOf(v) ?? (isUrl(v) ? { label: null, url: v } : null);
      if (!link) return String(v);
      // A link to another artifact here reads as its title, and opens in this tab.
      const title = linkTitle(link.url);
      const internal = link.url.startsWith("/") || link.url.startsWith("#") || title !== null;
      return (
        <a
          href={link.url}
          {...(internal ? {} : { target: "_blank", rel: "noopener noreferrer" })}
          className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary"
        >
          {link.label ?? title ?? link.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
        </a>
      );
    }
    default:
      if (typeof format === "string" && format.startsWith("currency")) {
        const currency = format.split(":")[1] ?? "USD";
        return typeof v === "number" ? money(v, currency) : String(v);
      }
      // Several links in one cell: each as a link.
      if (Array.isArray(v) && v.length && v.every((x) => linkOf(x) || isUrl(x))) {
        return v.map((x, i) => (
          <React.Fragment key={i}>
            {i > 0 && ", "}
            {formatValue(x, "url", row)}
          </React.Fragment>
        ));
      }
      if (Array.isArray(v)) return v.join(", ");
      if (linkOf(v)) return formatValue(v, "url", row);
      if (typeof v === "object") return <code className="text-xs">{JSON.stringify(v)}</code>;
      if (typeof v === "number") return numberFmt.format(v);
      if (typeof v === "boolean") return formatValue(v, "bool", row);
      if (isUrl(v)) return formatValue(v, "url", row);
      return String(v);
  }
}

/** What a cell sorts by: a link's label, a list's text, otherwise the value. */
function sortValue(v: unknown): unknown {
  const link = linkOf(v);
  if (link) return link.label;
  return Array.isArray(v) ? v.map((x) => linkOf(x)?.label ?? String(x)).join(", ") : v;
}

function compare(x: unknown, y: unknown): number {
  const a = sortValue(x);
  const b = sortValue(y);
  const an = a === null || a === undefined || a === "";
  const bn = b === null || b === undefined || b === "";
  if (an || bn) return an && bn ? 0 : an ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") return Number(b) - Number(a);
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export type TableProps = {
  /** "repos.json" (from data/) or an array of row objects. */
  data: string | unknown[];
  /** "name price selfHost", ["name", …], or [{ key, label, format, align }]. Defaults to every key. */
  columns?: ColumnsProp;
  /** Initial sort column; prefix "-" for descending ("-stars"). */
  sort?: string;
  /** Show a filter box. */
  search?: boolean;
  /** Shown when there are no rows. */
  empty?: React.ReactNode;
  /** Show the first N rows with a "Show all" toggle. */
  limit?: number;
  /**
   * Rows as cards (the first column as each card's title, the rest as label: value): "auto" (the default) on
   * phones when there are more than three columns or the table would be wider than the page, "always", or "never" (a table that scrolls sideways).
   */
  cards?: "auto" | "always" | "never";
  /**
   * The column each card is titled by. Default: the first, unless it only numbers the rows (1, 2, E1), then the
   * first text column. It isn't repeated among the card's labels.
   */
  cardTitle?: string;
  className?: string;
};

const PHONE = "(max-width: 639px)";
export function usePhone(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = matchMedia(PHONE);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => matchMedia(PHONE).matches,
    () => false,
  );
}

/** True when a table is wider than the box it sits in (a pixel of slack for rounding). */
export function overflows(tableWidth: number, containerWidth: number): boolean {
  return containerWidth > 0 && tableWidth > containerWidth + 1;
}

/** How much wider the box must get before cards turn back into a table: cards drop the box's border, so it grows a little by itself. */
const REGROW_PX = 24;

/**
 * Where the cards-because-it-overflows decision stands. `prev` is the container width at which the table last
 * overflowed (null: it fits, or hasn't been measured). Once it overflowed it stays cards until the container
 * grows well past that width (a rotation, a wider window), because a table shown as cards can't be measured;
 * then it gets measured again.
 */
export function nextOverflowAt(prev: number | null, containerWidth: number, tableWidth: number): number | null {
  if (prev !== null) return containerWidth > prev + REGROW_PX ? null : prev;
  return overflows(tableWidth, containerWidth) ? containerWidth : null;
}

/**
 * Whether the table inside `wrapper` is too wide for it. Measured before paint, so a phone never sees the clipped
 * table first, then again when the wrapper or the table resizes (a font arriving, rows changing) and when `key`
 * changes. False until measured, and where nothing can be measured. The last answer lives in a ref so a
 * measurement never re-runs the effect: switching to cards changes the layout it measures.
 */
export function useOverflowCards(wrapper: React.RefObject<HTMLElement | null>, enabled: boolean, key?: unknown): boolean {
  const [at, setAt] = React.useState<number | null>(null);
  const last = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    const el = wrapper.current;
    last.current = null;
    if (!el || !enabled) {
      setAt(null);
      return;
    }
    const check = () => {
      const next = nextOverflowAt(last.current, el.clientWidth, el.querySelector("table")?.offsetWidth ?? 0);
      if (next === last.current) return;
      last.current = next;
      setAt(next);
    };
    check();
    let frame = 0;
    // A frame later, not inside the observer's callback: a change it makes would resize what it observes.
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(later) : null;
    ro?.observe(el);
    const table = el.querySelector("table");
    if (table) ro?.observe(table);
    let live = true;
    document.fonts?.ready.then(() => live && later());
    return () => {
      live = false;
      ro?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [wrapper, enabled, key]);
  return enabled && at !== null;
}

/** A rank or id ("1", 7, "E1"): a column that numbers rows rather than naming them. */
function isRankLike(c: { key: string; format: Format }, rows: Row[]): boolean {
  const vals = rows.map((r) => r[c.key]).filter((v) => v !== null && v !== undefined && v !== "");
  if (!vals.length || new Set(vals).size !== vals.length) return false;
  if (c.format === "number" || c.format === "integer") {
    if (!vals.every((v) => typeof v === "number" && Number.isInteger(v))) return false;
    // A year or a count is a value worth a title's place; a rank is named so, or counts 1, 2, 3.
    const sorted = [...(vals as number[])].sort((a, b) => a - b);
    return /^(#|no\.?|n|rank|id|step|priority|pos(ition)?)$/i.test(c.key) || sorted.every((v, i) => v === i + 1);
  }
  return c.format === "text" && vals.every((v) => typeof v === "string" && /^[A-Za-z]{0,3}[-#]?\d+$/.test(v));
}

/**
 * The column a card is titled by: the one named by `cardTitle` (in any case), else the first, unless the first
 * only numbers the rows (1, 2, E1) and a text column follows: then that one. The rank stays on the card as a field.
 */
export function pickTitleColumn<C extends { key: string; format: Format }>(cols: C[], rows: Row[], cardTitle?: string): C | undefined {
  const named = cardTitle ? cols.find((c) => c.key === cardTitle || c.key.toLowerCase() === cardTitle.toLowerCase()) : undefined;
  if (named) return named;
  const first = cols[0];
  if (first && isRankLike(first, rows)) {
    const text = cols.slice(1).find((c) => c.format === "text" && !isRankLike(c, rows));
    if (text) return text;
  }
  return first;
}

const isBlank = (v: unknown) => v === null || v === undefined || v === "";
/** Fields a card shows before the rest fold behind "More" (a wide row would otherwise be a screenful of cards). */
export const CARD_FIELDS = 6;

type CardCol = { key: string; label?: React.ReactNode; format: Format };
function FieldList({ fields, row }: { fields: CardCol[]; row: Row }) {
  return (
    <dl className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] gap-x-3 gap-y-1">
      {fields.map((c) => (
        <React.Fragment key={c.key}>
          <dt className="min-w-0 break-words text-muted-foreground">{c.label ?? humanize(c.key)}</dt>
          <dd className="min-w-0 break-words">{formatValue(row[c.key], c.format, row)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** A card's label: value pairs; past a few, the rest open from a native disclosure (works on touch and keys). */
function CardFields({ fields, row }: { fields: CardCol[]; row: Row }) {
  if (fields.length <= CARD_FIELDS + 1) return <FieldList fields={fields} row={row} />;
  return (
    <>
      <FieldList fields={fields.slice(0, CARD_FIELDS)} row={row} />
      <details className="group mt-1.5">
        <summary data-key-stop="" className="relative inline-flex min-h-6 cursor-pointer items-center rounded text-primary outline-none select-none after:absolute after:-inset-x-2 after:-inset-y-1.5 focus-visible:focus-halo">
          <span className="group-open:hidden">{`More (${fields.length - CARD_FIELDS})`}</span>
          <span className="hidden group-open:inline">Fewer</span>
        </summary>
        <div className="mt-1.5">
          <FieldList fields={fields.slice(CARD_FIELDS)} row={row} />
        </div>
      </details>
    </>
  );
}

/** What a cell holds, as text, for the filter box. */
function searchable(v: unknown): string {
  const link = linkOf(v);
  if (link) return `${link.label} ${link.url}`;
  return Array.isArray(v) ? v.join(" ") : String(v ?? "");
}

export function Table(props: TableProps) {
  return (
    <ErrorBoundary label="Table">
      <TableInner {...props} />
    </ErrorBoundary>
  );
}

function TableInner({ data, columns, sort, search, empty = "Nothing here yet.", limit, cards = "auto", cardTitle, className }: TableProps) {
  const rows = useRows(data);
  const phone = usePhone();
  const cols = React.useMemo(
    () =>
      parseColumns(columns, rows).map((c) => {
        const format = c.format ?? inferFormat(c.key, rows);
        const numeric = format === "number" || format === "integer" || format === "percent" || (typeof format === "string" && format.startsWith("currency"));
        return { ...c, format, align: c.align ?? (numeric ? "right" : format === "bool" ? "center" : "left") };
      }),
    [columns, rows],
  );
  const [sortKey, setSortKey] = React.useState<string | null>(sort ? sort.replace(/^-/, "") : null);
  const [desc, setDesc] = React.useState(sort ? sort.startsWith("-") : false);
  const [query, setQuery] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);

  const shown = React.useMemo(() => {
    let out = rows;
    const q = query.trim().toLowerCase();
    if (q) out = out.filter((r) => cols.some((c) => searchable(r[c.key]).toLowerCase().includes(q)));
    if (sortKey) {
      out = [...out].sort((a, b) => {
        const res = compare(a[sortKey], b[sortKey]);
        const aNull = a[sortKey] === null || a[sortKey] === undefined || a[sortKey] === "";
        const bNull = b[sortKey] === null || b[sortKey] === undefined || b[sortKey] === "";
        return aNull || bNull ? res : desc ? -res : res;
      });
    }
    return out;
  }, [rows, cols, query, sortKey, desc]);

  const visible = limit && !expanded ? shown.slice(0, limit) : shown;

  function toggleSort(key: string) {
    if (sortKey !== key) {
      setSortKey(key);
      setDesc(false);
    } else if (!desc) setDesc(true);
    else setSortKey(null);
  }

  const alignClass = (a: string) => (a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left");
  // A narrower table is cards on a phone too once it would overflow (long text in two columns still clips).
  const wide = cols.length > 3;
  const outer = React.useRef<HTMLDivElement>(null);
  const overflowing = useOverflowCards(outer, cards === "auto" && phone && !wide);
  const asCards = cards === "always" || (cards === "auto" && phone && (wide || overflowing));
  const titleCol = pickTitleColumn(cols, rows, cardTitle);

  return (
    <div ref={outer} className={cn("my-6", className)}>
      {asCards ? (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {search && <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" className="max-w-[12rem]" aria-label="Filter rows" />}
          <select
            aria-label="Sort by"
            value={sortKey ? `${desc ? "-" : ""}${sortKey}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              setSortKey(v ? v.replace(/^-/, "") : null);
              setDesc(v.startsWith("-"));
            }}
            className="h-9 max-w-full rounded-md border border-input bg-card px-2 text-[14px] text-foreground"
          >
            <option value="">Sort: as listed</option>
            {cols.flatMap((c) => [
              <option key={c.key} value={c.key}>
                {`Sort: ${typeof c.label === "string" ? c.label : humanize(c.key)}`}
              </option>,
              <option key={`-${c.key}`} value={`-${c.key}`}>
                {`Sort: ${typeof c.label === "string" ? c.label : humanize(c.key)}, reversed`}
              </option>,
            ])}
          </select>
        </div>
      ) : null}
      {asCards ? (
        visible.length === 0 ? (
          <p className="rounded-xl border border-border bg-card px-5 py-8 text-center text-muted-foreground">{query ? "No rows match your filter." : empty}</p>
        ) : (
          <ul className="grid gap-2.5">
            {visible.map((r, i) => (
              <li
                key={i}
                data-row={cols[0] ? String(r[cols[0].key] ?? "").slice(0, 200) : undefined}
                className="rounded-xl border border-border bg-card px-4 py-3 text-[14px] leading-snug shadow-card"
              >
                {titleCol && <div className="mb-1.5 font-medium text-foreground">{formatValue(r[titleCol.key], titleCol.format, r)}</div>}
                <CardFields fields={cols.filter((c) => c !== titleCol && !isBlank(r[c.key]))} row={r} />
              </li>
            ))}
          </ul>
        )
      ) : null}
      {!asCards && search && (
        <div className="relative mb-3 max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter…" className="pl-10" aria-label="Filter rows" />
        </div>
      )}
      {!asCards && (
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <ScrollX>
        <table className="w-full border-collapse text-[14px] leading-snug">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              {cols.map((c) => {
                const active = sortKey === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (desc ? "descending" : "ascending") : undefined}
                    className={cn("px-4 py-2.5 font-medium whitespace-nowrap text-muted-foreground first:pl-5 last:pr-5", alignClass(c.align))}
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(c.key)}
                      className={cn(
                        "group inline-flex cursor-pointer items-center gap-1 rounded outline-none hover:text-foreground focus-visible:focus-halo",
                        active && "text-foreground",
                        c.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {c.label ?? humanize(c.key)}
                      {active ? (
                        desc ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />
                      ) : (
                        <ChevronsUpDown className="size-3.5 opacity-0 transition-opacity group-hover:opacity-60 group-focus-visible:opacity-60 pointer-coarse:opacity-60" />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={cols.length || 1} className="px-5 py-10 text-center text-muted-foreground">
                  {query ? "No rows match your filter." : empty}
                </td>
              </tr>
            ) : (
              visible.map((r, i) => (
                <tr
                  key={i}
                  data-row={cols[0] ? String(r[cols[0].key] ?? "").slice(0, 200) : undefined}
                  className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/40"
                >
                  {cols.map((c, j) => (
                    <td
                      key={c.key}
                      className={cn(
                        "px-4 py-2.5 align-top first:pl-5 last:pr-5",
                        c.align === "left" && "max-sm:min-w-36",
                        alignClass(c.align),
                        c.align === "right" && "tabular-nums",
                        j === 0 && "font-medium",
                      )}
                    >
                      {formatValue(r[c.key], c.format, r)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollX>
      </div>
      )}
      {limit && shown.length > limit && (
        <button type="button" onClick={() => setExpanded((e) => !e)} className="mt-2 cursor-pointer text-sm font-medium text-primary hover:underline">
          {expanded ? "Show fewer" : `Show all ${shown.length} rows`}
        </button>
      )}
    </div>
  );
}
