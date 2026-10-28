import * as React from "react";
import type { DiagramStep, StepState } from "../../shared/diagram-steps.ts";
import { ErrorBoundary } from "./error.tsx";
import { Button, Skeleton } from "./primitives.tsx";
import { cn } from "./utils.ts";

const DiagramImpl = React.lazy(() => import("./diagram-impl.tsx"));
// The step bar rides in the same lazy chunk, so pages without stepped diagrams carry none of it.
const StepBar = React.lazy(() => import("./diagram-impl.tsx").then((m) => ({ default: m.StepBar })));

export type { DiagramStep };

export type DiagramProps = {
  /** Mermaid source. Children work too: <Diagram>{`flowchart LR …`}</Diagram>. */
  code?: string;
  children?: React.ReactNode;
  title?: React.ReactNode;
  className?: string;
  /** Node ids to light (space-separated); the rest of the diagram fades back. A subgraph's id lights all of it. */
  focus?: string;
  /**
   * Walk the reader through the diagram a part at a time: a bar under it shows "Step 2 of 5", Previous / Next /
   * All, and the step's title and text, and each step lights its `focus` (and the edges between lit nodes).
   * Replaces `focus`. Listen reads the current step's text.
   */
  steps?: DiagramStep[];
};

export type DiagramShow = "before" | "both" | "after";

/** Nodes marked `:::added`, `:::changed` or `:::removed` (or `class A added`) make a "what changed" diagram. */
export const MARKED = /(?::::|\bclass\s+[\w,-]+\s+)(added|changed|removed)\b/;

/** A Mermaid diagram (flowchart, sequence, state, ER, class, gantt, mindmap…) rendered by Pele. */
export function Diagram(props: DiagramProps) {
  return (
    <ErrorBoundary label="Diagram" report>
      <DiagramInner {...props} />
    </ErrorBoundary>
  );
}

const CARD = "my-6 rounded-xl border border-border bg-card p-4 shadow-card";

function DiagramInner({ code, children, title, className, focus, steps }: DiagramProps) {
  const source = (code ?? textOf(children)).trim();
  const stepped = !!steps?.length;
  // A focused diagram is a detail of one already shown whole, so only the whole one offers the switch.
  const marked = (stepped || !focus) && MARKED.test(source);
  const [show, setShow] = React.useState<DiagramShow>("both");
  const [step, setStep] = React.useState<StepState>({ at: 0, all: false });
  const current = stepped ? steps[Math.min(step.at, steps.length - 1)] : undefined;
  const lit = stepped ? (step.all ? undefined : current?.focus) : focus;

  const figure = (
    <figure className={cn(stepped ? "m-0" : CARD, !stepped && className)} data-speak="diagram">
      {title && <figcaption className="mb-3 px-1 text-sm font-medium">{title}</figcaption>}
      {marked && <ShowSwitch show={show} onShow={setShow} />}
      <React.Suspense fallback={<Skeleton className="h-48" />}>
        <DiagramImpl code={source} show={show} focus={lit} steps={stepped ? steps : undefined} />
      </React.Suspense>
    </figure>
  );
  if (!stepped) return figure;
  // The bar sits outside the figure: Listen reads a figure as "A diagram", and the step's words should be heard.
  return (
    <div className={cn(CARD, className)}>
      {figure}
      <React.Suspense fallback={null}>
        <StepBar steps={steps} state={step} onState={setStep} />
      </React.Suspense>
    </div>
  );
}

/** The key to the marks, and a switch between the system before the change, both, and after. */
export function ShowSwitch({ show, onShow }: { show: DiagramShow; onShow: (s: DiagramShow) => void }) {
  const id = React.useId();
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-1" data-speak="skip">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
        <span><b className="font-mono text-positive" aria-hidden="true">+</b> new</span>
        <span><b className="font-mono text-caution" aria-hidden="true">~</b> changed</span>
        <span><b className="font-mono text-negative" aria-hidden="true">−</b> removed</span>
      </div>
      <div className="flex items-center gap-2">
        <span id={id} className="text-[13px] text-muted-foreground">Show</span>
        <div role="group" aria-labelledby={id} className="inline-flex rounded-lg border border-border p-0.5">
          {(["before", "both", "after"] as const).map((s) => (
            <Button key={s} size="sm" variant={show === s ? "secondary" : "ghost"} aria-pressed={show === s} onClick={() => onShow(s)} className="h-7 rounded-[6px] px-2.5 capitalize">
              {s}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}
