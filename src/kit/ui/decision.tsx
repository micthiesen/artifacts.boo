import * as React from "react";
import { ErrorBoundary } from "./error.tsx";
import { Skeleton } from "./primitives.tsx";

const DecisionImpl = React.lazy(() => import("./decision-impl.tsx"));

export type DecisionOption = string | { value: string; label?: string; detail?: string };

export type DecisionProps = {
  /** Names the shared answer, `decide/<id>`: letters, digits, - _ and . only. */
  id: string;
  question: React.ReactNode;
  options: DecisionOption[];
  /** The value of the option you recommend; it's marked "Recommended". */
  recommended?: string;
  /** Only these emails may decide; everyone else sees who it's waiting for. */
  deciders?: string[];
  description?: React.ReactNode;
  className?: string;
};

/**
 * A question answered on the page, which remembers the answer: one shared `{ choice, note?, by, at, version }`
 * at `decide/<id>`, stamped by the server. Anyone who can edit may decide or change it (the page asks first),
 * or only `deciders`. Agents read the answer; only people make it.
 */
export function Decision(props: DecisionProps) {
  return (
    <ErrorBoundary label="Decision">
      <React.Suspense fallback={<Skeleton className="my-6 h-56" />}>
        <DecisionImpl {...props} />
      </React.Suspense>
    </ErrorBoundary>
  );
}
