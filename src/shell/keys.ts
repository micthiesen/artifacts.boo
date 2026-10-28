// Vim-style keys on the shell's pages: reading them, the key sheet (?), going
// places (g h, g i, g s), the corner hint, and the per-device switch. The
// keymap and the rules about when keys act are in src/shared/keys.ts. Each
// page adds what its keys do through src/shell/keys-registry.ts: the artifact
// page sends page commands on to the frame, the list page moves through its
// rows. account.js and shell.js load this; one page never loads both.
import { ctrlKeys, KEYMAP, keyEngine, keyIsTheirs, keyLabel, keysCookieName, keyToken, readKeysCookie, type Binding, type Cmd } from "../shared/keys.ts";
import { soundsCookie, soundsScopeOf } from "../shared/sound.ts";
import { onKey, registry } from "./keys-registry.ts";

export { note, onKey, setKeysWhere } from "./keys-registry.ts";

const slot = document.getElementById("me");
const state = {
  on: readKeysCookie(document.cookie, keysCookieName(soundsScopeOf(slot).name)),
  changed: new Set<(on: boolean) => void>(),
  help: null as HTMLDialogElement | null,
};
const engine = keyEngine({
  enabled: () => state.on,
  mode: () => "normal",
  where: () => registry.where,
  run: (cmd, count) => runKey(cmd, count),
  show: (typed) => showcmd(typed),
});
window.addEventListener("keydown", (e) => engine.handle(e));
registry.note = note;
goKeys(slot);

export function keysOn(): boolean {
  return state.on;
}

/** Turn the keys on or off for this device (the account menu and the key sheet). */
export function setKeysOn(on: boolean) {
  state.on = on;
  const scope = soundsScopeOf(document.getElementById("me"));
  document.cookie = soundsCookie(on, { ...scope, name: keysCookieName(scope.name) }, location.hostname, location.protocol === "https:");
  if (!on) engine.reset();
  for (const fn of state.changed) fn(on);
}

export function onKeysChanged(fn: (on: boolean) => void) {
  state.changed.add(fn);
}

/** Carry out a command (a key here, or one the frame sent). False when this page has nothing for it. */
export function runKey(cmd: Cmd, count = 1): boolean {
  // While the key sheet is open, only ? (to close it) works: the page behind it stays put.
  if (state.help?.open && cmd !== "help") return false;
  const handler = registry.handlers.get(cmd);
  return handler ? handler(Math.max(1, Math.min(999, count))) !== false : false;
}

/** Going places: your list, the inbox, settings. A one-artifact link session has only the artifact. */
function goKeys(slot: HTMLElement | null) {
  onKey("help", () => toggleHelp());
  if (!slot?.dataset.email || slot.dataset.scoped) return;
  const apex = slot.dataset.apex || location.origin;
  const workspace = slot.dataset.context === "workspace";
  const go = (href: string) => () => {
    const url = new URL(href, location.href);
    if (url.href === location.href) return note("You're here");
    location.assign(url.href);
  };
  onKey("goHome", go("/"));
  onKey("goInbox", go(`${apex}/inbox`));
  onKey("goSettings", go(workspace && slot.dataset.member ? "/settings" : "/me"));
}

// ---- the key sheet -------------------------------------------------------------------------

function toggleHelp() {
  if (state.help?.open) return state.help.close();
  state.help ??= buildHelp();
  fillHelp(state.help);
  state.help.showModal();
}

function buildHelp(): HTMLDialogElement {
  const d = document.createElement("dialog");
  d.className = "keys-help";
  // The keys still read ? here (to close it); everything else waits behind it.
  d.setAttribute("data-keys", "");
  d.setAttribute("aria-labelledby", "keys-help-title");
  d.addEventListener("click", (e) => {
    // A click on the backdrop (outside the sheet's box) closes it.
    const r = d.getBoundingClientRect();
    if (e.target === d && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) d.close();
  });
  // Its own keys: q closes it (as Esc does), j and k scroll it, g g and G go to its top and bottom.
  let g = 0;
  d.addEventListener("keydown", (e) => {
    if (keyIsTheirs(e)) return;
    const token = keyToken(e);
    const row = 40;
    const top = token === "g" && Date.now() - g < 1200;
    g = token === "g" && !top ? Date.now() : 0;
    if (token === "q") d.close();
    else if (token === "j" || token === "k") d.scrollBy({ top: token === "j" ? row : -row, behavior: "instant" });
    else if (top || token === "G") d.scrollTo({ top: top ? 0 : d.scrollHeight, behavior: "instant" });
    else if (token !== "g") return;
    e.preventDefault();
  });
  document.body.append(d);
  return d;
}

