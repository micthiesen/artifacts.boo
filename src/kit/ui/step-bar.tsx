// The bar under something walked through a step at a time: a stepped diagram, a stepped scene. In a module of
// its own, so a scene's steps don't download Pele and a diagram's don't download three.js.
import * as React from "react";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import { canMove, stateAt, stepTo, type DiagramStep, type StateRow, type StepMove, type StepState } from "../../shared/diagram-steps.ts";
import { Button } from "./primitives.tsx";
import { cn } from "./utils.ts";

/** What the bar shows of a step: its words and, for a diagram, the values its nodes hold. */
export type BarStep = Pick<DiagramStep, "title" | "text" | "state">;

/**
 * The bar under a stepped diagram or scene: Previous, where the reader is, All (a diagram's every node at once;
 * a scene has no such state, so `all` is false there), Next, then the step's title and text. Arrow keys move
 * while focus is in the bar (Home and End go to the ends). The words swap plainly; nothing in the bar slides.
 * `onState` is also told whether a key made the move: what the picture does about that is its own business.
 */
export function StepBar({ steps, state, onState, all = true }: { steps: readonly BarStep[]; state: StepState; onState: (s: StepState, byKey: boolean) => void; all?: boolean }) {
  const count = steps.length;
  const step = steps[Math.min(state.at, count - 1)]!;
  const rows = React.useMemo(() => stateAt(steps, state.all ? count - 1 : Math.min(state.at, count - 1)), [steps, state, count]);
  // The live region says what this step changed, so moving on announces it; the list below is there to browse.
  const changes = rows
    ?.filter((r) => r.was !== undefined || r.added)
    .map((r) => `${r.node}.${r.name} ${r.was !== undefined ? `was ${r.was}, now` : "is"} ${r.value}`)
    .join("; ");
  const move = (m: StepMove, byKey: boolean) => onState(stepTo(state, m, count), byKey);
  const KEYS: Record<string, StepMove> = { ArrowLeft: "prev", ArrowRight: "next", Home: "first", End: "last" };
  const onKeyDown = (e: React.KeyboardEvent) => {
    const m = KEYS[e.key];
    if (!m || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    // Handled here, so the page's own keys (vim keys, the zoomed diagram) leave it alone.
    e.preventDefault();
    move(m, true);
  };
  // aria-disabled rather than disabled: a button that disables itself under the reader's focus drops focus to the page.
  const nav = (m: "prev" | "next", className: string) => {
    const can = canMove(state, m, count);
    return {
      "aria-disabled": !can || undefined,
      // detail is 0 when a key pressed the button.
      onClick: (e: React.MouseEvent) => {
        if (can) move(m, e.detail === 0);
      },
      className: cn(className, "aria-disabled:cursor-default aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"),
    };
  };
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div role="group" aria-label="Steps" className="flex flex-wrap items-center justify-between gap-2" onKeyDown={onKeyDown} data-speak="skip">
        <Button size="sm" variant="ghost" {...nav("prev", "pl-2")}>
          <ChevronLeft aria-hidden="true" /> Previous
        </Button>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          {state.all ? `All ${count} steps` : `Step ${state.at + 1} of ${count}`}
        </span>
        <div className="flex items-center gap-1">
          {all && (
            <Button size="sm" variant={state.all ? "secondary" : "ghost"} aria-pressed={state.all} onClick={(e) => move("all", e.detail === 0)} className="px-2.5">
              All
            </Button>
          )}
          <Button size="sm" variant="ghost" {...nav("next", "pr-2")}>
            Next <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
      <div className="mt-2 px-1" aria-live="polite">
        {state.all ? (
          <p className="text-sm text-muted-foreground" data-speak="skip">Every part at once. Previous or Next goes back to step {state.at + 1}.</p>
        ) : (
          <>
            {step.title && <p className="text-sm font-medium text-pretty">{step.title}</p>}
            <p className="text-sm text-pretty">{step.text}</p>
            {changes && (
              <p className="sr-only" data-speak="skip">
                {changes}
              </p>
            )}
          </>
        )}
      </div>
      {rows && <StateList rows={rows} all={state.all} />}
    </div>
  );
}

/**
 * What the parts hold as of this step, one ruled row per value. A value this step changed shows what it was,
 * struck through, before the new one; a value it first set says "new". Under "All", the values at the end.
 * Changing step swaps the words, as the step's text does.
 */
function StateList({ rows, all }: { rows: StateRow[]; all: boolean }) {
  return (
    <div role="group" aria-label={all ? "Values at the end" : "Values at this step"} data-speak="skip" className="mt-3">
    <dl className="divide-y divide-border rounded-lg border border-border text-[13px]">
      {rows.map((r) => {
        const changed = !all && (r.was !== undefined || r.added);
        return (
          <div key={`${r.node}.${r.name}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-3 py-1.5">
            <dt className={cn("min-w-0 font-mono break-all", changed ? "text-foreground" : "text-muted-foreground")}>
              {r.node}.{r.name}
            </dt>
            <dd className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 font-mono tabular-nums break-all">
              {!all && r.was !== undefined && (
                <>
                  <s className="text-muted-foreground">
                    <span className="sr-only">was </span>
                    {r.was}
                  </s>
                  <span aria-hidden="true" className="text-muted-foreground">→</span>
                  <span className="sr-only">now </span>
                </>
              )}
              {!all && r.added && <span className="sr-only">new: </span>}
              <span className={changed ? "font-medium text-foreground" : "text-muted-foreground"}>{r.value}</span>
              {!all && r.added && (
                <span aria-hidden="true" className="font-sans text-[12px] text-muted-foreground">
                  new
                </span>
              )}
            </dd>
          </div>
        );
      })}
    </dl>
    </div>
  );
}
