// A few lines of a unified diff, as `git diff` prints them. A ```diff fence in MDX renders as one too.
import * as React from "react";
import { cn } from "./utils.ts";

export type DiffProps = {
  /** The diff lines: each starts with "+", "-" or a space. Children work too. */
  code?: string;
  children?: React.ReactNode;
  /** The file the lines come from, shown above them. */
  file?: string;
  className?: string;
};

/** Added and removed lines carry their sign in a column of its own, so the tint never has to say it alone. */
export function Diff({ code, children, file, className }: DiffProps) {
  const text = (code ?? textOf(children)).replace(/\n$/, "");
  const lines = withoutFileHeader(text.split("\n"));
  return (
    <figure className={cn("my-6 overflow-hidden rounded-lg border border-border bg-black/25", className)} data-speak="skip">
      {file && <figcaption className="border-b border-border px-4 py-2 font-mono text-[12px] break-all text-muted-foreground">{file}</figcaption>}
      <pre tabIndex={0} aria-label={file ? `Changes to ${file}` : "Changed lines"} className="overflow-x-auto outline-none focus-visible:focus-halo py-2 font-mono text-[13px] leading-relaxed text-foreground/[0.92]">
        {lines.map((line, i) => {
          const s = line[0];
          if (s === "@") {
            return (
              <div key={i} className="px-4 text-muted-foreground">
                {line}
              </div>
            );
          }
          const added = s === "+";
          const removed = s === "-";
          return (
            <div key={i} className={cn("flex min-h-[1lh] w-max min-w-full", added && "bg-positive/10", removed && "bg-negative/10")}>
              <span className={cn("w-7 shrink-0 text-center select-none", added ? "text-positive" : removed ? "text-negative" : "text-muted-foreground")}>
                {added ? "+" : removed ? "−" : ""}
                <span className="sr-only">{added ? "added" : removed ? "removed" : ""}</span>
              </span>
              <span className="pr-4 whitespace-pre">{added || removed || s === " " ? line.slice(1) : line}</span>
            </div>
          );
        })}
      </pre>
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
