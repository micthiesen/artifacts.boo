// The three.js half of <Scene> (src/kit/ui/scene.tsx), downloaded only by pages that draw one.
//
// An artifact's build() adds objects to a scene. Everything else is here, because it is where hand-written
// three.js goes wrong and where the page's own rules apply:
// - one renderer per scene, sized to its box and drawn only when something changed: there is no frame loop;
// - the camera frames whatever was built, so a scene can't be aimed at nothing;
// - a finger on a scene scrolls the page until the reader taps it, and a mouse turns it straight away;
// - colours come from the theme, which three.js can't read (the tokens are oklch());
// - labels are DOM text placed over the canvas;
// - a stepped scene is built again for each step, and a part that keeps its name glides to where it now is;
// - in the render check it draws four sides, or every step, and reports what a screenshot can't say
//   (src/shared/scene.ts).
import * as React from "react";
import * as THREE from "three";
import { motionEase, motionMs } from "../../shared/motion.ts";
import {
  clampOrbit,
  countPixels,
  fitDistance,
  layoutLabels,
  mixOrbit,
  orbitPosition,
  SCENE_TOKENS,
  sceneProblems,
  SERIES_TOKENS,
  sheetCell,
  stepView,
  stepViewAt,
  tokenColor,
  VIEW_LABEL,
  VIEW_ORBIT,
  viewOf,
  VIEWS,
  type Orbit,
  type Rgb,
  type SceneColorName,
  type SceneStats,
  type SceneStep,
  type SceneView,
} from "../../shared/scene.ts";
import { getBoot, post } from "../store.ts";
import { Minus, Plus } from "./icons.ts";
import { Callout } from "./layout.tsx";
import { Button } from "./primitives.tsx";
import { cn } from "./utils.ts";

/** The theme's colours as three.js colours. `series` are the chart hues, for telling parts apart. */
export type SceneColors = Record<SceneColorName, THREE.Color> & { series: THREE.Color[] };
/** A place in the scene: [x, y, z], a Vector3, or an object (the label sits on top of it). */
export type ScenePoint = readonly [number, number, number] | THREE.Vector3 | THREE.Object3D;
export type SceneContext = {
  /** Add what you build to this. y is up. */
  scene: THREE.Scene;
  colors: SceneColors;
  /** A matte mesh with its edges drawn, in the kit's look. Position it and add it to the scene yourself. */
  solid: (geometry: THREE.BufferGeometry, color?: THREE.ColorRepresentation) => THREE.Mesh;
  /** Names a place or an object, as text over the scene. */
  label: (text: string, at: ScenePoint) => void;
  /** In a stepped scene, the step to build, counted from 0; otherwise 0. */
  step: number;
};
export type SceneBuild = (context: SceneContext) => void;
/** What the page's keys can do to a scene (src/kit/key-widget.ts). */
export type SceneHandle = { step: (dir: 1 | -1) => boolean; focus: () => boolean };

type ImplProps = {
  title: string;
  describedBy: string;
  build: SceneBuild;
  deps: readonly unknown[];
  view: SceneView;
  height: number;
  /** A stepped scene's steps, the one showing, and whether a key moved there (a key jumps, a pointer glides). */
  steps?: readonly SceneStep[];
  step: number;
  stepByKey: boolean;
  handle: React.RefObject<SceneHandle | null>;
  /** The scene has drawn (or can't): the render check may finish. */
  onSettled: () => void;
};

type Rig = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  key: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  colors: SceneColors;
  card: Rgb;
};

/** The middle, half-sizes and reach of what was built: what the camera frames. */
type Frame = { center: THREE.Vector3; half: [number, number, number]; radius: number };

/** One run of build(): the scene it made, and what the kit took from it. */
type Built = {
  scene: THREE.Scene;
  texts: string[];
  places: THREE.Vector3[];
  /** For a label put on an object: the object, and where the label sits in the object's own frame, so it rides along when the part glides or turns. */
  anchors: (Anchor | null)[];
  /** Meshes, lines, points and sprites. */
  objects: number;
  finite: boolean;
  /** It brought lights of its own. */
  lit: boolean;
  frame: Frame;
  error: Error | null;
};

/** Where a part is. */
export type Pose = { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };
export type Anchor = { part: THREE.Object3D; local: THREE.Vector3 };

/** A move in progress: `parts` is finished at once if the reader interrupts it, `camera` is left where it got to. */
type Move = { parts?: (e: number) => void; camera?: (e: number) => void };

/** A narrow lens: little perspective distortion, so sizes compare across the scene. */
const FOV = 32;
/** Radians turned per pixel dragged. */
const DRAG_TURN = 0.008;
const KEY_TURN = Math.PI / 12;
const ZOOM_STEP = 1.25;
/** A touch that moves less than this is a tap. */
const TAP_SLOP = 10;
/** Room for a view's name above its labels, in the render check. */
const CAPTION_HEIGHT = 26;
/** The width the render check draws a scene at when it isn't laid out. */
const CHECK_WIDTH = 640;

