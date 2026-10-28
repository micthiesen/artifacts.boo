// Stepped diagrams (<Diagram steps>): one picture walked through a part at a time. The kit keeps which step is
// showing; the render check (and, for a ChangeGuide's map, the Worker on save) refuses a step that lights a node
// the diagram doesn't have, since that step would dim everything and say nothing.

export type DiagramStep = {
  /** Node ids to light, separated by spaces (a subgraph's id lights everything in it). */
  focus: string;
  title?: string;
  text: string;
};

/** Where a stepped diagram is: one step lit (`at`, from 0), or every node shown (`all`). */
export type StepState = { at: number; all: boolean };

export type StepMove = "next" | "prev" | "first" | "last" | "all";

/** A `focus` string's node ids; empty for none. */
export function focusIds(focus: string | undefined): string[] {
  return focus ? focus.split(/\s+/).filter(Boolean) : [];
}

/**
 * The state after a move among `count` steps. Moving always leaves "All" and lands on a step: from "All",
 * Previous and Next return to the step the reader was on. They stop at the ends rather than wrapping, so the
 * last step doesn't jump back to the first. "all" toggles.
 */
export function stepTo(state: StepState, move: StepMove, count: number): StepState {
  const last = Math.max(0, count - 1);
  const at = Math.min(Math.max(0, state.at), last);
  switch (move) {
    case "all":
      return { at, all: !state.all };
    case "first":
      return { at: 0, all: false };
    case "last":
      return { at: last, all: false };
    case "next":
      return { at: state.all ? at : Math.min(at + 1, last), all: false };
    case "prev":
      return { at: state.all ? at : Math.max(at - 1, 0), all: false };
  }
}

/** Whether Previous / Next would do anything (from "All" either one returns to the current step). */
export function canMove(state: StepState, move: "next" | "prev", count: number): boolean {
  if (state.all) return count > 0;
  return move === "next" ? state.at < count - 1 : state.at > 0;
}

/** Each step's focus ids that `known` (the diagram's node ids) doesn't have, as "step N: id" problems. */
export function unknownFocus(steps: readonly Pick<DiagramStep, "focus">[], known: Set<string>): string[] {
  const out: string[] = [];
  steps.forEach((s, i) => {
    for (const id of focusIds(s.focus)) if (!known.has(id)) out.push(`step ${i + 1}'s focus "${id}" isn't a node in the diagram`);
  });
  return out;
}
