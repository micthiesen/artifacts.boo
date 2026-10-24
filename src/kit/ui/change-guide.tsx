import * as React from "react";
import { ErrorBoundary } from "./error.tsx";
import { Skeleton } from "./primitives.tsx";

const ChangeGuideImpl = React.lazy(() => import("./change-guide-impl.tsx"));

/**
 * A guide to a code change (a pull request or a branch) for someone with no context, rendered from a data
 * file in a fixed order. The data's shape and the recipe are in the "change" topic of artifact_guide.
 */
export function ChangeGuide({ data = "guide.json" }: { data?: string }) {
  return (
    <ErrorBoundary label="ChangeGuide" report>
      <React.Suspense fallback={<Skeleton className="my-6 h-72" />}>
        <ChangeGuideImpl data={data} />
      </React.Suspense>
    </ErrorBoundary>
  );
}