function readColors(): { colors: SceneColors; card: Rgb } {
  const style = getComputedStyle(document.documentElement);
  const read = (token: string) => style.getPropertyValue(token);
  const color = (pair: readonly [string, string]) => new THREE.Color().setRGB(...tokenColor(read, pair), THREE.SRGBColorSpace);
  const named = Object.fromEntries(Object.entries(SCENE_TOKENS).map(([name, pair]) => [name, color(pair)])) as Record<SceneColorName, THREE.Color>;
  return { colors: { ...named, series: SERIES_TOKENS.map(color) }, card: tokenColor(read, SCENE_TOKENS.ink) };
}

/** Frees what a build made; three.js keeps GPU buffers until told. */
function dispose(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as Partial<THREE.Mesh> & { dispose?: () => void };
    // An InstancedMesh or BatchedMesh holds buffers of its own.
    m.dispose?.();
    m.geometry?.dispose();
    for (const material of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) (value as THREE.Texture).dispose();
      material.dispose();
    }
  });
}

/** Where a label points: the place given, or the middle of the top of the object given. */
function place(at: ScenePoint): THREE.Vector3 {
  if ((at as THREE.Vector3).isVector3) return (at as THREE.Vector3).clone();
  if ((at as THREE.Object3D).isObject3D) {
    const object = at as THREE.Object3D;
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.isEmpty()) return object.getWorldPosition(new THREE.Vector3());
    return new THREE.Vector3((bounds.min.x + bounds.max.x) / 2, bounds.max.y, (bounds.min.z + bounds.max.z) / 2);
  }
  const [x, y, z] = at as readonly [number, number, number];
  return new THREE.Vector3(Number(x), Number(y), Number(z));
}

/** Whether everything built sits somewhere real. A NaN in a position or a transform draws nothing and says nothing. */
function allFinite(root: THREE.Object3D): boolean {
  let ok = true;
  root.traverse((o) => {
    if (!ok) return;
    const array = (o as Partial<THREE.Mesh>).geometry?.getAttribute("position")?.array;
    ok = o.matrixWorld.elements.every(Number.isFinite) && (!array || Array.prototype.every.call(array, Number.isFinite));
  });
  return ok;
}

/** Runs build() for one step into a scene of its own, and takes stock of what it made. */
function construct(build: SceneBuild, r: Rig, step: number, check: boolean): Built {
  const scene = new THREE.Scene();
  const frame: Frame = { center: new THREE.Vector3(), half: [1, 1, 1], radius: 1 };
  const found: { text: string; at: ScenePoint }[] = [];
  try {
    build({
      scene,
      colors: r.colors,
      step,
      solid: (geometry, color = r.colors.surface) => {
        const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
        // Only creases: a cylinder's side stays smooth, its rims are drawn.
        mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), new THREE.LineBasicMaterial({ color: r.colors.edge })));
        return mesh;
      },
      label: (text, at) => void found.push({ text: String(text), at }),
    });
  } catch (err) {
    dispose(scene);
    return { scene: new THREE.Scene(), texts: [], places: [], anchors: [], objects: 0, finite: true, lit: false, frame, error: err instanceof Error ? err : new Error(String(err)) };
  }
  scene.updateMatrixWorld(true);
  let objects = 0;
  let lit = false;
  scene.traverse((o) => {
    const kind = o as Partial<THREE.Mesh & THREE.Line & THREE.Points & THREE.Sprite & THREE.Light>;
    if (kind.isMesh || kind.isLine || kind.isPoints || kind.isSprite) objects++;
    if (kind.isLight) lit = true;
  });
  // three.js leaves NaN vertices out of its bounds, so the frame is of what can be drawn; the render check
  // looks for them itself.
  const bounds = new THREE.Box3().setFromObject(scene);
  if (!bounds.isEmpty() && Number.isFinite(bounds.min.lengthSq() + bounds.max.lengthSq())) {
    bounds.getCenter(frame.center);
    const size = bounds.getSize(new THREE.Vector3());
    frame.half = [size.x / 2, size.y / 2, size.z / 2];
    frame.radius = Math.max(size.length() / 2, 1e-4);
  }
  const places = found.map((f) => place(f.at));
  const anchors = found.map((f, i) => {
    const part = f.at as THREE.Object3D;
    return part.isObject3D ? { part, local: part.worldToLocal(places[i]!.clone()) } : null;
  });
  const finite = !check || (allFinite(scene) && places.every((v) => Number.isFinite(v.x + v.y + v.z)));
  return { scene, texts: found.map((f) => f.text), places, anchors, objects, finite, lit, frame, error: null };
}

