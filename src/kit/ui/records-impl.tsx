// The bodies of <Log>, <Record> and <Figure>. Loaded lazily, as one file; only pages with one of them download it.
import * as React from "react";
import { useSyncExternalStore } from "react";
import * as store from "../store.ts";
import { Dialog, DialogContent, DialogTitle } from "./controls.tsx";
import { Check, OctagonAlert, TriangleAlert } from "./icons.ts";
import { Badge } from "./primitives.tsx";
import { cn, isUrl } from "./utils.ts";
import type { FigureProps, LogEntry, LogProps, RecordItem, RecordProps } from "./records.tsx";

const LINK = "text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary";

/** A link to another artifact here (or a page anchor) opens in this tab; anything else in a new one. */
function linkProps(url: string) {
  const internal = url.startsWith("/") || url.startsWith("#") || store.linkTitle(url) !== null;
  return internal ? { href: url } : { href: url, target: "_blank", rel: "noopener noreferrer" };
}

/** A data file's contents, re-read when the page's files change. */
function useDataFile(path: string): unknown {
  useSyncExternalStore(store.subscribe, store.getBoot);
  return store.getData(path);
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="px-5 pt-4 pb-3 font-semibold text-balance">{children}</div>;
}

// ---- Log --------------------------------------------------------------------------

const TONES = {
  positive: { icon: Check, word: "Good news", className: "text-positive" },
  caution: { icon: TriangleAlert, word: "Caution", className: "text-caution" },
  negative: { icon: OctagonAlert, word: "Problem", className: "text-negative" },
} as const;

const time = (date: string) => {
  const t = Date.parse(date);
  return Number.isNaN(t) ? -Infinity : t;
};

/** The entries newest first; undated ones last, in file order. */
export function sortLog(entries: unknown): LogEntry[] {
  if (!Array.isArray(entries)) throw new Error("A Log's data is an array of { date, title, body?, tone?, tags? }");
  return entries
    .filter((e): e is LogEntry => e !== null && typeof e === "object" && typeof (e as LogEntry).title === "string")
    .map((e, i) => ({ e, i, t: time(String(e.date ?? "")) }))
    .sort((a, b) => b.t - a.t || a.i - b.i)
    .map(({ e }) => e);
}

function formatDate(date: string): string {
  // A bare date ("2026-10-24") is that calendar day wherever the reader is, not UTC midnight.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", ...(dateOnly ? { timeZone: "UTC" } : {}) });
}

