// Pele-backed diagram body. Loaded lazily by <Diagram>, and pele/lazy then
// loads only the diagram types a page uses, so pages without diagrams never
// download Pele.
import * as React from "react";
import { mountAsync, parse, type Mounted } from "pele/lazy";
import { LOGO_NAME, logoRefs } from "../../shared/logos.ts";
import { focusIds, stateProblems, unknownFocus, type DiagramStep } from "../../shared/diagram-steps.ts";
import { post } from "../store.ts";
import type { DiagramShow } from "./diagram.tsx";
import { Callout } from "./layout.tsx";

// The step bar rides in this chunk for diagrams (src/kit/ui/diagram.tsx loads it from here).
export { StepBar } from "./step-bar.tsx";

/** The logo modules' directory under /kit/v1/logos/, named by scripts/build-kit.ts. */
declare const __LOGOS_DIR__: string;

/**
 * The logos a diagram names, as Pele icon markup. Each is a module beside the kit (scripts/build-kit.ts):
 * the frame may import scripts from the kit but fetch nothing. The save already refused unknown names.
 */
async function loadLogos(code: string): Promise<Map<string, string>> {
  const names = logoRefs(code);
  const svgs = await Promise.all(
    names.map(async (name) => {
      if (!LOGO_NAME.test(name)) throw new Error(`no logo named logos:${name}`);
      try {
        return ((await import(/* @vite-ignore */ new URL(`../logos/${__LOGOS_DIR__}/${name}.js`, import.meta.url).href)) as { default: string }).default;
      } catch (err) {
        throw new Error(`couldn't load logos:${name} (${describe(err)})`);
      }
    }),
  );
  return new Map(names.map((name, i) => [`logos:${name}`, svgs[i]]));
}

const MARKS = ["added", "changed", "removed"] as const;
type Mark = (typeof MARKS)[number];
const SIGN: Record<Mark, string> = { added: "+", changed: "~", removed: "−" };

type ImplProps = {
  code: string;
  show?: DiagramShow;
  focus?: string;
  /** A stepped diagram's steps: outlines what a focus lights, and checks every step names real nodes. */
  steps?: readonly DiagramStep[];
};

