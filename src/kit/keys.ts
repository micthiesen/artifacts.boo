// Vim-style keys inside the artifact frame. The keymap and the rules about when keys act are in
// src/shared/keys.ts. This part is always here and small: it reads the keys, shows what has been typed in the
// corner, and sends the shell its commands (the key sheet, going places, the drawer, Listen). What the keys do
// to the page (the block cursor, selecting words, find) is src/kit/keys-page.ts, loaded at the first page key.
import type { FrameMessage } from "../shared/protocol.ts";
import { keyEngine, SHELL_CMDS, type Cmd, type Mode } from "../shared/keys.ts";

type Page = typeof import("./keys-page.ts");
let page: Page | null = null;
let loading: Promise<Page> | null = null;
const loadPage = () =>
  (loading ??= import("./keys-page.ts").then(
    (m) => (page = m),
    (err: unknown) => {
      // A failed fetch: try again at the next key.
      loading = null;
      throw err;
    },
  ));

let send: (m: FrameMessage) => void = () => {};
let root: HTMLElement;
let on = true;
let mode: Mode = "normal";

const engine = keyEngine({ enabled: () => on, mode: () => mode, where: () => "artifact", run, show: (typed) => showcmd(typed) });

export function installKeys(rootEl: HTMLElement, transport: (m: FrameMessage) => void) {
  root = rootEl;
  send = transport;
  window.addEventListener("keydown", (e) => engine.handle(e));
}

export function setKeysOn(next: boolean) {
  on = next;
  if (on) return;
  engine.reset();
  page?.escape();
  showcmd("");
}

/** A page command pressed while the shell had focus. */
export function runKey(cmd: Cmd, count: number) {
  run(cmd, Math.max(1, Math.min(999, Number(count) || 1)));
}

function run(cmd: Cmd, n: number): boolean {
  if (SHELL_CMDS.has(cmd)) {
    send({ t: "key", cmd, count: n });
    return true;
  }
  // Nothing to clear or open before the first page key: leave Escape and Enter to the page.
  if ((cmd === "escape" || cmd === "open") && !page?.busy()) return false;
  void loadPage().then((p) => p.run(cmd, n), () => note("Couldn't load the keys. Try again."));
  return true;
}

// ---- for keys-page.ts ----------------------------------------------------------------------

export const keysRoot = () => root;
export const keysMode = () => mode;
export function setKeysMode(next: Mode) {
  mode = next;
}
export function sendKey(m: FrameMessage) {
  send(m);
}

// ---- the corner hint (vim's showcmd) -----------------------------------------------------

let hint: HTMLDivElement | null = null;
let spoken: HTMLDivElement | null = null;
let hintTimer: ReturnType<typeof setTimeout> | undefined;
let sticky = "";

/** What has been typed so far, or (stay) a mode that holds while it lasts: selecting. */
export function showcmd(text: string, stay = false) {
  if (stay) sticky = text;
  else if (!text && mode === "normal") sticky = "";
  paintHint(text || sticky);
}

/** A short message that clears itself ("No more changes"), also read out to screen readers. */
export function note(text: string) {
  if (!spoken) {
    spoken = document.createElement("div");
    spoken.setAttribute("role", "status");
    spoken.className = "sr-only";
    document.body.append(spoken);
  }
  spoken.textContent = text;
  paintHint(text);
  hintTimer = setTimeout(() => paintHint(sticky), 1800);
}

function paintHint(text: string) {
  clearTimeout(hintTimer);
  if (!hint) {
    if (!text) return;
    hint = document.createElement("div");
    hint.className = "art-showcmd";
    hint.setAttribute("aria-hidden", "true");
    hint.setAttribute("data-print", "hide");
    hint.hidden = true;
    document.body.append(hint);
  }
  if (text) hint.textContent = text;
  hint.hidden = !text;
}
