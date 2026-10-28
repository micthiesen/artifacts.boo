// Evidence: the bodies of <Sources>, <Cite>, <AsOf> and <Claim>, and the date and numbering rules behind them.
// Loaded lazily; only pages that cite, stamp or list sources download it.
import * as React from "react";
import { useSyncExternalStore } from "react";
import CircleHelp from "lucide-react/dist/esm/icons/circle-help.mjs";
import Clock from "lucide-react/dist/esm/icons/clock.mjs";
import Lightbulb from "lucide-react/dist/esm/icons/lightbulb.mjs";
import Quote from "lucide-react/dist/esm/icons/quote.mjs";
import * as store from "../store.ts";
import { useData } from "../hooks.ts";
import type { ClaimStatus } from "./evidence.tsx";
import { checkSources, parseDay, SOURCE_ID, SOURCE_KINDS, type Source, type SourceKind } from "../../shared/sources.ts";

export { checkSources, parseDay, SOURCE_ID, SOURCE_KINDS };
import { ChevronRight, CircleCheck, TriangleAlert } from "./icons.ts";
import { Callout } from "./layout.tsx";
import { Badge } from "./primitives.tsx";
import { cn, useNow } from "./utils.ts";

/** A source's number is its place in the file, from 1; 0 when the file doesn't have it. */
export function citeNumber(sources: readonly { id?: unknown }[], id: string): number {
  return sources.findIndex((s) => s?.id === id) + 1;
}

// ---- Dates ---------------------------------------------------------------------

const DAY = 86_400_000;

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** Whole calendar days from `then` to `now` (negative when `then` is later). */
export function daysBetween(then: Date, now: Date): number {
  return Math.round((startOfDay(now) - startOfDay(then)) / DAY);
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "4 months ago", "a year ago"; "in 3 days" ahead. */
export function relativeDay(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  const n = Math.abs(days);
  const [count, unit] = n < 14 ? [n, "day"] : n < 60 ? [Math.floor(n / 7), "week"] : n < 365 ? [Math.floor(n / 30.44), "month"] : [Math.floor(n / 365), "year"];
  const phrase = count === 1 ? `a ${unit}` : `${count} ${unit}s`;
  return days > 0 ? `${phrase} ago` : `in ${phrase}`;
}

export function absoluteDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export type Freshness = { checked: Date; relative: string; absolute: string; due: boolean; next: Date | null };

/** How fresh a check is: due for a recheck from the day `next` names onwards. Null when `checked` isn't a date. */
export function freshness(checked: unknown, next?: unknown, now: Date = new Date()): Freshness | null {
  const at = parseDay(checked);
  if (!at) return null;
  const due = parseDay(next);
  return { checked: at, relative: relativeDay(daysBetween(at, now)), absolute: absoluteDay(at), next: due, due: due !== null && daysBetween(due, now) >= 0 };
}

// ---- Components ----------------------------------------------------------------

/** A data file's rows, or null when it's missing or not a list: inline marks don't take the page down with them. */
function useSourceRows(path: string): Source[] | null {
  useSyncExternalStore(store.subscribe, store.getBoot);
  try {
    const v = store.getData(path);
    return Array.isArray(v) ? (v as Source[]) : null;
  } catch {
    return null;
  }
}

/** A mark that tells the author something is wrong, in place, with the word as well as the colour. */
function Broken({ text, why }: { text: string; why: string }) {
  return (
    <span className="rounded-sm border border-negative/60 px-1 text-[0.8em] font-medium text-negative" title={why} role="img" aria-label={why}>
      {text}
    </span>
  );
}

/** `[n]`, n being the source's place in the file, so it matches the list however often it's cited. */
export function CiteImpl({ id, data = "sources.json" }: { id: string; data?: string }) {
  const rows = useSourceRows(data);
  const n = rows ? citeNumber(rows, id) : 0;
  if (!n) return <Broken text={`[? ${id}]`} why={rows ? `No source "${id}" in ${data}` : `${data} is missing or isn't a list`} />;
  const source = rows![n - 1]!;
  return (
    // Listen leaves citations out: "one" in the middle of a sentence only gets in the way.
    <sup data-speak="skip" className="ml-px">
      <a
        href={`#source-${id}`}
        aria-label={`Source ${n}: ${source.title}`}
        // A closed <Sources> list would hide the row; open it before the frame scrolls there.
        onClick={() => document.getElementById(`source-${id}`)?.closest("details")?.setAttribute("open", "")}
        className="relative rounded-sm px-px text-[0.8em] font-medium text-primary tabular-nums underline underline-offset-2 outline-none after:absolute after:-inset-x-1 after:-inset-y-1.5 after:content-[''] focus-visible:focus-halo"
      >
        [{n}]
      </a>
    </sup>
  );
}

/** The absolute date stays visible beside the relative one: a title alone would be hover-only. */
export function AsOfImpl({ checked, next, scope, className }: { checked: string; next?: string; scope?: React.ReactNode; className?: string }) {
  const now = useNow(60 * 60_000);
  const f = freshness(checked, next, new Date(now));
  if (!f) return <Broken text="[date?]" why={`AsOf: "${checked}" isn't an ISO date like 2026-10-28`} />;
  const Icon = f.due ? TriangleAlert : Clock;
  const title = `Checked ${absoluteDay(f.checked)}${f.next ? `; ${f.due ? "was due for a recheck" : "next check"} ${absoluteDay(f.next)}` : ""}`;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-md border px-2 py-px align-baseline text-[13px] leading-5 tabular-nums",
        f.due ? "border-caution/30 bg-caution/10 text-caution" : "border-border bg-muted/60 text-foreground/90",
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0 self-center" />
      <span>
        Checked <time dateTime={checked}>{f.relative}</time>
      </span>
      <span className={f.due ? "text-caution/85" : "text-muted-foreground"}>· {f.absolute}</span>
      {scope && <span className={f.due ? "" : "text-muted-foreground"}>· {scope}</span>}
      {f.due && <span className="font-semibold">· Due for a recheck</span>}
    </span>
  );
}

