// How kit components tell the vim-style keys (src/kit/keys-page.ts) what to do, instead of the keys guessing from
// their markup. Two parts:
//
// - Stops. A component that knows its own structure marks its root `data-key-scope` and each element the cursor
//   should stop on `data-key-stop` (a heading, a row, a chart, a control group). Inside a scope only those count;
//   everywhere else (plain Markdown, an artifact's own code) the keys find stops by element type. Hidden stops
//   (zero size, inside a closed <details> other than its summary) are skipped either way.
// - Actions. `useKeyWidget(ref, {across, enter})` on the element that owns a control (a Tabs root, a stepped
//   diagram, a row that opens). The keys use the nearest one around the cursor: h and l call `across(dir)`, Enter
//   calls `enter()`. Each returns whether it did something; at its ends `across` returns false, so the key moves
//   on to the block beside.
import * as React from "react";

export type KeyWidget = {
  /** h (-1) or l (1): the previous or next tab, step or option. False when there's none that way. */
  across?: (dir: 1 | -1) => boolean;
  /** Enter: open, toggle or focus the thing. False when it has nothing to do. */
  enter?: () => boolean;
};

const widgets = new WeakMap<Element, KeyWidget>();

/**
 * Runs a key's action on the widgets around `el` (itself included, up to `stop`), nearest first, until one does
 * something: a diagram with nothing to step through inside a set of tabs leaves h and l to the tabs. Returns the
 * element whose widget acted, or null.
 */
export function runKeyWidget(el: Element, stop: Element, act: (w: KeyWidget) => boolean | undefined): Element | null {
  for (let up: Element | null = el; up && up !== stop; up = up.parentElement) {
    const widget = widgets.get(up);
    if (widget && act(widget)) return up;
  }
  return null;
}

/** Registers what the keys do for an element; returns the undo. */
export function registerKeyWidget(el: Element, widget: KeyWidget): () => void {
  widgets.set(el, widget);
  return () => {
    if (widgets.get(el) === widget) widgets.delete(el);
  };
}

/** Registers what the keys do for the element `ref` points at, for as long as it's mounted. */
export function useKeyWidget(ref: React.RefObject<Element | null>, widget: KeyWidget) {
  // The latest handlers, without re-registering on every render.
  const latest = React.useRef(widget);
  latest.current = widget;
  // After every render: the element can change (a list that appears later, a diagram that becomes stepped).
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return registerKeyWidget(el, {
      across: (dir) => latest.current.across?.(dir) ?? false,
      enter: () => latest.current.enter?.() ?? false,
    });
  });
}
