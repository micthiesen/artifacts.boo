// What a <Scene> (src/kit/ui/scene-impl.tsx) needs that isn't three.js: the theme's colours as numbers, where
// the camera stands, where labels go, and what the render check says about what was drawn. Kept free of
// three.js and the DOM so the rules can be tested.

export type Rgb = [r: number, g: number, b: number];

/** The sides a scene can be seen from. `angle` is the three-quarter view a reader starts on. */
export const VIEWS = ["angle", "front", "side", "top"] as const;
export type SceneView = (typeof VIEWS)[number];
export const VIEW_LABEL: Record<SceneView, string> = { angle: "Angle", front: "Front", side: "Side", top: "Top" };

/** Where the camera sits on a sphere around the scene: `azimuth` around the y axis from +z, `polar` down from +y. */
export type Orbit = { azimuth: number; polar: number; zoom: number };

const DEG = Math.PI / 180;
/** Never exactly overhead or underneath: the camera's "up" would have no direction there. */
export const POLAR_MIN = 0.02;
export const POLAR_MAX = Math.PI - 0.02;
export const ZOOM_MIN = 0.4;
export const ZOOM_MAX = 4;

export const VIEW_ORBIT: Record<SceneView, Orbit> = {
  angle: { azimuth: 35 * DEG, polar: 62 * DEG, zoom: 1 },
  front: { azimuth: 0, polar: 90 * DEG, zoom: 1 },
  side: { azimuth: 90 * DEG, polar: 90 * DEG, zoom: 1 },
  top: { azimuth: 0, polar: POLAR_MIN, zoom: 1 },
};

export function clampOrbit(o: Orbit): Orbit {
  return {
    azimuth: o.azimuth,
    polar: Math.min(POLAR_MAX, Math.max(POLAR_MIN, o.polar)),
    zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, o.zoom)),
  };
}

/** The camera's position for an orbit around `target` at `distance`. */
export function orbitPosition(target: readonly [number, number, number], distance: number, o: Orbit): [number, number, number] {
  const s = Math.sin(o.polar);
  return [target[0] + distance * s * Math.sin(o.azimuth), target[1] + distance * Math.cos(o.polar), target[2] + distance * s * Math.cos(o.azimuth)];
}

/**
 * How far back a camera on this orbit stands so a box of half-sizes `half` (centred on what it looks at) just
 * fits a frame of this shape, with a margin for labels. Fitted to the box as seen from this side, not to a
 * sphere around it: a tall rack or a flat room would otherwise sit small in the middle of its card.
 */
export function fitDistance(half: readonly [number, number, number], o: Orbit, fovDeg: number, aspect: number, margin = 1.15): number {
  const tanV = Math.tan((fovDeg * DEG) / 2);
  const tanH = tanV * aspect;
  // From what it looks at toward the camera, and the camera's own right and up.
  const s = Math.sin(o.polar);
  const toward = [s * Math.sin(o.azimuth), Math.cos(o.polar), s * Math.cos(o.azimuth)] as const;
  const flat = Math.hypot(toward[0], toward[2]) || 1;
  const right = [toward[2] / flat, 0, -toward[0] / flat] as const;
  const up = [-right[2] * toward[1], right[2] * toward[0] - right[0] * toward[2], right[0] * toward[1]] as const;
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  let distance = 1e-6;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const corner = [sx * half[0], sy * half[1], sz * half[2]];
        // A corner nearer the camera needs the camera further back by as much.
        distance = Math.max(distance, Math.abs(dot(corner, up)) / tanV + dot(corner, toward), Math.abs(dot(corner, right)) / tanH + dot(corner, toward));
      }
    }
  }
  return distance * margin;
}

/** The orbit part-way from `a` to `b`, turning the short way round. */
export function mixOrbit(a: Orbit, b: Orbit, t: number): Orbit {
  let turn = (b.azimuth - a.azimuth) % (2 * Math.PI);
  if (turn > Math.PI) turn -= 2 * Math.PI;
  if (turn < -Math.PI) turn += 2 * Math.PI;
  return { azimuth: a.azimuth + turn * t, polar: a.polar + (b.polar - a.polar) * t, zoom: a.zoom + (b.zoom - a.zoom) * t };
}

/** The view an orbit is, if it is exactly one of them (the bar marks it pressed). */
export function viewOf(o: Orbit): SceneView | null {
  const near = (x: number, y: number) => Math.abs(x - y) < 1e-3;
  const wrap = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return VIEWS.find((v) => near(wrap(o.azimuth), wrap(VIEW_ORBIT[v].azimuth)) && near(o.polar, VIEW_ORBIT[v].polar) && near(o.zoom, 1)) ?? null;
}

