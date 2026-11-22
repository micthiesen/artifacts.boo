// A support case's page (in the operator's support workspace, shared with the
// person who reported it): what they reported, where it stands, and, once a fix
// is out, whether it helped. The conversation is the page's comment thread; on
// a case's own page the shell sends that one thread here (ShellBoot.conversation)
// and it is shown in the page, with the drawer as a second view of it. The
// status (`case/status`), the plan (`case/plan`) and the log (`case/log`) are
// written only by the service, never from the page.
import * as React from "react";
import { useData, useShared, useViewer } from "../hooks.ts";
import * as store from "../store.ts";
import { cue, move } from "../../shared/motion.ts";
import { CommentComposer, CommentRow } from "./collab.tsx";
import { Badge, Button, Textarea } from "./primitives.tsx";
import { cn, displayName, relativeTime, useNow } from "./utils.ts";
import type { ConversationView } from "../../shared/protocol.ts";

type Kind = "bug" | "feature" | "question";
type CaseData = {
  number: number;
  kind: Kind;
  title: string;
  reporter: string;
  submittedAt: string;
  viaAgent?: boolean;
  context?: { workspace?: string; page?: string; browser?: string; version?: string };
  error?: { id: string; message: string } | null;
};
type CaseStatus = {
  status: string;
  at?: string;
  thread?: string;
  history?: { status: string; at: string }[];
  fix?: { summary?: string; version?: string };
};

