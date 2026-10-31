// A <Diff> with notes, loaded only by diffs that have them: numbers in a gutter column, a bar down a noted
// range, noted names underlined, and the notes listed under the lines. Everything shows at once, so nothing
// waits on a hover and a phone reads it the same.
import * as React from "react";
import { placeNotes, symbolPattern, type DiffNote, type PlacedNote } from "../../shared/diff-notes.ts";
import { post } from "../store.ts";
import { DiffView } from "./diff.tsx";

type Props = { file?: string; lines: string[]; notes: DiffNote[]; className?: string };

export default function NotedDiff({ file, lines, notes, className }: Props) {
  const key = lines.join("\n");
  const { placed, problems } = React.useMemo(() => placeNotes(lines, notes), [key, notes]);
  // Reaches the render check, so a note about a line or name the diff doesn't have fails the write's check.
  const problem = problems.join("; ");
  React.useEffect(() => {
    if (problem) post({ t: "error", message: `Diff: ${problem}` });
  }, [problem]);
  const marks = React.useMemo(() => noteMarks(placed), [placed]);
  const names = React.useMemo(() => {
    // Longest first, so `foo.bar` isn't cut short by a note on `foo`.
    const symbols = placed
      .flatMap((p) => (p.symbol ? [p.symbol] : []))
      .sort((a, b) => b.length - a.length)
      .map((sym) => symbolPattern(sym).source);
    return symbols.length ? new RegExp(symbols.join("|"), "g") : null;
  }, [placed]);
  if (!placed.length) return <DiffView file={file} lines={lines} className={className} />;
  return (
    <DiffView
      file={file}
      lines={lines}
      className={className}
      gutter={(i) => (
        <span className="w-7 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums select-none">
          <span aria-hidden="true">{marks.get(i)?.numbers.join(",")}</span>
          {marks.get(i)?.numbers.length ? <span className="sr-only">{`(note ${marks.get(i)!.numbers.join(", ")}) `}</span> : null}
        </span>
      )}
      rowClass={(i) => marks.get(i)?.ranged && "shadow-[inset_2px_0_0_var(--muted-foreground)]"}
      renderText={names ? (text) => underline(text, names) : undefined}
      footer={
        <ol aria-label="Notes" className="space-y-1.5 border-t border-border px-4 py-2.5 text-[14px] leading-snug">
          {placed.map((p) => (
            <li key={p.n} className="flex gap-2">
              <span className="w-4 shrink-0 text-right text-[12px] leading-[inherit] text-muted-foreground tabular-nums">{p.n}</span>
              <span className="min-w-0 text-pretty">
                <span className="mr-1.5 font-mono text-[12px] break-all text-muted-foreground">{p.symbol ?? where(p)}</span>
                {inlineCode(p.text)}
              </span>
            </li>
          ))}
        </ol>
      }
    />
  );
}

/** Which note numbers each row carries in the gutter: a range's on its first row, a name's on each row it appears. */
function noteMarks(placed: PlacedNote[]): Map<number, { numbers: number[]; ranged: boolean }> {
  const out = new Map<number, { numbers: number[]; ranged: boolean }>();
  const at = (r: number) => out.get(r) ?? (out.set(r, { numbers: [], ranged: false }), out.get(r)!);
  for (const p of placed) {
    if (p.symbol) for (const r of p.rows) at(r).numbers.push(p.n);
    else {
      at(p.rows[0]!).numbers.push(p.n);
      // A range shows a bar down its rows, so where it ends reads without the list.
      if (p.rows.length > 1) for (const r of p.rows) at(r).ranged = true;
    }
  }
  return out;
}

function where(p: PlacedNote): string {
  const [a, b] = [p.rows[0]! + 1, p.rows.at(-1)! + 1];
  return a === b ? `line ${a}` : `lines ${a}–${b}`;
}

/** Underlines every whole-word use of the noted names, so the gutter number says which word it means. */
function underline(text: string, names: RegExp): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(names)) {
    out.push(
      text.slice(last, m.index),
      <span key={m.index} className="underline decoration-muted-foreground decoration-dotted underline-offset-[3px]">
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  out.push(text.slice(last));
  return out;
}

/** A note's `backticks` read as code. */
function inlineCode(text: string): React.ReactNode {
  return text.split(/(`[^`]+`)/).map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      <code key={i} className="rounded bg-muted px-1 font-mono text-[0.9em]">
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    ),
  );
}
