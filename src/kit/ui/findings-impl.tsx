// The body of <Findings>: an audit or review told in a fixed order (the question and its answer, where things
// stand, impact against effort, the ranked findings, what isn't worth doing, how it was measured, the long
// table), so a reader who has seen one knows where to look in the next. Loaded lazily; only audits download it.
import * as React from "react";
import {
  checkFindings,
  findingsQuadrant,
  rankFindings,
  statusRollup,
  type Confidence,
  type Effort,
  type Finding,
  type FindingStatus,
  type FindingsData,
  type Impact,
} from "../../shared/findings.ts";
import { useData } from "../hooks.ts";
import * as store from "../store.ts";
import { Diagram } from "./diagram.tsx";
import { ChevronDown } from "./icons.ts";
import { Callout, Link, Section, Summary } from "./layout.tsx";
import { DeltaImpl } from "./numbers-impl.tsx";
import { Badge, type BadgeProps } from "./primitives.tsx";
import { Table } from "./table.tsx";
import { cn } from "./utils.ts";

type Tone = BadgeProps["tone"];
type Word = { sign: string; word: string; tone: Tone };

// Every level is a word with a sign, so the badge's colour never carries the meaning alone.
const IMPACT: Record<Impact, Word> = {
  high: { sign: "↑", word: "High impact", tone: "neutral" },
  medium: { sign: "→", word: "Medium impact", tone: "neutral" },
  low: { sign: "↓", word: "Low impact", tone: "neutral" },
};
const EFFORT: Record<Effort, Word> = {
  small: { sign: "◔", word: "Small effort", tone: "outline" },
  medium: { sign: "◑", word: "Medium effort", tone: "outline" },
  large: { sign: "●", word: "Large effort", tone: "outline" },
};
const CONFIDENCE: Record<Confidence, Word> = {
  measured: { sign: "✓", word: "Measured", tone: "positive" },
  estimated: { sign: "≈", word: "Estimated", tone: "neutral" },
  guess: { sign: "?", word: "Guess", tone: "caution" },
};
const STATUS: Record<FindingStatus, Word & { count: string }> = {
  open: { sign: "○", word: "Open", tone: "outline", count: "open" },
  doing: { sign: "◐", word: "Doing", tone: "neutral", count: "doing" },
  shipped: { sign: "✓", word: "Shipped", tone: "positive", count: "shipped" },
  skipped: { sign: "–", word: "Skipped", tone: "neutral", count: "skipped" },
  // Iris is the reader's colour: this one waits on them.
  decide: { sign: "◆", word: "Your call", tone: "primary", count: "your call" },
};

function Tag({ w, className }: { w: Word; className?: string }) {
  return (
    <Badge tone={w.tone} className={className}>
      <span aria-hidden="true">{w.sign}</span>
      {w.word}
    </Badge>
  );
}

