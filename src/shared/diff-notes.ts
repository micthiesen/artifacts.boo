// Notes on a few changed lines (<Diff notes>, a change guide step's diff): each explains one line, a range,
// or a name wherever it appears. The kit numbers them in the gutter and lists them under the lines, so they
// read on a phone without hovering. A note pointing at nothing would explain nothing: the render check (and,
// for a change guide, the Worker on save) refuses one whose line is out of range or whose name isn't there.

/** `at` is "L3", "L3-L5", or a name such as `validateInput`, matched as a whole word. */
export type DiffNote = { at: string; text: string };

/** A note placed on the shown lines: `rows` are 0-based, `symbol` set for a name note. */
export type PlacedNote = { n: number; at: string; text: string; rows: number[]; symbol?: string };

export const NOTE_LIMITS = { notes: 6, text: 240 };

const LINES = /^L(\d+)(?:-L?(\d+))?$/;

/** A name, matched where it isn't part of a longer identifier. */
export function symbolPattern(symbol: string, flags = ""): RegExp {
  return new RegExp(`(?<![\\w$])${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`, flags);
}

/**
 * Places `notes` on `lines` (the diff's lines as shown, pasted file headers already dropped). Line numbers count
 * those lines from 1, hunk headers included; a name is looked for after the sign. Returns the placed notes and one problem per bad note.
 */
export function placeNotes(lines: readonly string[], notes: unknown): { placed: PlacedNote[]; problems: string[] } {
  const placed: PlacedNote[] = [];
  const problems: string[] = [];
  if (notes === undefined) return { placed, problems };
  if (!Array.isArray(notes)) return { placed, problems: [`"notes" is a list of {at, text}`] };
  if (notes.length > NOTE_LIMITS.notes) problems.push(`${notes.length} notes on one diff; keep it to ${NOTE_LIMITS.notes}`);
  notes.forEach((raw, i) => {
    const note = raw as Partial<DiffNote> | null;
    const at = typeof note?.at === "string" ? note.at.trim() : "";
    const text = typeof note?.text === "string" ? note.text.trim() : "";
    const label = `note ${i + 1}`;
    if (!at || !text) return void problems.push(`${label} is {at, text}: "at" is "L3", "L3-L5" or a name in the lines`);
    if (text.length > NOTE_LIMITS.text) problems.push(`${label} is ${text.length} characters; keep notes to ${NOTE_LIMITS.text}`);
    const range = LINES.exec(at);
    if (range) {
      const from = Number(range[1]);
      const to = range[2] ? Number(range[2]) : from;
      if (from < 1 || to < from || to > lines.length) {
        return void problems.push(`${label} points at ${at}, but the diff has lines L1 to L${lines.length}${to < from ? " (and a range runs low to high)" : ""}`);
      }
      placed.push({ n: placed.length + 1, at, text, rows: Array.from({ length: to - from + 1 }, (_, k) => from - 1 + k) });
      return;
    }
    if (/\s/.test(at)) return void problems.push(`${label}'s "at" is "L3", "L3-L5" or one name, not "${at}"`);
    const re = symbolPattern(at);
    // The sign column isn't part of the text a reader sees; a line without one (a hunk header) is all text.
    const rows = lines.flatMap((l, r) => (re.test("+- ".includes(l[0] ?? "") ? l.slice(1) : l) ? [r] : []));
    if (!rows.length) return void problems.push(`${label} is about "${at}", which isn't in the diff's lines`);
    placed.push({ n: placed.length + 1, at, text, rows, symbol: at });
  });
  return { placed, problems };
}
