// A few lines of a unified diff, as `git diff` prints them. A ```diff fence in MDX renders as one too.
import * as React from "react";
import type { DiffNote } from "../../shared/diff-notes.ts";
import { ErrorBoundary } from "./error.tsx";
import { cn } from "./utils.ts";

export type { DiffNote };

// Notes load with their own chunk, so the many diffs without any keep the eager bundle as it was.
const NotedDiff = React.lazy(() => import("./diff-notes-impl.tsx"));

export type DiffProps = {
  /** The diff lines: each starts with "+", "-" or a space. Children work too. */
  code?: string;
  children?: React.ReactNode;
  /** The file the lines come from, shown above them. */
  file?: string;
  /**
   * Notes on the lines: `at` is "L3" or "L3-L5" (counting the lines from 1) or a name, which is underlined wherever
   * it appears. Each gets a number in the gutter and is listed under the lines.
   */
  notes?: DiffNote[];
  className?: string;
};

/** Added and removed lines carry their sign in a column of its own, so the tint never has to say it alone. */
export function Diff({ code, children, file, notes, className }: DiffProps) {
  const text = (code ?? textOf(children)).replace(/\n$/, "");
  const lines = withoutFileHeader(text.split("\n"));
  if (notes === undefined) return <DiffView file={file} lines={lines} className={className} />;
  return (
    <ErrorBoundary label="Diff" report>
      <React.Suspense fallback={<DiffView file={file} lines={lines} className={className} />}>
        <NotedDiff file={file} lines={lines} notes={notes} className={className} />
      </React.Suspense>
    </ErrorBoundary>
  );
}

export type DiffViewProps = {
  file?: string;
  lines: string[];
  className?: string;
  /** What notes add: a gutter column before the sign, a class per row, how a row's text is drawn, and what follows the lines. */
  gutter?: (row: number) => React.ReactNode;
  rowClass?: (row: number) => string | false | undefined;
  renderText?: (text: string) => React.ReactNode;
  footer?: React.ReactNode;
};

export function DiffView({ file, lines, className, gutter, rowClass, renderText, footer }: DiffViewProps) {
  return (
    <figure className={cn("my-6 overflow-hidden rounded-lg border border-border bg-black/25", className)}>
      {file && <figcaption className="border-b border-border px-4 py-2 font-mono text-[12px] break-all text-muted-foreground" data-speak="skip">{file}</figcaption>}
      {/* Listen and the page's keys skip the code; notes under it are prose and stay readable. */}
      <pre data-speak="skip" tabIndex={0} aria-label={file ? `Changes to ${file}` : "Changed lines"} className="overflow-x-auto outline-none focus-visible:focus-halo py-2 font-mono text-[13px] leading-relaxed text-foreground/[0.92]">
        {lines.map((line, i) => {
          const s = line[0];
          if (s === "@") {
            return (
              <div key={i} className={cn("flex w-max min-w-full text-muted-foreground", rowClass?.(i))}>
                {gutter?.(i)}
                <span className="px-4 whitespace-pre">{renderText ? renderText(line) : line}</span>
              </div>
            );
          }
          const added = s === "+";
          const removed = s === "-";
          const body = added || removed || s === " " ? line.slice(1) : line;
          return (
            <div key={i} className={cn("flex min-h-[1lh] w-max min-w-full", added && "bg-positive/10", removed && "bg-negative/10", rowClass?.(i))}>
              {gutter?.(i)}
              <span className={cn("w-7 shrink-0 text-center select-none", added ? "text-positive" : removed ? "text-negative" : "text-muted-foreground")}>
                {added ? "+" : removed ? "−" : ""}
                <span className="sr-only">{added ? "added" : removed ? "removed" : ""}</span>
              </span>
              <span className="pr-4 whitespace-pre">{renderText ? renderText(body) : body}</span>
            </div>
          );
        })}
      </pre>
      {footer}
    </figure>
  );
}

/** Pasted `git diff` output starts with file headers; drop them, but only before the first hunk, where they can't be content. */
function withoutFileHeader(lines: string[]): string[] {
  const hunk = lines.findIndex((l) => l.startsWith("@@"));
  if (hunk <= 0) return lines;
  const head = lines.slice(0, hunk);
  return head.every((l) => /^(diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(l)) ? lines.slice(hunk) : lines;
}

function textOf(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return textOf(node.props.children);
  return "";
}