function fillHelp(d: HTMLDialogElement) {
  const where = registry.where;
  const ctrl = ctrlKeys();
  const shown = (k: Binding) => {
    if (!ctrl && k.keys.some((x) => x.startsWith("C-"))) return false;
    if (k.mode === "visual") return where === "artifact" && k.group === "Selecting";
    if (k.where.includes("drawer")) return where === "artifact" && registry.handlers.has("threads");
    return (k.where.includes(where) || k.where.includes("any")) && registry.handlers.has(k.cmd);
  };
  // Rows with the same words share one line: "Esc or v".
  const groups = new Map<string, Map<string, string[][]>>();
  for (const k of KEYMAP) {
    if (!shown(k)) continue;
    const rows = groups.get(k.group) ?? new Map<string, string[][]>();
    groups.set(k.group, rows);
    rows.set(k.label, [...(rows.get(k.label) ?? []), k.keys]);
  }
  const head = document.createElement("div");
  head.className = "keys-help-head";
  const title = document.createElement("h2");
  title.id = "keys-help-title";
  title.textContent = "Keyboard shortcuts";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "keys-help-close";
  close.setAttribute("aria-label", "Close");
  close.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  close.addEventListener("click", () => d.close());
  head.append(title, close);
  const body = document.createElement("div");
  body.className = "keys-help-body";
  for (const [group, rows] of groups) {
    const section = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = group;
    const dl = document.createElement("dl");
    for (const [label, keysets] of rows) {
      const dt = document.createElement("dt");
      keysets.forEach((keys, i) => {
        if (i) dt.append(Object.assign(document.createElement("span"), { className: "keys-or", textContent: "or" }));
        for (const key of keys) dt.append(Object.assign(document.createElement("kbd"), { textContent: keyLabel(key) }));
      });
      const dd = document.createElement("dd");
      dd.textContent = label;
      dl.append(dt, dd);
    }
    section.append(h, dl);
    body.append(section);
  }
  const foot = document.createElement("div");
  foot.className = "keys-help-foot";
  const say = document.createElement("p");
  say.textContent = "Keys rest while you type in a field. A number first repeats a move: 3j. Here, j and k scroll and q closes.";
  const off = document.createElement("button");
  off.type = "button";
  off.className = "keys-help-off";
  off.textContent = "Turn off on this device";
  off.addEventListener("click", () => {
    setKeysOn(false);
    d.close();
    note("Shortcuts off. Turn them back on with Shortcuts in your account menu.");
  });
  foot.append(say, off);
  d.replaceChildren(head, body, foot);
}

// ---- the corner hint (vim's showcmd) ---------------------------------------------------------

let hint: HTMLDivElement | null = null;
let spoken: HTMLDivElement | null = null;
let hintTimer: ReturnType<typeof setTimeout> | undefined;

function showcmd(text: string) {
  clearTimeout(hintTimer);
  if (!hint) {
    if (!text) return;
    hint = document.createElement("div");
    hint.className = "keys-showcmd";
    hint.setAttribute("aria-hidden", "true");
    hint.hidden = true;
    document.body.append(hint);
  }
  if (text) hint.textContent = text;
  hint.hidden = !text;
}

/** A short message in the corner that clears itself, also read out to screen readers. */
function note(text: string) {
  if (!spoken) {
    spoken = document.createElement("div");
    spoken.className = "sr-only";
    spoken.setAttribute("role", "status");
    document.body.append(spoken);
  }
  spoken.textContent = text;
  showcmd(text);
  hintTimer = setTimeout(() => showcmd(""), 2400);
}
