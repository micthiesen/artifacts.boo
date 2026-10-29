// Numbers that changed (<Delta>) and a number against its target (<BulletBar>). Their bodies and arithmetic are
// in numbers-impl.tsx, loaded the first time a page uses one.
import * as React from "react";
import { ErrorBoundary } from "./error.tsx";
import type { Better, DeltaRow, Tolerance } from "./numbers-impl.tsx";
import { Skeleton } from "./primitives.tsx";

export type { Better, DeltaRow, Tolerance } from "./numbers-impl.tsx";

const DeltaImpl = React.lazy(() => import("./numbers-impl.tsx").then((m) => ({ default: m.DeltaImpl })));
const BulletBarImpl = React.lazy(() => import("./numbers-impl.tsx").then((m) => ({ default: m.BulletBarImpl })));

/**
 * Before and after for a few measures: Label | Before | After | Change, with the change worked out (absolute and
 * percent) and told as better or worse by `better`. Rows come from `data` (a data file) or `rows`, each
 * `{label, before, after, unit?, better: "up"|"down", note?}`. `chart` adds a before-to-after line per row.
 * `tolerance` (a number in the unit, or "5%" of before; also per row) makes smaller changes read "about the same".
 */
export function Delta(props: { data?: string; rows?: DeltaRow[]; title?: React.ReactNode; chart?: boolean; tolerance?: Tolerance }) {
  return (
    <ErrorBoundary label="Delta">
      <React.Suspense fallback={<Skeleton className="my-6 h-40" />}>
        <DeltaImpl {...props} />
      </React.Suspense>
    </ErrorBoundary>
  );
}

/**
 * One value against a target, as a bullet graph: grey qualitative `bands` (their upper edges), a bar for the
 * value and a tick for the target, with the numbers in words beside it.
 */
export function BulletBar(props: {
  label: React.ReactNode;
  value: number;
  target?: number;
  max?: number;
  bands?: number[];
  unit?: string;
  better?: Better;
}) {
  return (
    <ErrorBoundary label="BulletBar">
      <React.Suspense fallback={<Skeleton className="my-4 h-12" />}>
        <BulletBarImpl {...props} />
      </React.Suspense>
    </ErrorBoundary>
  );
}
