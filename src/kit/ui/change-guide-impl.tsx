// The body of <ChangeGuide>: a code change told for someone with no context, always in the same order so a
// reader who has seen one knows where to look in the next. Loaded lazily; only guides download it. Blocks for
// the optional fields (metrics, shots, verify, decide…) appear only when the guide has them: the point of the
// format is that it packs a lot into little.
import * as React from "react";
import {
  checkChangeGuide,
  groupFiles,
  mapSteps,
  proofStatus,
  slug,
  takeLines,
  type ChangeGuideData,
  type FileItem,
  type GuideFile,
  type GuideProof,
  type GuideShot,
} from "../../shared/change-guide.ts";
import { canMove, stepTo, type StepState } from "../../shared/diagram-steps.ts";
import { useData } from "../hooks.ts";
import { useKeyWidget } from "../key-widget.ts";
import { Decision } from "./decision.tsx";
import { Diagram, MARKED, ShowSwitch, type DiagramShow } from "./diagram.tsx";
import DiagramImpl, { StepBar } from "./diagram-impl.tsx";
import { Diff } from "./diff.tsx";
import { Callout, Link, Section, Step, Steps } from "./layout.tsx";
import { Delta } from "./numbers.tsx";
import { Badge, Button, Skeleton } from "./primitives.tsx";
import { Figure } from "./records.tsx";
import { cn } from "./utils.ts";

const RISK_TONE = { low: "positive", medium: "caution", high: "negative" } as const;
const ASK = { approve: "Approve", try: "Try it first", decide: "Decide" } as const;
const ENV = { local: "local", ci: "CI", staging: "staging", prod: "production" } as const;
/** A stop's files past this many fold behind "Show all"; folded, it shows FOLDED_SHOWN of them. */
const FOLD_PAST = 8;
const FOLDED_SHOWN = 6;
/** Up to this many files (with no mirrored copies) sit in a row of chips rather than a list. */
const CHIPS_UP_TO = 3;

const scrollBehavior = (): ScrollBehavior => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

