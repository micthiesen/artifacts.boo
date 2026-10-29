// The body of <Decision>: a question answered on the page, remembered as one shared answer at `decide/<id>`.
// Loaded lazily; only pages with a decision download it.
import * as React from "react";
import { useShared, useViewer } from "../hooks.ts";
import { getBoot } from "../store.ts";
import { cueAfterRender, useArrivals } from "../feedback.ts";
import { useKeyWidget } from "../key-widget.ts";
import { Check } from "./icons.ts";
import { Badge, Button, Textarea } from "./primitives.tsx";
import { cn, displayName, relativeTime, useNow } from "./utils.ts";
import type { DecisionOption, DecisionProps } from "./decision.tsx";

/** What `decide/<id>` holds. The server stamps `by`, `at` and `version`; until it answers, the optimistic copy lacks them. */
export type DecisionValue = { choice: string; note?: string; by?: string; at?: number; version?: number };

type Option = { value: string; label: string; detail?: string };

export function normalizeOptions(options: DecisionOption[]): Option[] {
  return (options ?? []).map((o) =>
    typeof o === "string" ? { value: o, label: o } : { value: String(o.value), label: o.label ?? String(o.value), ...(o.detail ? { detail: o.detail } : {}) },
  );
}

/** "Sam", "Sam and Rob", "Sam, Rob and Lee". */
export function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export default function DecisionImpl({ id, question, options, recommended, deciders, description, className }: DecisionProps) {
  const key = `decide/${id}`;
  const [value, setValue] = useShared<DecisionValue | null>(key, null);
  const viewer = useViewer();
  const now = useNow();
  const root = React.useRef<HTMLDivElement>(null);
  useArrivals(root, key);
  const name = React.useId();

  const opts = normalizeOptions(options);
  const decided = value && typeof value === "object" && typeof value.choice === "string" ? value : null;
  const required = (deciders ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const me = viewer.email?.toLowerCase() ?? null;
  // The server holds the same line: with deciders, only they may decide.
  const canDecide = viewer.canWrite && me !== null && (required.length === 0 || required.includes(me));
  const pageVersion = getBoot()?.version ?? 0;
  // Unlike an approval, a decision made on an earlier version still stands; the page just says which one.
  const olderVersion = decided && typeof decided.version === "number" && pageVersion && decided.version < pageVersion ? decided.version : null;

  const [editing, setEditing] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [choice, setChoice] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const open = !decided || editing;

  function decide() {
    if (!canDecide || choice === null) return;
    const text = note.trim();
    // The version on screen: the server records that, so an old tab decides on what it showed.
    setValue({ choice, ...(text ? { note: text } : {}), ...(pageVersion ? { version: pageVersion } : {}) });
    setEditing(false);
    setNote("");
    focusChange();
    cueAfterRender(() => root.current?.querySelector("[role=status]"), "approve");
  }

  function startChange() {
    setConfirming(false);
    setEditing(true);
    setChoice(decided?.choice ?? null);
    // The buttons that had focus are gone; the current answer is where a keyboard picks up.
    requestAnimationFrame(() => {
      const radios = root.current?.querySelector<HTMLInputElement>("input[type=radio]:checked") ?? root.current?.querySelector<HTMLInputElement>("input[type=radio]");
      radios?.focus();
    });
  }

  /** The button that had focus goes away (Decide, Keep, Cancel): the keyboard picks up at Change. */
  const focusChange = () => requestAnimationFrame(() => root.current?.querySelector<HTMLElement>("[data-decision-change]")?.focus());

  // Enter on the decision puts the keyboard where it picks up: the current answer while choosing, else Change.
  useKeyWidget(root, {
    enter: () => {
      const el = root.current;
      if (!el) return false;
      const target = open
        ? (el.querySelector<HTMLInputElement>("input[type=radio]:checked:enabled") ?? el.querySelector<HTMLInputElement>("input[type=radio]:enabled"))
        : (el.querySelector<HTMLElement>("[data-decision-change]") ?? el.querySelector<HTMLElement>('[role="group"] button'));
      if (!target) return false;
      target.focus();
      return el.ownerDocument.activeElement === target;
    },
  });

  const labelOf = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const who = decided?.by ?? (decided ? viewer.email : null);
  const whoName = who && me && who.toLowerCase() === me ? "you" : displayName(who);

  return (
    // A stop when a recipe's keys scope holds it (Shortlist); standalone, the keys find it as one block anyway.
    <div ref={root} className={cn("my-6 rounded-xl border border-border bg-card shadow-card", className)} data-key-stop="">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3">
        <div className="min-w-0">
          <div className="font-semibold text-balance">{question}</div>
          {description && <div className="mt-0.5 text-sm text-muted-foreground">{description}</div>}
        </div>
        <Badge tone={decided ? "positive" : "neutral"} role="status">
          {decided && <Check />}
          {decided ? (editing ? "Changing" : "Decided") : "Open"}
        </Badge>
      </div>

      {decided && !editing && (
        <div className="border-t border-border px-5 py-3">
          <p className="text-[15px] leading-snug break-words">
            <span className="text-muted-foreground">Decided: </span>
            <span className="font-semibold">{labelOf(decided.choice)}</span>
          </p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            by {whoName}
            {" · "}
            <time dateTime={new Date(decided.at ?? now).toISOString()} title={new Date(decided.at ?? now).toLocaleString()}>
              {relativeTime(decided.at ?? now, now)}
            </time>
            {olderVersion !== null && ` · decided on v${olderVersion}`}
          </p>
          {decided.note && <p className="mt-1.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap">{decided.note}</p>}
          {canDecide &&
            (confirming ? (
              <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Change this decision?">
                <p className="w-full text-[13px] text-muted-foreground">
                  Change this decision? Your answer will replace {whoName === "you" ? "yours" : `${whoName}'s`}.
                </p>
                <Button type="button" size="sm" variant="outline" onClick={startChange} autoFocus>
                  Change it
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                    focusChange();
                  }}
                >
                  Keep
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="outline" className="mt-3" data-decision-change="" onClick={() => setConfirming(true)}>
                Change
              </Button>
            ))}
        </div>
      )}

      {open && (
        <div className="border-t border-border px-5 py-3">
          <div role="radiogroup" aria-label={typeof question === "string" ? question : "Options"} className="flex flex-col gap-2">
            {opts.map((o) => {
              const chosen = choice === o.value;
              const isRecommended = recommended !== undefined && String(recommended) === o.value;
              return (
                <label
                  key={o.value}
                  data-choice={o.value}
                  className={cn(
                    "relative flex items-start gap-3 rounded-lg border bg-background/40 px-3.5 py-2.5 text-[15px] transition-colors has-[:focus-visible]:focus-halo",
                    canDecide && "cursor-pointer hover:border-primary/45 active:bg-muted/60",
                    chosen ? "border-primary/60" : "border-border",
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={o.value}
                    checked={chosen}
                    disabled={!canDecide}
                    onChange={() => setChoice(o.value)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden
                    className={cn(
                      "mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full border transition-colors",
                      chosen ? "border-transparent bg-primary text-primary-foreground" : "border-input bg-card",
                    )}
                  >
                    {chosen && <span className="size-1.5 rounded-full bg-current" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium break-words">{o.label}</span>
                      {isRecommended && <Badge tone="primary">Recommended</Badge>}
                    </span>
                    {o.detail && <span className="mt-0.5 block text-[14px] leading-snug text-muted-foreground">{o.detail}</span>}
                  </span>
                </label>
              );
            })}
          </div>
          {canDecide ? (
            <div className="mt-3 flex flex-col gap-2.5">
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note (optional)"
                aria-label="Note with your decision (optional)"
                rows={2}
                className="min-h-14 bg-background/40"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={decide} disabled={choice === null}>
                  <Check /> {editing ? "Change decision" : "Decide"}
                </Button>
                {editing && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      // The note stays: closing never throws away what someone typed.
                      setEditing(false);
                      focusChange();
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-3 text-[13px] text-muted-foreground">
              {required.length
                ? `Waiting for ${joinNames(required.map(displayName))} to decide.`
                : viewer.email === null
                  ? "Sign in with edit access to decide."
                  : "You have view access, so this is read-only."}
            </p>
          )}
        </div>
      )}

      {decided && !editing && !canDecide && required.length > 0 && viewer.canWrite && (
        <p className="border-t border-border px-5 py-2.5 text-[13px] text-muted-foreground">Only {joinNames(required.map(displayName))} can change this.</p>
      )}
    </div>
  );
}
