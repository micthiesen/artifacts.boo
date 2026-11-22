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

// ---- steps -------------------------------------------------------------------

/**
 * One stop in a scene walked through in order (<Scene steps>): what to say, and optionally the side to see it
 * from. build() is told which step is showing and builds the scene as it is then.
 */
export type SceneStep = { title?: string; text: string; view?: SceneView };

/** Past this a reader loses the thread, and the render check's sheet of steps gets too small to judge. */
export const MAX_STEPS = 8;

/** What is wrong with `steps` as written (the first thing), or null. */
export function stepProblem(steps: unknown): string | null {
  if (!Array.isArray(steps) || steps.length < 2) return "steps is a list of at least two {title?, text, view?}: one step is just the scene";
  if (steps.length > MAX_STEPS) return `${steps.length} steps is too many to follow: keep to ${MAX_STEPS} (split a longer walk-through into two scenes)`;
  for (const [i, step] of steps.entries()) {
    const s = (step ?? {}) as Partial<Record<keyof SceneStep, unknown>>;
    if (typeof s.text !== "string" || !s.text.trim()) return `step ${i + 1} needs "text": what this step shows, in a sentence`;
    if (s.title !== undefined && typeof s.title !== "string") return `step ${i + 1}'s "title" is a few words of text`;
    if (s.view !== undefined && !VIEWS.includes(s.view as SceneView)) return `step ${i + 1}'s "view" is one of ${VIEWS.map((v) => `"${v}"`).join(", ")}`;
  }
  return null;
}

/** The side step `at` is seen from: the last one a step up to it asked for, else the scene's own. */
export function stepViewAt(steps: readonly Pick<SceneStep, "view">[], at: number, first: SceneView): SceneView {
  for (let i = Math.min(at, steps.length - 1); i >= 0; i--) if (steps[i]!.view) return steps[i]!.view!;
  return first;
}

/** Where the render check draws its `i`th picture of `count` (four sides, or one per step): two across. */
export function sheetCell(i: number, count: number, width: number, height: number): { x: number; y: number; w: number; h: number } {
  const rows = Math.ceil(count / 2);
  return { x: (i % 2) * (width / 2), y: Math.floor(i / 2) * (height / rows), w: width / 2, h: height / rows };
}

// ---- labels ------------------------------------------------------------------

/** Where a label may be pushed out to, when its parts are small and close together (`label(text, at, { side })`). */
export const LABEL_SIDES = ["left", "right", "up"] as const;
export type LabelSide = (typeof LABEL_SIDES)[number];
export type LabelOptions = { side?: LabelSide };

/** A box on screen, in the view's pixels. */
export type Rect = { left: number; top: number; right: number; bottom: number };

/**
 * A label to place: where its point is in the view, how big its text is, the side its author asked for, and
 * the box its own part takes up on screen (when it names a part). Null when the point isn't in view.
 */
export type LabelAsk = { x: number; y: number; w: number; h: number; side?: LabelSide; part?: Rect | null } | null;
/** Where a label's box goes, and where its leader line meets it. Null when it isn't shown. */
export type LabelSpot = { left: number; top: number; tipX: number; tipY: number } | null;

const LABEL_STEM = 10;
const LABEL_GAP = 3;
const LABEL_EDGE = 2;
/** No label covers a point another label (or itself) names: the dot stays this clear. */
const DOT_CLEAR = 5;
/** Two points closer than this on screen can't be told apart, whatever their labels do. */
export const POINTS_APART = 12;

type Candidate = { left: number; top: number; dir: "up" | "down" | LabelSide };

/** Where the line from (x, y) meets the box: the nearest point of its edge. */
function tip(x: number, y: number, b: Rect): { tipX: number; tipY: number } {
  const tipX = x < b.left ? b.left : x > b.right ? b.right : Math.min(Math.max(x, b.left + 3), b.right - 3);
  const tipY = y < b.top ? b.top : y > b.bottom ? b.bottom : y;
  return { tipX, tipY };
}

