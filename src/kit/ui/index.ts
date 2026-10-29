// @a/ui: the component kit available to every artifact.
import { Chart, Sparkline } from "./chart.tsx";
import { Diagram } from "./diagram.tsx";
import { Diff } from "./diff.tsx";
import { ChangeGuide } from "./change-guide.tsx";
import { Approval, Checklist, Comments, Form, Notes, Poll } from "./collab.tsx";
import * as controls from "./controls.tsx";
import { Callout, Grid, Link, Page, Section, Stack, Stat, Stats, Step, Steps, Summary, Timeline, TimelineItem } from "./layout.tsx";
import { markdownComponents } from "./mdx.tsx";
import * as primitives from "./primitives.tsx";
import { Table } from "./table.tsx";
import { Ledger } from "./ledger.tsx";
import { Collection, SourceRecords } from "./page-extras.tsx";
import { SupportCase } from "./support.tsx";
import { AsOf, Cite, Claim, Sources } from "./evidence.tsx";
import { BulletBar, Delta } from "./numbers.tsx";
import { Decision } from "./decision.tsx";
import { Figure, Log, Record } from "./records.tsx";
import { Shortlist } from "./shortlist.tsx";
import { Findings } from "./findings.tsx";

export * from "./primitives.tsx";
export * from "./controls.tsx";
export * from "./layout.tsx";
export { Table, formatValue } from "./table.tsx";
export type { TableProps, ColumnSpec, Format } from "./table.tsx";
export { Chart, Sparkline } from "./chart.tsx";
export type { ChartProps } from "./chart.tsx";
export { Diagram } from "./diagram.tsx";
export type { DiagramProps } from "./diagram.tsx";
export { Diff } from "./diff.tsx";
export type { DiffProps } from "./diff.tsx";
export { ChangeGuide } from "./change-guide.tsx";
export { Poll, Checklist, Comments, Notes, Approval, Form } from "./collab.tsx";
export { Ledger } from "./ledger.tsx";
export { Collection, SourceRecords } from "./page-extras.tsx";
export { Sources, Cite, AsOf, Claim } from "./evidence.tsx";
export type { Source, SourceKind, ClaimStatus } from "./evidence.tsx";
export { Delta, BulletBar } from "./numbers.tsx";
export type { DeltaRow, Better } from "./numbers.tsx";
export { Decision } from "./decision.tsx";
export type { DecisionProps, DecisionOption } from "./decision.tsx";
export { Log, Record, Figure } from "./records.tsx";
export { Shortlist } from "./shortlist.tsx";
export { Findings } from "./findings.tsx";
export type { LogProps, LogEntry, RecordProps, RecordItem, FigureProps } from "./records.tsx";
export type { FormField } from "./collab.tsx";
export { ErrorBoundary, ErrorPanel } from "./error.tsx";
export { cn, displayName, relativeTime } from "./utils.ts";

const kitComponents = {
  ...primitives,
  ...controls,
  Page,
  Section,
  Grid,
  Stack,
  Summary,
  Callout,
  Stat,
  Stats,
  Steps,
  Step,
  Timeline,
  TimelineItem,
  Link,
  Table,
  Chart,
  Sparkline,
  Diagram,
  Diff,
  ChangeGuide,
  Poll,
  Checklist,
  Comments,
  Notes,
  Approval,
  Form,
  Ledger,
  SourceRecords,
  Collection,
  SupportCase,
  Sources,
  Cite,
  AsOf,
  Claim,
  Delta,
  BulletBar,
  Decision,
  Log,
  Record,
  Figure,
  Shortlist,
  Findings,
};

const allComponents = { ...kitComponents, ...markdownComponents };

/** MDX provider hook: every kit component plus styled markdown elements. */
export function useMDXComponents(components?: Record<string, unknown>) {
  return components ? { ...allComponents, ...components } : allComponents;
}
