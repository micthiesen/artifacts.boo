import * as React from "react";
import { ErrorBoundary } from "./error.tsx";
import { Skeleton } from "./primitives.tsx";

const ShortlistImpl = React.lazy(() => import("./shortlist-impl.tsx"));

/**
 * A decision between real options (providers, products, plans), rendered from a data file: the question, the
 * pick and why, then ranked rows that open to their pros and cons, deciding question, facts and evidence, and
 * optionally a Decision to choose. The data's shape and the recipe are in the "shortlist" topic of artifact_guide.
 */
export function Shortlist({ data = "shortlist.json" }: { data?: string }) {
  return (
    <ErrorBoundary label="Shortlist" report>
      <React.Suspense fallback={<Skeleton className="my-6 h-72" />}>
        <ShortlistImpl data={data} />
      </React.Suspense>
    </ErrorBoundary>
  );
}
