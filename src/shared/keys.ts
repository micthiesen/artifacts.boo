// Vim-style keys, shared by the shell page and the artifact frame. They are on
// by default and invisible until used: nothing shows until a key is pressed,
// and keys only act when typing can't be meant (no field, menu, slider or
// other widget that owns its letters has focus, and the page didn't handle the
// key itself). Nothing destructive sits on a single key. The account menu
// turns them off per device (WCAG 2.1.4), in a cookie beside Sounds.
//
// Whichever document has focus reads the keys and works out the command
// (counts like 3j, sequences like gg). "page" commands act on what you are
// reading: the frame on an artifact page, the list on your list page. "shell"
// commands (help, go to, the comments drawer) belong to the shell. Each side
// sends the other's commands over the postMessage bridge.

export type Cmd =
  | "down"
  | "up"
  | "left"
  | "right"
  | "halfDown"
  | "halfUp"
  | "top"
  | "bottom"
  | "nextSection"
  | "prevSection"
  | "nextChange"
  | "prevChange"
  | "nextThread"
  | "prevThread"
  | "open"
  | "comment"
  | "visual"
  | "listen"
  | "yank"
  | "find"
  | "findNext"
  | "findPrev"
  | "pin"
  | "escape"
  | "wordNext"
  | "wordEnd"
  | "wordBack"
  | "sentenceNext"
  | "sentenceBack"
  | "reply"
  | "resolve"
  | "undo"
  | "help"
  | "goHome"
  | "goInbox"
  | "goSettings"
  | "threads";

export type Mode = "normal" | "visual";
/**
 * Where a key applies: an artifact, your list, or any page. The comments drawer reads its own keys
 * (src/shell/threads.ts); its rows here are for the key sheet.
 */
export type Where = "artifact" | "list" | "drawer" | "any";

export type Binding = { keys: string[]; cmd: Cmd; mode: Mode; where: Where[]; label: string; group: string };

/** Commands the shell carries out wherever the key was pressed. */
export const SHELL_CMDS: ReadonlySet<Cmd> = new Set<Cmd>(["help", "goHome", "goInbox", "goSettings", "threads"]);

const b = (keys: string, cmd: Cmd, group: string, label: string, where: Where[] = ["artifact"], mode: Mode = "normal"): Binding => ({
  keys: keys.split(" "),
  cmd,
  mode,
  where,
  label,
  group,
});