const area = (r: Rect) => Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top);
const overlap = (a: Rect, b: Rect): number => area({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
const intersects = (a: Rect, b: Rect, gap = 0) => a.left < b.right + gap && a.right + gap > b.left && a.top < b.bottom + gap && a.bottom + gap > b.top;
/** How much of `part` the box covers, 0 to 1. */
export const covers = (box: Rect, part: Rect): number => (area(part) > 0 ? overlap(box, part) / area(part) : 0);

/** Whether segments p1p2 and p3p4 cross. */
function crosses(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (d === 0) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}

/** Whether the segment from (ax, ay) to (bx, by) passes through the box. */
function through(ax: number, ay: number, bx: number, by: number, r: Rect): boolean {
  for (let k = 1; k < 8; k++) {
    const x = ax + ((bx - ax) * k) / 8;
    const y = ay + ((by - ay) * k) / 8;
    if (x > r.left && x < r.right && y > r.top && y < r.bottom) return true;
  }
  return false;
}

/** How far the point (px, py) is from the segment from (ax, ay) to (bx, by). */
function distance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const [dx, dy] = [bx - ax, by - ay];
  const t = dx || dy ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** The places a label could go around its point: above first, then out to either side, then below. */
function candidates(ask: NonNullable<LabelAsk>): Candidate[] {
  const { x, y, w, h } = ask;
  const out: Candidate[] = [];
  const row = h + LABEL_GAP;
  for (let lift = 0; lift < 4; lift++) {
    for (let k = 0; k <= 12; k++) {
      // 0, then alternately right and left, further each time, out to a little past the label's own width.
      const dx = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((w + 24) / 6);
      out.push({ left: x - w / 2 + dx, top: y - LABEL_STEM - h - lift * row, dir: "up" });
    }
  }
  for (const reach of [0, 14, 30, 50]) {
    for (const dy of [0, -1, 1, -2, 2]) {
      const top = y - h / 2 + dy * row;
      out.push({ left: x + LABEL_STEM + reach, top, dir: "right" }, { left: x - LABEL_STEM - reach - w, top, dir: "left" });
    }
  }
  for (let lift = 0; lift < 2; lift++) {
    for (let k = 0; k <= 8; k++) {
      const dx = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * ((w + 24) / 6);
      out.push({ left: x - w / 2 + dx, top: y + LABEL_STEM + lift * row, dir: "down" });
    }
  }
  return out;
}

/**
 * For labels whose boxes would collide above their points: the same labels packed side by side in one row
 * above them all, in the order of their points and centred on them, so neighbours fan out left and right with
 * the lines kept short. Each label's place in its row, by index; a row too wide for the view isn't made.
 */
function rows(shown: readonly { ask: NonNullable<LabelAsk>; i: number }[], width: number): Map<number, { left: number; top: number }> {
  const out = new Map<number, { left: number; top: number }>();
  const home = shown.map(({ ask }) => ({ left: ask.x - ask.w / 2, top: ask.y - LABEL_STEM - ask.h, right: ask.x + ask.w / 2, bottom: ask.y - LABEL_STEM }));
  const group = shown.map((_, k) => k);
  const root = (k: number): number => (group[k] === k ? k : (group[k] = root(group[k]!)));
  for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) if (intersects(home[a]!, home[b]!, LABEL_GAP)) group[root(a)] = root(b);
  const clusters = new Map<number, number[]>();
  for (let k = 0; k < shown.length; k++) clusters.set(root(k), [...(clusters.get(root(k)) ?? []), k]);
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    members.sort((a, b) => shown[a]!.ask.x - shown[b]!.ask.x);
    const total = members.reduce((sum, k) => sum + shown[k]!.ask.w, 0) + LABEL_GAP * (members.length - 1);
    if (total > width - 2 * LABEL_EDGE) continue;
    const middle = members.reduce((sum, k) => sum + shown[k]!.ask.x, 0) / members.length;
    let left = Math.min(Math.max(middle - total / 2, LABEL_EDGE), width - total - LABEL_EDGE);
    const top = Math.min(...members.map((k) => home[k]!.top));
    for (const k of members) {
      out.set(shown[k]!.i, { left, top });
      left += shown[k]!.ask.w + LABEL_GAP;
    }
  }
  return out;
}

/**
 * How much of a part a box hides, past the share a part's on-screen box can lose without the part being hidden:
 * the box round its corners is bigger than the part looks, and a label over its corner hides nothing.
 */
