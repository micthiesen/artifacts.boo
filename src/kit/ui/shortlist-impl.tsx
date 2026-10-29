// The body of <Shortlist>: a decision between real options, always in the same order (question, pick, what
// matters, ranked rows, ruled out, decide) so a reader who has seen one knows where to look in the next. Each
// row is a sentence on a phone until it's opened; its caveats live inside it, not in prose around the list.
// Loaded lazily; only shortlists download it.
import * as React from "react";
import { arrangeShortlist, checkShortlist, decisionChoices, type ShortlistData, type ShortlistOption, type Verdict } from "../../shared/shortlist.ts";
import { SOURCE_KINDS } from "../../shared/sources.ts";
import { useData } from "../hooks.ts";
import { useKeyWidget } from "../key-widget.ts";
import { Decision } from "./decision.tsx";
import { AsOf } from "./evidence.tsx";
import { ChevronDown } from "./icons.ts";
import { Callout } from "./layout.tsx";
import { Badge } from "./primitives.tsx";
import { cn } from "./utils.ts";

/** A word and a sign for each verdict, so it never rests on the badge's colour. */
const VERDICT: Record<Verdict, { word: string; sign: string; tone: "primary" | "neutral" | "caution" | "negative" }> = {
  pick: { word: "Pick", sign: "✓", tone: "primary" },
  close: { word: "Alternative", sign: "≈", tone: "neutral" },
  conditional: { word: "Conditional", sign: "?", tone: "caution" },
  no: { word: "Ruled out", sign: "✕", tone: "negative" },
};

const LINK = "text-primary underline decoration-primary/30 underline-offset-[3px] transition-colors hover:decoration-primary";

export default function ShortlistImpl({ data: path }: { data: string }) {
  const s = useData<ShortlistData>(path);
  const [open, setOpen] = React.useState<string | null>(null);
  const [showRuledOut, setShowRuledOut] = React.useState(false);
  const ruledOutId = React.useId();
  // Enter on "Ruled out" opens or closes the list, as a click does.
  const ruledOutButton = React.useRef<HTMLButtonElement>(null);
  useKeyWidget(ruledOutButton, {
    enter: () => {
      setShowRuledOut((x) => !x);
      return true;
    },
  });
  const problems = checkShortlist(s);
  if (problems.length) {
    // The Worker refuses these on write; this only shows when the page was saved before the check existed.
    return (
      <Callout tone="danger" title="This shortlist's data is incomplete">
        <ul className="list-disc pl-5 text-[14px]">{problems.slice(0, 8).map((p) => <li key={p}>{p}</li>)}</ul>
      </Callout>
    );
  }
  const { ranked, ruledOut } = arrangeShortlist(s.options);
  const pick = s.pick ? s.options.find((o) => o.id === s.pick) : undefined;
  const choices = s.decide ? decisionChoices(s) : [];
  // One row open at a time: opening another closes this one at once, as an accordion does.
  const toggle = (id: string) => setOpen((cur) => (cur === id ? null : id));
  const row = (o: ShortlistOption, rank: number | null) => (
    <OptionRow key={o.id} option={o} rank={rank} checked={s.checked} open={open === o.id} onToggle={() => toggle(o.id)} />
  );

  return (
    <div className="art-shortlist my-6" data-key-scope="">
      <h2 className="font-display text-[1.35rem] leading-snug font-semibold text-balance" data-key-stop="">
        {s.question}
      </h2>
      {pick ? (
        <div className="mt-3 rounded-xl border border-primary/20 bg-primary/[0.09] px-4 py-3" data-key-stop="">
          <p className="text-[1.0625rem] leading-snug text-pretty">
            Pick: <strong className="font-semibold">{pick.name}</strong>
          </p>
          <p className="mt-1 text-[15px] leading-relaxed text-pretty">{s.why}</p>
          <div className="mt-2">
            <AsOf checked={s.checked} next={s.next} scope="prices" />
          </div>
        </div>
      ) : (
        <div className="mt-2" data-key-stop="">
          <AsOf checked={s.checked} next={s.next} scope="prices" />
        </div>
      )}
      {s.criteria && s.criteria.length > 0 && (
        <p className="mt-3 text-[14px] leading-snug text-muted-foreground" data-key-stop="">
          What matters, in order: <span className="text-foreground/90">{s.criteria.join(" · ")}</span>
        </p>
      )}

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <ol aria-label="Options, best first" className="divide-y divide-border">
          {ranked.map(({ option, rank }) => row(option, rank))}
        </ol>
        {ruledOut.length > 0 && (
          <>
            {/* Like an accordion: opening shows them, closing takes them away at once. */}
            <button
              ref={ruledOutButton}
              type="button"
              data-key-stop=""
              aria-expanded={showRuledOut}
              aria-controls={ruledOutId}
              onClick={() => setShowRuledOut((x) => !x)}
              className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-b-[calc(var(--radius)+0.25rem-1px)] border-t border-border px-4 py-2.5 text-left text-[14px] font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-primary active:bg-muted/60"
            >
              <ChevronDown aria-hidden className={cn("size-4 shrink-0 transition-transform duration-(--motion-fast) ease-(--motion-ease)", !showRuledOut && "-rotate-90")} />
              Ruled out
              <span className="tabular-nums">· {ruledOut.length}</span>
            </button>
            {showRuledOut && (
              <ol id={ruledOutId} aria-label="Ruled out" className="divide-y divide-border border-t border-border">
                {ruledOut.map((o) => row(o, null))}
              </ol>
            )}
          </>
        )}
      </div>

      {s.decide && (
        <Decision
          id={s.decide.id ?? "shortlist"}
          question={s.decide.question ?? "Your choice"}
          options={choices}
          recommended={pick && choices.some((c) => c.value === pick.id) ? pick.id : undefined}
        />
      )}
    </div>
  );
}

