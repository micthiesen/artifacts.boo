import * as React from "react";
import { VIEWS, type SceneView } from "../../shared/scene.ts";
import { holdCheck } from "../check.ts";
import { useKeyWidget } from "../key-widget.ts";
import { getBoot } from "../store.ts";
import { ErrorBoundary } from "./error.tsx";
import { Skeleton } from "./primitives.tsx";
import type { SceneBuild, SceneHandle } from "./scene-impl.tsx";
import { cn } from "./utils.ts";

// three.js (about 190 KB gzipped) rides in this chunk, so only pages with a scene download it.
const SceneImpl = React.lazy(() => import("./scene-impl.tsx"));

export type { SceneBuild, SceneColors, SceneContext, ScenePoint } from "./scene-impl.tsx";
export type { SceneView };

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

function SceneInner({ title, description, build, deps = [], view = "angle", height = 320, className }: SceneProps) {
  if (typeof build !== "function") throw new Error("<Scene> needs build={({ scene }) => { … }}: a function that adds three.js objects to the scene");
  // A canvas says nothing to Listen or a screen reader; these two are all they get.
  if (!String(title ?? "").trim() || !String(description ?? "").trim()) throw new Error("<Scene> needs a title and a description: what it is, and what someone who can't see it should know");
  if (!VIEWS.includes(view)) throw new Error(`<Scene view="${String(view)}">: view is one of ${VIEWS.map((v) => `"${v}"`).join(", ")}`);
  const outer = React.useRef<HTMLElement>(null);
  const handle = React.useRef<SceneHandle | null>(null);
  const about = React.useId();
  // The page's h and l step through the views; Enter moves focus in, where the arrow keys turn it.
  useKeyWidget(outer, {
    across: (dir) => handle.current?.step(dir) ?? false,
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

  return (
    <figure ref={outer} data-key-stop="" data-speak="scene" className={cn("my-6 rounded-xl border border-border bg-card p-4 shadow-card", className)}>
      <figcaption className="mb-3 px-1 text-sm font-medium">{title}</figcaption>
      <React.Suspense fallback={<Skeleton style={{ height }} />}>
        <SceneImpl title={title} describedBy={about} build={build} deps={deps} view={view} height={height} handle={handle} onSettled={settled} />
      </React.Suspense>
      <p id={about} data-scene-about="" className="mt-3 px-1 text-[13px] text-pretty text-muted-foreground">
        {description}
      </p>
    </figure>
  );
}