const hides = (box: Rect, part: Rect) => Math.max(0, covers(box, part) - 0.25);

/** What a direction costs, before anything is in the way: above is where a reader looks first. */
const DIR_COST = { up: 0, right: 8, left: 8, down: 18 } as const;
/** A side the author asked for is tried before any other. */
const UNASKED = 40;

/**
 * Places labels around their points without covering each other or any point a label names. Each label goes
 * where its line is shortest and crosses nothing: above its point when there is room, else fanned out to
 * a side or higher up with a longer line, else below. Parts that are small and close together put their
 * points close together, so their labels fan out left and right of the cluster. A label for which there is
 * no room in the view isn't shown. `top` keeps a strip at the top of the view free (the render check's
 * caption). Labels are placed top to bottom, so the ones a reader meets first get the best spots.
 */
export function layoutLabels(asks: readonly LabelAsk[], width: number, height: number, top = LABEL_EDGE): LabelSpot[] {
  const spots: LabelSpot[] = asks.map(() => null);
  const shown = asks.map((ask, i) => ({ ask, i })).filter((a): a is { ask: NonNullable<LabelAsk>; i: number } => a.ask !== null);
  const dots = shown.map(({ ask }) => ({ x: ask.x, y: ask.y }));
  const placed: { box: Rect; x: number; y: number; tipX: number; tipY: number }[] = [];
  const order = [...shown].sort((a, b) => a.ask.y - b.ask.y || a.ask.x - b.ask.x || a.i - b.i);
  const packed = rows(shown, width);
  for (const { ask, i } of order) {
    let best: { cost: number; box: Rect } | null = null;
    const row = packed.get(i);
    // Its place in a row with its neighbours comes first, so it wins a tie with going up on its own.
    for (const c of [...(row ? [{ ...row, dir: "up" as const, row: true }] : []), ...candidates(ask)]) {
      // Pulled in from the sides, never past them; a label that doesn't fit top to bottom here is tried elsewhere.
      const left = Math.min(Math.max(c.left, LABEL_EDGE), width - ask.w - LABEL_EDGE);
      if (left < LABEL_EDGE - 0.01 || c.top < top || c.top + ask.h > height - LABEL_EDGE) continue;
      const box = { left, top: c.top, right: left + ask.w, bottom: c.top + ask.h };
      if (placed.some((p) => intersects(box, p.box, LABEL_GAP))) continue;
      if (dots.some((d) => d.x > box.left - DOT_CLEAR && d.x < box.right + DOT_CLEAR && d.y > box.top - DOT_CLEAR && d.y < box.bottom + DOT_CLEAR)) continue;
      const t = tip(ask.x, ask.y, box);
      let cost = Math.hypot(t.tipX - ask.x, t.tipY - ask.y) + DIR_COST[c.dir] + (ask.side && ask.side !== c.dir ? UNASKED : 0);
      // Above or below, a label centred on its point reads best: off-centre costs a little, so a near tie stays put.
      // A row is centred on its labels' points together.
      if ((c.dir === "up" || c.dir === "down") && !("row" in c)) cost += 0.05 * Math.abs(box.left + ask.w / 2 - ask.x);
      for (const p of placed) {
        if (crosses(ask.x, ask.y, t.tipX, t.tipY, p.x, p.y, p.tipX, p.tipY)) cost += 30;
        if (through(ask.x, ask.y, t.tipX, t.tipY, p.box)) cost += 60;
        if (through(p.x, p.y, p.tipX, p.tipY, box)) cost += 40;
      }
      // A line running over another label's point makes it look like it names that one.
      for (const d of dots) if ((d.x !== ask.x || d.y !== ask.y) && distance(d.x, d.y, ask.x, ask.y, t.tipX, t.tipY) < DOT_CLEAR) cost += 20;
      if (ask.part) cost += 80 * hides(box, ask.part);
      for (const other of shown) if (other.ask !== ask && other.ask.part) cost += 20 * hides(box, other.ask.part);
      if (!best || cost < best.cost - 1e-9) best = { cost, box };
    }
    if (!best) continue;
    const t = tip(ask.x, ask.y, best.box);
    placed.push({ box: best.box, x: ask.x, y: ask.y, ...t });
    spots[i] = { left: best.box.left, top: best.box.top, ...t };
  }
  return spots;
}