const STATUS: Record<string, { label: string; tone: "neutral" | "positive" | "caution"; text: string }> = {
  new: { label: "Received", tone: "neutral", text: "We have it. We'll reply below and email you when something changes." },
  triaged: { label: "Looking into it", tone: "neutral", text: "We're looking into it." },
  investigating: { label: "Looking into it", tone: "neutral", text: "We're looking into it." },
  needs_info: { label: "Waiting for you", tone: "caution", text: "We've asked you something below. Reply when you can." },
  fix_proposed: { label: "Fix in progress", tone: "neutral", text: "A fix is being made and reviewed." },
  fix_deployed: { label: "Fix released", tone: "positive", text: "A fix is out." },
  resolved: { label: "Resolved", tone: "positive", text: "This is resolved. If it comes back, say so below and we'll pick it up again." },
  wont_fix: { label: "Closed", tone: "neutral", text: "Closed without a change; the conversation says why." },
  duplicate: { label: "Merged with another report", tone: "neutral", text: "Someone reported the same thing, and we're working on it together. You'll hear about it here." },
};
type LogEntry = { at: string; actor?: string; event?: string; status?: string };
const KIND = { bug: "Problem", feature: "Idea", question: "Question" } as const;
/** "Did this fix it?" in the words that fit what was asked. */
const ASK: Record<Kind, { question: string; yes: string; no: string; what: string; missing: string }> = {
  bug: { question: "Did this fix it?", yes: "Yes, it's fixed", no: "No, still a problem", what: "What's still wrong?", missing: "Say what's still wrong, so we know where to look." },
  feature: { question: "Does this do what you wanted?", yes: "Yes, it does", no: "Not quite", what: "What's still missing?", missing: "Say what's still missing, so we know what to change." },
  question: { question: "Did that answer it?", yes: "Yes, thanks", no: "Not quite", what: "What's still unclear?", missing: "Say what's still unclear, so we can answer it." },
};
/** The plan shows this many lines until "Show all". */
const PLAN_LINES = 8;
/** History shows the latest this many until "Show earlier". */
const HISTORY_SHOWN = 5;
/** What the service adds to a message an agent sent for someone; the page says it in words of its own instead. */
const AGENT_SUFFIX = /\n\n\((?:Sent by [^)\n]+'s agent on their behalf|Sent by their agent)\.\)$/;

/** A text button: its tap target grows to 24 px or more with a pseudo-element, and the keyboard focus shows a ring. */
const LINK = "relative cursor-pointer rounded text-[14px] text-primary underline outline-none after:absolute after:-inset-1.5 after:content-[''] focus-visible:focus-halo";
const heading = "mb-3 text-[13px] font-medium tracking-[0.06em] text-muted-foreground uppercase";

export function SupportCase({ data: path = "case.json" }: { data?: string }) {
  const data = useData<CaseData>(path);
  const [status] = useShared<CaseStatus | null>("case/status", null);
  const [plan] = useShared<{ text?: string } | null>("case/plan", null);
  const [log] = useShared<LogEntry[] | null>("case/log", null);
  const conversation = React.useSyncExternalStore(store.subscribe, store.getConversation);
  const viewer = useViewer();
  const now = useNow();
  if (!data) return null;
  const s = STATUS[status?.status ?? "new"] ?? STATUS.new;
  const context = Object.entries(data.context ?? {}).filter(([, v]) => v);
  // A request from before the log has only its status changes; they come first, then the log from where it starts.
  const logged = Array.isArray(log) ? log : [];
  const history: LogEntry[] = [...(status?.history ?? []).filter((h) => !logged.length || h.at < logged[0].at), ...logged];
  const mine = viewer.email === data.reporter;
  const who = (actor?: string) => (!actor ? "" : actor === "agent" ? "Support" : actor === "system" ? "Automatic" : actor === viewer.email ? "You" : displayName(actor));
  // Asked only when a fix was released: now, or just before it resolved (an answer can still reopen it then).
  const steps = status?.history ?? [];
  const released = status?.status === "fix_deployed" || (status?.status === "resolved" && steps.at(-2)?.status === "fix_deployed");
  const kind: Kind = data.kind in ASK ? data.kind : "bug";
  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="m-0 font-display text-[1.75rem] leading-tight font-semibold text-balance">{data.title}</h1>
        <p className="mt-2 mb-0 text-[14px] text-muted-foreground">
          {KIND[data.kind] ?? "Request"} #{data.number}, from {mine ? "you" : displayName(data.reporter)}
          {data.viaAgent ? (mine ? " (sent by your agent)" : " (sent by their agent)") : ""}, {relativeTime(data.submittedAt, now)}
        </p>
      </header>

      <section aria-label="Status" className="rounded-xl border border-border bg-card p-4 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={s.tone}>{s.label}</Badge>
          {status?.at && <span className="text-[13px] text-muted-foreground">{relativeTime(status.at, now)}</span>}
        </div>
        <p className="mt-2 mb-0 text-[15px] leading-relaxed">{s.text}</p>
        {status?.fix?.summary && <p className="mt-2 mb-0 text-[15px] leading-relaxed text-muted-foreground">What changed: {status.fix.summary}</p>}
        {released && mine && <Confirm reporter={data.reporter} ask={ASK[kind]} />}
        {!conversation && status?.thread && (
          <Button type="button" size="sm" variant="secondary" className="mt-3" onClick={() => store.post({ t: "comment:open", thread: status.thread! })}>
            Open the conversation
          </Button>
        )}
      </section>

      {conversation && <Conversation view={conversation} viaAgent={Boolean(data.viaAgent)} reporter={data.reporter} />}

      {plan?.text && <Plan text={plan.text} />}

      {(context.length > 0 || data.error) && (
        <section>
          <h2 className={heading}>Details</h2>
          <dl className="m-0 grid grid-cols-1 gap-x-3 text-[14px] sm:grid-cols-[minmax(0,0.7fr)_minmax(0,2fr)] sm:gap-y-1">
            {context.map(([k, v]) => (
              <React.Fragment key={k}>
                <dt className="text-muted-foreground max-sm:mt-2 max-sm:first:mt-0">{{ workspace: "Workspace", page: "Page", browser: "Browser", version: "App version" }[k] ?? k}</dt>
                <dd className="m-0 min-w-0 break-words">{v}</dd>
              </React.Fragment>
            ))}
            {data.error && (
              <>
                <dt className="text-muted-foreground max-sm:mt-2 max-sm:first:mt-0">Error</dt>
                <dd className="m-0 min-w-0 break-words">
                  {data.error.message} <span className="text-muted-foreground">({data.error.id})</span>
                </dd>
              </>
            )}
          </dl>
        </section>
      )}

      {history.length > 1 && <History entries={history} who={who} />}
    </div>
  );
}

