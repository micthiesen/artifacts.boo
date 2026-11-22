// Comment drawer: lists the artifact's threads in page order, starts new ones
// from a selection in the frame, and handles replies, resolve and delete. The
// frame only reports anchors and clicks; everything here runs in the trusted
// shell, so artifact code can't read or forge comments.
import { ANCHOR_LABEL_MAX, REACTIONS, type Anchor, type AnchorStatus, type Person, type PlacedAnchor, type SyncClientMessage, type Thread, type ThreadComment } from "../shared/protocol.ts";
import { whoColor } from "../shared/who.ts";
import { keyIsTheirs, keyToken } from "../shared/keys.ts";
import { keysOn } from "./keys.ts";
import { toast } from "./toast.ts";
import { motionMs, move } from "../shared/motion.ts";

export type DrawerOptions = {
  me: string | null;
  canComment: boolean;
  /** Editors and owners may resolve anyone's thread; viewers only their own. */
  canResolveAny: boolean;
  isOwner: boolean;
  readSeq: number;
  /** Sends a message; false when it couldn't go (offline), so the caller keeps what was typed. */
  send: (msg: SyncClientMessage) => boolean;
  /** Ask the frame to scroll to and flash a thread's anchor. */
  focus: (threadId: string) => void;
  /** Threads changed: the frame redraws highlights. */
  onThreads: (threads: Thread[]) => void;
  onRead: (seq: number) => void;
  /**
   * A support case's page: the thread its page shows as its conversation. New threads aren't started there (the
   * conversation is the one place to write), and the conversation can't be resolved.
   */
  conversation?: string;
};

type Filter = "open" | "resolved";