/** A label's place relative to its point, kept while the reader turns the scene so the labels move with it. */
export type LabelHold = { dx: number; dy: number } | null;
export const holdOf = (asks: readonly LabelAsk[], spots: readonly LabelSpot[]): LabelHold[] =>
  spots.map((s, i) => (s && asks[i] ? { dx: s.left - asks[i]!.x, dy: s.top - asks[i]!.y } : null));

/**
 * The labels where they were relative to their points, for frames drawn while the camera is still moving: a
 * fresh layout each frame would make labels jump from side to side as the scene turns. Kept inside the view.
 * Labels are laid out again (layoutLabels) once the camera settles.
 */
export function heldLabels(asks: readonly LabelAsk[], holds: readonly LabelHold[], width: number, height: number, top = LABEL_EDGE): LabelSpot[] {
  return asks.map((ask, i) => {
    const hold = holds[i];
    if (!ask || !hold) return null;
    const left = Math.min(Math.max(ask.x + hold.dx, LABEL_EDGE), Math.max(LABEL_EDGE, width - ask.w - LABEL_EDGE));
    const at = Math.min(Math.max(ask.y + hold.dy, top), Math.max(top, height - ask.h - LABEL_EDGE));
    return { left, top: at, ...tip(ask.x, ask.y, { left, top: at, right: left + ask.w, bottom: at + ask.h }) };
  });
}

/** What the render check found wrong with one view's labels. */
export type LabelTrouble =
  | { kind: "overlap"; a: string; b: string }
  | { kind: "close"; a: string; b: string; px: number }
  | { kind: "covers"; a: string; share: number }
  | { kind: "hidden"; a: string };

/** A label covering this much of its own part's box on screen hides what it names. */
export const COVERS_PART = 0.5;

/**
 * Judges one view's labels as laid out: boxes that overlap, points too close to tell apart, a label sitting
 * over most of the part it names, and labels left out for lack of room. Labels whose point is out of view
 * (a null ask) aren't judged.
 */
export function labelTrouble(texts: readonly string[], asks: readonly LabelAsk[], spots: readonly LabelSpot[]): LabelTrouble[] {
  const out: LabelTrouble[] = [];
  const box = (i: number): Rect | null => {
    const s = spots[i];
    const a = asks[i];
    return s && a ? { left: s.left, top: s.top, right: s.left + a.w, bottom: s.top + a.h } : null;
  };
  for (let i = 0; i < asks.length; i++) {
    const a = asks[i];
    if (!a) continue;
    const bi = box(i);
    if (!bi) {
      out.push({ kind: "hidden", a: texts[i]! });
      continue;
    }
    for (let j = i + 1; j < asks.length; j++) {
      const b = asks[j];
      if (!b) continue;
      const bj = box(j);
      if (bj && intersects(bi, bj)) out.push({ kind: "overlap", a: texts[i]!, b: texts[j]! });
      const px = Math.hypot(a.x - b.x, a.y - b.y);
      if (px < POINTS_APART) out.push({ kind: "close", a: texts[i]!, b: texts[j]!, px: Math.round(px) });
    }
    if (a.part) {
      const share = covers(bi, a.part);
      if (share >= COVERS_PART) out.push({ kind: "covers", a: texts[i]!, share });
    }
  }
  return out;
}

/** The render check's warning for one view's trouble, or null when there is none. `where` says which step and width. */
export function labelWarning(trouble: readonly LabelTrouble[], where: string): string | null {
  if (!trouble.length) return null;
  const q = (s: string) => `"${s}"`;
  const said = trouble.map((t) =>
    t.kind === "overlap" ? `${q(t.a)} and ${q(t.b)} overlap`
    : t.kind === "close" ? `${q(t.a)} and ${q(t.b)} point to places ${t.px} px apart, too close to tell which is which`
    : t.kind === "covers" ? `${q(t.a)} covers ${Math.round(t.share * 100)}% of the part it names`
    : `${q(t.a)} has no room and isn't shown`,
  );
  return `${where}: labels crowd: ${said.join("; ")}. Keep one or two labels on small neighbouring parts and say the rest in the step's text, anchor labels further apart, or push one out with label(text, at, { side: "left" | "right" | "up" })`;
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