/**
 * The conversation: what they sent first, then the replies, then a box to reply in. The text they type stays in
 * the box until the reply is saved; a refused one says why under it.
 */
function Conversation({ view, viaAgent, reporter }: { view: ConversationView; viaAgent: boolean; reporter: string }) {
  const [text, setText] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const field = React.useRef<HTMLTextAreaElement>(null);
  const list = React.useRef<HTMLUListElement>(null);
  const seen = React.useRef<Set<string> | null>(null);
  const sending = React.useRef(false);
  // A comment arriving: yours lands with the send cue, someone else's glows. Not the ones there on load.
  React.useEffect(() => {
    const ids = view.comments.map((c) => c.id);
    if (seen.current) {
      for (const c of view.comments) {
        if (seen.current.has(c.id)) continue;
        const el = list.current?.querySelector(`[data-key="${CSS.escape(c.id)}"]`);
        if (c.by === view.me && sending.current) cue(el, "send");
        else if (c.by !== view.me) move(el, "glow");
      }
    }
    seen.current = new Set(ids);
  }, [view]);

  async function submit(e?: React.SyntheticEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setError(null);
    sending.current = true;
    const r = await store.sendReply(t);
    sending.current = false;
    setBusy(false);
    if (r.ok) setText("");
    else {
      setError(r.reason ?? "That didn't send. Try again.");
      field.current?.focus();
    }
  }

  const fromAgent = (c: ConversationView["comments"][number]) => c.by === reporter && AGENT_SUFFIX.test(c.text);
  return (
    <section aria-labelledby="case-conversation" data-speak="skip">
      <h2 id="case-conversation" className={heading}>
        Conversation
      </h2>
      {view.comments.length === 0 && <p className="mt-0 mb-4 text-[15px] text-muted-foreground">Nothing here yet.</p>}
      <ul ref={list} className="m-0 flex list-none flex-col gap-5 p-0">
        {view.comments.map((c, i) => (
          <CommentRow
            key={c.id}
            rowKey={c.id}
            by={c.by}
            name={c.name}
            at={c.at}
            text={fromAgent(c) ? c.text.replace(AGENT_SUFFIX, "") : c.text}
            me={view.me}
            reactions={new Map((c.reactions ?? []).map((r) => [r.emoji, r.by]))}
            note={fromAgent(c) ? (c.by === view.me ? (i === 0 && viaAgent ? "Sent by your agent for you" : "Sent by your agent") : "Sent by their agent") : undefined}
          />
        ))}
      </ul>
      {view.canReply && (
        <CommentComposer
          className="mt-5"
          me={view.me}
          value={text}
          onChange={(v) => {
            setText(v);
            if (error) setError(null);
          }}
          onSubmit={submit}
          placeholder="Write a reply…"
          label="Reply"
          submitLabel="Reply"
          busy={busy}
          error={error}
          fieldRef={field}
        />
      )}
    </section>
  );
}