/** Every key, in the order the key sheet lists them. Keys in one string are pressed in turn ("g g"). */
export const KEYMAP: Binding[] = [
  b("j", "down", "Move", "Next block", ["artifact", "list"]),
  b("k", "up", "Move", "Previous block", ["artifact", "list"]),
  b("h", "left", "Move", "Scroll a wide table or code block left"),
  b("l", "right", "Move", "Scroll it right"),
  b("C-d", "halfDown", "Move", "Half a page down"),
  b("C-u", "halfUp", "Move", "Half a page up"),
  b("g g", "top", "Move", "Top", ["artifact", "list"]),
  b("G", "bottom", "Move", "Bottom", ["artifact", "list"]),
  b("}", "nextSection", "Move", "Next heading"),
  b("{", "prevSection", "Move", "Previous heading"),
  b("] c", "nextChange", "Find", "Next change since your last visit"),
  b("[ c", "prevChange", "Find", "Previous change"),
  b("] t", "nextThread", "Find", "Next comment"),
  b("[ t", "prevThread", "Find", "Previous comment"),
  b("/", "find", "Find", "Find on the page", ["artifact", "list"]),
  b("n", "findNext", "Find", "Next match"),
  b("N", "findPrev", "Find", "Previous match"),
  b("Enter", "open", "Act", "Open its comment, or its first control", ["artifact", "list"]),
  b("o", "open", "Act", "Same as Enter", ["artifact", "list"]),
  b("c", "comment", "Act", "Comment on this block"),
  b("v", "visual", "Act", "Select words to comment on"),
  b("s", "listen", "Act", "Listen from here (again to pause)"),
  b("y", "yank", "Act", "Copy a link to this block"),
  b("p", "pin", "Act", "Pin or unpin", ["list"]),
  b("t", "threads", "Act", "Comments drawer"),
  b("Escape", "escape", "Act", "Clear", ["artifact", "list"]),
  b("w", "wordNext", "Selecting", "One more word", ["artifact"], "visual"),
  b("e", "wordEnd", "Selecting", "One more word", ["artifact"], "visual"),
  b("b", "wordBack", "Selecting", "One word less", ["artifact"], "visual"),
  b(")", "sentenceNext", "Selecting", "To the end of the sentence", ["artifact"], "visual"),
  b("(", "sentenceBack", "Selecting", "One sentence less", ["artifact"], "visual"),
  b("c", "comment", "Selecting", "Comment on the selection", ["artifact"], "visual"),
  b("y", "yank", "Selecting", "Copy the selection", ["artifact"], "visual"),
  b("Escape", "escape", "Selecting", "Stop selecting", ["artifact"], "visual"),
  b("v", "escape", "Selecting", "Stop selecting", ["artifact"], "visual"),
  b("j", "down", "Comments drawer", "Next comment", ["drawer"]),
  b("k", "up", "Comments drawer", "Previous comment", ["drawer"]),
  b("Enter", "open", "Comments drawer", "Show it on the page", ["drawer"]),
  b("r", "reply", "Comments drawer", "Reply", ["drawer"]),
  b("x", "resolve", "Comments drawer", "Resolve or reopen", ["drawer"]),
  b("u", "undo", "Comments drawer", "Undo that", ["drawer"]),
  b("Escape", "escape", "Comments drawer", "Close the drawer", ["drawer"]),
  b("g h", "goHome", "Go", "Your artifacts", ["any"]),
  b("g i", "goInbox", "Go", "Inbox", ["any"]),
  b("g s", "goSettings", "Go", "Settings", ["any"]),
  b("?", "help", "Go", "This list", ["any"]),
];

// The visual-mode table lists only its own keys; the shell's keys work there too.
for (const k of KEYMAP.filter((k) => k.mode === "normal" && SHELL_CMDS.has(k.cmd))) KEYMAP.push({ ...k, mode: "visual" });

/** How a key reads on the key sheet. */
export function keyLabel(key: string): string {
  if (key.startsWith("C-")) return `Ctrl ${key.slice(2)}`;
  if (key === "Escape") return "Esc";
  return key;
}

/**
 * Ctrl d and Ctrl u are vim's half pages on a Mac. Elsewhere Ctrl is the browser's (Ctrl D bookmarks, Ctrl U
 * shows the source), so they stay the browser's there.
 */
export const ctrlKeys = (platform = globalThis.navigator?.platform ?? "") => /^Mac/.test(platform);

/** The key as the keymap names it: "j", "G", "?", "C-d", "Enter"; null for keys no binding could use. */
export function keyToken(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">, ctrl = ctrlKeys()): string | null {
  if (e.metaKey || !e.key) return null;
  // Option (Mac) and AltGr (which reports Ctrl and Alt) type symbols on many layouts: [ and { on a German one.
  if (e.altKey) return e.key.length === 1 && !/[\p{L}\p{N}]/u.test(e.key) ? e.key : null;
  if (e.ctrlKey) return ctrl && !e.shiftKey && /^[a-z]$/i.test(e.key) ? `C-${e.key.toLowerCase()}` : null;
  if (e.key.length === 1 || e.key === "Enter" || e.key === "Escape") return e.key;
  return null;
}

/** Commands a held key repeats; everything else happens once per press. */
const REPEATS: ReadonlySet<Cmd> = new Set<Cmd>(["down", "up", "left", "right", "halfDown", "halfUp", "findNext", "findPrev", "wordNext", "wordEnd", "wordBack", "sentenceNext", "sentenceBack"]);

/** Widgets that own their letters or arrows: keys typed in them are theirs. */
const OWNS_KEYS =
  "textarea,select,[contenteditable]:not([contenteditable='false']),[role=textbox],[role=combobox],[role=searchbox],[role=listbox],[role=grid],[role=treegrid],[role=tree],[role=menu],[role=menubar],[role=slider],[role=spinbutton],[role=tablist],[role=radiogroup],[role=application],[role=dialog]:not([data-keys]),dialog:not([data-keys]),[aria-modal='true']:not([data-keys])";
