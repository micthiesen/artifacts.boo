// Pele-backed diagram body. Loaded lazily by <Diagram>, and pele/lazy then
// loads only the diagram types a page uses, so pages without diagrams never
// download Pele.
import * as React from "react";
import { mountAsync, parse, type Mounted } from "pele/lazy";
import { post } from "../store.ts";
import type { DiagramShow } from "./diagram.tsx";
import { Callout } from "./layout.tsx";

const MARKS = ["added", "changed", "removed"] as const;
type Mark = (typeof MARKS)[number];
const SIGN: Record<Mark, string> = { added: "+", changed: "~", removed: "−" };

export default function DiagramImpl({ code, show = "both", focus }: { code: string; show?: DiagramShow; focus?: string }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<unknown>(null);
  const lit = React.useMemo(() => (focus ? new Set(focus.split(/\s+/).filter(Boolean)) : null), [focus]);
  const litRef = React.useRef(lit);
  litRef.current = lit;

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let mounted: Mounted | undefined;
    let failed = false;
    const fail = (err: unknown) => {
      if (cancelled || failed) return;
      failed = true;
      setError(err);
      // Reaches the render check, so a broken diagram fails the write's check.
      post({ t: "error", message: `Diagram: ${describe(err)}` });
    };
    setError(null);
    // In the reading column (about 670 px), wide left-to-right diagrams may
    // stack vertically instead of shrinking to unreadable text.
    mountAsync(el, code, {
      links: false,
      images: false,
      directionBreakpoint: 720,
      onError: fail,
      // Pele renders again when the width crosses the breakpoint, so marks are drawn on every render.
      onRender: () => decorate(el, code, litRef.current),
    }).then(
      (m) => {
        if (cancelled) return m.destroy();
        mounted = m;
        if (!m.result && m.error) fail(m.error);
        else decorate(el, code, litRef.current);
      },
      fail,
    );
    return () => {
      cancelled = true;
      mounted?.destroy();
      el.replaceChildren();
    };
  }, [code]);

  React.useEffect(() => {
    if (ref.current) decorate(ref.current, code, lit);
  }, [lit, code]);

  // The parts of the change fade only when the reader switches, never as the page loads.
  const shown = React.useRef(show);
  React.useEffect(() => {
    const el = ref.current;
    if (el && shown.current !== show) el.dataset.switched = "";
    shown.current = show;
  }, [show]);

  return (
    <>
      <div ref={ref} className="art-diagram" data-show={show} hidden={!!error} />
      {error != null && (
        <Callout tone="danger" title="Diagram failed to render">
          <pre className="overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{describe(error)}</pre>
        </Callout>
      )}
    </>
  );
}

function markOf(el: Element): Mark | null {
  return MARKS.find((m) => el.classList.contains(m)) ?? null;
}

/** Which nodes each flowchart edge joins, from Pele's own parse (its SVG ids alone can't split ids holding `_`). */
function edgeEnds(code: string): { pairs: Set<string>; ok: boolean } {
  try {
    const model = parse(code) as { edges?: { start: string; end: string }[] };
    return { pairs: new Set((model.edges ?? []).map((e) => `${e.start}\u0000${e.end}`)), ok: true };
  } catch {
    return { pairs: new Set(), ok: false };
  }
}

function ends(id: string, pairs: Set<string>): [string, string] | null {
  const body = /^L_(.+)_\d+$/.exec(id)?.[1];
  if (!body) return null;
  for (let i = body.indexOf("_"); i > 0; i = body.indexOf("_", i + 1)) {
    const pair: [string, string] = [body.slice(0, i), body.slice(i + 1)];
    if (pairs.has(pair.join("\u0000"))) return pair;
  }
  return null;
}

/**
 * Draws a marked node's sign into its label and marks the edges that come and go with it, so the change reads
 * without colour; dims what a `focus` leaves out. Styles are in kit.css (`.art-diagram .added` and friends).
 */
export function decorate(root: HTMLElement, code: string, focus: Set<string> | null) {
  const svg = root.querySelector("svg");
  if (!svg) return;
  const nodes = [...svg.querySelectorAll<SVGGElement>("g.pele-node[data-id]")];
  const marks = new Map<string, Mark | null>(nodes.map((n) => [n.dataset.id!, markOf(n)]));
  const marked = [...marks.values()].some(Boolean);
  for (const n of nodes) {
    const id = n.dataset.id!;
    n.classList.toggle("art-dim", !!focus && !focus.has(id));
    const m = marks.get(id);
    const label = n.querySelector("text");
    if (m && label && !label.querySelector(".art-sign")) {
      const sign = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      sign.setAttribute("class", "art-sign");
      sign.setAttribute("aria-hidden", "true");
      sign.textContent = `${SIGN[m]} `;
      label.insertBefore(sign, label.firstChild);
    }
  }
  if (!marked && !focus) return;
  const { pairs } = edgeEnds(code);
  for (const e of svg.querySelectorAll<SVGGElement>("g.pele-edge[data-id], g.pele-edge-label[data-id]")) {
    const pair = ends(e.dataset.id!, pairs);
    if (!pair) continue;
    const m = pair.map((p) => marks.get(p));
    e.classList.toggle("removed", m.includes("removed"));
    e.classList.toggle("added", !m.includes("removed") && m.includes("added"));
    e.classList.toggle("art-dim", !!focus && !pair.every((p) => focus.has(p)));
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