export function LogImpl({ data = "log.json", title, show = 5, className }: LogProps) {
  const entries = sortLog(useDataFile(data));
  const [expanded, setExpanded] = React.useState(false);
  const listId = React.useId();
  const limit = Math.max(1, Math.floor(show));
  const visible = expanded ? entries : entries.slice(0, limit);
  const hidden = entries.length - limit;
  return (
    <div className={cn("my-6 rounded-xl border border-border bg-card shadow-card", className)}>
      {title && <Heading>{title}</Heading>}
      {entries.length === 0 ? (
        <p className={cn("px-5 py-6 text-center text-muted-foreground", title && "border-t border-border")}>Nothing logged yet.</p>
      ) : (
        <ol id={listId} className={cn("divide-y divide-border/70", title && "border-t border-border")}>
          {visible.map((e, i) => {
            const tone = e.tone && e.tone !== "neutral" ? TONES[e.tone] : null;
            return (
              <li key={i} className="grid gap-x-4 gap-y-0.5 px-5 py-3 sm:grid-cols-[8.5rem_minmax(0,1fr)]">
                <time dateTime={e.date} className="text-[13px] leading-6 text-muted-foreground tabular-nums">
                  {formatDate(String(e.date ?? ""))}
                </time>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className={cn("font-medium leading-6 break-words", tone?.className)}>
                      {tone && (
                        <>
                          <tone.icon aria-hidden className="mr-1.5 inline size-4 -translate-y-px" />
                          <span className="sr-only">{tone.word}: </span>
                        </>
                      )}
                      {e.title}
                    </span>
                    {Array.isArray(e.tags) && e.tags.map((t) => <Badge key={String(t)}>{String(t)}</Badge>)}
                  </div>
                  {e.body && <p className="mt-0.5 text-[15px] leading-relaxed break-words whitespace-pre-line text-muted-foreground">{e.body}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {hidden > 0 && (
        // Like an accordion: opening shows the rest, closing takes them away at once.
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((x) => !x)}
          className="w-full cursor-pointer rounded-b-[inherit] border-t border-border px-5 py-2.5 text-left text-sm font-medium text-primary transition-colors outline-none hover:bg-muted/40 focus-visible:focus-halo active:bg-muted/60"
        >
          {expanded ? "Show fewer" : `Show ${hidden} earlier`}
        </button>
      )}
    </div>
  );
}

// ---- Record -----------------------------------------------------------------------

/** [{ label, value, url? }] or { label: value }, as a list of items. */
export function recordItems(raw: unknown): RecordItem[] {
  if (Array.isArray(raw)) {
    return raw
      .filter((r): r is RecordItem => r !== null && typeof r === "object" && "label" in r)
      .map((r) => ({ label: String(r.label), value: r.value, ...(typeof r.url === "string" ? { url: r.url } : {}) }));
  }
  if (raw && typeof raw === "object") return Object.entries(raw).map(([label, value]) => ({ label, value }));
  throw new Error("A Record's items are [{ label, value, url? }] or { label: value }");
}

export function RecordImpl({ data, items, title, className }: RecordProps) {
  useSyncExternalStore(store.subscribe, store.getBoot);
  const list = recordItems(data === undefined ? (items ?? []) : store.getData(data));
  return (
    <div className={cn("my-6 rounded-xl border border-border bg-card shadow-card", className)}>
      {title && <Heading>{title}</Heading>}
      <dl className={cn("divide-y divide-border/70", title && "border-t border-border")}>
        {list.map((it, i) => {
          const text = it.value === null || it.value === undefined || it.value === "" ? null : Array.isArray(it.value) ? it.value.join(", ") : String(it.value);
          const url = it.url ?? (text && isUrl(text) ? text : null);
          return (
            <div key={i} className="grid gap-x-4 gap-y-0.5 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
              <dt className="text-[13px] leading-6 break-words text-muted-foreground sm:text-sm">{it.label}</dt>
              <dd className="min-w-0 text-[15px] leading-6 break-words">
                {text === null ? (
                  <span className="text-muted-foreground/60">—</span>
                ) : url ? (
                  <a {...linkProps(url)} className={LINK}>
                    {text}
                  </a>
                ) : (
                  text
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

// ---- Figure -----------------------------------------------------------------------

export function FigureImpl({ src, alt, caption, credit, creditUrl, className }: FigureProps) {
  useSyncExternalStore(store.subscribe, store.getBoot);
  const url = store.assetUrl(src);
  const [open, setOpen] = React.useState(false);
  return (
    <figure className={cn("my-6 max-w-full", className)}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label={`Enlarge image: ${alt}`}
        className="block max-w-full cursor-zoom-in rounded-lg outline-none focus-visible:focus-halo"
      >
        <img src={url} alt={alt} loading="lazy" decoding="async" className="block h-auto max-w-full rounded-lg border border-border" />
      </button>
      {(caption || credit) && (
        <figcaption className="mt-2 text-[14px] leading-snug text-muted-foreground">
          {caption}
          {credit && (
            <span className={cn("block text-[13px]", caption && "mt-0.5")}>
              Credit:{" "}
              {creditUrl ? (
                <a {...linkProps(creditUrl)} className={LINK}>
                  {credit}
                </a>
              ) : (
                credit
              )}
            </span>
          )}
        </figcaption>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-auto max-w-[calc(100vw-2rem)] gap-3 p-3 pt-12 sm:max-w-[min(calc(100vw-4rem),72rem)]">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <img src={url} alt={alt} className="mx-auto block max-h-[calc(100dvh-8rem)] w-auto max-w-full rounded-md object-contain" />
          {caption && <p className="text-[14px] text-muted-foreground">{caption}</p>}
        </DialogContent>
      </Dialog>
    </figure>
  );
}