/** Inputs you can't type in (a checkbox's letters do nothing). */
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);
/** Controls that Enter and Space already work. */
const PRESSABLE = "a[href],button,summary,input,[role=button],[role=link],[role=checkbox],[role=switch],[role=tab],[role=option],[role=menuitem],[tabindex]:not([tabindex='-1'])";

/**
 * Whether a key press is someone typing or working a widget, so the keys stay out of it: in a field, while
 * composing (IME), in a widget that owns its keys, or already handled by the page (`preventDefault`).
 */
export function keyIsTheirs(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return true;
  const target = (e.composedPath?.()[0] ?? e.target) as Element | null;
  if (!target || typeof target.closest !== "function") return false;
  if (target instanceof HTMLInputElement && !NOT_TYPED.has(target.type)) return true;
  if (target.closest(OWNS_KEYS)) return true;
  if ((e.key === "Enter" || e.key === " ") && target.closest(PRESSABLE)) return true;
  return false;
}

export type KeyEngine = {
  /** Reads one keydown, and carries out the command it completes. */
  handle(e: KeyboardEvent): void;
  /** Forget a half-typed sequence or count. */
  reset(): void;
};

/**
 * Reads key presses into commands. `run` carries a command out and says whether it did (a key whose command
 * does nothing here is left to the browser). `show` gets what has been typed so far ("3", "g", "] "), for the
 * corner hint, and "" when that clears.
 */
export function keyEngine(o: {
  enabled: () => boolean;
  mode: () => Mode;
  where: () => Where;
  run: (cmd: Cmd, count: number) => boolean;
  show?: (typed: string) => void;
  /** How long a half-typed sequence waits for its next key. */
  timeoutMs?: number;
}): KeyEngine {
  let pending: string[] = [];
  let count = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const typed = () => [count, ...pending].filter(Boolean).join(" ");
  const reset = () => {
    clearTimeout(timer);
    const had = pending.length > 0 || count !== "";
    pending = [];
    count = "";
    if (had) o.show?.("");
  };
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(reset, o.timeoutMs ?? 1200);
    o.show?.(typed());
  };
  const bindings = () => {
    const mode = o.mode();
    const where = o.where();
    return KEYMAP.filter((k) => k.mode === mode && (k.where.includes(where) || k.where.includes("any")));
  };
  return {
    reset,
    handle(e) {
      if (!o.enabled()) return reset();
      if (keyIsTheirs(e)) return reset();
      const token = keyToken(e);
      if (!token) return;
      if (/^[0-9]$/.test(token) && !pending.length && (token !== "0" || count)) {
        count = (count + token).slice(-3);
        e.preventDefault();
        return arm();
      }
      const seq = [...pending, token];
      const all = bindings();
      const exact = all.find((k) => k.keys.length === seq.length && k.keys.every((x, i) => x === seq[i]));
      const longer = all.some((k) => k.keys.length > seq.length && seq.every((x, i) => x === k.keys[i]));
      if (longer && !exact) {
        pending = seq;
        e.preventDefault();
        return arm();
      }
      const n = count ? Math.max(1, Number(count)) : 1;
      const midway = pending.length > 0 || count !== "";
      reset();
      if (exact && e.repeat && !REPEATS.has(exact.cmd)) e.preventDefault();
      else if (exact && o.run(exact.cmd, n)) e.preventDefault();
      // The end of a sequence nothing knows (g x) is swallowed rather than acted on as a key of its own.
      else if (midway) e.preventDefault();
    },
  };
}

/** The keys cookie sits beside the Sounds one: art_sounds → art_keys (a stage's suffix carries over). */
export function keysCookieName(soundsName: string): string {
  return soundsName.replace(/^art_sounds/, "art_keys");
}

/** On unless this device turned them off. */
export function readKeysCookie(cookie: string, name: string): boolean {
  return !new RegExp(`(?:^|;\\s*)${name}=0(?:;|$)`).test(cookie);
}
