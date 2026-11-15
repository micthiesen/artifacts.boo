// The parts of a <Scene> that aren't three.js (src/shared/scene.ts): the theme's colours as numbers, where the
// camera stands, and what the render check says about what was drawn.
import { describe, expect, test } from "bun:test";
import {
  clampOrbit,
  countPixels,
  fitDistance,
  layoutLabels,
  MAX_DRAW_CALLS,
  MAX_LABELS,
  MAX_TRIANGLES,
  mixOrbit,
  oklchToSrgb,
  orbitPosition,
  parseColor,
  POLAR_MIN,
  sceneProblems,
  sheetCell,
  stepProblem,
  stepView,
  stepViewAt,
  tokenColor,
  VIEW_ORBIT,
  viewOf,
  ZOOM_MAX,
  type Rgb,
  type SceneStats,
} from "../src/shared/scene.ts";

const near = (a: readonly number[], b: readonly number[], by = 0.004) => a.every((v, i) => Math.abs(v - b[i]!) <= by);

describe("theme colours", () => {
  test("oklch converts to sRGB: white, black and the three primaries", () => {
    expect(near(oklchToSrgb(1, 0, 0), [1, 1, 1])).toBe(true);
    expect(near(oklchToSrgb(0, 0, 0), [0, 0, 0])).toBe(true);
    expect(near(oklchToSrgb(0.62796, 0.25768, 29.234), [1, 0, 0])).toBe(true);
    expect(near(oklchToSrgb(0.86644, 0.29483, 142.495), [0, 1, 0])).toBe(true);
    expect(near(oklchToSrgb(0.45201, 0.31321, 264.052), [0, 0, 1])).toBe(true);
  });

  test("a colour outside sRGB is clipped, never negative or over 1", () => {
    for (const v of oklchToSrgb(0.9, 0.4, 150)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  test("reads the forms the theme and artifacts write, and nothing else", () => {
    expect(near(parseColor("oklch(0.62796 0.25768 29.234)")!, [1, 0, 0])).toBe(true);
    expect(near(parseColor(" oklch(62.796% 0.25768 29.234deg / 0.5) ")!, [1, 0, 0])).toBe(true);
    expect(parseColor("#fff")).toEqual([1, 1, 1]);
    expect(parseColor("#FF0000")).toEqual([1, 0, 0]);
    expect(parseColor("rgb(255, 0, 0)")).toEqual([1, 0, 0]);
    expect(parseColor("rgb(0 255 0 / 50%)")).toEqual([0, 1, 0]);
    expect(parseColor("color-mix(in oklab, red, blue)")).toBeNull();
    expect(parseColor("")).toBeNull();
  });

  test("a token the page doesn't define falls back to the theme's value", () => {
    const fallback = tokenColor(() => "", ["--primary", "oklch(0.62796 0.25768 29.234)"]);
    expect(near(fallback, [1, 0, 0])).toBe(true);
    expect(tokenColor(() => " #00ff00", ["--primary", "oklch(0 0 0)"])).toEqual([0, 1, 0]);
  });
});

describe("the camera", () => {
  test("the camera stands where the box, seen from that side, just fits the frame", () => {
    const tan = Math.tan((16 * Math.PI) / 180);
    // From the front, a 2 x 4 x 6 box in a wide frame is limited by its height; its near face is 3 closer.
    expect(fitDistance([1, 2, 3], VIEW_ORBIT.front, 32, 2, 1)).toBeCloseTo(2 / tan + 3, 6);
    // From the side its depth is the width on screen: still the height that limits it, with the near face 1 closer.
    expect(fitDistance([1, 2, 3], VIEW_ORBIT.side, 32, 2, 1)).toBeCloseTo(2 / tan + 1, 6);
    // A narrow frame is limited by width instead, so the camera stands further back.
    expect(fitDistance([1, 2, 3], VIEW_ORBIT.front, 32, 0.25, 1)).toBeCloseTo(1 / (tan * 0.25) + 3, 6);
    // A wide flat thing fills its frame: far closer than a sphere around it would allow.
    const sphere = Math.hypot(2, 0.2, 2) / Math.sin((16 * Math.PI) / 180);
    expect(fitDistance([2, 0.2, 2], VIEW_ORBIT.front, 32, 2, 1)).toBeLessThan(sphere * 0.6);
    // Every corner is inside the frame from any side, and nothing has no distance at all.
    for (const o of [VIEW_ORBIT.angle, VIEW_ORBIT.top, { azimuth: 4, polar: 2.5, zoom: 1 }]) {
      const d = fitDistance([1, 2, 3], o, 32, 1.3, 1);
      const [cx, cy, cz] = orbitPosition([0, 0, 0], d, o);
      for (const corner of [[1, 2, 3], [-1, 2, 3], [1, -2, 3], [1, 2, -3], [-1, -2, -3], [-1, -2, 3], [-1, 2, -3], [1, -2, -3]]) {
        const depth = -((corner[0]! - cx) * cx + (corner[1]! - cy) * cy + (corner[2]! - cz) * cz) / d;
        const off = Math.sqrt(Math.max(0, (corner[0]! - cx) ** 2 + (corner[1]! - cy) ** 2 + (corner[2]! - cz) ** 2 - depth ** 2));
        // Within the widest half-angle of the frame (its diagonal), with room for rounding.
        expect(off / depth).toBeLessThanOrEqual(tan * Math.hypot(1, 1.3) + 1e-9);
        expect(depth).toBeGreaterThan(0);
      }
    }
    expect(fitDistance([0, 0, 0], VIEW_ORBIT.front, 32, 1)).toBeGreaterThan(0);
  });

  test("each view stands where its name says", () => {
    const at = (v: keyof typeof VIEW_ORBIT) => orbitPosition([0, 0, 0], 10, VIEW_ORBIT[v]);
    expect(near(at("front"), [0, 0, 10], 1e-6)).toBe(true);
    expect(near(at("side"), [10, 0, 0], 1e-6)).toBe(true);
    const top = at("top");
    expect(top[1]).toBeGreaterThan(9.99);
    const angle = at("angle");
    expect(angle.every((v) => v > 0)).toBe(true);
    expect(near(orbitPosition([1, 2, 3], 10, VIEW_ORBIT.front), [1, 2, 13], 1e-6)).toBe(true);
  });

  test("turning by hand stays off the poles and within the zoom range", () => {
    const o = clampOrbit({ azimuth: 9, polar: -1, zoom: 99 });
    expect(o).toEqual({ azimuth: 9, polar: POLAR_MIN, zoom: ZOOM_MAX });
    expect(clampOrbit({ azimuth: 0, polar: 10, zoom: 0 }).polar).toBeLessThan(Math.PI);
  });

  test("moving to a view turns the short way round and ends exactly there", () => {
    const from = { azimuth: (350 * Math.PI) / 180, polar: 1, zoom: 2 };
    const to = { azimuth: (10 * Math.PI) / 180, polar: 1.2, zoom: 1 };
    const half = mixOrbit(from, to, 0.5);
    // 350° to 10° is 20° forward through 0°, not 340° back.
    expect(half.azimuth).toBeCloseTo((360 * Math.PI) / 180, 6);
    expect(half.polar).toBeCloseTo(1.1, 6);
    expect(half.zoom).toBeCloseTo(1.5, 6);
  });

  test("the bar marks a view only while the camera is exactly on it", () => {
    expect(viewOf(VIEW_ORBIT.side)).toBe("side");
    expect(viewOf({ ...VIEW_ORBIT.front, azimuth: 2 * Math.PI })).toBe("front");
    expect(viewOf({ ...VIEW_ORBIT.side, zoom: 1.25 })).toBeNull();
    expect(viewOf({ ...VIEW_ORBIT.side, azimuth: 1.5 })).toBeNull();
  });

  test("h and l step through the views and move on at the ends", () => {
    expect(stepView("angle", 1)).toBe("front");
    expect(stepView("side", 1)).toBe("top");
    expect(stepView("top", 1)).toBeNull();
    expect(stepView("angle", -1)).toBeNull();
    // Turned by hand: l starts from the first view, h from the last.
    expect(stepView(null, 1)).toBe("angle");
    expect(stepView(null, -1)).toBe("top");
  });
});

describe("steps", () => {
  test("steps are at least two, each with words, and a side that exists if it names one", () => {
    expect(stepProblem([{ text: "One." }, { title: "Two", text: "Two.", view: "top" }])).toBeNull();
    expect(stepProblem([{ text: "Only one." }])).toContain("at least two");
    expect(stepProblem("nope")).toContain("at least two");
    expect(stepProblem([{ text: "One." }, { title: "No words" }])).toBe('step 2 needs "text": what this step shows, in a sentence');
    expect(stepProblem([{ text: "One." }, { text: "  " }])).toContain("step 2 needs");
    expect(stepProblem([{ text: "One.", view: "iso" }, { text: "Two." }])).toBe('step 1\'s "view" is one of "angle", "front", "side", "top"');
    expect(stepProblem([{ text: "One.", title: 3 }, { text: "Two." }])).toContain("step 1's \"title\"");
  });

  test("a step is seen from the last side a step asked for, else the scene's own", () => {
    const steps = [{}, { view: "top" as const }, {}, { view: "side" as const }];
    expect(steps.map((_, i) => stepViewAt(steps, i, "angle"))).toEqual(["angle", "top", "top", "side"]);
    expect(stepViewAt(steps, 99, "front")).toBe("side");
    expect(stepViewAt([], 0, "front")).toBe("front");
  });

  test("the render check lays its pictures out two across, in as many rows as they need", () => {
    expect(sheetCell(0, 4, 600, 400)).toEqual({ x: 0, y: 0, w: 300, h: 200 });
    expect(sheetCell(3, 4, 600, 400)).toEqual({ x: 300, y: 200, w: 300, h: 200 });
    // Three steps: two rows, the third alone on the second.
    expect(sheetCell(2, 3, 600, 400)).toEqual({ x: 0, y: 200, w: 300, h: 200 });
    expect(sheetCell(1, 2, 600, 200)).toEqual({ x: 300, y: 0, w: 300, h: 200 });
  });

  test("a walk-through stops at eight steps", () => {
    const steps = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Step ${i + 1}.` }));
    expect(stepProblem(steps(8))).toBeNull();
    expect(stepProblem(steps(11))).toBe("11 steps is too many to follow: keep to 8 (split a longer walk-through into two scenes)");
  });
});

describe("labels", () => {
  const box = (spot: NonNullable<ReturnType<typeof layoutLabels>[number]>, ask: { w: number; h: number }) => ({ left: spot.left, top: spot.top, right: spot.left + ask.w, bottom: spot.top + ask.h });

  test("a label sits above its point, with a line down to it", () => {
    const [spot] = layoutLabels([{ x: 100, y: 100, w: 40, h: 20 }], 300, 200);
    expect(spot).toEqual({ left: 80, top: 70, tipX: 100, tipY: 90 });
  });

  test("labels for things stacked on one spot don't cover each other, and each still fits the view", () => {
    const asks = Array.from({ length: 5 }, () => ({ x: 150, y: 60, w: 60, h: 20 }));
    const spots = layoutLabels(asks, 300, 200);
    const boxes = spots.map((s, i) => box(s!, asks[i]!));
    for (const [i, a] of boxes.entries()) {
      for (const b of boxes.slice(i + 1)) expect(a.bottom <= b.top || b.bottom <= a.top).toBe(true);
      expect(a.top).toBeGreaterThanOrEqual(0);
      expect(a.bottom).toBeLessThanOrEqual(200);
    }
    // Moved below its point, a label's line comes up to its top edge.
    expect(spots[4]!.tipY).toBe(spots[4]!.top);
  });

  test("labels beside each other stay where they are, and one at the edge is pulled inside", () => {
    const spots = layoutLabels([{ x: 60, y: 100, w: 50, h: 20 }, { x: 200, y: 100, w: 50, h: 20 }, { x: 295, y: 100, w: 80, h: 20 }], 300, 200);
    expect(spots[0]!.top).toBe(70);
    expect(spots[1]!.top).toBe(70);
    expect(spots[2]!.left + 80).toBeLessThanOrEqual(300);
    // Its line still starts over its own text.
    expect(spots[2]!.tipX).toBeLessThanOrEqual(spots[2]!.left + 80);
  });

  test("a strip kept free at the top pushes a label down, not out", () => {
    const [spot] = layoutLabels([{ x: 100, y: 30, w: 40, h: 20 }], 300, 200, 26);
    expect(spot!.top).toBe(26);
    // Now on its point: the line has nowhere to go.
    expect(spot!.tipY).toBe(30);
  });

  test("a point out of view has no label, and neither has one there is no room left for", () => {
    expect(layoutLabels([null, { x: 50, y: 50, w: 40, h: 20 }], 300, 200)).toEqual([null, { left: 30, top: 20, tipX: 50, tipY: 40 }]);
    const crowded = layoutLabels(Array.from({ length: 4 }, () => ({ x: 50, y: 30, w: 40, h: 20 })), 100, 70);
    expect(crowded.filter(Boolean)).toHaveLength(3);
    expect(crowded[3]).toBeNull();
  });
});

describe("the render check", () => {
  const card: Rgb = [0.05, 0.06, 0.09];
  const frame = (...px: [number, number, number, number][]) => px.flat();
  const fine: SceneStats = { objects: 3, finite: true, calls: 6, triangles: 36, lines: 0, points: 0, pixels: { total: 100, drawn: 40, visible: 40 }, labels: 2 };

  test("pixels: background is transparent, and a surface as dark as the card doesn't count as seen", () => {
    const counted = countPixels(frame([0, 0, 0, 0], [200, 180, 240, 255], [14, 16, 22, 255], [10, 10, 10, 8]), card);
    expect(counted).toEqual({ total: 4, drawn: 2, visible: 1 });
  });

  test("pixels: an antialiased edge is judged with the card showing through it", () => {
    // Half-covered by white (premultiplied): reads as mid grey over the card, which stands out.
    expect(countPixels(frame([128, 128, 128, 128]), card).visible).toBe(1);
    // Half-covered by the card's own colour: nothing to see.
    expect(countPixels(frame([6, 8, 11, 128]), card).visible).toBe(0);
  });

  test("a scene that draws is fine", () => {
    expect(sceneProblems(fine)).toEqual([]);
  });

  test("the most basic problem is the only one reported", () => {
    const empty = sceneProblems({ ...fine, objects: 0, triangles: MAX_TRIANGLES * 2 });
    expect(empty).toHaveLength(1);
    expect(empty[0]).toContain("added nothing");
    expect(sceneProblems({ ...fine, finite: false })[0]).toContain("aren't finite");
    expect(sceneProblems({ ...fine, calls: 0 })[0]).toContain("nothing was drawn");
    expect(sceneProblems({ ...fine, triangles: 0, lines: 0, points: 0 })[0]).toContain("nothing was drawn");
    expect(sceneProblems({ ...fine, pixels: { total: 100, drawn: 0, visible: 0 } })[0]).toContain("the view readers start on shows nothing");
  });

  test("lines or points alone count as drawing", () => {
    expect(sceneProblems({ ...fine, triangles: 0, lines: 12 })).toEqual([]);
    expect(sceneProblems({ ...fine, triangles: 0, points: 500 })).toEqual([]);
  });

  test("too dark, too heavy and too many labels are each named with their number", () => {
    const all = sceneProblems({ ...fine, pixels: { total: 1000, drawn: 500, visible: 3 }, triangles: 1_200_000, calls: MAX_DRAW_CALLS + 1, labels: MAX_LABELS + 3 });
    expect(all).toHaveLength(4);
    expect(all[0]).toContain("too dark");
    expect(all[1]).toContain("1,200,000 triangles");
    expect(all[2]).toContain("1,001 draw calls");
    expect(all[3]).toContain(`${MAX_LABELS + 3} labels`);
    // At the ceilings exactly, nothing is said.
    expect(sceneProblems({ ...fine, triangles: MAX_TRIANGLES, calls: MAX_DRAW_CALLS, labels: MAX_LABELS })).toEqual([]);
  });
});