export function createDrawer(panel: HTMLElement, toggle: HTMLButtonElement, opts: DrawerOptions) {
  let threads = new Map<string, Thread>();
  let people: Person[] = [];
  let order: PlacedAnchor[] = [];
  let filter: Filter = "open";
  let draft: { anchor: Anchor | null; text?: string } | null = null;
  let readSeq = opts.readSeq;
  let activeId: string | null = null;
  const replyDrafts = new Map<string, string>();
  /** Comments sent but not yet saved, by cid: a rejected one puts its text back. */
  const unsaved = new Map<string, { thread: string; text: string } | { anchor: Anchor | null; text: string }>();
  let pendingFocus: string | null = null;
  /** Your reactions sent but not yet saved, by cid: shown at once, and taken back if refused or never answered. */
  const reacting = new Map<string, { comment: string; emoji: string; on: boolean }>();
  /** The comment whose reaction menu is open. */
  let reactOpen: string | null = null;

  const nameOf = (email: string) => {
    if (email === "agent") return "Agent";
    if (email === opts.me) return "You";
    return people.find((p) => p.email === email)?.name ?? email.split("@")[0];
  };

  function isOpen() {
    return !panel.hidden;
  }

  function setOpen(open: boolean) {
    panel.hidden = !open;
    document.body.classList.toggle("threads-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      render();
      markRead();
    } else {
      // A comment you started stays for when the drawer opens again; an empty one goes.
      if (!draft?.text?.trim()) draft = null;
      activeId = null;
      opts.onThreads(visibleThreads());
    }
  }

  toggle.addEventListener("click", () => setOpen(!isOpen()));

  function visibleThreads(): Thread[] {
    return [...threads.values()].filter((t) => !t.resolved && t.comments.length);
  }

  function statusOf(id: string): AnchorStatus | undefined {
    return order.find((o) => o.id === id)?.status;
  }

  function sorted(list: Thread[]): Thread[] {
    const pos = new Map(order.map((o, i) => [o.id, i]));
    return [...list].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9) || a.at.localeCompare(b.at));
  }

  function unreadCount(): number {
    let n = 0;
    for (const t of threads.values()) for (const c of t.comments) if (c.seq > readSeq && c.by !== opts.me) n++;
    return n;
  }

  function markRead() {
    let max = readSeq;
    for (const t of threads.values()) for (const c of t.comments) max = Math.max(max, c.seq);
    if (max > readSeq) {
      // Keep "new" markers on screen until the drawer re-renders on its own.
      readSeq = max;
      opts.onRead(max);
    }
    updateToggle();
  }

  function updateToggle() {
    const open = visibleThreads().length;
    const unread = unreadCount();
    toggle.querySelector(".count")!.textContent = open ? String(open) : "";
    toggle.classList.toggle("has-unread", unread > 0);
    toggle.title = unread ? `${unread} new ${unread === 1 ? "comment" : "comments"}` : "Comments";
  }

  // ---- rendering ---------------------------------------------------------------

  function render() {
    updateToggle();
    if (!isOpen()) return;
    const focusKey = (document.activeElement as HTMLElement | null)?.dataset?.key;
    // A card the keys moved to keeps the focus when the list redraws (a comment arriving).
    const focusCard = (document.activeElement as HTMLElement | null)?.matches?.("article.thread") ? (document.activeElement as HTMLElement).dataset.thread : undefined;
    const all = [...threads.values()].filter((t) => t.comments.length);
    const open = all.filter((t) => !t.resolved);
    const resolved = all.filter((t) => t.resolved);
    const list = filter === "open" ? open : resolved;

    const head = el("div", "threads-head");
    const tabs = el("div", "threads-tabs");
    for (const f of ["open", "resolved"] as const) {
      const b = button(`${f === "open" ? "Open" : "Resolved"} ${f === "open" ? open.length : resolved.length}`, "tab", () => {
        filter = f;
        render();
      });
      b.setAttribute("aria-pressed", String(filter === f));
      tabs.append(b);
    }
    const close = button("", "icon", () => setOpen(false));
    close.innerHTML = X_ICON;
    close.setAttribute("aria-label", "Close comments");
    head.append(tabs, close);

    const body = el("div", "threads-body");
    if (draft) body.append(composer(draft.anchor));
    if (opts.canComment && !draft && filter === "open" && !opts.conversation) {
      const add = button("Comment on the whole page", "ghost add-page", () => {
        draft = { anchor: null };
        render();
      });
      body.append(add);
      const hint = el("p", "threads-hint");
      hint.textContent = "Or select text on the page, or hover a block or an item and press +.";
      body.append(hint);
    }
    if (!opts.canComment && opts.me === null) {
      const hint = el("p", "threads-hint");
      hint.textContent = "Sign in to comment.";
      body.append(hint);
    }
    const placed = sorted(list);
    const groups: [string, Thread[]][] =
      filter === "open"
        ? [
            ["", placed.filter((t) => !t.anchor || statusOf(t.id) !== "orphaned")],
            ["No longer on the page", placed.filter((t) => t.anchor && statusOf(t.id) === "orphaned")],
          ]
        : [["", placed]];
    for (const [title, items] of groups) {
      if (!items.length) continue;
      if (title) {
        const h = el("h3", "threads-group");
        h.textContent = title;
        body.append(h);
      }
      for (const t of items) body.append(card(t));
    }
    if (!list.length && !draft) {
      const empty = el("p", "threads-empty");
      empty.textContent = filter === "open" ? "No open comments." : "Nothing resolved yet.";
      body.append(empty);
    }
    panel.replaceChildren(head, body);
    // A chip that went with your last reaction of its kind hands the focus to its comment's React button.
    if (focusKey) (panel.querySelector<HTMLElement>(`[data-key="${focusKey}"]`) ?? panel.querySelector<HTMLElement>(`[data-key="${focusKey.replace(/^rx-(.+)-\d$/, "react-$1")}"]`))?.focus();
    else if (focusCard) cardEl(focusCard)?.focus({ preventScroll: true });
    if (pendingFocus) {
      const target = panel.querySelector(`[data-thread="${CSS.escape(pendingFocus)}"]`);
      target?.scrollIntoView({ block: "nearest" });
      pendingFocus = null;
    }
  }

  function anchorView(anchor: Anchor | null, status: AnchorStatus | undefined, onClick?: () => void, live?: string): HTMLElement | null {
    if (!anchor) return null;
    const q = el(onClick ? "button" : "div", `thread-anchor${status === "outdated" || status === "orphaned" ? " is-stale" : ""}`);
    if (onClick) {
      (q as HTMLButtonElement).type = "button";
      q.addEventListener("click", onClick);
    }
    // A comment target shows what the item is called now; once it has left the page, the name saved with the thread.
    const text = anchor.quote?.exact ?? live ?? anchor.label ?? anchor.target ?? (anchor.row ? `Row ${anchor.row}` : "This block");
    q.textContent = text.length > 160 ? `${text.slice(0, 159)}…` : text;
    return q;
  }

  function card(t: Thread): HTMLElement {
    const status = statusOf(t.id);
    const c = el("article", `thread${t.id === activeId ? " is-active" : ""}`);
    c.dataset.thread = t.id;
    // The keys (j, k) move the focus between cards.
    c.tabIndex = -1;
    const chips = el("div", "thread-chips");
    if (t.addressedIn) chips.append(chip(`Addressed in v${t.addressedIn}`, "positive"));
    else if (t.resolved) chips.append(chip(`Resolved by ${nameOf(t.resolved.by)}`, "muted"));
    if (!t.resolved && status === "outdated") chips.append(chip(`Text changed since v${t.version}`, "caution"));
    if (chips.childElementCount) c.append(chips);
    const anchor = anchorView(t.anchor, status, status === "orphaned" ? undefined : () => select(t.id), order.find((o) => o.id === t.id)?.label);
    if (anchor) c.append(anchor);
    for (const cm of t.comments) {
      const row = el("div", `comment${cm.seq > readSeq && cm.by !== opts.me ? " is-new" : ""}`);
      row.dataset.comment = cm.id;
      const meta = el("div", "comment-meta");
      // The agent is the moonlit ghost; people are small ghosts in their own colour.
      const av = el("span", `avatar small ${cm.by === "agent" ? "agent" : "ghosted"}`);
      if (cm.by !== "agent") {
        av.style.setProperty("--who", whoColor(cm.by));
        av.textContent = cm.by.slice(0, 1).toUpperCase();
      }
      const who = el("span", "comment-who");
      who.textContent = nameOf(cm.by);
      // Display names are self-chosen; the address is always one hover away.
      if (cm.by.includes("@")) who.title = cm.by;
      if (cm.by === "agent") who.append(chip("agent", "muted"));
      const when = el("time", "comment-when");
      when.dateTime = cm.at;
      when.title = new Date(cm.at).toLocaleString();
      when.textContent = relative(cm.at);
      meta.append(av, who, when);
      if (opts.me && (cm.by === opts.me || opts.isOwner)) {
        const del = button("Delete", "link danger", () => {
          if (confirm("Delete this comment?")) opts.send({ t: "comment:delete", cid: cid(), comment: cm.id });
        });
        meta.append(del);
      }
      const text = el("p", "comment-text");
      renderText(text, cm.text);
      row.append(meta, text);
      if (opts.canComment) {
        const add = button("", "icon react-add", () => (reactOpen === cm.id ? closeReact(true) : openReact(cm.id)));
        add.innerHTML = REACT_ICON;
        add.setAttribute("aria-label", "React");
        add.setAttribute("aria-haspopup", "menu");
        add.setAttribute("aria-expanded", String(reactOpen === cm.id));
        add.dataset.key = `react-${cm.id}`;
        const del = meta.querySelector(".danger");
        if (del) del.before(add);
        else meta.append(add);
      }
      const reactions = reactionsOf(cm);
      if (reactions.length) {
        const chips = el("div", "reactions");
        for (const r of reactions) {
          const mine = opts.me !== null && r.by.includes(opts.me);
          const b = el("button", "reaction");
          b.type = "button";
          b.disabled = !opts.canComment;
          b.dataset.key = reactKey(cm.id, r.emoji);
          b.setAttribute("aria-pressed", String(mine));
          b.title = namesOf(r.by);
          b.setAttribute("aria-label", `${REACTIONS[r.emoji]}: ${namesOf(r.by)}. Press to ${mine ? "take yours back" : "add yours"}.`);
          const count = el("span");
          count.textContent = String(r.by.length);
          b.append(r.emoji, count);
          b.addEventListener("click", () => react(cm.id, r.emoji, !mine));
          chips.append(b);
        }
        row.append(chips);
      }
      if (reactOpen === cm.id) {
        // Redrawn while open (a comment arrived): it is already there, so it doesn't grow in again.
        const pop = reactMenu(cm, reactions);
        pop.classList.add("is-still");
        requestAnimationFrame(() => pop.classList.remove("is-still"));
        row.append(pop);
      }
      c.append(row);
    }
    const actions = el("div", "thread-actions");
    if (opts.canComment) {
      const reply = textarea(`Reply…`, replyDrafts.get(t.id) ?? "", `reply-${t.id}`);
      reply.addEventListener("input", () => replyDrafts.set(t.id, reply.value));
      const send = () => {
        const text = reply.value.trim();
        if (!text) return;
        const id = cid();
        if (!opts.send({ t: "comment", cid: id, thread: t.id, text })) return;
        unsaved.set(id, { thread: t.id, text });
        replyDrafts.delete(t.id);
        reply.value = "";
      };
      reply.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          send();
        }
      });
      attachMentions(reply);
      c.append(reply);
      actions.append(button("Reply", "primary small", send));
    }
    const mayResolve = opts.me && (opts.canResolveAny || t.by === opts.me) && t.id !== opts.conversation;
    if (mayResolve) {
      actions.append(
        button(t.resolved ? "Reopen" : "Resolve", "ghost small", () =>
          opts.send({ t: "resolve", cid: cid(), thread: t.id, resolved: !t.resolved }),
        ),
      );
    }
    if (actions.childElementCount) c.append(actions);
    c.addEventListener("click", (e) => {
      if ((e.target as Element).closest("button, textarea, a")) return;
      select(t.id);
    });
    return c;
  }

  // ---- reactions: a chip per emoji under a comment, and a menu of the six from its React button ----

  const reactKey = (comment: string, emoji: string) => `rx-${comment}-${Object.keys(REACTIONS).indexOf(emoji)}`;
  /** You first, so your own reaction is said in words and not only by the chip's colour. */
  const namesOf = (by: string[]) => [...by].sort((a, b) => Number(b === opts.me) - Number(a === opts.me)).map(nameOf).join(", ");

  /** A comment's reactions as shown: what is saved, with yours still on their way applied over it. */
  function reactionsOf(cm: ThreadComment): NonNullable<ThreadComment["reactions"]> {
    const by = new Map(Object.keys(REACTIONS).map((e) => [e, [...(cm.reactions?.find((r) => r.emoji === e)?.by ?? [])]]));
    for (const p of reacting.values()) {
      if (p.comment !== cm.id || !opts.me) continue;
      const list = by.get(p.emoji)!.filter((b) => b !== opts.me);
      if (p.on) list.push(opts.me);
      by.set(p.emoji, list);
    }
    return [...by].filter(([, list]) => list.length).map(([emoji, list]) => ({ emoji, by: list }));
  }

  function react(comment: string, emoji: string, on: boolean) {
    const id = cid();
    if (!opts.send({ t: "react", cid: id, comment, emoji, on })) return;
    reacting.set(id, { comment, emoji, on });
    // A workspace still running the code from before a deploy doesn't know this message and never answers it.
    setTimeout(() => {
      if (!reacting.delete(id)) return;
      toast("Reaction not saved. Try again.");
      render();
    }, 8000);
    render();
  }

  function reactMenu(cm: ThreadComment, reactions: NonNullable<ThreadComment["reactions"]>): HTMLElement {
    const pop = el("div", "react-pop");
    const menu = el("div", "react-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "React");
    for (const [emoji, name] of Object.entries(REACTIONS)) {
      const mine = opts.me !== null && Boolean(reactions.find((r) => r.emoji === emoji)?.by.includes(opts.me));
      const b = el("button");
      b.type = "button";
      b.textContent = emoji;
      b.setAttribute("role", "menuitemcheckbox");
      b.setAttribute("aria-checked", String(mine));
      b.setAttribute("aria-label", name);
      b.title = name;
      b.addEventListener("click", () => {
        closeReact(true);
        react(cm.id, emoji, !mine);
      });
      menu.append(b);
    }
    menu.addEventListener("keydown", (e) => {
      const items = [...menu.querySelectorAll<HTMLElement>("button")];
      const at = items.indexOf(document.activeElement as HTMLElement);
      const to = e.key === "ArrowRight" ? at + 1 : e.key === "ArrowLeft" ? at - 1 : e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : null;
      if (to !== null) {
        e.preventDefault();
        items[(to + items.length) % items.length].focus();
      } else if (e.key === "Escape") {
        // Closes the menu only; the drawer stays.
        e.preventDefault();
        e.stopPropagation();
        closeReact(true);
      } else if (e.key === "Tab") closeReact(false);
    });
    pop.append(menu);
    // Who reacted, in words: a chip's tooltip never shows on a touch screen.
    if (reactions.length) {
      const who = el("div", "react-who");
      for (const r of reactions) {
        const line = el("div");
        const names = el("span");
        names.textContent = namesOf(r.by);
        line.append(r.emoji, names);
        who.append(line);
      }
      pop.append(who);
    }
    return pop;
  }

  function openReact(comment: string) {
    closeReact(false);
    const row = panel.querySelector<HTMLElement>(`[data-comment="${CSS.escape(comment)}"]`);
    const cm = [...threads.values()].flatMap((t) => t.comments).find((c) => c.id === comment);
    if (!row || !cm) return;
    reactOpen = comment;
    const pop = reactMenu(cm, reactionsOf(cm));
    row.append(pop);
    row.querySelector(".react-add")?.setAttribute("aria-expanded", "true");
    pop.scrollIntoView({ block: "nearest" });
    pop.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  }

  function closeReact(refocus: boolean) {
    if (!reactOpen) return;
    const row = panel.querySelector<HTMLElement>(`[data-comment="${CSS.escape(reactOpen)}"]`);
    reactOpen = null;
    const pop = row?.querySelector<HTMLElement>(".react-pop");
    const add = row?.querySelector<HTMLElement>(".react-add");
    add?.setAttribute("aria-expanded", "false");
    if (refocus) add?.focus();
    if (!pop) return;
    // Hidden first, so it shrinks back to the button; then out of the page.
    pop.hidden = true;
    setTimeout(() => pop.remove(), motionMs("base"));
  }

  document.addEventListener("pointerdown", (e) => {
    if (reactOpen && !(e.target as Element).closest?.(".react-pop, .react-add")) closeReact(false);
  });
  // A press on the page lands in the artifact's frame, which this document only hears of as losing the focus.
  window.addEventListener("blur", () => closeReact(false));

  function composer(anchor: Anchor | null): HTMLElement {
    const c = el("article", "thread is-draft");
    const a = anchorView(anchor, undefined);
    if (a) c.append(a);
    const input = textarea(anchor ? "Comment on this…" : "Comment on the page…", draft?.text ?? "", "draft");
    input.addEventListener("input", () => {
      if (draft) draft.text = input.value;
    });
    const submit = () => {
      const text = input.value.trim();
      if (!text) return;
      const id = cid();
      if (!opts.send({ t: "comment", cid: id, anchor, text })) return;
      unsaved.set(id, { anchor, text });
      draft = null;
      render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submit();
      }
      // Escape leaves a comment you've started (Cancel discards it); an empty one just closes.
      if (e.key === "Escape") {
        if (input.value.trim()) input.blur();
        else {
          draft = null;
          render();
        }
      }
    });
    attachMentions(input);
    const actions = el("div", "thread-actions");
    actions.append(
      button("Cancel", "ghost small", () => {
        draft = null;
        render();
      }),
      button("Comment", "primary small", submit),
    );
    const hint = el("span", "threads-hint inline");
    hint.textContent = "⌘/Ctrl + Enter";
    actions.prepend(hint);
    c.append(input, actions);
    queueMicrotask(() => input.focus());
    // Opened by a held key (c): its auto-repeat doesn't type into the box. The first real press or release ends that.
    let fresh = true;
    input.addEventListener("keyup", () => (fresh = false), { once: true });
    input.addEventListener("keydown", (e) => {
      if (fresh && e.repeat) e.preventDefault();
      else fresh = false;
    });
    return c;
  }

  function select(id: string) {
    activeId = id;
    opts.focus(id);
    render();
  }

  // ---- keys (src/shared/keys.ts): j and k between comments, Enter shows one, r replies, x resolves ----

  function cardEl(id: string): HTMLElement | null {
    return panel.querySelector<HTMLElement>(`article.thread[data-thread="${CSS.escape(id)}"]`);
  }

  function cards(): HTMLElement[] {
    return [...panel.querySelectorAll<HTMLElement>("article.thread[data-thread]")];
  }

  function focusCardEl(card: HTMLElement | undefined) {
    if (!card) return;
    card.focus({ preventScroll: true });
    card.scrollIntoView({ block: "nearest" });
    // The page follows: the comment's text is shown and lit there.
    const id = card.dataset.thread!;
    if (id !== activeId && statusOf(id) !== "orphaned") select(id);
  }

  panel.addEventListener("keydown", (e) => {
    if (!keysOn() || keyIsTheirs(e)) return;
    const list = cards();
    const at = list.findIndex((c) => c.contains(document.activeElement));
    const card = list[at];
    const token = keyToken(e);
    let done = true;
    if (token === "j" || token === "k") focusCardEl(list[at < 0 ? 0 : Math.max(0, Math.min(list.length - 1, at + (token === "j" ? 1 : -1)))]);
    else if ((token === "Enter" || token === "o") && card) select(card.dataset.thread!);
    else if (token === "r" && card?.querySelector("textarea")) card.querySelector<HTMLTextAreaElement>("textarea")!.focus();
    else if (token === "x" && card) resolveByKey(card.dataset.thread!);
    else if (token === "u" && undoResolve) undoResolve();
    else if (token === "Escape") {
      setOpen(false);
      toggle.focus();
    } else done = false;
    if (done) e.preventDefault();
  });

  /** The last x, until its toast goes: u (or the toast's Undo) takes it back. */
  let undoResolve: (() => void) | null = null;

  function resolveByKey(id: string) {
    const t = threads.get(id);
    if (!t || !opts.me || !(opts.canResolveAny || t.by === opts.me) || id === opts.conversation) return;
    const resolved = !t.resolved;
    if (!opts.send({ t: "resolve", cid: cid(), thread: id, resolved })) return;
    // The next card takes the focus (the one before, at the end), so x can work down the list and the keys stay here.
    const list = cards();
    const at = list.findIndex((c) => c.dataset.thread === id);
    const near = list[at + 1] ?? list[at - 1];
    if (near) focusCardEl(near);
    else panel.querySelector<HTMLElement>(".threads-tabs button, button")?.focus();
    const undo = () => {
      undoResolve = null;
      opts.send({ t: "resolve", cid: cid(), thread: id, resolved: !resolved });
    };
    undoResolve = undo;
    setTimeout(() => {
      if (undoResolve === undo) undoResolve = null;
    }, 6000);
    toast(`${resolved ? "Comment resolved" : "Comment reopened"}. Press u to undo.`, { label: "Undo", run: undo });
  }

  // ---- mentions --------------------------------------------------------------------

  function attachMentions(input: HTMLTextAreaElement) {
    let list: HTMLElement | null = null;
    let matches: Person[] = [];
    let index = 0;
    const close = () => {
      list?.remove();
      list = null;
    };
    const query = () => {
      const upto = input.value.slice(0, input.selectionStart ?? input.value.length);
      return /(?:^|\s)@([^\s@]*)$/.exec(upto)?.[1] ?? null;
    };
    const pick = (p: Person) => {
      const pos = input.selectionStart ?? input.value.length;
      const before = input.value.slice(0, pos).replace(/@([^\s@]*)$/, `@${p.email} `);
      input.value = before + input.value.slice(pos);
      input.setSelectionRange(before.length, before.length);
      input.dispatchEvent(new Event("input"));
      close();
      input.focus();
    };
    input.addEventListener("input", () => {
      const q = query();
      if (q === null) return close();
      matches = people
        .filter((p) => p.email !== opts.me && `${p.name ?? ""} ${p.email}`.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 6);
      if (!matches.length) return close();
      index = 0;
      list ??= el("div", "mentions");
      list.setAttribute("role", "listbox");
      list.replaceChildren(
        ...matches.map((p, i) => {
          const b = button(`${p.name ? `${p.name} · ` : ""}${p.email}`, `mention${i === index ? " is-active" : ""}`, () => pick(p));
          b.setAttribute("role", "option");
          b.addEventListener("pointerdown", (e) => e.preventDefault());
          return b;
        }),
      );
      input.after(list);
    });
    input.addEventListener("keydown", (e) => {
      if (!list) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        index = (index + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length;
        list.querySelectorAll(".mention").forEach((b, i) => b.classList.toggle("is-active", i === index));
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        e.stopImmediatePropagation();
        pick(matches[index]);
      } else if (e.key === "Escape") {
        e.stopImmediatePropagation();
        close();
      }
    });
    input.addEventListener("blur", () => setTimeout(close, 150));
  }

  function renderText(target: HTMLElement, text: string) {
    const parts = text.split(/(@[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/gi);
    for (const part of parts) {
      if (/^@.+@/.test(part)) {
        const m = el("span", "mention-text");
        m.textContent = `@${nameOf(part.slice(1).toLowerCase())}`;
        m.title = part.slice(1);
        target.append(m);
      } else target.append(document.createTextNode(part));
    }
  }

  // ---- public API ---------------------------------------------------------------------

  return {
    /** How many comments a thread has (0 for one not seen yet). */
    count(id: string): number {
      return threads.get(id)?.comments.length ?? 0;
    },
    /** A comment's row, while the drawer shows it. */
    commentEl(id: string): HTMLElement | null {
      return panel.querySelector(`[data-comment="${CSS.escape(id)}"]`);
    },
    setAll(list: Thread[], ppl: Person[]) {
      threads = new Map(list.map((t) => [t.id, t]));
      people = ppl;
      opts.onThreads(visibleThreads());
      render();
      if (isOpen()) markRead();
    },
    upsert(t: Thread) {
      const had = new Set(threads.get(t.id)?.comments.flatMap((c) => (c.reactions ?? []).flatMap((r) => r.by.map((by) => `${c.id} ${r.emoji} ${by}`))));
      const known = threads.has(t.id);
      if (!t.comments.length) threads.delete(t.id);
      else threads.set(t.id, t);
      for (const c of t.comments) {
        for (const by of [c.by, ...(c.reactions ?? []).flatMap((r) => r.by)]) {
          if (by.includes("@") && !people.some((p) => p.email === by)) people = [...people, { email: by, name: null }];
        }
      }
      opts.onThreads(visibleThreads());
      render();
      if (isOpen()) markRead();
      // Someone else's reaction reaching the page glows on its chip. No sound: a reaction is quieter than a comment.
      if (!known) return;
      for (const c of t.comments) {
        for (const r of c.reactions ?? []) {
          if (r.by.some((by) => by !== opts.me && !had.has(`${c.id} ${r.emoji} ${by}`))) move(panel.querySelector(`[data-key="${reactKey(c.id, r.emoji)}"]`), "glow");
        }
      }
    },
    setPlacement(placed: PlacedAnchor[]) {
      // The frame is the artifact's own code: take a label from it only as a short string.
      // Only for a thread on a comment target: no other thread's name is the page's to change.
      order = placed.map((p) => ({ id: p.id, status: p.status, ...(typeof p.label === "string" && p.label && threads.get(p.id)?.anchor?.target ? { label: p.label.slice(0, ANCHOR_LABEL_MAX) } : {}) }));
      render();
    },
    compose(anchor: Anchor) {
      if (!opts.canComment || opts.conversation) return;
      // Text already typed moves to the new selection rather than being dropped.
      draft = { anchor, text: draft?.text };
      filter = "open";
      setOpen(true);
    },
    open(threadId: string) {
      const t = threads.get(threadId);
      if (!t) {
        setOpen(true);
        return;
      }
      filter = t.resolved ? "resolved" : "open";
      activeId = threadId;
      pendingFocus = threadId;
      setOpen(true);
      if (!t.resolved) opts.focus(threadId);
    },
    show() {
      setOpen(true);
    },
    /** The t key: opens the drawer on a comment, or closes it when the keys are already in it. */
    keys() {
      if (isOpen() && panel.contains(document.activeElement)) {
        setOpen(false);
        toggle.focus();
        return;
      }
      setOpen(true);
      const list = cards();
      const card = (activeId && cardEl(activeId)) || list[0];
      if (card) focusCardEl(card);
      else panel.querySelector<HTMLElement>("button.add-page, textarea, button")?.focus();
    },
    /** A comment or reaction was saved: forget its text, and show the reaction as the server has it. */
    sent(cid: string) {
      unsaved.delete(cid);
      reacting.delete(cid);
    },
    /**
     * A comment was rejected: put its text back where it was typed (unless something new is being typed there).
     * A rejected reaction comes off its chip. Says which it was, for the status line.
     */
    failed(cid: string): "reaction" | "comment" {
      if (reacting.delete(cid)) {
        render();
        return "reaction";
      }
      const lost = unsaved.get(cid);
      if (!lost) return "comment";
      unsaved.delete(cid);
      if ("thread" in lost) {
        filter = threads.get(lost.thread)?.resolved ? "resolved" : "open";
        if (!replyDrafts.get(lost.thread)?.trim()) replyDrafts.set(lost.thread, lost.text);
        pendingFocus = lost.thread;
      } else if (!draft?.text?.trim()) draft = { anchor: lost.anchor, text: lost.text };
      if (isOpen()) render();
      else setOpen(true);
      return "comment";
    },
    unread: unreadCount,
    /** One thread as last received, and the people named in threads. */
    thread(id: string): Thread | undefined {
      return threads.get(id);
    },
    people(): Person[] {
      return people;
    },
    /** The page showed these comments (a case's conversation): read up to `seq`. */
    readUpTo(seq: number) {
      if (seq <= readSeq) return;
      readSeq = seq;
      opts.onRead(seq);
      updateToggle();
    },
  };
}

// ---- small DOM helpers ------------------------------------------------------------------

// Drawn, not typed: "✕" and "✦" come from fallback fonts and sit off-center in their boxes.
const X_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;

const REACT_ICON = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M20.5 12a8.5 8.5 0 1 1-8.5-8.5M8.5 14.5a4.5 4.5 0 0 0 7 0M9 10h.01M15 10h.01M19 2.5v5M16.5 5h5"/></svg>`;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", `tbtn ${variant}`);
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function chip(text: string, tone: string): HTMLElement {
  const c = el("span", `chip ${tone}`);
  c.textContent = text;
  return c;
}

function textarea(placeholder: string, value: string, key: string): HTMLTextAreaElement {
  const t = el("textarea", "thread-input");
  t.placeholder = placeholder;
  t.value = value;
  t.rows = 2;
  t.dataset.key = key;
  return t;
}

function cid() {
  return crypto.randomUUID();
}

export function relative(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
