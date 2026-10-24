// The body of <ChangeGuide>: a code change told for someone with no context, always in the same order so a
// reader who has seen one knows where to look in the next. Loaded lazily; only guides download it.
import * as React from "react";
import { checkChangeGuide, type ChangeGuideData, type GuideFile } from "../../shared/change-guide.ts";
import { useData } from "../hooks.ts";
import { Diagram } from "./diagram.tsx";
import { Diff } from "./diff.tsx";
import { Callout, Link, Section, Step, Steps } from "./layout.tsx";
import { Badge } from "./primitives.tsx";
import { cn } from "./utils.ts";

const RISK_TONE = { low: "positive", medium: "caution", high: "negative" } as const;
const ASK = { approve: "Approve", try: "Try it first", decide: "Decide" } as const;

export default function ChangeGuideImpl({ data: path }: { data: string }) {
  const g = useData<ChangeGuideData>(path);
  const problems = checkChangeGuide(g);
  if (problems.length) {
    // The Worker refuses these on write; this only shows when the page was saved before a check existed.
    return (
      <Callout tone="danger" title="This change guide's data is incomplete">
        <ul className="list-disc pl-5 text-[14px]">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      </Callout>
    );
  }
  const byPath = new Map(g.files.map((f) => [f.path, f]));
  const add = g.files.reduce((n, f) => n + (f.add ?? 0), 0);
  const del = g.files.reduce((n, f) => n + (f.del ?? 0), 0);
  const chips = (paths: string[]) => (
    <div className="flex flex-wrap gap-1.5">{paths.map((p) => <FileChip key={p} file={byPath.get(p)!} />)}</div>
  );

  return (
    <div className="art-change-guide">
      <section aria-label="Verdict" className="my-6 overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="px-5 pt-5 pb-4">
          <p className="text-[1.2rem] leading-snug font-semibold text-balance">{g.outcome}</p>
          <p className="mt-2 text-[14px] text-muted-foreground">{g.where}</p>
        </div>
        <dl className="grid grid-cols-3 divide-x divide-border border-y border-border text-sm">
          <Cell label="Risk">
            <Badge tone={RISK_TONE[g.risk]}>{g.risk}</Badge>
          </Cell>
          <Cell label="Size">
            <span className="tabular-nums">
              {g.files.length} {g.files.length === 1 ? "file" : "files"} · <span className="text-positive">+{add}</span> <span className="text-negative">−{del}</span>
            </span>
          </Cell>
          <Cell label="Revert">{g.revert}</Cell>
        </dl>
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <p className="font-semibold">
              <span aria-hidden="true" className="mr-1.5 text-muted-foreground">→</span>
              {ASK[g.ask.kind]}
            </p>
            <span className="font-mono text-[12px] text-muted-foreground">describes {g.head}</span>
          </div>
          <p className="mt-1 text-[15px]">{g.ask.text}</p>
          {g.ask.steps && g.ask.steps.length > 0 && (
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-[15px] marker:text-muted-foreground">
              {g.ask.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
          {g.url && (
            <p className="mt-3 text-[14px]">
              <Link href={g.url}>Open the change</Link>
            </p>
          )}
        </div>
      </section>

      {g.lookHere && g.lookHere.length > 0 && (
        <section aria-labelledby="guide-judge" className="my-6">
          <h2 id="guide-judge" className="mb-2 text-base font-semibold">
            <span aria-hidden="true" className="mr-1.5 text-caution">?</span>Only you can judge
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {g.lookHere.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-[15px]">
                <span>{l.q}</span>
                <a href={`#step-${l.stop}`} className="shrink-0 rounded py-1 text-[13px] whitespace-nowrap text-primary underline underline-offset-2 outline-none focus-visible:focus-halo">
                  Step {l.stop}
                  <span aria-hidden="true"> ↓</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <dl className="my-6 divide-y divide-border rounded-lg border border-border">
        <Row label="Before">{g.before}</Row>
        <Row label="After">{g.after}</Row>
      </dl>

      <Section title="The change on one picture">
        <Diagram code={g.map} className="my-0" />
      </Section>

      <Section title="Step by step">
        <Steps>
          {g.stops.map((s, i) => (
            <Step key={i} title={<span id={`step-${i + 1}`} className="scroll-mt-20">{s.title}</span>}>
              <div className="mt-1.5">{chips(s.files)}</div>
              <p className="mt-2">{s.why}</p>
              {s.diff ? (
                <Diff file={s.diff.file} code={s.diff.lines} className="my-3" />
              ) : s.focus ? (
                <Diagram code={g.map} focus={s.focus} className="my-3 p-3 shadow-none" />
              ) : null}
            </Step>
          ))}
        </Steps>
      </Section>

      <Section title="Checked">
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {g.proof.length === 0 && <li className="px-4 py-2.5 text-[15px] text-muted-foreground">Nothing was checked.</li>}
          {g.proof.map((p, i) => {
            const elsewhere = p.ran && p.head !== g.head;
            const ok = p.ran && !elsewhere && p.exit === 0;
            const word = !p.ran ? "Not run" : elsewhere ? "Other commit" : p.exit === 0 ? "Passed" : "Failed";
            return (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-[15px]">
                <span className={cn("w-24 shrink-0 text-[13px] font-medium", ok ? "text-positive" : p.ran && !elsewhere ? "text-negative" : "text-caution")}>
                  <span aria-hidden="true">{ok ? "✓ " : p.ran && !elsewhere ? "✕ " : "○ "}</span>
                  {word}
                </span>
                <span className="min-w-0">
                  <span className={cn(p.ran && "font-mono text-[13.5px] break-words")}>{p.check}</span>
                  {p.ran && (
                    <span className="block text-[13px] text-muted-foreground">
                      exit {p.exit} at {p.head}
                      {elsewhere && `, not ${g.head}: run it again on this commit`}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
        {g.alsoTouched && g.alsoTouched.length > 0 && (
          <details className="mt-4 rounded-lg border border-border px-4 py-2.5 text-[15px]">
            <summary className="cursor-pointer rounded py-0.5 outline-none focus-visible:focus-halo">Also touched ({g.alsoTouched.length})</summary>
            <div className="mt-2">{chips(g.alsoTouched)}</div>
          </details>
        )}
      </Section>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] tracking-[0.05em] text-muted-foreground uppercase">{children}</span>;
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-3">
      <dt>
        <Label>{label}</Label>
      </dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-3 px-4 py-3">
      <dt className="pt-0.5">
        <Label>{label}</Label>
      </dt>
      <dd className="text-[15px]">{children}</dd>
    </div>
  );
}

function FileChip({ file }: { file: GuideFile }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[12.5px]">
      <span className="truncate font-mono">{file.path}</span>
      {file.add != null && <span className="text-positive tabular-nums">+{file.add}</span>}
      {file.del != null && <span className="text-negative tabular-nums">−{file.del}</span>}
    </span>
  );
}
