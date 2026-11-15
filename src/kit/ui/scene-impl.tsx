// The three.js half of <Scene> (src/kit/ui/scene.tsx), downloaded only by pages that draw one.
//
// An artifact's build() adds objects to a scene. Everything else is here, because it is where hand-written
// three.js goes wrong and where the page's own rules apply:
// - one renderer per scene, sized to its box and drawn only when something changed: there is no frame loop;
// - the camera frames whatever was built, so a scene can't be aimed at nothing;
// - a finger on a scene scrolls the page until the reader taps it, and a mouse turns it straight away;
// - colours come from the theme, which three.js can't read (the tokens are oklch());
// - labels are DOM text placed over the canvas;
// - in the render check it draws four views and reports what a screenshot can't say (src/shared/scene.ts).
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
  stepView,
  tokenColor,
  VIEW_LABEL,
  VIEW_ORBIT,
  viewOf,
  VIEWS,
  type Orbit,
  type Rgb,
  type SceneColorName,
  type SceneStats,
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
  handle: React.RefObject<SceneHandle | null>;
  /** The scene has drawn (or can't): the render check may finish. */
  onSettled: () => void;
};

type Rig = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  key: THREE.DirectionalLight;
  fill: THREE.HemisphereLight;
  /** The middle, half-sizes and reach of what was built: what the camera frames. */
  center: THREE.Vector3;
  half: [number, number, number];
  radius: number;
  colors: SceneColors;
  card: Rgb;
};

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

/** Stands the camera on its orbit, framing the scene for a view of this shape. */
function aim(r: Rig, o: Orbit, aspect: number) {
  const distance = fitDistance(r.half, o, FOV, aspect) / o.zoom;
  r.camera.position.set(...orbitPosition([r.center.x, r.center.y, r.center.z], distance, o));
  r.camera.aspect = aspect;
  r.camera.near = Math.max(r.radius / 200, distance - r.radius * 1.05);
  r.camera.far = distance + r.radius * 1.05;
  r.camera.lookAt(r.center);
  r.camera.updateProjectionMatrix();
  r.camera.updateMatrixWorld();
  // The key light rides above and to the left of the camera, so no side the reader turns to is left unlit.
  const m = r.camera.matrixWorld.elements;
  const [side, lift] = [-0.5 * distance, 0.7 * distance];
  r.key.position.set(r.camera.position.x + m[0]! * side + m[4]! * lift, r.camera.position.y + m[1]! * side + m[5]! * lift, r.camera.position.z + m[2]! * side + m[6]! * lift);
  r.key.target.position.copy(r.center);
  r.key.target.updateMatrixWorld();
}

const projected = new THREE.Vector3();
/**
 * Puts one view's labels where their places are on screen, inside the view at (x, y) of size w by h: each
 * label's text, and the line and dot that tie it to its place (the `slot`th run of both lists).
 */