function OptionRow({ option: o, rank, checked, open, onToggle }: { option: ShortlistOption; rank: number | null; checked: string; open: boolean; onToggle: () => void }) {
  const id = React.useId();
  const v = VERDICT[o.verdict];
  const hasDetails = !!(o.pros?.length || o.cons?.length || o.deciding || o.facts?.length || o.evidence?.length || o.url || o.priceChecked);
  // Enter on the row's line opens or closes it, as a click does.
  const line = React.useRef<HTMLDivElement>(null);
  useKeyWidget(line, {
    enter: () => {
      if (!hasDetails) return false;
      onToggle();
      return true;
    },
  });
  return (
    // Listen reads the row's line (rank, name, verdict, price, summary) as one unit; an open row's parts follow.
    // The button lies under the text rather than holding it, because Listen never reads inside a button.
    <li data-speak="option" id={`option-${o.id}`} className="scroll-mt-20">
      <div ref={line} className="relative" data-key-stop="">
        {hasDetails && (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-panel`}
            aria-labelledby={`${id}-name ${id}-verdict${o.price ? ` ${id}-price` : ""}`}
            aria-describedby={`${id}-summary`}
            onClick={onToggle}
            className="absolute inset-0 size-full cursor-pointer rounded-[calc(var(--radius)+0.25rem-1px)] transition-colors outline-none hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-primary active:bg-muted/60"
          />
        )}
        {/* The text stays selectable (to copy it, or select words to comment on); a tap on it opens the row like
            the button under it, unless it was the end of selecting. */}
        <div
          className={cn("relative grid grid-cols-[1.25rem_minmax(0,1fr)_1rem] gap-x-3 px-4 py-3", hasDetails && "cursor-pointer")}
          onClick={(e) => {
            if (!hasDetails || (e.target as Element).closest("a") || getSelection()?.toString()) return;
            onToggle();
          }}
        >
          <span className="text-right text-[14px] leading-6 text-muted-foreground tabular-nums">{rank !== null ? `${rank}.` : ""}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span id={`${id}-name`} className="leading-6 font-semibold break-words">
                {o.name}
              </span>
              <Badge id={`${id}-verdict`} tone={v.tone}>
                <span aria-hidden="true">{v.sign}</span>
                {v.word}
              </Badge>
            </div>
            {/* The price leads the second line: beside the name it would wrap on its own on a phone. */}
            <div className="mt-0.5 text-[14px] leading-snug text-pretty text-muted-foreground">
              {o.price && (
                <>
                  <span id={`${id}-price`} className="font-medium text-foreground tabular-nums">
                    {o.price}
                  </span>
                  <span aria-hidden="true"> · </span>
                </>
              )}
              <span id={`${id}-summary`}>{o.summary}</span>
            </div>
          </div>
          {hasDetails && (
            <ChevronDown aria-hidden className={cn("mt-1 size-4 text-muted-foreground transition-transform duration-(--motion-fast) ease-(--motion-ease)", open && "rotate-180")} />
          )}
        </div>
      </div>
      {open && hasDetails && (
        <div
          id={`${id}-panel`}
          className="flex flex-col gap-3 pt-0.5 pr-4 pb-4 pl-12 text-[15px] leading-relaxed transition-opacity duration-(--motion-base) ease-(--motion-ease) starting:opacity-0"
        >
          {Boolean(o.pros?.length || o.cons?.length) && (
            <div className="grid gap-3 sm:grid-cols-2">
              {o.pros && o.pros.length > 0 && <Points label="For" sign="+" tone="text-positive" items={o.pros} />}
              {o.cons && o.cons.length > 0 && <Points label="Against" sign="−" tone="text-negative" items={o.cons} />}
            </div>
          )}
          {o.deciding && (
            <div data-key-stop="">
              <Label>Decides it</Label>
              <p className="flex gap-2">
                <span aria-hidden="true" className="w-3 shrink-0 font-semibold text-caution">
                  ?
                </span>
                <span className="min-w-0">{o.deciding}</span>
              </p>
            </div>
          )}
          {o.facts && o.facts.length > 0 && (
            <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[14px] leading-6" data-key-stop="">
              {o.facts.map((f, i) => (
                <React.Fragment key={i}>
                  <dt className="break-words text-muted-foreground">{f.label}</dt>
                  <dd className="min-w-0 break-words tabular-nums">{String(f.value)}</dd>
                </React.Fragment>
              ))}
            </dl>
          )}
          {o.priceChecked && o.priceChecked !== checked && (
            <div data-key-stop="">
              <AsOf checked={o.priceChecked} scope="price" />
            </div>
          )}
          {Boolean(o.url || o.evidence?.length) && (
            <div data-key-stop="">
              <Label>Evidence</Label>
              <ul className="flex flex-col gap-1">
                {o.url && (
                  <li>
                    <a href={o.url} className={LINK}>
                      Website
                    </a>
                  </li>
                )}
                {o.evidence?.map((e, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2">
                    <a href={e.url} className={cn(LINK, "[overflow-wrap:anywhere]")}>
                      {e.label}
                    </a>
                    {e.kind && (
                      <Badge tone={SOURCE_KINDS[e.kind].tone} className="self-center">
                        {SOURCE_KINDS[e.kind].label}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-0.5 text-[12px] tracking-[0.05em] text-muted-foreground uppercase">{children}</div>;
}

function Points({ label, sign, tone, items }: { label: string; sign: string; tone: string; items: string[] }) {
  return (
    <div data-key-stop="">
      <Label>{label}</Label>
      <ul className="flex flex-col gap-1">
        {items.map((p, i) => (
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className={cn("w-3 shrink-0 font-semibold", tone)}>
              {sign}
            </span>
            <span className="min-w-0">{p}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
