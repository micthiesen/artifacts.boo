import { expect, test } from "bun:test";
import { rowAcross, rowsOf, rowStep, type Box } from "./keys-geometry.ts";

const box = (left: number, top: number, w = 100, h = 40): Box => ({ left, top, right: left + w, bottom: top + h });

// A heading, a row of three Stat cells, then two cards side by side with two lines each, then a paragraph.
const page: Box[] = [
  box(0, 0, 320, 30), // 0 heading
  box(0, 50), box(110, 50), box(220, 50), // 1-3 stats
  box(0, 120, 150, 30), box(0, 160, 150, 30), // 4-5 card A
  box(170, 120, 150, 30), box(170, 160, 150, 30), // 6-7 card B
  box(0, 220, 320, 30), // 8 paragraph
];
const rows = rowsOf(page);

test("blocks side by side share a row; stacked ones don't", () => {
  expect(rows).toEqual([[0], [1, 2, 3], [4, 6], [5, 7], [8]]);
});

test("j goes down a row to the block that lines up, and k comes back the same way", () => {
  expect(rowStep(rows, page, 0, 1)).toBe(1); // heading → first stat (most shared width)
  expect(rowStep(rows, page, 3, 1)).toBe(6); // last stat → card B, which it sits over
  expect(rowStep(rows, page, 4, 1)).toBe(5); // down card A
  expect(rowStep(rows, page, 6, 1)).toBe(7); // down card B
  expect(rowStep(rows, page, 7, 1)).toBe(8);
  expect(rowStep(rows, page, 8, -1)).toBe(5); // up: the paragraph lines up with card A first
  expect(rowStep(rows, page, 5, -1)).toBe(4);
  expect(rowStep(rows, page, 0, -1)).toBe(-1);
  expect(rowStep(rows, page, 8, 1)).toBe(-1);
});

test("h and l move along a row and stop at its ends", () => {
  expect(rowAcross(rows, 1, 1)).toBe(2);
  expect(rowAcross(rows, 3, 1)).toBe(-1);
  expect(rowAcross(rows, 3, -1)).toBe(2);
  expect(rowAcross(rows, 4, 1)).toBe(6);
  expect(rowAcross(rows, 0, 1)).toBe(-1);
});

test("every block is reachable with j, k, h and l, and j and k visit the same rows", () => {
  const seen = new Set<number>();
  // Down the left edge with j, then along each row with l.
  for (let at: number = rows[0]![0]!; at >= 0; at = rowStep(rows, page, at, 1)) {
    for (let x: number = rows.find((r) => r.includes(at))![0]!; x >= 0; x = rowAcross(rows, x, 1)) seen.add(x);
  }
  expect(seen.size).toBe(page.length);
  const down: number[] = [];
  for (let at = 0; at >= 0; at = rowStep(rows, page, at, 1)) down.push(rows.findIndex((r) => r.includes(at)));
  const up: number[] = [];
  for (let at = 8; at >= 0; at = rowStep(rows, page, at, -1)) up.push(rows.findIndex((r) => r.includes(at)));
  expect(up.reverse()).toEqual(down);
});

test("from a wide block, j enters a row of uneven cells on its first, and k from that cell's column comes back", () => {
  const uneven = [box(0, 0, 400, 30), box(0, 50, 100), box(110, 50, 120), box(240, 50, 160), box(0, 120, 190, 30), box(210, 120, 190, 30)];
  const r = rowsOf(uneven);
  expect(rowStep(r, uneven, 0, 1)).toBe(1);
  expect(rowStep(r, uneven, 1, 1)).toBe(4);
  expect(rowStep(r, uneven, 4, -1)).toBe(1);
});

test("a staggered column still belongs to a row", () => {
  const staggered = [box(0, 0, 100, 40), box(0, 50, 100, 40), box(120, 20, 100, 60)];
  const r = rowsOf(staggered);
  expect(r.flat().sort()).toEqual([0, 1, 2]);
});
