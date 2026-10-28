// Records an agent keeps: a dated Log, a Record of facts, and a Figure with its caption and credit.
import * as React from "react";
import { ErrorBoundary } from "./error.tsx";
import { Skeleton } from "./primitives.tsx";

const impl = () => import("./records-impl.tsx");
const LogImpl = React.lazy(() => impl().then((m) => ({ default: m.LogImpl })));
const RecordImpl = React.lazy(() => impl().then((m) => ({ default: m.RecordImpl })));
const FigureImpl = React.lazy(() => impl().then((m) => ({ default: m.FigureImpl })));

export type LogEntry = { date: string; title: string; body?: string; tone?: "neutral" | "positive" | "caution" | "negative"; tags?: string[] };

export type LogProps = {
  /** A data file holding [{ date, title, body?, tone?, tags? }]; agents append to it. */
  data?: string;
  title?: React.ReactNode;
  /** How many of the newest entries show before "Show N earlier". */
  show?: number;
  className?: string;
};

/** Dated entries, newest first, as ruled rows; older ones fold away behind "Show N earlier". */
export function Log(props: LogProps) {
  return (
    <ErrorBoundary label="Log">
      <React.Suspense fallback={<Skeleton className="my-6 h-48" />}>
        <LogImpl {...props} />
      </React.Suspense>
    </ErrorBoundary>
  );
}

export type RecordItem = { label: string; value: unknown; url?: string };

export type RecordProps = {
  /** A data file holding the items, instead of `items`. */
  data?: string;
  /** [{ label, value, url? }] or { label: value }. */
  items?: RecordItem[] | { [label: string]: unknown };
  title?: React.ReactNode;
  className?: string;
};

/** Facts as label and value: two columns on wide screens, the label above its value on a phone. */
export function Record(props: RecordProps) {
  return (
    <ErrorBoundary label="Record">
      <React.Suspense fallback={<Skeleton className="my-6 h-40" />}>
        <RecordImpl {...props} />
      </React.Suspense>
    </ErrorBoundary>
  );
}

export type FigureProps = {
  /** An uploaded asset ("assets/plan.png") or a data: URL. */
  src: string;
  alt: string;
  caption?: React.ReactNode;
  credit?: React.ReactNode;
  creditUrl?: string;
  className?: string;
};

/** An image with its caption and credit; tap or click it to see it larger. */
export function Figure(props: FigureProps) {
  return (
    <ErrorBoundary label="Figure">
      <React.Suspense fallback={<Skeleton className="my-6 aspect-video max-w-full" />}>
        <FigureImpl {...props} />
      </React.Suspense>
    </ErrorBoundary>
  );
}
