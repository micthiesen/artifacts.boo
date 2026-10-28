// Where the keys go on a page laid out in rows and columns (src/kit/keys-page.ts): blocks side by side (Stat
// cells, cards in a Grid, columns) are one row, so j and k move down and up a row and h and l move along it.
// Pure geometry over rectangles, so it can be tested without a browser.

export type Box = { top: number; bottom: number; left: number; right: number };

/** How much two boxes share vertically, as a share of the shorter one (0 to 1). */
function sharedHeight(a: Box, b: Box): number {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const shorter = Math.min(a.bottom - a.top, b.bottom - b.top);
  return shorter > 0 ? Math.max(0, overlap) / shorter : 0;
}

/** Side by side: most of their height shared, and not overlapping across. */
export function beside(a: Box, b: Box): boolean {
  return sharedHeight(a, b) >= 0.5 && (b.left >= a.right - 4 || b.right <= a.left + 4);
}

/**
 * The next block down (dir 1) or up (dir -1) from `at`, in reading order: skipping blocks beside it and blocks
 * wholly above it (going down) or wholly below it (going up), which are other columns of a row already passed.
 * A block in a staggered column that overlaps it at all is still a stop, so nothing is unreachable.
 * When nothing qualifies (an odd layout), simply the next block, so the keys never get stuck.
 */
export function nextInColumn(boxes: Box[], at: number, dir: 1 | -1): number {
  const here = boxes[at]!;
  for (let j = at + dir; j >= 0 && j < boxes.length; j += dir) {
    const b = boxes[j]!;
    if (beside(here, b)) continue;
    if (dir > 0 ? b.bottom <= here.top + 2 : b.top >= here.bottom - 2) continue;
    return j;
  }
  const plain = at + dir;
  return plain >= 0 && plain < boxes.length ? plain : -1;
}

/** The nearest block beside `at` to its right (dir 1) or left (dir -1), or -1 when the row ends there. */
export function besideIndex(boxes: Box[], at: number, dir: 1 | -1): number {
  const here = boxes[at]!;
  let best = -1;
  let gap = Infinity;
  boxes.forEach((b, j) => {
    if (j === at || !beside(here, b)) return;
    const d = dir > 0 ? b.left - here.right : here.left - b.right;
    if (d < -4) return;
    if (d < gap) [best, gap] = [j, d];
  });
  return best;
}