/**
 * The view the page's h (-1) or l (1) steps to from `at` (null: turned by hand), or null past either end,
 * where the key moves on to the block beside.
 */
export function stepView(at: SceneView | null, dir: 1 | -1): SceneView | null {
  const from = at ? VIEWS.indexOf(at) : dir > 0 ? -1 : VIEWS.length;
  return VIEWS[from + dir] ?? null;
}

// ---- labels ------------------------------------------------------------------

/** A label to place: where its point is in the view, and how big its text is. Null when the point isn't in view. */
export type LabelAsk = { x: number; y: number; w: number; h: number } | null;
/** Where a label's box goes, and where its leader line meets it. Null when it isn't shown. */
export type LabelSpot = { left: number; top: number; tipX: number; tipY: number } | null;

const LABEL_STEM = 10;
const LABEL_GAP = 2;
const LABEL_EDGE = 2;

/**
 * Places labels above their points without covering each other: things stacked on top of one another (the
 * units of a rack, anything seen from above) put their points close together or on the same spot. A label that
 * would land on another moves down until it is clear, and a line back to its point says whose it is. One that
 * no longer fits the view isn't shown. `top` keeps a strip at the top of the view free (the render check's
 * caption).
 */
export function layoutLabels(asks: readonly LabelAsk[], width: number, height: number, top = LABEL_EDGE): LabelSpot[] {
  const spots: LabelSpot[] = asks.map(() => null);
  const placed: { left: number; top: number; w: number; h: number }[] = [];
  const order = asks
    .map((ask, i) => ({ ask, i }))
    .filter((a): a is { ask: NonNullable<LabelAsk>; i: number } => a.ask !== null)
    .sort((a, b) => a.ask.y - a.ask.h - (b.ask.y - b.ask.h) || a.i - b.i);
  for (const { ask, i } of order) {
    const left = Math.min(Math.max(ask.x - ask.w / 2, LABEL_EDGE), Math.max(LABEL_EDGE, width - ask.w - LABEL_EDGE));
    let at = Math.max(ask.y - ask.h - LABEL_STEM, top);
    for (let moved = true; moved; ) {
      moved = false;
      for (const b of placed) {
        if (left < b.left + b.w + LABEL_GAP && left + ask.w + LABEL_GAP > b.left && at < b.top + b.h + LABEL_GAP && at + ask.h + LABEL_GAP > b.top) {
          at = b.top + b.h + LABEL_GAP;
          moved = true;
        }
      }
    }
    if (at + ask.h > height - LABEL_EDGE) continue;
    placed.push({ left, top: at, w: ask.w, h: ask.h });
    const tipX = Math.min(Math.max(ask.x, left + 3), left + ask.w - 3);
    // The line runs to the edge of the box that faces the point; a box sitting on its point needs none.
    spots[i] = { left, top: at, tipX, tipY: at + ask.h <= ask.y ? at + ask.h : at >= ask.y ? at : ask.y };
  }
  return spots;
}

// ---- colours ---------------------------------------------------------------

/** OKLCH to gamma-encoded sRGB, each channel 0 to 1, clipped to the gamut. */
export function oklchToSrgb(l: number, c: number, hDeg: number): Rgb {
  const h = hDeg * DEG;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const encode = (x: number) => {
    const v = Math.min(1, Math.max(0, x));
    return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
  };
  return [encode(linear[0]!), encode(linear[1]!), encode(linear[2]!)];
}

/**
 * A CSS colour as sRGB, for the forms the theme and artifacts use: oklch(L C H), #rgb, #rrggbb and
 * rgb(r g b). three.js reads none of the theme's oklch() tokens itself.
 */
export function parseColor(css: string): Rgb | null {
  const s = css.trim().toLowerCase();
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/[^)]*)?\)$/.exec(s);
  if (ok) return oklchToSrgb(Number(ok[1]) / (ok[2] ? 100 : 1), Number(ok[3]), Number(ok[4]));
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((ch) => ch + ch).join("") : hex;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255) as Rgb;
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(s);
  if (rgb) return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  return null;
}

/**
 * The theme tokens a scene's `colors` come from, and what they fall back to off the page (tests, no
 * stylesheet). Not the lights that say whose something is (moon, iris, aqua: Look in AGENTS.md): parts of a
 * scene are told apart with the series hues, like a chart's.
 */
