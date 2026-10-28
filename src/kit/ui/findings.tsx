import * as React from "react";
import { ErrorBoundary } from "./error.tsx";
import { Skeleton } from "./primitives.tsx";

const FindingsImpl = React.lazy(() => import("./findings-impl.tsx"));

/**
 * An audit or review (performance, cost, security, "what to fix" after an incident), rendered from a data file
 * in a fixed order: the question and answer, where the fixes stand, impact against effort, ranked findings, what
 * isn't worth doing, how it was measured and an optional long inventory. The data's shape and the recipe are in
 * the "findings" topic of artifact_guide.
 */
export function Findings({ data = "findings.json" }: { data?: string }) {
  return (
    <ErrorBoundary label="Findings" report>
      <React.Suspense fallback={<Skeleton className="my-6 h-72" />}>
        <FindingsImpl data={data} />
      </React.Suspense>
    </ErrorBoundary>
  );
}