export default function FindingsImpl({ data: path }: { data: string }) {
  const g = useData<FindingsData>(path);
  const boot = React.useSyncExternalStore(store.subscribe, store.getBoot);
  const problems = checkFindings(g, boot?.data ? Object.keys(boot.data) : undefined);
  if (problems.length) {
    // The Worker refuses these on write; this only shows when the page was saved before a check existed.
    return (
      <Callout tone="danger" title="These findings' data is incomplete">
        <ul className="list-disc pl-5 text-[14px]">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      </Callout>
    );
  }
  const ranked = rankFindings(g.findings);
  const rollup = statusRollup(g.findings);

  return (
    <div className="art-findings" data-key-scope="">
      <Summary className="mb-3">
        <p className="text-[15px] leading-normal text-muted-foreground" data-key-stop="">{g.question}</p>
        <p data-key-stop="">{g.answer}</p>
      </Summary>
      <p className="mb-8 flex flex-wrap gap-x-2 gap-y-1 px-1 text-[14px] text-muted-foreground tabular-nums" data-key-stop="">
        {rollup.map((r, i) => (
          <span key={r.status} className="whitespace-nowrap">
            {i > 0 && <span aria-hidden="true" className="mr-2">·</span>}
            <span aria-hidden="true" className={cn("mr-1", r.status === "shipped" && "text-positive", r.status === "decide" && "text-primary")}>
              {STATUS[r.status].sign}
            </span>
            <span className={cn(r.status === "decide" && "font-medium text-foreground")}>
              {r.count} {STATUS[r.status].count}
            </span>
          </span>
        ))}
      </p>

      <Section title={<KeyHeading>Impact against effort</KeyHeading>}>
        <Diagram code={findingsQuadrant(ranked)} className="my-0 p-3" />
      </Section>

      <Section title={<KeyHeading>Findings</KeyHeading>}>
        <ol className="divide-y divide-border rounded-xl border border-border bg-card shadow-card">
          {ranked.map((f, i) => (
            <FindingRow key={f.id} f={f} rank={i + 1} />
          ))}
        </ol>
      </Section>

      {g.notWorth && g.notWorth.length > 0 && (
        <details className="mt-8 rounded-xl border border-border">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2.5 font-semibold outline-none focus-visible:focus-halo [&::-webkit-details-marker]:hidden" data-key-stop="">
            <span>
              Not worth doing <span className="font-normal text-muted-foreground tabular-nums">({g.notWorth.length})</span>
            </span>
            <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground [[open]>summary>&]:rotate-180" />
          </summary>
          <ul className="divide-y divide-border border-t border-border">
            {g.notWorth.map((n, i) => (
              <li key={i} className="px-4 py-2.5 text-[15px]" data-key-stop="">
                <span className="font-medium">{n.title}</span>
                <span className="block text-muted-foreground">{n.why}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Section title={<KeyHeading>How this was measured</KeyHeading>}>
        <Method m={g.method} />
      </Section>

      {g.inventory && (
        <Section title={<KeyHeading>{g.inventory.title}</KeyHeading>}>
          {/* A table, not phone cards: an inventory is read across rows, and ten cards of eleven fields is ten screens. */}
          <div data-key-stop="">
            <Table data={g.inventory.data} columns={g.inventory.columns} limit={g.inventory.top ?? 10} cards="never" className="my-0" />
          </div>
        </Section>
      )}
    </div>
  );
}

function FindingRow({ f, rank }: { f: Finding; rank: number }) {
  const status = STATUS[f.status ?? "open"];
  const done = f.status === "shipped" || f.status === "skipped";
  return (
    <li id={`finding-${f.id}`} className="scroll-mt-20">
      <details className="group">
        <summary className="flex cursor-pointer list-none gap-3 rounded-xl px-4 py-3 outline-none focus-visible:focus-halo [&::-webkit-details-marker]:hidden" data-key-stop="">
          <span className="w-5 shrink-0 pt-px text-right text-[15px] font-semibold text-muted-foreground tabular-nums">{rank}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="flex items-start justify-between gap-2">
              <span className={cn("min-w-0 text-[15px] leading-snug font-semibold text-balance", done && "text-muted-foreground")}>{f.title}</span>
              <Tag w={status} className="shrink-0" />
            </span>
            <span className="flex flex-wrap gap-1.5">
              <Tag w={IMPACT[f.impact]} />
              <Tag w={EFFORT[f.effort]} />
              <Tag w={CONFIDENCE[f.confidence]} />
            </span>
          </span>
          <ChevronDown aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground group-open:rotate-180" />
        </summary>
        <div className="pr-4 pb-4 pl-12">
          <dl className="flex flex-col gap-2.5 text-[15px]">
            <Field label="Change">{f.change}</Field>
            <Field label="Benefit">{f.benefit}</Field>
            {f.validate && <Field label="Validate">{f.validate}</Field>}
          </dl>
          {f.metrics && f.metrics.length > 0 && (
            <div data-key-stop="">
              <DeltaImpl rows={f.metrics} />
            </div>
          )}
          {(f.owner || f.link) && (
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[14px] text-muted-foreground" data-key-stop="">
              {f.owner && <span>Owner: <span className="text-foreground">{f.owner}</span></span>}
              {f.link && <Link href={f.link.url}>{f.link.label}</Link>}
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

/** A Section's title as a stop for the keys: a block filling the heading, so the cursor outlines the whole line. */
function KeyHeading({ children }: { children: React.ReactNode }) {
  return (
    <span className="block" data-key-stop="">
      {children}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] tracking-[0.05em] text-muted-foreground uppercase">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div data-key-stop="">
      <dt>
        <Label>{label}</Label>
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function Method({ m }: { m: FindingsData["method"] }) {
  const facts = (
    [
      ["Window", m.window],
      ["Sample", m.sample],
      ["Setup", m.setup],
      ["Version", m.head],
    ] as const
  ).filter(([, v]) => v);
  return (
    <div className="rounded-xl border border-border bg-card shadow-card">
      <dl className="divide-y divide-border/70">
        {facts.map(([label, value]) => (
          <div key={label} className="grid gap-x-4 gap-y-0.5 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-key-stop="">
            <dt className="text-[13px] leading-6 text-muted-foreground sm:text-sm">{label}</dt>
            <dd className={cn("min-w-0 text-[15px] leading-6 break-words", label === "Version" && "font-mono text-[14px]")}>{value}</dd>
          </div>
        ))}
        {m.sources && m.sources.length > 0 && (
          <div className="grid gap-x-4 gap-y-0.5 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-key-stop="">
            <dt className="text-[13px] leading-6 text-muted-foreground sm:text-sm">Sources</dt>
            <dd className="min-w-0 text-[15px] leading-6">
              <ul className="flex flex-col gap-1">
                {m.sources.map((s, i) => (
                  <li key={i} className="break-words">
                    <Link href={s.url}>{s.label}</Link>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        {m.caveats && m.caveats.length > 0 && (
          <div className="grid gap-x-4 gap-y-0.5 px-5 py-2.5 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" data-key-stop="">
            <dt className="text-[13px] leading-6 text-muted-foreground sm:text-sm">Caveats</dt>
            <dd className="min-w-0 text-[15px] leading-6">
              <ul className="list-disc pl-4 marker:text-muted-foreground">
                {m.caveats.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