const poseOf = (o: THREE.Object3D): Pose => ({ p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() });

/** Where every named part is. Names are taken once: the first object with a name is the part. */
export function poses(root: THREE.Object3D): Map<string, Pose> {
  const out = new Map<string, Pose>();
  root.traverse((o) => {
    if (o.name && !out.has(o.name)) out.set(o.name, poseOf(o));
  });
  return out;
}

/**
 * The parts of a newly built scene that were somewhere else a moment ago: same name, different pose. They are
 * what glides when the reader moves to a step, so the eye can follow each part to where it went.
 */
export function movers(before: Map<string, Pose>, built: THREE.Object3D): { part: THREE.Object3D; from: Pose; to: Pose }[] {
  const out: { part: THREE.Object3D; from: Pose; to: Pose }[] = [];
  const seen = new Set<string>();
  built.traverse((o) => {
    const from = o.name ? before.get(o.name) : undefined;
    if (!from || seen.has(o.name)) return;
    seen.add(o.name);
    const to = poseOf(o);
    if (!from.p.equals(to.p) || !from.q.equals(to.q) || !from.s.equals(to.s)) out.push({ part: o, from, to });
  });
  return out;
}

/** Puts the moving parts `e` of the way from where they were to where they now are (0 to 1). */
export function pose(parts: readonly { part: THREE.Object3D; from: Pose; to: Pose }[], e: number) {
  for (const m of parts) {
    m.part.position.lerpVectors(m.from.p, m.to.p, e);
    m.part.quaternion.slerpQuaternions(m.from.q, m.to.q, e);
    m.part.scale.lerpVectors(m.from.s, m.to.s, e);
  }
}

/** Moves each label that sits on a part to where that part is now. */
export function ride(anchors: readonly (Anchor | null)[], places: THREE.Vector3[]) {
  for (const [i, anchor] of anchors.entries()) {
    if (!anchor) continue;
    anchor.part.updateWorldMatrix(true, false);
    places[i]!.copy(anchor.local).applyMatrix4(anchor.part.matrixWorld);
  }
}

/** Takes the kit's lights out of whatever scene they were last drawn in, before that scene is let go. */
function unlight(r: Rig) {
  r.fill.removeFromParent();
  r.key.removeFromParent();
  r.key.target.removeFromParent();
}

const mixFrame = (a: Frame, b: Frame, e: number): Frame => ({
  center: a.center.clone().lerp(b.center, e),
  half: [a.half[0] + (b.half[0] - a.half[0]) * e, a.half[1] + (b.half[1] - a.half[1]) * e, a.half[2] + (b.half[2] - a.half[2]) * e],
  radius: a.radius + (b.radius - a.radius) * e,
});

/** Stands the camera on its orbit, framing `f` for a view of this shape. */
function aim(r: Rig, f: Frame, o: Orbit, aspect: number) {
  const distance = fitDistance(f.half, o, FOV, aspect) / o.zoom;
  r.camera.position.set(...orbitPosition([f.center.x, f.center.y, f.center.z], distance, o));
  r.camera.aspect = aspect;
  r.camera.near = Math.max(f.radius / 200, distance - f.radius * 1.05);
  r.camera.far = distance + f.radius * 1.05;
  r.camera.lookAt(f.center);
  r.camera.updateProjectionMatrix();
  r.camera.updateMatrixWorld();
  // The key light rides above and to the left of the camera, so no side the reader turns to is left unlit.
  const m = r.camera.matrixWorld.elements;
  const [side, lift] = [-0.5 * distance, 0.7 * distance];
  r.key.position.set(r.camera.position.x + m[0]! * side + m[4]! * lift, r.camera.position.y + m[1]! * side + m[5]! * lift, r.camera.position.z + m[2]! * side + m[6]! * lift);
  r.key.target.position.copy(f.center);
  r.key.target.updateMatrixWorld();
}

const projected = new THREE.Vector3();
/**
 * Puts one picture's labels where their places are on screen, inside the picture at (x, y) of size w by h: each
 * label's text, and the line and dot that tie it to its place.
 */