export default function DiagramImpl({ code, show = "both", focus, steps }: ImplProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<unknown>(null);
  const lit = React.useMemo(() => {
    const ids = focusIds(focus);
    return ids.length ? new Set(ids) : null;
  }, [focus]);
  const litRef = React.useRef(lit);
  litRef.current = lit;
  const stepsRef = React.useRef(steps);
  stepsRef.current = steps;

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
    loadLogos(code).then((logos) => cancelled ? undefined : mountAsync(el, code, {
      icons: (name) => logos.get(name),
      links: false,
      images: false,
      directionBreakpoint: 720,
      // Code-like parts read as code; Pele sizes the boxes for the monospace font.
      monospace: ["members", "attributes", "files"],
      // A diagram scaled down to fit gets zoom buttons, pinch and Ctrl-wheel zoom (diagram-steps.css themes
      // them and keeps a one-finger vertical swipe scrolling the page). Diagrams that fit get none.
      zoom: "auto",
      onError: fail,
      // Pele renders again when the width crosses the breakpoint, so marks are drawn on every render.
      onRender: () => decorate(el, code, litRef.current),
    })).then(
      (m) => {
        if (!m) return;
        if (cancelled) return m.destroy();
        mounted = m;
        if (!m.result && m.error) return fail(m.error);
        decorate(el, code, litRef.current);
        // A step lighting a node the diagram doesn't have would dim everything: the render check refuses it.
        // So is a value on one; the bar would list it under a name the picture doesn't show.
        const steps = stepsRef.current;
        const known = steps ? knownIds(el, code) : null;
        const bad = steps && known ? [...unknownFocus(steps, known), ...stateProblems(steps, known)] : [];
        if (bad.length) post({ t: "error", message: `Diagram: ${bad.join("; ")}` });
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
      <div ref={ref} className="art-diagram" data-show={show} data-steps={steps ? "" : undefined} hidden={!!error} />
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

/** What Pele's parse says about a diagram that its SVG doesn't: which nodes each edge joins, what each subgraph holds, and which nodes a collapsed subgraph hides. */
type Shape = {
  /** Every node and subgraph id, for flowcharts (other types: null). */
  ids: Set<string> | null;
  /** "start\0end" for each edge (Pele's SVG ids alone can't split ids holding `_`). */
  pairs: Set<string>;
  /** A subgraph's id to the ids directly inside it. */
  members: Map<string, string[]>;
  /** A node inside a collapsed subgraph to the outermost collapsed one, which is drawn in its place. */
  shownAs: Map<string, string>;
};

let lastShape: { code: string; shape: Shape } | null = null;

/** Parsed once per source: a stepped diagram asks again on every step. */
export function shapeOf(code: string): Shape {
  if (lastShape?.code === code) return lastShape.shape;
  const shape: Shape = { ids: null, pairs: new Set(), members: new Map(), shownAs: new Map() };
  try {
    const model = parse(code) as {
      nodes?: unknown;
      edges?: { start: string; end: string }[];
      subgraphs?: { id: string; nodes?: string[]; metadata?: { view?: string } }[];
    };
    if (model.nodes instanceof Map) shape.ids = new Set([...model.nodes.keys()].map(String));
    for (const e of model.edges ?? []) shape.pairs.add(`${e.start}\u0000${e.end}`);
    const parent = new Map<string, string>();
    const collapsed = new Set<string>();
    for (const g of model.subgraphs ?? []) {
      shape.ids?.add(g.id);
      shape.members.set(g.id, g.nodes ?? []);
      for (const n of g.nodes ?? []) parent.set(n, g.id);
      if (g.metadata?.view === "collapsed") collapsed.add(g.id);
    }
    if (collapsed.size) {
      for (const id of parent.keys()) {
        let top: string | undefined;
        // Bounded by the number of subgraphs, in case a parse ever loops.
        for (let p = parent.get(id), hops = 0; p && hops <= parent.size; p = parent.get(p), hops++) if (collapsed.has(p)) top = p;
        if (top) shape.shownAs.set(id, top);
      }
    }
  } catch {
    // An unparsable diagram fails to render and says why; nothing here to mark.
  }
  lastShape = { code, shape };
  return shape;
}

/** What a focus lights: its ids, everything inside a named subgraph, and the collapsed subgraph standing in for a lit node. */
export function litIds(focus: Iterable<string>, shape: Shape): Set<string> {
  const out = new Set<string>();
  const add = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const m of shape.members.get(id) ?? []) add(m);
  };
  for (const id of focus) add(id);
  for (const id of [...out]) {
    const shown = shape.shownAs.get(id);
    if (shown) out.add(shown);
  }
  return out;
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
 * without colour; dims what a `focus` leaves out and marks what it lights (`art-lit`, which only a stepped
 * diagram outlines). Styles are in kit.css (`.art-diagram .added` and friends) and diagram-steps.css.
 */
export function decorate(root: HTMLElement, code: string, focus: Set<string> | null) {
  // The drawing itself, not the icons in Pele's zoom buttons beside it.
  const svg = root.querySelector(":scope > svg");
  if (!svg) return;
  const nodes = [...svg.querySelectorAll<SVGGElement>("g.pele-node[data-id]")];
  const marks = new Map<string, Mark | null>(nodes.map((n) => [n.dataset.id!, markOf(n)]));
  const marked = [...marks.values()].some(Boolean);
  const shape = marked || focus ? shapeOf(code) : null;
  const lit = focus && shape ? litIds(focus, shape) : null;
  for (const n of nodes) {
    const id = n.dataset.id!;
    n.classList.toggle("art-dim", !!lit && !lit.has(id));
    n.classList.toggle("art-lit", !!lit && lit.has(id));
    const m = marks.get(id);
    const label = n.querySelector("text");
    if (m && label && !label.querySelector(".art-sign")) {
      const sign = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      sign.setAttribute("class", "art-sign");
      sign.setAttribute("aria-hidden", "true");
      sign.textContent = `${SIGN[m]} `;
      label.insertBefore(sign, label.firstChild);
    }
  }
  for (const c of svg.querySelectorAll<SVGGElement>("g.pele-cluster[data-id], g.pele-cluster-title[data-id]")) {
    c.classList.toggle("art-lit", !!lit && lit.has(c.dataset.id!));
  }
  const edges = svg.querySelectorAll<SVGGElement>("g.pele-edge[data-id], g.pele-edge-label[data-id]");
  if (!shape) {
    // A focus just went away (a stepped diagram's "All").
    for (const e of edges) e.classList.remove("art-dim", "art-lit");
    return;
  }
  for (const e of edges) {
    const pair = ends(e.dataset.id!, shape.pairs);
    if (!pair) continue;
    // An edge into a node hidden in a collapsed subgraph is drawn to the subgraph.
    const shown = pair.map((p) => shape.shownAs.get(p) ?? p);
    const m = shown.map((p) => marks.get(p));
    e.classList.toggle("removed", m.includes("removed"));
    e.classList.toggle("added", !m.includes("removed") && m.includes("added"));
    const both = !!lit && shown.every((p) => lit.has(p));
    e.classList.toggle("art-dim", !!lit && !both);
    e.classList.toggle("art-lit", both);
  }
}

/** Every id a focus may name: the parse's (nodes hidden in a collapsed subgraph too) and the drawing's. */
export function knownIds(root: HTMLElement, code: string): Set<string> {
  const known = new Set(shapeOf(code).ids ?? []);
  for (const g of root.querySelectorAll<SVGGElement>("svg g.pele-node[data-id], svg g.pele-cluster[data-id]")) known.add(g.dataset.id!);
  return known;
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