const CLAIMS = {
  verified: { word: "Verified", icon: CircleCheck, tone: "text-positive", line: "decoration-positive/60" },
  reported: { word: "Reported", icon: Quote, tone: "text-muted-foreground", line: "decoration-muted-foreground/60" },
  inferred: { word: "Inferred", icon: Lightbulb, tone: "text-caution", line: "decoration-caution/60" },
  unknown: { word: "Unknown", icon: CircleHelp, tone: "text-negative", line: "decoration-negative/60" },
} as const satisfies Record<ClaimStatus, unknown>;

/** Icon and word together, so the status never rests on colour. */
export function ClaimImpl({ status, note, children, className }: { status: ClaimStatus; note?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const c = CLAIMS[status];
  if (!c) return <Broken text="[claim?]" why={`Claim: status is one of ${Object.keys(CLAIMS).join(", ")}`} />;
  const Icon = c.icon;
  const marker = (
    <span className={cn("inline-flex items-baseline gap-0.5 text-[0.82em] font-medium whitespace-nowrap", c.tone)}>
      <Icon aria-hidden className="size-[1.05em] shrink-0 self-center" />
      {c.word}
    </span>
  );
  return (
    <span className={cn("art-claim", className)} data-claim={status}>
      {children != null && children !== "" && (
        <>
          <span className={cn("underline decoration-dotted decoration-[1.5px] underline-offset-[3px]", c.line)}>{children}</span>{" "}
        </>
      )}
      {marker}
      {note && <span className="text-[0.82em] text-muted-foreground"> · {note}</span>}
    </span>
  );
}

// ---- Sources -------------------------------------------------------------------

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function SourcesImpl({ data: path, title, open }: { data: string; title: React.ReactNode; open: boolean }) {
  const rows = useData<Source[]>(path);
  const now = new Date(useNow(60 * 60_000));
  const problems = checkSources(rows);
  if (problems.length) {
    return (
      <Callout tone="danger" title={`${path} has problems`}>
        <ul className="list-disc pl-5 text-[14px]">{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul>
      </Callout>
    );
  }

  const list = (
    <ol className="divide-y divide-border">
      {rows.map((s, i) => {
        const f = s.checked ? freshness(s.checked, undefined, now) : null;
        const kind = s.kind ? SOURCE_KINDS[s.kind] : null;
        const site = s.url ? host(s.url) : "";
        return (
          <li key={s.id} id={`source-${s.id}`} className="flex scroll-mt-20 gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
            <span className="w-5 shrink-0 text-right text-[14px] leading-6 text-muted-foreground tabular-nums">{i + 1}.</span>
            <div className="min-w-0 flex-1 text-[15px] leading-6">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                {s.url ? (
                  // A plain link: the frame sends it to the shell, which opens it in a new tab.
                  <a href={s.url} className="font-medium [overflow-wrap:anywhere] text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:decoration-primary">
                    {s.title}
                  </a>
                ) : (
                  <span className="font-medium [overflow-wrap:anywhere]">{s.title}</span>
                )}
                {site && (
                  <span data-speak="skip" className="text-[13px] text-muted-foreground">
                    {site}
                  </span>
                )}
                {kind && (
                  <Badge tone={kind.tone} className="self-center">
                    {kind.label}
                  </Badge>
                )}
              </div>
              {s.note && <p className="text-[14px] text-muted-foreground">{s.note}</p>}
              {f && (
                <p className="text-[13px] text-muted-foreground tabular-nums">
                  Checked <time dateTime={s.checked}>{f.relative}</time> · {f.absolute}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );

  const count = `${rows.length} ${rows.length === 1 ? "source" : "sources"}`;
  if (!open) {
    return (
      <details className="art-sources group my-6 rounded-xl border border-border bg-card shadow-card">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl px-4 py-2.5 font-semibold outline-none select-none focus-visible:focus-halo [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          {title ?? "Sources"}
          <span className="font-normal text-muted-foreground tabular-nums">· {rows.length}</span>
        </summary>
        <div className="border-t border-border">{list}</div>
      </details>
    );
  }
  return (
    <section aria-label={typeof title === "string" ? title : count} className="art-sources my-6">
      {title && (
        <h2 className="mb-2 flex items-baseline gap-1.5 font-display text-[1.15rem] font-semibold">
          {title}
          <span className="font-normal text-muted-foreground tabular-nums">· {rows.length}</span>
        </h2>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">{list}</div>
    </section>
  );
}
