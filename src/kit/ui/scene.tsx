import * as React from "react";
import { canMove, stepTo, type StepState } from "../../shared/diagram-steps.ts";
import { stepProblem, VIEWS, type SceneStep, type SceneView } from "../../shared/scene.ts";
import { holdCheck } from "../check.ts";
import { useKeyWidget } from "../key-widget.ts";
import { getBoot } from "../store.ts";
import { ErrorBoundary } from "./error.tsx";
import { Skeleton } from "./primitives.tsx";
import type { SceneBuild, SceneHandle } from "./scene-impl.tsx";
import { cn } from "./utils.ts";

// three.js (about 190 KB gzipped) rides in this chunk, so only pages with a scene download it.
const SceneImpl = React.lazy(() => import("./scene-impl.tsx"));
// The diagram's step bar, for a scene walked through in steps.
const StepBar = React.lazy(() => import("./step-bar.tsx").then((m) => ({ default: m.StepBar })));

export type { SceneBuild, SceneColors, SceneContext, ScenePoint } from "./scene-impl.tsx";
export type { SceneStep, SceneView };

export type SceneProps = {
  /** What the scene is, shown above it and read aloud. A save refuses a Scene without one. */
  title: string;
  /** What someone who can't see or turn it should know: what is there and what to notice. Shown under the scene. */
  description: string;
  /** Adds three.js objects to the `scene` it is given. The kit owns the canvas, camera, lights and controls. */
  build: SceneBuild;
  /** Values build() reads from props or state; it runs again when one changes, as with useEffect. */
  deps?: readonly unknown[];
  /** The side shown first. */
  view?: SceneView;
  /**
   * Walk the reader through it in order (2 to 8 steps): a bar under the scene shows "Step 2 of 4", Previous /
   * Next and the step's title and text. build() is told the `step` (from 0) and builds the scene as it is
   * then; a part that keeps its `name` from one step to the next glides to where it now is. A step's `view`
   * is the side it and the steps after it are seen from: moving to a step seen from another side turns the
   * camera there. Listen reads the step's words.
   */
  steps?: readonly SceneStep[];
  height?: number;
  className?: string;
};

/** Something with a shape in space (a room, a rack, an enclosure, a route), drawn with three.js and turned by the reader. */
export function Scene(props: SceneProps) {
  return (
    <ErrorBoundary label="Scene" report>
      <SceneInner {...props} />
    </ErrorBoundary>
  );
}

const CARD = "my-6 rounded-xl border border-border bg-card p-4 shadow-card";

function SceneInner({ title, description, build, deps = [], view = "angle", steps, height = 320, className }: SceneProps) {
  if (typeof build !== "function") throw new Error("<Scene> needs build={({ scene }) => { … }}: a function that adds three.js objects to the scene");
  // A canvas says nothing to Listen or a screen reader; these two are all they get.
  if (!String(title ?? "").trim() || !String(description ?? "").trim()) throw new Error("<Scene> needs a title and a description: what it is, and what someone who can't see it should know");
  if (!VIEWS.includes(view)) throw new Error(`<Scene view="${String(view)}">: view is one of ${VIEWS.map((v) => `"${v}"`).join(", ")}`);
  const wrong = steps === undefined ? null : stepProblem(steps);
  if (wrong) throw new Error(`<Scene steps>: ${wrong}`);
  const stepped = !!steps?.length;
  const outer = React.useRef<HTMLElement | null>(null);
  const handle = React.useRef<SceneHandle | null>(null);
  const about = React.useId();
  // Which step is showing, and whether a key moved there: a key jumps, a pointer lets the parts glide.
  const [at, setAt] = React.useState<{ state: StepState; byKey: boolean }>({ state: { at: 0, all: false }, byKey: true });
  // The page's h and l walk a stepped scene's steps, or step through a plain one's views; Enter moves focus
  // in, where the arrow keys turn it.
  useKeyWidget(outer, {
    across: (dir) => {
      if (!stepped) return handle.current?.step(dir) ?? false;
      const move = dir > 0 ? "next" : "prev";
      if (!canMove(at.state, move, steps.length)) return false;
      setAt({ state: stepTo(at.state, move, steps.length), byKey: true });
      return true;
    },
    enter: () => handle.current?.focus() ?? false,
  });
  // The render check waits for this scene's first frame, so a blank one fails it (src/kit/check.ts). Taken
  // when the scene is in the page, not while rendering: a render React throws away would never let go.
  const release = React.useRef<(() => void) | null>(null);
  React.useLayoutEffect(() => {
    if (getBoot()?.check !== true) return;
    const letGo = holdCheck();
    release.current = letGo;
    return letGo;
  }, []);
  const settled = React.useCallback(() => release.current?.(), []);

  const figure = (
    <figure ref={stepped ? undefined : outer} data-key-stop={stepped ? undefined : ""} data-speak="scene" className={cn(stepped ? "m-0" : CARD, !stepped && className)}>
      <figcaption className="mb-3 px-1 text-sm font-medium">{title}</figcaption>
      <React.Suspense fallback={<Skeleton style={{ height }} />}>
        <SceneImpl
          title={title}
          describedBy={about}
          build={build}
          deps={deps}
          view={view}
          height={height}
          steps={stepped ? steps : undefined}
          step={stepped ? Math.min(at.state.at, steps.length - 1) : 0}
          stepByKey={at.byKey}
          handle={handle}
          onSettled={settled}
        />
      </React.Suspense>
      <p id={about} data-scene-about="" className="mt-3 px-1 text-[13px] text-pretty text-muted-foreground">
        {description}
      </p>
    </figure>
  );
  if (!stepped) return figure;
  // The bar sits outside the figure: Listen reads the figure as one block, and the step's words should be heard.
  return (
    <div ref={outer as React.RefObject<HTMLDivElement | null>} className={cn(CARD, className)} data-key-stop="">
      {figure}
      <React.Suspense fallback={null}>
        <StepBar steps={steps} state={at.state} onState={(state, byKey) => setAt({ state, byKey })} all={false} />
      </React.Suspense>
    </div>
  );
}
