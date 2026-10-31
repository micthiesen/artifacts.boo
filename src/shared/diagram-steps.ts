// Stepped diagrams (<Diagram steps>): one picture walked through a part at a time. The kit keeps which step is
// showing; the render check (and, for a ChangeGuide's map, the Worker on save) refuses a step that lights a node
// the diagram doesn't have, since that step would dim everything and say nothing. A step can also set values
// that its nodes hold ("Auth.attempts": "1"); the bar lists every value so far, with what changed struck
// through, so the reader doesn't have to remember them.

export type DiagramStep = {
  /** Node ids to light, separated by spaces (a subgraph's id lights everything in it). */
  focus: string;
  title?: string;
  text: string;
  /** Values this step sets, keyed "Node.name" (the node is a diagram id): later steps keep them until changed. */
  state?: Record<string, string>;
};

/** One value as of a step: `was` is what it held before this step changed it; `added` when this step first set it. */
export type StateRow = { node: string; name: string; value: string; was?: string; added?: boolean };

export const STATE_LIMITS = { keys: 12, value: 40 };

/** The values held after step `at` (from 0), in the order they were first set; null for steps that set none. */
export function stateAt(steps: readonly Pick<DiagramStep, "state">[], at: number): StateRow[] | null {
  const rows = new Map<string, StateRow>();
  steps.slice(0, at + 1).forEach((s, i) => {
    for (const [key, value] of Object.entries(s.state ?? {})) {
      const dot = key.indexOf(".");
      const prev = rows.get(key);
      const row: StateRow = { node: key.slice(0, dot), name: key.slice(dot + 1), value };
      if (i === at && prev?.value !== value) {
        if (prev) row.was = prev.value;
        else row.added = true;
      }
      rows.set(key, row);
    }
  });
  return rows.size ? [...rows.values()] : null;
}

/**
 * Problems with the steps' `state`, as "step N: …" lines: a key is "Node.name" with a node `known` has (the
 * check is skipped without `known`), each value is short text, and a diagram holds at most 12 values.
 */
export function stateProblems(steps: readonly Pick<DiagramStep, "state">[], known?: Set<string>, diagram = "the diagram"): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  steps.forEach((s, i) => {
    const st = s.state as unknown;
    if (st === undefined) return;
    if (!st || typeof st !== "object" || Array.isArray(st)) {
      out.push(`step ${i + 1}'s "state" is {"Node.name": "value"}`);
      return;
    }
    for (const [key, value] of Object.entries(st)) {
      const m = /^([^.\s]+)\.(\S.*)$/.exec(key);
      if (!m) out.push(`step ${i + 1}'s state key "${key}" is "Node.name": a node id, a dot, then the value's name`);
      else if (known && !known.has(m[1]!)) out.push(`step ${i + 1}'s state key "${key}" names "${m[1]}", which isn't a node in ${diagram}`);
      if (typeof value !== "string" || !value.trim()) out.push(`step ${i + 1}'s state "${key}" is a short text value`);
      else if (value.length > STATE_LIMITS.value) out.push(`step ${i + 1}'s state "${key}" is ${value.length} characters; keep values to ${STATE_LIMITS.value}`);
      keys.add(key);
    }
  });
  if (keys.size > STATE_LIMITS.keys) out.push(`the steps set ${keys.size} values; show at most ${STATE_LIMITS.keys}, the ones the change is about`);
  return out;
}

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