/** The plan: the first lines, and the rest on "Show all" (it can run long). */
function Plan({ text }: { text: string }) {
  const [open, setOpen] = React.useState(false);
  const [long, setLong] = React.useState(false);
  const body = React.useRef<HTMLParagraphElement>(null);
  const id = React.useId();
  React.useLayoutEffect(() => {
    const el = body.current;
    if (!el || open) return;
    // Measured again when the width changes (a phone turned, fonts loaded), so clamped lines are never out of reach.
    const measure = () => setLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [text, open]);
  return (
    <section>
      <h2 className={heading}>Plan</h2>
      <p
        ref={body}
        id={id}
        className={cn("m-0 text-[15px] leading-relaxed break-words whitespace-pre-wrap", !open && "overflow-hidden")}
        style={open ? undefined : { display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: PLAN_LINES }}
      >
        {text}
      </p>
      {(long || open) && (
        <button type="button" aria-expanded={open} aria-controls={id} className={cn("mt-2", LINK)} onClick={() => setOpen(!open)}>
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </section>
  );
}

/** What happened, oldest first: a label said twice in a row shows once, and only the latest few until asked. */
function History({ entries, who }: { entries: LogEntry[]; who: (actor?: string) => string }) {
  const [all, setAll] = React.useState(false);
  const label = (h: LogEntry) => (h.status ? (STATUS[h.status] ?? STATUS.new).label : (h.event ?? ""));
  const rows = entries.filter((h, i) => i === 0 || label(h) !== label(entries[i - 1]) || who(h.actor) !== who(entries[i - 1].actor));
  const shown = all ? rows : rows.slice(-HISTORY_SHOWN);
  return (
    <section>
      <h2 className={heading}>History</h2>
      {rows.length > shown.length && (
        <button type="button" className={cn("mb-2", LINK)} onClick={() => setAll(true)}>
          Show earlier ({rows.length - shown.length})
        </button>
      )}
      <ol className="m-0 flex list-none flex-col gap-2 p-0 text-[14px] sm:gap-1">
        {shown.map((h, i) => (
          <li key={`${h.at}-${i}`} className="flex flex-col sm:flex-row sm:gap-3">
            <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums sm:w-28 sm:text-[14px]">
              {new Date(h.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
            <span className="min-w-0 break-words">
              {label(h)}
              {who(h.actor) && <span className="text-muted-foreground"> · {who(h.actor)}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * "Did this fix it?" (in the words of what was asked): the reporter's own answer, stored as their decision so the
 * assistant hears of it. Yes resolves the request; no needs a note saying what's still wrong, which goes into the
 * conversation as their message, and reopens it.
 */
function Confirm({ reporter, ask }: { reporter: string; ask: (typeof ASK)[Kind] }) {
  const [answer, setAnswer] = useShared<{ decision?: string; note?: string; at?: number } | null>(`approve/fixed/${reporter}`, null);
  const [asking, setAsking] = React.useState(false);
  const [note, setNote] = React.useState("");
  const [missing, setMissing] = React.useState(false);
  const field = React.useRef<HTMLTextAreaElement>(null);
  const no = React.useRef<HTMLButtonElement>(null);
  const id = React.useId();
  const said = answer?.decision;
  React.useEffect(() => {
    if (asking && !said) field.current?.focus();
  }, [asking, said]);
  const send = (e: React.FormEvent) => {
    e.preventDefault();
    const text = note.trim();
    if (!text) {
      setMissing(true);
      field.current?.focus();
      return;
    }
    // The text stays in the field: if the answer is refused and comes back, nothing they typed is lost.
    setAnswer({ decision: "changes", note: text });
  };
  return (
    <div className={cn("mt-4 border-t pt-4", said === "approve" ? "border-positive/40" : "border-border")}>
      <p className="m-0 font-medium">{ask.question}</p>
      {said ? (
        <p className="mt-1 mb-0 text-[14px] text-muted-foreground">
          {said === "approve" ? "Thanks for confirming." : "Thanks; we'll keep at it."}{" "}
          <button type="button" className={LINK} onClick={() => setAnswer(null)}>
            Change
          </button>
        </p>
      ) : asking ? (
        <form className="mt-2 flex flex-col gap-2" onSubmit={send} noValidate>
          <label htmlFor={id} className="text-[14px]">
            {ask.what}
          </label>
          <Textarea
            ref={field}
            id={id}
            value={note}
            maxLength={2000}
            rows={3}
            aria-invalid={missing || undefined}
            aria-describedby={missing ? `${id}-error` : undefined}
            onChange={(e) => {
              setNote(e.target.value);
              if (e.target.value.trim()) setMissing(false);
            }}
          />
          {missing && (
            <p id={`${id}-error`} role="alert" className="m-0 text-[14px] text-negative">
              {ask.missing}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm">
              Send
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setAsking(false);
                // Back to where they came from, once the buttons are in the page again.
                requestAnimationFrame(() => no.current?.focus());
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={() => setAnswer({ decision: "approve" })}>
            {ask.yes}
          </Button>
          <Button ref={no} type="button" size="sm" variant="secondary" onClick={() => setAsking(true)}>
            {ask.no}
          </Button>
        </div>
      )}
    </div>
  );
}