function placeTags(tags: HTMLCollection | undefined, leaders: HTMLCollection | undefined, places: THREE.Vector3[], slot: number, camera: THREE.Camera, x: number, y: number, w: number, h: number, top?: number) {
  if (!tags || !leaders) return;
  const first = slot * places.length;
  const asks = places.map((at, i) => {
    projected.copy(at).project(camera);
    // Not in this view, or nowhere at all (a place worked out from a missing number).
    if (!Number.isFinite(projected.x + projected.y + projected.z) || projected.z <= -1 || projected.z >= 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) return null;
    const el = tags[first + i] as HTMLElement | undefined;
    return el ? { x: (projected.x * 0.5 + 0.5) * w, y: (0.5 - projected.y * 0.5) * h, w: el.offsetWidth, h: el.offsetHeight } : null;
  });
  layoutLabels(asks, w, h, top).forEach((spot, i) => {
    const el = tags[first + i] as HTMLElement | undefined;
    const leader = leaders[first + i] as SVGGElement | undefined;
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

export default function SceneImpl({ title, describedBy, build, deps, view, height, handle, onSettled }: ImplProps) {
  const check = getBoot()?.check === true;
  const box = React.useRef<HTMLDivElement>(null);
  const canvas = React.useRef<HTMLCanvasElement>(null);
  const tags = React.useRef<HTMLDivElement>(null);
  const leaders = React.useRef<SVGSVGElement>(null);
  const rig = React.useRef<Rig | null>(null);
  const orbit = React.useRef<Orbit>({ ...VIEW_ORBIT[view] });
  const places = React.useRef<THREE.Vector3[]>([]);
  /** Set by a build, taken by the frame that first shows it (once its labels are in the page). */
  const built = React.useRef<(Pick<SceneStats, "objects" | "finite" | "labels"> & { places: THREE.Vector3[] }) | null>(null);
  const frame = React.useRef(0);
  const tween = React.useRef(0);
  const fingers = React.useRef(new Map<number, { x: number; y: number }>());
  const tap = React.useRef<{ id: number; x: number; y: number } | null>(null);
  const spread = React.useRef(0);
  const latest = React.useRef({ build, title, view, height, onSettled });
  latest.current = { build, title, view, height, onSettled };

  const [labels, setLabels] = React.useState<string[]>([]);
  const [failure, setFailure] = React.useState<"webgl" | Error | null>(null);
  const [preset, setPreset] = React.useState<SceneView | null>(view);
  /** Touch only: the reader tapped the scene, so a finger now turns it instead of scrolling the page. */
  const [engaged, setEngaged] = React.useState(false);
  const [used, setUsed] = React.useState(false);
  const [keyFocus, setKeyFocus] = React.useState(false);
  const [coarse] = React.useState(() => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);

  /** Draws the scene as it stands. Returns what the renderer drew for the first view, or null when the box isn't laid out. */
  const draw = React.useCallback((): Drawn | null => {
    const r = rig.current;
    const el = box.current;
    if (!r || !el) return null;
    // A scene in a closed tab or section has no size. The render check judges it at a usual one all the same:
    // it is just as blank or as heavy when the reader opens it.
    const w = el.clientWidth || (check ? CHECK_WIDTH : 0);
    const h = el.clientHeight || (check ? Math.round(latest.current.height * 1.5) : 0);
    if (!w || !h) return null;
    const size = r.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) r.renderer.setSize(w, h, false);
    const shot = (o: Orbit, x: number, y: number, vw: number, vh: number, slot: number): Drawn => {
      aim(r, o, vw / vh);
      // WebGL measures a viewport from the bottom of the canvas.
      r.renderer.setViewport(x, h - y - vh, vw, vh);
      r.renderer.setScissor(x, h - y - vh, vw, vh);
      r.renderer.render(r.scene, r.camera);
      // In the render check each view has its name in the top corner; labels start below it.
      placeTags(tags.current?.children, leaders.current?.children, places.current, slot, r.camera, x, y, vw, vh, check ? CAPTION_HEIGHT : undefined);
      const { calls, triangles, lines, points } = r.renderer.info.render;
      return { calls, triangles, lines, points };
    };
    r.renderer.setScissorTest(check);
    if (!check) return shot(orbit.current, 0, 0, w, h, 0);
    const shots = checkViews(latest.current.view).map((v, i) => shot(VIEW_ORBIT[v], (i % 2) * (w / 2), Math.floor(i / 2) * (h / 2), w / 2, h / 2, i));
    return shots[0]!;
  }, [check]);

  const requestDraw = React.useCallback(() => {
    if (frame.current) return;
    // One frame however many pointer moves arrive before it.
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  /** The reader turned or zoomed it by hand. */
  const turn = React.useCallback(
    (next: Orbit) => {
      cancelAnimationFrame(tween.current);
      orbit.current = clampOrbit(next);
      setPreset(viewOf(orbit.current));
      requestDraw();
    },
    [requestDraw],
  );

  /** To one of the views. A press with a pointer turns there, so the reader keeps their bearings; keys jump. */
  const go = React.useCallback(
    (to: SceneView, instant: boolean) => {
      cancelAnimationFrame(tween.current);
      const from = orbit.current;
      const target = VIEW_ORBIT[to];
      setPreset(to);
      const ms = instant ? 0 : motionMs("slow");
      if (!ms) {
        orbit.current = { ...target };
        requestDraw();
        return;
      }
      const ease = motionEase();
      const started = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / ms);
        orbit.current = t < 1 ? mixOrbit(from, target, ease(t)) : { ...target };
        draw();
        if (t < 1) tween.current = requestAnimationFrame(step);
      };
      tween.current = requestAnimationFrame(step);
    },
    [draw, requestDraw],
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
    const scene = new THREE.Scene();
    rig.current = {
      renderer,
      scene,
      camera: new THREE.PerspectiveCamera(FOV, 1, 0.1, 100),
      key: new THREE.DirectionalLight(0xffffff, 2.4),
      fill: new THREE.HemisphereLight(0xffffff, colors.ink, 1.5),
      center: new THREE.Vector3(),
      half: [1, 1, 1],
      radius: 1,
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
      dispose(scene);
      renderer.dispose();
      // Phones allow only a few WebGL contexts per page; give this one back now rather than at garbage collection.
      renderer.forceContextLoss();
      rig.current = null;
    };
  }, [draw, check]);

  // The build, again whenever what it reads changes. The camera keeps its orbit and re-frames what is there now.
  React.useEffect(() => {
    const r = rig.current;
    if (!r) return;
    dispose(r.scene);
    r.scene.clear();
    const found: { text: string; at: ScenePoint }[] = [];
    try {
      latest.current.build({
        scene: r.scene,
        colors: r.colors,
        solid: (geometry, color = r.colors.surface) => {
          const mesh = new THREE.Mesh(geometry, new THREE.MeshLambertMaterial({ color }));
          // Only creases: a cylinder's side stays smooth, its rims are drawn.
          mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 30), new THREE.LineBasicMaterial({ color: r.colors.edge })));
          return mesh;
        },
        label: (text, at) => void found.push({ text: String(text), at }),
      });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      dispose(r.scene);
      r.scene.clear();
      places.current = [];
      built.current = null;
      setLabels([]);
      setFailure(error);
      // Reaches the render check, so a scene that throws fails the write's check.
      post({ t: "error", message: `Scene "${latest.current.title}": build() failed: ${error.message}`, stack: error.stack });
      latest.current.onSettled();
      return;
    }
    r.scene.updateMatrixWorld(true);
    let objects = 0;
    let lit = false;
    r.scene.traverse((o) => {
      const kind = o as Partial<THREE.Mesh & THREE.Line & THREE.Points & THREE.Sprite & THREE.Light>;
      if (kind.isMesh || kind.isLine || kind.isPoints || kind.isSprite) objects++;
      if (kind.isLight) lit = true;
    });
    // three.js leaves NaN vertices out of its bounds, so the frame is of what can be drawn; the render check
    // looks for them itself.
    const bounds = new THREE.Box3().setFromObject(r.scene);
    if (!bounds.isEmpty() && Number.isFinite(bounds.min.lengthSq() + bounds.max.lengthSq())) {
      bounds.getCenter(r.center);
      const size = bounds.getSize(new THREE.Vector3());
      r.half = [size.x / 2, size.y / 2, size.z / 2];
      r.radius = Math.max(size.length() / 2, 1e-4);
    } else {
      r.center.set(0, 0, 0);
      r.half = [1, 1, 1];
      r.radius = 1;
    }
    // A build that brings its own lights is lit its own way.
    if (!lit) r.scene.add(r.fill, r.key, r.key.target);
    const at = found.map((f) => place(f.at));
    built.current = { objects, finite: !check || (allFinite(r.scene) && at.every((v) => Number.isFinite(v.x + v.y + v.z))), labels: found.length, places: at };
    setFailure(null);
    setLabels(found.map((f) => f.text));
  }, deps);

  // The first frame of a build, once its labels are in the page to be placed. In the render check, also what
  // the pixels say.
  React.useLayoutEffect(() => {
    const fresh = built.current;
    built.current = null;
    // Only now, with the labels' text in the page, do their places change: a frame drawn in between still has
    // the old places for the old text.
    if (fresh) places.current = fresh.places;
    const drawn = draw();
    if (!fresh) return;
    const r = rig.current;
    if (check && drawn && r) {
      // The pixels of the view readers start on: the top-left quarter, and WebGL counts rows from the bottom.
      const gl = r.renderer.getContext();
      const [w, h] = [Math.floor(gl.drawingBufferWidth / 2), Math.floor(gl.drawingBufferHeight / 2)];
      const rgba = new Uint8Array(w * h * 4);
      gl.readPixels(0, gl.drawingBufferHeight - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      for (const problem of sceneProblems({ ...fresh, ...drawn, pixels: countPixels(rgba, r.card) })) {
        post({ t: "error", message: `Scene "${latest.current.title}": ${problem}` });
      }
    }
    latest.current.onSettled();
  }, [labels, draw, check]);

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
    else if (e.key === "Home" || e.key === "0") go(latest.current.view, true);
    else if (e.key === "Escape") {
      setEngaged(false);
      e.currentTarget.blur();
    } else return;
    // Handled here, so the page's own keys leave it alone.
    e.preventDefault();
    setUsed(true);
  };

  const slots = check ? checkViews(view) : [view];
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
        style={{ height: check ? Math.round(height * 1.5) : height }}
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
          {slots.flatMap((_, slot) =>
            labels.map((_, i) => (
              // A dark casing under a light line: it has to show on the card and on any surface it crosses.
              <g key={`${slot}:${i}`} style={{ visibility: "hidden" }}>
                <line stroke="var(--card)" strokeWidth="3" />
                <line stroke="var(--foreground)" strokeWidth="1" />
                <circle r="2.5" fill="var(--foreground)" stroke="var(--card)" strokeWidth="1" />
              </g>
            )),
          )}
        </svg>
        <div ref={tags} className="pointer-events-none absolute inset-0" aria-hidden="true">
          {slots.flatMap((_, slot) =>
            labels.map((text, i) => (
              <span key={`${slot}:${i}`} className="absolute top-0 left-0 max-w-48 truncate rounded-md border border-border bg-popover px-1.5 py-0.5 text-[12px] leading-tight text-foreground" style={{ visibility: "hidden" }}>
                {text}
              </span>
            )),
          )}
        </div>
        {check && (
          <>
            <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
            <div className="absolute inset-x-0 top-1/2 h-px bg-border" />
            {checkViews(view).map((v, i) => (
              <span key={v} className="absolute m-1.5 rounded bg-popover/90 px-1.5 py-0.5 text-[11px] text-muted-foreground" style={{ left: `${(i % 2) * 50}%`, top: `${Math.floor(i / 2) * 50}%` }}>
                {VIEW_LABEL[v]}
                {i === 0 ? ", shown first" : ""}
              </span>
            ))}
          </>
        )}
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
