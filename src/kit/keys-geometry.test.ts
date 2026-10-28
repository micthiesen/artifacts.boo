import { expect, test } from "bun:test";
import { beside, besideIndex, nextInColumn, type Box } from "./keys-geometry.ts";

const box = (left: number, top: number, w = 100, h = 40): Box => ({ left, top, right: left + w, bottom: top + h });

// A heading, a row of three Stat cells, then two cards side by side with two paragraphs each, then a paragraph.
const page: Box[] = [
  box(0, 0, 320, 30), // 0 heading
  box(0, 50), box(110, 50), box(220, 50), // 1-3 stats
  box(0, 120, 150, 30), box(0, 160, 150, 30), // 4-5 card A
  box(170, 120, 150, 30), box(170, 160, 150, 30), // 6-7 card B
  box(0, 220, 320, 30), // 8 paragraph
];

test("blocks side by side are beside each other; stacked ones aren't", () => {
  expect(beside(page[1]!, page[2]!)).toBe(true);
  expect(beside(page[0]!, page[1]!)).toBe(false);
  expect(beside(page[4]!, page[5]!)).toBe(false);
});

test("j goes down a row, not across it", () => {
  expect(nextInColumn(page, 0, 1)).toBe(1); // heading → first stat
  expect(nextInColumn(page, 1, 1)).toBe(4); // first stat → card A, skipping the other stats
  expect(nextInColumn(page, 4, 1)).toBe(5); // down card A
  expect(nextInColumn(page, 5, 1)).toBe(8); // past card B (beside, and above) to the paragraph
  expect(nextInColumn(page, 6, 1)).toBe(7); // down card B
});

test("k goes up a row", () => {
  expect(nextInColumn(page, 8, -1)).toBe(7); // the paragraph → the last block above it in reading order
  expect(nextInColumn(page, 5, -1)).toBe(4);
  expect(nextInColumn(page, 4, -1)).toBe(3); // card A's top → the row of stats
  expect(nextInColumn(page, 0, -1)).toBe(-1);
});

test("h and l move along a row and stop at its ends", () => {
  expect(besideIndex(page, 1, 1)).toBe(2);
  expect(besideIndex(page, 2, 1)).toBe(3);
  expect(besideIndex(page, 3, 1)).toBe(-1);
  expect(besideIndex(page, 3, -1)).toBe(2);
  expect(besideIndex(page, 4, 1)).toBe(6); // card A → card B
  expect(besideIndex(page, 0, 1)).toBe(-1);
});

test("an odd layout never gets the keys stuck", () => {
  // Everything overlapping (absolutely placed): plain reading order.
  const odd = [box(0, 0), box(0, 0), box(0, 0)];
  expect(nextInColumn(odd, 0, 1)).toBe(1);
});

test("a block in a staggered column is still reachable", () => {
  // Left column at 0 and 50; the right column's block starts 30 px higher than the second left block.
  const staggered = [box(0, 0, 100, 40), box(0, 50, 100, 40), box(120, 20, 100, 60)];
  expect(nextInColumn(staggered, 1, 1)).toBe(2);
});