function placeTags(tags: HTMLCollection | undefined, leaders: HTMLCollection | undefined, places: THREE.Vector3[], camera: THREE.Camera, x: number, y: number, w: number, h: number, top?: number) {
  if (!tags || !leaders) return;
  const asks = places.map((at, i) => {
    projected.copy(at).project(camera);
    // Not in this view, or nowhere at all (a place worked out from a missing number).
    if (!Number.isFinite(projected.x + projected.y + projected.z) || projected.z <= -1 || projected.z >= 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return null;
    const el = tags[i] as HTMLElement | undefined;
    return el ? { x: (projected.x * 0.5 + 0.5) * w, y: (0.5 - projected.y * 0.5) * h, w: el.offsetWidth, h: el.offsetHeight } : null;
  });
  layoutLabels(asks, w, h, top).forEach((spot, i) => {
    const el = tags[i] as HTMLElement | undefined;
    const leader = leaders[i] as SVGGElement | undefined;
    const ask = asks[i];
    if (!el || !leader) return;
    el.style.visibility = spot ? "visible" : "hidden";
    leader.style.visibility = spot ? "visible" : "hidden";
    if (!spot || !ask) return;
    el.style.transform = `translate(${(x + spot.left).toFixed(1)}px, ${(y + spot.top).toFixed(1)}px)`;
    const [casing, line, dot] = leader.children as unknown as [Element, Element, Element];
    for (const [name, value] of [["x1", x + ask.x], ["y1", y + ask.y], ["x2", x + spot.tipX], ["y2", y + spot.tipY]] as const) {
      casing.setAttribute(name, value.toFixed(1));
      line.setAttribute(name, value.toFixed(1));
    }
    dot.setAttribute("cx", (x + ask.x).toFixed(1));
    dot.setAttribute("cy", (y + ask.y).toFixed(1));
  });
}

/** The render check's four views: the one readers start on, then the rest. */
const checkViews = (first: SceneView): SceneView[] => [first, ...VIEWS.filter((v) => v !== first)];

type Drawn = Pick<SceneStats, "calls" | "triangles" | "lines" | "points">;
/** What a frame drew, picture by picture, and the size it was drawn at. */
type Sheet = { shots: Drawn[]; width: number; height: number };

export default function SceneImpl({ title, describedBy, build, deps, view, height, steps, step, stepByKey, handle, onSettled }: ImplProps) {
  const check = getBoot()?.check === true;
  const stepped = !!steps?.length;
  /** The render check draws four sides of a scene, or every step of a stepped one. */
  const pictures = stepped ? steps.length : 4;
  const sheetHeight = Math.round(height * 0.75) * Math.ceil(pictures / 2);
  const box = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const tags = React.useRef<HTMLDivElement>(null);
  const leaders = React.useRef<SVGSVGElement>(null);
  const rig = React.useRef<Rig | null>(null);
  const orbit = React.useRef<Orbit>({ ...VIEW_ORBIT[stepped ? stepViewAt(steps, step, view) : view] });
  /** What is on screen: one build, or in the render check of a stepped scene one for each step. */
  const shown = React.useRef<Built[]>([]);
  /** What the camera frames: the build's own bounds, or on the way there from the last step's. */
  const framed = React.useRef<Frame>({ center: new THREE.Vector3(), half: [1, 1, 1], radius: 1 });
  /** Built, and waiting for its labels to be in the page: the next frame shows it. */
  const next = React.useRef<{ builts: Built[]; step: number; byKey: boolean } | null>(null);
  /** The step of the build on screen; null before the first, and after one that failed. */
  const shownStep = React.useRef<number | null>(null);
  const frame = React.useRef(0);
  const tween = React.useRef(0);
  const moving = React.useRef<Move | null>(null);
  const fingers = React.useRef(new Map<number, { x: number; y: number }>());
  const tap = React.useRef<{ id: number; x: number; y: number } | null>(null);
  const spread = React.useRef(0);
  const latest = React.useRef({ build, title, view, steps, step, stepByKey, sheetHeight, onSettled });
  latest.current = { build, title, view, steps, step, stepByKey, sheetHeight, onSettled };

  /** Each picture's labels: one picture for a reader, several in the render check. */
  const [labels, setLabels] = React.useState<string[][]>([]);
  const [failure, setFailure] = React.useState<"webgl" | Error | null>(null);
  const [preset, setPreset] = React.useState<SceneView | null>(stepped ? stepViewAt(steps, step, view) : view);
  /** Touch only: the reader tapped the scene, so a finger now turns it instead of scrolling the page. */
  const [engaged, setEngaged] = React.useState(false);
  const [used, setUsed] = React.useState(false);
  const [keyFocus, setKeyFocus] = React.useState(false);
  const [coarse] = React.useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);

  /** Draws the scene as it stands. Null when there is nothing to draw on (the box isn't laid out) or nothing built. */
  const draw = React.useCallback((): Sheet | null => {
    const r = rig.current;
    const el = box.current;
    if (!r || !el) return null;
    // A scene in a closed section has no size. The render check judges it at a usual one all the same: it is
    // just as blank or as heavy when the reader opens it.
    const w = el.clientWidth || (check ? CHECK_WIDTH : 0);
    const h = el.clientHeight || (check ? latest.current.sheetHeight : 0);
    if (!w || !h) return null;
    const size = r.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.renderer.setSize(w, h, false);
    const shot = (b: Built, f: Frame, o: Orbit, x: number, y: number, vw: number, vh: number, slot: number): Drawn => {
      // The kit's lights go wherever the picture being drawn is; a build that brought its own is lit its own way.
      if (!b.lit && r.key.parent !== b.scene) b.scene.add(r.fill, r.key, r.key.target);
      aim(r, f, o, vw / vh);
      // WebGL measures a viewport from the bottom of the canvas.
      r.renderer.setViewport(x, h - y - vh, vw, vh);
      r.renderer.setScissor(x, h - y - vh, vw, vh);
      r.renderer.render(b.scene, r.camera);
      // In the render check each picture has its name in the top corner; labels start below it.
      placeTags(tags.current?.children[slot]?.children, leaders.current?.children[slot]?.children, b.places, r.camera, x, y, vw, vh, check ? CAPTION_HEIGHT : undefined);
      const { calls, triangles, lines, points } = r.renderer.info.render;
      return { calls, triangles, lines, points };
    };
    r.renderer.setScissorTest(check);
    const first = shown.current[0];
    if (!first) return null;
    if (!check) return { shots: [shot(first, framed.current, orbit.current, 0, 0, w, h, 0)], width: w, height: h };
    // The render check's sheet: every step from the side it is seen from, or one build from four sides.
    const { steps: all, view: side } = latest.current;
    const cells = all?.length ? shown.current.map((b, i) => ({ b, o: VIEW_ORBIT[stepViewAt(all, i, side)] })) : checkViews(side).map((v) => ({ b: first, o: VIEW_ORBIT[v] }));
    const shots = cells.map(({ b, o }, i) => {
      const at = sheetCell(i, cells.length, w, h);
      return shot(b, b.frame, o, at.x, at.y, at.w, at.h, i);
    });
    return { shots, width: w, height: h };
  }, [check]);

  const requestDraw = React.useCallback(() => {
    if (frame.current) return;
    // One frame however many pointer moves arrive before it.
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  /** Ends a move in progress: its parts land where they were going, its camera stays where it got to. */
  const stop = React.useCallback(() => {
    cancelAnimationFrame(tween.current);
    tween.current = 0;
    moving.current?.parts?.(1);
    moving.current = null;
  }, []);

  /** Carries a move out over `ms` on the page's own curve, or at once when that is 0 (a key, reduced motion). */
  const run = React.useCallback(
    (ms: number, move: Move) => {
      stop();
      if (!ms) {
        move.parts?.(1);
        move.camera?.(1);
        requestDraw();
        return;
      }
      const ease = motionEase();
      const started = performance.now();
      moving.current = move;
      // From where things are, so the frame drawn before the first tick doesn't show where they are going.
      move.parts?.(0);
      move.camera?.(0);
      const tick = (now: number) => {
        const t = Math.min(1, (now - started) / ms);
        const e = t < 1 ? ease(t) : 1;
        move.parts?.(e);
        move.camera?.(e);
        if (t === 1) moving.current = null;
        draw();
        if (t < 1) tween.current = requestAnimationFrame(tick);
      };
      tween.current = requestAnimationFrame(tick);
    },
    [draw, requestDraw, stop],
  );

  /** The reader turned or zoomed it by hand. */
  const turn = React.useCallback(
    (to: Orbit) => {
      stop();
      orbit.current = clampOrbit(to);
      setPreset(viewOf(orbit.current));
      requestDraw();
    },
    [requestDraw, stop],
  );

  /** To one of the views. A press with a pointer turns there, so the reader keeps their bearings; keys jump. */
  const go = React.useCallback(
    (to: SceneView, instant: boolean) => {
      const from = orbit.current;
      const target = VIEW_ORBIT[to];
      setPreset(to);
      run(instant ? 0 : motionMs("slow"), { camera: (e) => void (orbit.current = e < 1 ? mixOrbit(from, target, e) : { ...target }) });
    },
    [run],
  );

  // The renderer, once. Without WebGL (an old device, a locked-down browser) the title and description still
  // say what the scene is.
  React.useEffect(() => {
    const el = canvas.current;
    const host = box.current;
    if (!el || !host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: el, antialias: true, alpha: true });
    } catch {
      setFailure("webgl");
      // On a reader's device that is the device's limit. In the render check it means nothing was looked at.
      if (check) post({ t: "error", message: `Scene "${latest.current.title}": WebGL didn't start in the render check, so the scene wasn't drawn or checked. Keep to a few scenes a page; with only a few, run artifact_check again` });
      latest.current.onSettled();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    const { colors, card } = readColors();
    rig.current = {
      renderer,
      camera: new THREE.PerspectiveCamera(FOV, 1, 0.1, 100),
      key: new THREE.DirectionalLight(0xffffff, 2.4),
      fill: new THREE.HemisphereLight(0xffffff, colors.ink, 1.5),
      colors,
      card,
    };
    const redraw = () => void draw();
    const resized = new ResizeObserver(redraw);
    resized.observe(host);
    // The browser may take the context away (a backgrounded tab on a phone); three.js rebuilds its state when it returns.
    const lost = (e: Event) => e.preventDefault();
    el.addEventListener("webglcontextlost", lost);
    el.addEventListener("webglcontextrestored", redraw);
    // A WebGL canvas prints blank unless it was drawn in the same task the page is captured in.
    window.addEventListener("beforeprint", redraw);
    return () => {
      resized.disconnect();
      el.removeEventListener("webglcontextlost", lost);
      el.removeEventListener("webglcontextrestored", redraw);
      window.removeEventListener("beforeprint", redraw);
      cancelAnimationFrame(frame.current);
      cancelAnimationFrame(tween.current);
      frame.current = tween.current = 0;
      moving.current = null;
      unlight(rig.current!);
      for (const b of [...shown.current, ...(next.current?.builts ?? [])]) dispose(b.scene);
      shown.current = [];
      next.current = null;
      renderer.dispose();
      // Phones allow only a few WebGL contexts per page; give this one back now rather than at garbage collection.
      renderer.forceContextLoss();
      rig.current = null;
    };
  }, [draw, check]);

  // The build, again whenever what it reads changes or the reader moves to another step. The camera keeps its
  // orbit and frames what is there now. The render check of a stepped scene builds every step, to draw them all.
  React.useEffect(() => {
    const r = rig.current;
    if (!r) return;
    const now = latest.current;
    const which = check && now.steps?.length ? now.steps.map((_, i) => i) : [now.step];
    const builts = which.map((i) => construct(now.build, r, i, check));
    const failed = builts.flatMap((b, k) => (b.error ? [{ error: b.error, at: which[k]! }] : []));
    for (const b of next.current?.builts ?? []) dispose(b.scene);
    next.current = null;
    if (failed.length) {
      stop();
      unlight(r);
      for (const b of [...builts, ...shown.current]) dispose(b.scene);
      shown.current = [];
      shownStep.current = null;
      setLabels([]);
      setFailure(failed[0]!.error);
      // Reaches the render check, so a scene that throws fails the write's check.
      for (const { error, at } of failed) post({ t: "error", message: `Scene "${now.title}"${now.steps?.length ? `, step ${at + 1}` : ""}: build() failed: ${error.message}`, stack: error.stack });
      now.onSettled();
      return;
    }
    next.current = { builts, step: now.step, byKey: now.stepByKey };
    setFailure(null);
    setLabels(check && !now.steps?.length ? checkViews(now.view).map(() => builts[0]!.texts) : builts.map((b) => b.texts));
  }, [...deps, step, steps?.length ?? 0]);

  // The first frame of a build, once its labels are in the page to be placed: until then the frame on screen
  // is the last build with the last build's labels. In the render check, also what the pixels say.
  React.useLayoutEffect(() => {
    const fresh = next.current;
    next.current = null;
    const r = rig.current;
    if (!fresh || !r) return void draw();
    const now = latest.current;
    // The step the reader is coming from is the one on screen, not the last one asked for: a build that was
    // replaced before it showed never counted. Only a move made with a pointer glides; a first build,
    // changed deps and a key all jump.
    const cameFrom = shownStep.current !== null && shownStep.current !== fresh.step ? shownStep.current : null;
    shownStep.current = fresh.step;
    const glide = cameFrom !== null && !fresh.byKey && !check;
    // Where things visibly are, read before a move still running is ended: a second step taken mid-glide
    // starts from what the reader saw, not from where the first was heading.
    const before = glide && shown.current[0] ? poses(shown.current[0].scene) : null;
    const from = { frame: framed.current, orbit: orbit.current };
    stop();
    unlight(r);
    for (const b of shown.current) dispose(b.scene);
    shown.current = fresh.builts;
    const built = fresh.builts[0]!;
    // A step seen from another side than the one the reader came from turns the camera there as its parts
    // move; between steps seen from the same side the camera stays where the reader has it.
    const sides = cameFrom !== null && now.steps?.length ? [stepViewAt(now.steps, cameFrom, now.view), stepViewAt(now.steps, fresh.step, now.view)] : null;
    const side = sides && sides[0] !== sides[1] ? sides[1] : undefined;
    // The pressed view is the one the camera is on: a turn this cut short left it between two.
    setPreset(side ?? viewOf(orbit.current));
    const parts = before ? movers(before, built.scene) : [];
    run(glide ? motionMs("slow") : 0, {
      parts: (e) => {
        pose(parts, e);
        // A label on a part rides along with it.
        if (parts.length) ride(built.anchors, built.places);
        framed.current = e < 1 ? mixFrame(from.frame, built.frame, e) : built.frame;
      },
      ...(side ? { camera: (e: number) => void (orbit.current = e < 1 ? mixOrbit(from.orbit, VIEW_ORBIT[side], e) : { ...VIEW_ORBIT[side] }) } : {}),
    });
    const sheet = draw();
    if (check && sheet) {
      const gl = r.renderer.getContext();
      const scale = gl.drawingBufferWidth / sheet.width;
      // A stepped scene is judged step by step; any other by the side readers start on, the first picture.
      for (const i of now.steps?.length ? fresh.builts.map((_, k) => k) : [0]) {
        const at = sheetCell(i, sheet.shots.length, sheet.width, sheet.height);
        const [w, h] = [Math.floor(at.w * scale), Math.floor(at.h * scale)];
        const rgba = new Uint8Array(w * h * 4);
        // WebGL counts rows from the bottom.
        gl.readPixels(Math.round(at.x * scale), gl.drawingBufferHeight - Math.round(at.y * scale) - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
        const b = fresh.builts[i]!;
        for (const problem of sceneProblems({ objects: b.objects, finite: b.finite, labels: b.texts.length, ...sheet.shots[i]!, pixels: countPixels(rgba, r.card) })) {
          post({ t: "error", message: `Scene "${now.title}"${now.steps?.length ? `, step ${i + 1}` : ""}: ${problem}` });
        }
      }
    }
    now.onSettled();
  }, [labels, draw, run, stop, check]);

  // A plain wheel scrolls the page past the scene. With Ctrl or ⌘ it zooms, which is also how a trackpad pinch arrives.
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setUsed(true);
      turn({ ...orbit.current, zoom: orbit.current.zoom * Math.exp(-e.deltaY * 0.01) });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [turn]);

  // A touch anywhere else hands the finger back to the page.
  React.useEffect(() => {
    if (!engaged) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setEngaged(false);
    };
    document.addEventListener("pointerdown", away, true);
    return () => document.removeEventListener("pointerdown", away, true);
  }, [engaged]);

  React.useImperativeHandle(
    handle,
    () => ({
      step: (dir) => {
        if (failure) return false;
        const next = stepView(preset, dir);
        if (!next) return false;
        go(next, true);
        return true;
      },
      focus: () => {
        if (failure) return false;
        box.current?.focus();
        return true;
      },
    }),
    [failure, preset, go],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest("button")) return;
    if (e.pointerType !== "mouse" && !engaged) {
      // A finger or a pen isn't ours yet: the page scrolls. If it turns out to be a tap, the scene takes over.
      tap.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    spread.current = 0;
    setUsed(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const was = fingers.current.get(e.pointerId);
    if (!was) return;
    fingers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const o = orbit.current;
    if (fingers.current.size === 1) return turn({ ...o, azimuth: o.azimuth - (e.clientX - was.x) * DRAG_TURN, polar: o.polar - (e.clientY - was.y) * DRAG_TURN });
    const [a, b] = [...fingers.current.values()];
    const apart = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    if (spread.current > 0 && apart > 0) turn({ ...o, zoom: o.zoom * (apart / spread.current) });
    spread.current = apart;
  };
  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    fingers.current.delete(e.pointerId);
    spread.current = 0;
    const start = tap.current;
    tap.current = null;
    if (e.type === "pointerup" && start?.id === e.pointerId && Math.hypot(e.clientX - start.x, e.clientY - start.y) < TAP_SLOP) {
      setEngaged(true);
      setUsed(true);
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return;
    const o = orbit.current;
    // The arrows move the camera: up looks from higher, right from further round to the right.
    const next: Orbit | null =
      e.key === "ArrowLeft" ? { ...o, azimuth: o.azimuth - KEY_TURN }
      : e.key === "ArrowRight" ? { ...o, azimuth: o.azimuth + KEY_TURN }
      : e.key === "ArrowUp" ? { ...o, polar: o.polar - KEY_TURN }
      : e.key === "ArrowDown" ? { ...o, polar: o.polar + KEY_TURN }
      : e.key === "+" || e.key === "=" ? { ...o, zoom: o.zoom * ZOOM_STEP }
      : e.key === "-" || e.key === "_" ? { ...o, zoom: o.zoom / ZOOM_STEP }
      : null;
    if (next) turn(next);
    else if (e.key === "Home" || e.key === "0") go(latest.current.steps?.length ? stepViewAt(latest.current.steps, latest.current.step, latest.current.view) : latest.current.view, true);
    else if (e.key === "Escape") {
      setEngaged(false);
      e.currentTarget.blur();
    } else return;
    // Handled here, so the page's own keys leave it alone.
    e.preventDefault();
    setUsed(true);
  };

  /** The render check's pictures, by name. */
  const captions = !check ? [] : stepped ? steps.map((s, i) => `Step ${i + 1}${s.title ? `: ${s.title}` : ""}`) : checkViews(view).map((v, i) => `${VIEW_LABEL[v]}${i === 0 ? ", shown first" : ""}`);
  const hint = engaged ? "Drag to turn, pinch to zoom" : keyFocus ? "Arrow keys turn it, + and − zoom, Esc leaves" : coarse ? "Tap to turn" : "Drag to turn";
  return (
    <>
      <div
        ref={box}
        hidden={failure !== null}
        role="application"
        aria-roledescription="3D scene"
        aria-label={title}
        aria-describedby={describedBy}
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown + - Home Escape"
        tabIndex={0}
        className={cn(
          "art-scene relative overflow-hidden rounded-lg outline-none select-none focus-visible:focus-halo",
          !check && "cursor-grab active:cursor-grabbing",
          engaged && "touch-none ring-2 ring-primary",
        )}
        style={{ height: check ? sheetHeight : height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        // A mouse turns the scene without taking keyboard focus, so the page's keys keep working after a drag.
        onMouseDown={(e) => e.preventDefault()}
        onKeyDown={onKeyDown}
        onFocus={(e) => setKeyFocus(e.target === e.currentTarget && e.currentTarget.matches(":focus-visible"))}
        onBlur={() => setKeyFocus(false)}
      >
        <canvas ref={canvas} className="block size-full" aria-hidden="true" />
        {/* One line and dot per label, tying its text to its place; then the text, over the lines. */}
        <svg ref={leaders} className="pointer-events-none absolute inset-0 size-full" aria-hidden="true">
          {labels.map((texts, slot) => (
            <g key={slot}>
              {texts.map((_, i) => (
                // A dark casing under a light line: it has to show on the card and on any surface it crosses.
                <g key={i} style={{ visibility: "hidden" }}>
                  <line stroke="var(--card)" strokeWidth="3" />
                  <line stroke="var(--foreground)" strokeWidth="1" />
                  <circle r="2.5" fill="var(--foreground)" stroke="var(--card)" strokeWidth="1" />
                </g>
              ))}
            </g>
          ))}
        </svg>
        <div ref={tags} className="pointer-events-none absolute inset-0" aria-hidden="true">
          {labels.map((texts, slot) => (
            <div key={slot}>
              {texts.map((text, i) => (
                <span key={i} className="absolute top-0 left-0 max-w-48 truncate rounded-md border border-border bg-popover px-1.5 py-0.5 text-[12px] leading-tight text-foreground" style={{ visibility: "hidden" }}>
                  {text}
                </span>
              ))}
            </div>
          ))}
        </div>
        {captions.map((caption, i) => {
          const rows = Math.ceil(captions.length / 2);
          return (
            <div key={i} className={cn("pointer-events-none absolute border-border", i % 2 === 1 && "border-l", i >= 2 && "border-t")} style={{ left: `${(i % 2) * 50}%`, top: `${(Math.floor(i / 2) * 100) / rows}%`, width: "50%", height: `${100 / rows}%` }}>
              <span className="absolute top-1.5 left-1.5 max-w-[calc(100%-0.75rem)] truncate rounded bg-popover/90 px-1.5 py-0.5 text-[11px] text-muted-foreground">{caption}</span>
            </div>
          );
        })}
        {!check && (engaged || keyFocus || !used) && <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-popover/90 px-2 py-1 text-[12px] text-muted-foreground">{hint}</span>}
        {engaged && (
          <Button size="sm" variant="secondary" className="absolute top-2 right-2" onClick={() => setEngaged(false)}>
            Done
          </Button>
        )}
      </div>
      {failure === "webgl" && (
        <p role="status" className="rounded-lg bg-muted/60 px-4 py-8 text-center text-[13px] text-muted-foreground" data-speak="skip">
          This device can't draw 3D here. The description below says what the scene shows.
        </p>
      )}
      {failure instanceof Error && (
        <div role="alert">
          <Callout tone="danger" title="This scene failed to build" className="my-0">
            <pre className="overflow-x-auto font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{failure.message}</pre>
          </Callout>
        </div>
      )}
      {failure === null && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1" data-speak="skip">
          <div role="group" aria-label="View" className="inline-flex rounded-lg border border-border p-0.5">
            {VIEWS.map((v) => (
              // detail is 0 when a key pressed the button.
              <Button key={v} size="sm" variant={preset === v ? "secondary" : "ghost"} aria-pressed={preset === v} onClick={(e) => go(v, e.detail === 0)} className="h-7 rounded-[6px] px-2.5">
                {VIEW_LABEL[v]}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="Zoom out" onClick={() => turn({ ...orbit.current, zoom: orbit.current.zoom / ZOOM_STEP })}>
              <Minus aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => turn({ ...orbit.current, zoom: orbit.current.zoom * ZOOM_STEP })}>
              <Plus aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