export default function ChangeGuideImpl({ data: path }: { data: string }) {
  const g = useData<ChangeGuideData>(path);
  const problems = checkChangeGuide(g);
  // The map's step state lives here, so a stop's "On the map" can select its step.
  const [step, setStep] = React.useState<StepState>({ at: 0, all: true });
  const mapRef = React.useRef<HTMLDivElement>(null);
  if (problems.length) {
    // The Worker refuses these on write; this only shows when the page was saved before a check existed.
    return (
      <Callout tone="danger" title="This change guide's data is incomplete">
        <ul className="list-disc pl-5 text-[14px]">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
      </Callout>
    );
  }
  const byPath = new Map(g.files.map((f) => [f.path, f]));
  const filesOf = (paths: string[]) => paths.map((p) => byPath.get(p)!);
  const add = g.files.reduce((n, f) => n + (f.add ?? 0), 0);
  const del = g.files.reduce((n, f) => n + (f.del ?? 0), 0);
  const { steps, stepOf } = mapSteps(g.stops);
  const showOnMap = (i: number) => {
    const at = stepOf.get(i);
    if (at === undefined) return;
    setStep({ at, all: false });
    mapRef.current?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
  };
  const ran = g.proof.filter((p) => p.ran);
  const notRun = g.proof.filter((p) => !p.ran);
  const links = [...(g.url ? [{ label: "Open the change", url: g.url }] : []), ...(g.links ?? [])];

  return (
    <div className="art-change-guide" data-key-scope="">
      <section aria-label="Verdict" className="my-6 overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div className="px-5 pt-5 pb-4" data-key-stop="">
          <p className="text-[1.2rem] leading-snug font-semibold text-balance">{g.outcome}</p>
          <p className="mt-2 text-[14px] text-muted-foreground">{g.where}</p>
        </div>
        {/* Three columns from 640 px; on a phone, one fact per row so none is squeezed. */}
        <dl
          className={cn(
            "grid grid-cols-1 divide-y divide-border border-y border-border text-sm sm:divide-x sm:divide-y-0",
            g.riskWhy ? "sm:grid-cols-[1.6fr_1fr_1fr]" : "sm:grid-cols-3",
          )}
        >
          <Cell label="Risk">
            <Badge tone={RISK_TONE[g.risk]}>{g.risk}</Badge>
            {g.riskWhy && <span className="mt-1 block text-[13px] leading-snug text-muted-foreground">{g.riskWhy}</span>}
          </Cell>
          <Cell label="Size">
            <span className="tabular-nums">
              {g.files.length} {g.files.length === 1 ? "file" : "files"} ·{" "}
              <span className="whitespace-nowrap">
                <span className="text-positive">+{add}</span> <span className="text-negative">−{del}</span>
              </span>
            </span>
          </Cell>
          <Cell label="Revert">{g.revert}</Cell>
        </dl>
        <div className="px-5 py-4" data-key-stop="">
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
          {links.length > 0 && (
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
              {links.map((l, i) => (
                <Link key={i} href={l.url}>
                  {l.label}
                </Link>
              ))}
            </p>
          )}
        </div>
      </section>

      {g.decide && <Decision id="guide" question={g.decide.question} options={g.decide.options} recommended={g.decide.recommended} />}

      {g.lookHere && g.lookHere.length > 0 && (
        <section aria-labelledby="only-you-can-judge" className="my-6">
          <h2 id="only-you-can-judge" className="mb-2 scroll-mt-20 font-display text-[1.15rem] font-semibold" data-key-stop="">
            <span aria-hidden="true" className="mr-1.5 text-caution">?</span>Only you can judge
          </h2>
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {g.lookHere.map((l, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-[15px]" data-key-stop="">
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

      <div id="before-and-after" className="scroll-mt-20">
        <dl className="my-6 divide-y divide-border rounded-lg border border-border">
          <Row label="Before">{g.before}</Row>
          <Row label="After">{g.after}</Row>
        </dl>
        {g.metrics && g.metrics.length > 0 && (
          <div data-key-stop="">
            <Delta
            rows={g.metrics}
            title={
              <>
                Measured
                {g.metricsNote && <span className="mt-0.5 block text-[13px] font-normal text-muted-foreground">{g.metricsNote}</span>}
              </>
            }
            />
          </div>
        )}
        {g.shots?.map((s, i) => <Shot key={i} shot={s} />)}
      </div>

      <Section title={<Heading>The picture</Heading>}>
        {steps.length ? (
          <SteppedMap ref={mapRef} code={g.map} steps={steps} state={step} onState={setStep} />
        ) : (
          <Diagram code={g.map} className="my-0" />
        )}
      </Section>

      <Section title={<Heading>Step by step</Heading>}>
        <Steps>
          {g.stops.map((s, i) => (
            <StopCard key={i} onMap={stepOf.has(i) ? () => showOnMap(i) : undefined}>
              <Step
                title={
                  <span id={`step-${i + 1}`} className="block scroll-mt-20" data-key-stop="">
                    {s.title}
                  </span>
                }
              >
                <div className="mt-1.5">
                  <Files files={filesOf(s.files)} />
                </div>
                <p className="mt-2" data-key-stop="">
                  {s.why}
                </p>
                {s.diff && (
                  <div data-key-stop="">
                    <Diff file={s.diff.file} code={s.diff.lines} className="my-3" />
                  </div>
                )}
                {stepOf.has(i) && (
                  <button
                    type="button"
                    onClick={() => showOnMap(i)}
                    data-speak="skip"
                    className="mt-1 inline-flex min-h-6 items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[13px] text-foreground transition-colors outline-none hover:bg-muted focus-visible:focus-halo active:bg-input/40"
                  >
                    On the map
                    <span aria-hidden="true" className="text-muted-foreground">↑</span>
                  </button>
                )}
              </Step>
            </StopCard>
          ))}
        </Steps>
      </Section>

      <Section title={<Heading>Checked</Heading>}>
        {g.proof.length === 0 && <p className="rounded-lg border border-border px-4 py-2.5 text-[15px] text-muted-foreground" data-key-stop="">
            Nothing was checked.
          </p>}
        {ran.length > 0 && <Proofs label={notRun.length ? "Ran" : undefined} proofs={ran} head={g.head} />}
        {notRun.length > 0 && <Proofs label={ran.length ? "Not run" : undefined} proofs={notRun} head={g.head} />}
        {g.alsoTouched && g.alsoTouched.length > 0 && (
          <details className="mt-4 rounded-lg border border-border px-4 py-2.5 text-[15px]">
            <summary className="cursor-pointer rounded py-0.5 outline-none focus-visible:focus-halo" data-key-stop="">Also touched ({g.alsoTouched.length})</summary>
            <div className="mt-2">
              <Files files={filesOf(g.alsoTouched)} />
            </div>
          </details>
        )}
      </Section>

      {g.verify && (
        <Section title={<Heading>After it ships</Heading>}>
          <div className="rounded-lg border border-border px-4 py-3 text-[15px]" data-key-stop="">
            <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-muted-foreground">
              {g.verify.steps.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
            <p className="mt-2.5 border-t border-border pt-2.5">
              <Label>Expected</Label> <span className="ml-1">{g.verify.expected}</span>
            </p>
          </div>
        </Section>
      )}
    </div>
  );
}

/** A stop of the walk-through. Enter anywhere in it does what its "On the map" chip does, when it has one. */
function StopCard({ onMap, children }: { onMap?: () => void; children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);
  useKeyWidget(ref, {
    enter: () => {
      if (!onMap) return false;
      onMap();
      return true;
    },
  });
  return <div ref={ref}>{children}</div>;
}

/** A section heading that can be linked to: its id is the heading in kebab case. */
function Heading({ children }: { children: string }) {
  return (
    // A block, so the keys' cursor outlines the heading's line.
    <span id={slug(children)} className="block scroll-mt-20" data-key-stop="">
      {children}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-[12px] tracking-[0.05em] text-muted-foreground uppercase">{children}</span>;
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3 px-4 py-2.5 sm:flex-col sm:items-stretch sm:gap-1 sm:py-3" data-key-stop="">
      <dt className="w-14 shrink-0 sm:w-auto">
        <Label>{label}</Label>
      </dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] gap-3 px-4 py-3" data-key-stop="">
      <dt className="pt-0.5">
        <Label>{label}</Label>
      </dt>
      <dd className="text-[15px]">{children}</dd>
    </div>
  );
}

// ---- The map ---------------------------------------------------------------------------------------------------

type MapProps = { code: string; steps: { focus: string; title: string; text: string }[]; state: StepState; onState: (s: StepState) => void };

/**
 * The guide's one picture, walked through stop by stop. <Diagram steps> keeps its step to itself, so this
 * puts the same parts together with the step held by the guide, which a stop's "On the map" can move.
 */
const SteppedMap = React.forwardRef<HTMLDivElement, MapProps>(function SteppedMap({ code, steps, state, onState }, ref) {
  const [show, setShow] = React.useState<DiagramShow>("both");
  const marked = MARKED.test(code);
  const lit = state.all ? undefined : steps[Math.min(state.at, steps.length - 1)]?.focus;
  // The page's h and l step through the map, as Previous and Next do.
  const own = React.useRef<HTMLDivElement | null>(null);
  useKeyWidget(own, {
    across: (dir) => {
      const m = dir > 0 ? "next" : "prev";
      if (!canMove(state, m, steps.length)) return false;
      onState(stepTo(state, m, steps.length));
      return true;
    },
  });
  const setRef = (el: HTMLDivElement | null) => {
    own.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  return (
    <div ref={setRef} className="scroll-mt-20 rounded-xl border border-border bg-card p-4 shadow-card" data-key-stop="">
      <figure className="m-0" data-speak="diagram">
        {marked && <ShowSwitch show={show} onShow={setShow} />}
        <React.Suspense fallback={<Skeleton className="h-48" />}>
          <DiagramImpl code={code} show={show} focus={lit} steps={steps} />
        </React.Suspense>
      </figure>
      <StepBar steps={steps} state={state} onState={onState} />
    </div>
  );
});

// ---- Screenshots -----------------------------------------------------------------------------------------------

/** A before/after pair: side by side from 640 px; on a phone one at a time, with a switch. */
function Shot({ shot }: { shot: GuideShot }) {
  const both = !!shot.before && !!shot.after;
  const [side, setSide] = React.useState<"before" | "after">("after");
  const id = React.useId();
  const sides = (["before", "after"] as const).filter((k) => shot[k]);
  return (
    <figure className="my-6" data-key-stop="">
      {both && (
        <div role="group" aria-labelledby={id} className="mb-2 flex items-center gap-2 sm:hidden" data-speak="skip">
          <span id={id} className="sr-only">Show</span>
          <div className="inline-flex rounded-lg border border-border p-0.5">
            {(["before", "after"] as const).map((k) => (
              <Button key={k} size="sm" variant={side === k ? "secondary" : "ghost"} aria-pressed={side === k} onClick={() => setSide(k)} className="h-7 rounded-[6px] px-2.5 capitalize">
                {k}
              </Button>
            ))}
          </div>
        </div>
      )}
      <div className={cn("grid gap-3", both && "sm:grid-cols-2")}>
        {sides.map((k) => (
          <div key={k} className={cn("min-w-0", both && side !== k && "max-sm:hidden")}>
            <Label>{k}</Label>
            <Figure src={shot[k]!} alt={`${shot.caption} (${k})`} className="mt-1 mb-0" />
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-[14px] leading-snug text-muted-foreground">{shot.caption}</figcaption>
    </figure>
  );
}

// ---- Proof -----------------------------------------------------------------------------------------------------

const VERDICT = {
  passed: { sign: "✓", word: "Passed", tone: "text-positive" },
  failed: { sign: "✕", word: "Failed", tone: "text-negative" },
  red: { sign: "✕", word: "Failed first", tone: "text-foreground" },
  "not-run": { sign: "○", word: "Not run", tone: "text-caution" },
} as const;

function Proofs({ label, proofs, head }: { label?: string; proofs: GuideProof[]; head: string }) {
  return (
    <div className="mb-4 last:mb-0">
      {label && (
        <p className="mb-1.5">
          <Label>{label}</Label>
        </p>
      )}
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {proofs.map((p, i) => {
          const s = proofStatus(p, head);
          const v = VERDICT[s.verdict];
          const bits: React.ReactNode[] = [];
          if (s.verdict === "red") bits.push("before the fix, as it should");
          if (p.expect === "fail" && s.verdict === "failed") bits.push("should have failed before the fix and didn't");
          if (p.ran) bits.push(`exit ${p.exit}`);
          if (p.count) bits.push(p.count);
          if (p.env) bits.push(ENV[p.env]);
          if (p.ran) bits.push(s.older ? `at ${p.head}, an older commit` : `at ${p.head}`);
          if (p.link) bits.push(<Link href={p.link}>the run</Link>);
          return (
            <li key={i} className="flex gap-3 px-4 py-2.5 text-[15px]" data-key-stop="">
              <span className={cn("w-[6.5rem] shrink-0 text-[13px] font-medium", v.tone)}>
                <span aria-hidden="true">{v.sign} </span>
                {v.word}
              </span>
              <span className="min-w-0">
                <span className={cn(p.ran && "font-mono text-[13.5px] break-words")}>{p.check}</span>
                {bits.length > 0 && (
                  <span className="block text-[13px] text-muted-foreground">
                    {bits.map((b, j) => (
                      <React.Fragment key={j}>
                        {j > 0 && " · "}
                        {b}
                      </React.Fragment>
                    ))}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---- Files -----------------------------------------------------------------------------------------------------

/**
 * A stop's files. A few sit in a row of chips; more become a list by directory, with mirrored copies shown
 * once, folded past FOLD_PAST lines behind "Show all". Directories are cut from the left, so the file name
 * always shows whole; tapping or focusing a line shows its path whole. Listen skips them: paths read aloud
 * are noise.
 */
function Files({ files }: { files: GuideFile[] }) {
  const groups = React.useMemo(() => groupFiles(files), [files]);
  const items = groups.flatMap((g) => g.items);
  const [open, setOpen] = React.useState(false);
  if (items.length <= CHIPS_UP_TO && !items.some((i) => i.roots)) {
    return (
      <ul className="flex flex-wrap gap-1.5" data-speak="skip" data-key-stop="">
        {items.map((f) => (
          <FileLine key={f.path} item={f} chip />
        ))}
      </ul>
    );
  }
  const folds = items.length > FOLD_PAST;
  const shown = folds && !open ? takeLines(groups, FOLDED_SHOWN) : groups;
  return (
    <div data-speak="skip" data-key-stop="">
      <ul className="flex flex-col gap-0.5 rounded-lg border border-border py-1">
        {shown.map((g) => {
          if (g.items.length === 1) return <FileLine key={g.dir + g.items[0]!.name} item={g.items[0]!} />;
          // Mirrored lines in one folder usually share their roots: say them once, on the folder.
          const roots = g.items[0]!.roots?.join("\0");
          const shared = !!roots && g.items.every((i) => i.roots?.join("\0") === roots);
          return (
            <li key={g.dir} className="min-w-0">
              <div tabIndex={0} title={g.dir} className="group flex min-h-6 items-end rounded-md px-3 pt-1 text-[12px] outline-none focus-visible:focus-halo">
                <span className="flex min-w-0 group-focus:flex-wrap">
                  <Dir text={g.dir} />
                </span>
                {shared && <Roots roots={g.items[0]!.roots!} />}
              </div>
              <ul className="flex flex-col">
                {g.items.map((f) => (
                  <FileLine key={f.path} item={f} nameOnly hideRoots={shared} />
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {folds && (
        // Closes at once: the list just gets shorter.
        <Button size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)} className="mt-1 -ml-2 px-2 text-muted-foreground">
          {open ? "Show fewer" : `Show all ${items.length} files`}
        </Button>
      )}
    </div>
  );
}

/**
 * A directory cut from the left (the end nearest the file matters most), whole when its line has focus. It
 * gives way first: its huge flex-shrink makes it absorb the squeeze before the file name does.
 */
function Dir({ text }: { text: string }) {
  if (!text) return null;
  return (
    <span className="min-w-0 shrink-1000 truncate text-left font-mono text-muted-foreground [direction:rtl] group-focus:shrink group-focus:basis-full group-focus:break-all group-focus:whitespace-normal group-focus:[direction:ltr]">
      <bdi dir="ltr">{text}</bdi>
    </span>
  );
}

function Roots({ roots }: { roots: string[] }) {
  return (
    <span className="block text-[12px] text-muted-foreground">
      under{" "}
      {roots.map((r, i) => (
        <React.Fragment key={r}>
          {i > 0 && (i === roots.length - 1 ? " and " : ", ")}
          <code className="font-mono">{r || "./"}</code>
        </React.Fragment>
      ))}
    </span>
  );
}

function FileLine({ item, chip, nameOnly, hideRoots }: { item: FileItem; chip?: boolean; nameOnly?: boolean; hideRoots?: boolean }) {
  const copies = item.paths.length;
  return (
    <li
      // Focusable so a tap (or Tab) can show a path cut short on a phone.
      tabIndex={0}
      title={item.paths.join("\n")}
      className={cn(
        "group min-w-0 text-[12.5px] outline-none focus-visible:focus-halo",
        chip ? "max-w-full rounded-md border border-border bg-muted/40 px-2 py-0.5" : cn("rounded-md py-1 pr-3", nameOnly ? "pl-6" : "pl-3"),
      )}
    >
      <span className="flex min-w-0 items-baseline gap-x-2">
        <span className={cn("flex min-w-0 font-mono group-focus:flex-wrap", !chip && "flex-1")}>
          {!nameOnly && <Dir text={item.dir} />}
          <span className="min-w-0 [overflow-wrap:anywhere]">{item.name}</span>
        </span>
        <span className={cn("shrink-0 whitespace-nowrap tabular-nums", !chip && "ml-auto")}>
          {copies > 1 && (
            <span className="mr-1.5 text-muted-foreground">
              <span aria-hidden="true">×{copies}</span>
              <span className="sr-only">, in {copies} places,</span>
            </span>
          )}
          {item.add != null && <span className="text-positive">+{item.add}</span>}
          {item.add != null && item.del != null && " "}
          {item.del != null && <span className="text-negative">−{item.del}</span>}
        </span>
      </span>
      {item.roots && !hideRoots && <Roots roots={item.roots} />}
    </li>
  );
}