export const SCENE_TOKENS = {
  surface: ["--input", "oklch(0.52 0.02 262)"],
  edge: ["--muted-foreground", "oklch(0.76 0.014 262)"],
  ink: ["--card", "oklch(0.188 0.016 262)"],
  text: ["--foreground", "oklch(0.95 0.012 85)"],
  muted: ["--muted-foreground", "oklch(0.76 0.014 262)"],
  line: ["--border", "oklch(0.285 0.016 262)"],
  positive: ["--positive", "oklch(0.79 0.15 158)"],
  caution: ["--caution", "oklch(0.84 0.135 80)"],
  negative: ["--negative", "oklch(0.72 0.17 22)"],
} as const satisfies Record<string, readonly [token: string, fallback: string]>;
export type SceneColorName = keyof typeof SCENE_TOKENS;
export const SERIES_TOKENS: readonly (readonly [string, string])[] = [
  ["--chart-1", "oklch(0.74 0.14 292)"],
  ["--chart-2", "oklch(0.82 0.12 200)"],
  ["--chart-3", "oklch(0.85 0.14 78)"],
  ["--chart-4", "oklch(0.69 0.17 20)"],
  ["--chart-5", "oklch(0.77 0.15 150)"],
  ["--chart-6", "oklch(0.76 0.14 335)"],
];

/** A token's colour: what the page's stylesheet says, or the fallback when it says nothing readable. */
export function tokenColor(read: (token: string) => string, [token, fallback]: readonly [string, string]): Rgb {
  return parseColor(read(token)) ?? parseColor(fallback)!;
}

// ---- the render check --------------------------------------------------------

/** Rough ceilings for a phone to turn a scene smoothly; a scene past them fails its render check. */
export const MAX_TRIANGLES = 500_000;
export const MAX_DRAW_CALLS = 1_000;
export const MAX_LABELS = 12;

export type SceneStats = {
  /** Meshes, lines, points and sprites the build added. */
  objects: number;
  /** Whether everything built has finite bounds. */
  finite: boolean;
  /** From the renderer, for the view readers start on. */
  calls: number;
  triangles: number;
  lines: number;
  points: number;
  /** From the pixels of that view. */
  pixels: PixelCount;
  labels: number;
};

export type PixelCount = { total: number; drawn: number; visible: number };

const luminance = (r: number, g: number, b: number) => {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
};

/** Below this contrast against the card, a surface is there but nobody can make it out. */
const SEEN_CONTRAST = 1.5;

/**
 * Counts an RGBA frame (clear colour transparent): pixels something was drawn on, and those of them that stand
 * out from the card the scene sits on.
 */
export function countPixels(rgba: ArrayLike<number>, card: Rgb): PixelCount {
  const cardL = luminance(card[0] * 255, card[1] * 255, card[2] * 255);
  let drawn = 0;
  let visible = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3]!;
    if (alpha < 16) continue;
    drawn++;
    // The canvas holds premultiplied colour; an edge pixel's share of the card comes back in.
    const k = alpha / 255;
    const l = luminance(rgba[i]! + card[0] * 255 * (1 - k), rgba[i + 1]! + card[1] * 255 * (1 - k), rgba[i + 2]! + card[2] * 255 * (1 - k));
    const contrast = (Math.max(l, cardL) + 0.05) / (Math.min(l, cardL) + 0.05);
    if (contrast >= SEEN_CONTRAST) visible++;
  }
  return { total: rgba.length / 4, drawn, visible };
}

const count = (n: number) => n.toLocaleString("en-US");

/**
 * What is wrong with a scene as drawn, most basic first: a scene that built nothing isn't also told about its
 * triangle count. Empty when it is fine.
 */
export function sceneProblems(s: SceneStats): string[] {
  if (s.objects === 0) return ["build() added nothing to draw: add meshes, lines or points to the `scene` it is given"];
  if (!s.finite) return ["some positions aren't finite (NaN or Infinity), in an object or a label: look for a division by zero or a missing value"];
  if (s.calls === 0 || s.triangles + s.lines + s.points === 0) return ["nothing was drawn: every object is hidden or its geometry is empty"];
  if (s.pixels.drawn === 0) return ["the view readers start on shows nothing: what was built has no size, is fully transparent, or faces away (a flat shape seen from behind or edge-on)"];
  const out: string[] = [];
  if (s.pixels.visible < s.pixels.drawn * 0.02) out.push("it is drawn too dark to see on the card: use solid() or the `colors` build() is given, not near-black materials");
  if (s.triangles > MAX_TRIANGLES) out.push(`it draws ${count(s.triangles)} triangles; keep a scene under ${count(MAX_TRIANGLES)} so a phone can turn it (fewer segments, simpler shapes)`);
  if (s.calls > MAX_DRAW_CALLS) out.push(`it takes ${count(s.calls)} draw calls; draw repeated objects with one InstancedMesh to stay under ${count(MAX_DRAW_CALLS)}`);
  if (s.labels > MAX_LABELS) out.push(`it has ${s.labels} labels, which overlap on a phone: keep to ${MAX_LABELS} and say the rest in the description or a table`);
  return out;
}
