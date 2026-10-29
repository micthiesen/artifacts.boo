// Where the keys go on a page laid out in rows and columns (src/kit/keys-page.ts). Blocks side by side (Stat
// cells, cards in a Grid, columns) make one row: j and k move from row to row, h and l along a row. Every block
// is in exactly one row, so j and k visit the same rows down as up, and nothing is out of reach. Pure geometry
// over rectangles, so it can be tested without a browser.

export type Box = { top: number; bottom: number; left: number; right: number };

/** How much two boxes share vertically, as a share of the shorter one (0 to 1). */
function sharedHeight(a: Box, b: Box): number {
  const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  const shorter = Math.min(a.bottom - a.top, b.bottom - b.top);
  return shorter > 0 ? Math.max(0, overlap) / shorter : 0;
}

/** How much two boxes share across, in pixels. */
function sharedWidth(a: Box, b: Box): number {
  return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
}

/**
 * The page's rows, top to bottom, each a list of block indexes left to right. A block joins the row whose first
 * (topmost) block it shares most of its height with; otherwise it starts the next row.
 */
export function rowsOf(boxes: Box[]): number[][] {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a]!.top - boxes[b]!.top || boxes[a]!.left - boxes[b]!.left);
  const rows: number[][] = [];
  for (const i of order) {
    const row = rows.at(-1);
    if (row && sharedHeight(boxes[row[0]!]!, boxes[i]!) >= 0.5) row.push(i);
    else rows.push([i]);
  }
  for (const row of rows) row.sort((a, b) => boxes[a]!.left - boxes[b]!.left);
  return rows;
}

/** The row a block is in. */
function rowOf(rows: number[][], at: number): number {
  return rows.findIndex((r) => r.includes(at));
}

/**
 * j (1) or k (-1): the block in the next row down or up that lines up best with this one: the one this block
 * covers the most of its width (so from a wide heading or paragraph, the row's first block, as you'd read it,
 * whichever cell is widest), else the nearest across when none line up. -1 past the first or last row.
 */
export function rowStep(rows: number[][], boxes: Box[], at: number, dir: 1 | -1): number {
  const r = rowOf(rows, at) + dir;
  const target = rows[r];
  if (!target) return -1;
  const here = boxes[at]!;
  const centre = (b: Box) => (b.left + b.right) / 2;
  // Share of the candidate's width this block spans, rounded so near-equal counts as equal.
  const covered = (b: Box) => Math.round((sharedWidth(here, b) / Math.max(1, b.right - b.left)) * 20) / 20;
  return target.reduce((best, i) => {
    const ca = covered(boxes[i]!);
    const cb = covered(boxes[best]!);
    if (ca !== cb) return ca > cb ? i : best;
    // Equally covered: the first in the row; none covered: the nearest across.
    if (ca > 0) return best;
    return Math.abs(centre(boxes[i]!) - centre(here)) < Math.abs(centre(boxes[best]!) - centre(here)) ? i : best;
  }, target[0]!);
}

/** h (-1) or l (1): the block before or after this one in its row, or -1 at the row's end. */
export function rowAcross(rows: number[][], at: number, dir: 1 | -1): number {
  const row = rows[rowOf(rows, at)];
  if (!row) return -1;
  return row[row.indexOf(at) + dir] ?? -1;
}
