// Evidence: where a page's facts came from and how fresh they are. <Sources> lists them from a data file,
// <Cite> points at one inline, <AsOf> stamps when something was last checked, and <Claim> says how sure a
// statement is. Their bodies are in evidence-impl.tsx, loaded the first time a page uses one.
import * as React from "react";
import { ErrorBoundary } from "./error.tsx";
import { Skeleton } from "./primitives.tsx";
import type { Source, SourceKind } from "../../shared/sources.ts";
export type { Source, SourceKind };
export type ClaimStatus = "verified" | "reported" | "inferred" | "unknown";

const load = () => import("./evidence-impl.tsx");
const SourcesImpl = React.lazy(() => load().then((m) => ({ default: m.SourcesImpl })));
const CiteImpl = React.lazy(() => load().then((m) => ({ default: m.CiteImpl })));
const AsOfImpl = React.lazy(() => load().then((m) => ({ default: m.AsOfImpl })));
const ClaimImpl = React.lazy(() => load().then((m) => ({ default: m.ClaimImpl })));

/** ErrorBoundary for something in a line of text: a panel there would break the paragraph apart. */
class InlineBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <span className="text-[0.85em] text-negative">[failed to load]</span> : this.props.children;
  }
}

function Inline({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  return (
    <InlineBoundary>
      <React.Suspense fallback={fallback}>{children}</React.Suspense>
    </InlineBoundary>
  );
}

/**
 * The sources a page rests on, numbered in file order, from a data file of
 * `{id, title, url?, checked?, kind?, note?}`. Each row is `#source-<id>`, which is where <Cite> links.
 * `open={false}` starts it closed, for long lists.
 */
export function Sources({ data = "sources.json", title = "Sources", open = true }: { data?: string; title?: React.ReactNode; open?: boolean }) {
  return (
    <ErrorBoundary label="Sources">
      <React.Suspense fallback={<Skeleton className="my-6 h-40" />}>
        <SourcesImpl data={data} title={title} open={open} />
      </React.Suspense>
    </ErrorBoundary>
  );
}

/**
 * An inline citation, `[n]`, linking to its row in <Sources>. n is the source's place in the file, so it
 * matches the list's numbering however often it's cited.
 */
export function Cite(props: { id: string; data?: string }) {
  return (
    <Inline fallback={<sup className="text-[0.8em] text-muted-foreground">[·]</sup>}>
      <CiteImpl {...props} />
    </Inline>
  );
}

/**
 * "Checked 3 days ago · Oct 25, 2026 · prices": when something on the page was last checked. Once `next` has
 * come it says "Due for a recheck" in the caution colour, with a sign.
 */
export function AsOf(props: { checked: string; next?: string; scope?: React.ReactNode; className?: string }) {
  return (
    <Inline fallback={<span className="text-[13px] text-muted-foreground tabular-nums">Checked {props.checked}</span>}>
      <AsOfImpl {...props} />
    </Inline>
  );
}

/**
 * How sure a statement is: verified (checked against a source), reported (someone says so), inferred (worked
 * out, not seen) or unknown. With children it marks that text; alone it's just the marker.
 */
export function Claim(props: { status: ClaimStatus; note?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <Inline fallback={<span>{props.children}</span>}>
      <ClaimImpl {...props} />
    </Inline>
  );
}
