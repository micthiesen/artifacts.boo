// What the vim-style keys do to the artifact's page. src/kit/keys.ts reads the keys and loads this the first
// time a page key is pressed, so pages nobody presses keys on don't carry it.
//
// j and k move a cursor over the page's blocks (paragraphs, headings, list items, tables, charts): the same
// blocks Listen reads and comments point at. The current block wears your light, an iris ring that appears in
// place rather than sliding, since moving is frequent and keyboard-driven. Longer jumps (a heading, a change,
// the top) land with an iris halo that fades out, drawn on a layer of its own, so the eye finds where it went.
// Everything else acts on the cursor: c comments on it, v selects words in it to comment on, s reads it aloud,
// y copies a link to it, Enter opens its comment or first control. The only change to the artifact's own
// elements is the cursor's class, which draws its outline.
import type { Cmd } from "../shared/keys.ts";
import { anchorFromRange, blockAnchor, commentAllowed, focusThread, rangeAt, textIndex, threadNodes } from "./annotate.ts";
import { speakFrom, speakJumpTo } from "./speak.ts";
import { keysMode, keysRoot, note, sendKey as send, setKeysMode, showcmd } from "./keys.ts";

/** What counts as a block. The innermost one is the cursor's stop; the atomic ones are stops whole. */
const BLOCKS = "h1,h2,h3,h4,h5,h6,p,li,pre,table,blockquote,figure,dt,dd,[data-speak],[role=note],[data-b]";
const ATOMIC = "pre,table,figure,blockquote,[data-speak],[role=note]";
const SKIP = "nav,[hidden],[aria-hidden='true'],[data-speak='skip'],.art-contents,.art-markers,.art-keys-find,.art-showcmd,.art-landing,template";
const CONTROLS = "a[href],button,input,select,textarea,summary,[tabindex]:not([tabindex='-1']),[role=button],[role=checkbox],[role=switch],[role=tab]";
const MAX_QUOTE = 1000;
const MAX_HITS = 500;

let cursor: Element | null = null;
/** A control Enter focused: Escape hands the keys back from it. */
let opened: HTMLElement | null = null;

const highlights = (globalThis as { CSS?: { highlights?: Map<string, unknown> } }).CSS?.highlights;
const HighlightCtor = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

// Pointing somewhere is leaving the keys: the cursor goes until the next key.
addEventListener(
  "pointerdown",
  (e) => {
    if ((e.target as Element | null)?.closest?.(".art-keys-find")) return;
    setCursor(null);
  },
  { passive: true },
);
// A selection the mouse cleared or replaced ends selecting.
document.addEventListener("selectionchange", () => {
  if (keysMode() === "visual" && sel && document.getSelection()?.toString() !== sel.painted) leaveVisual();
});
// Escape in a field Enter put you in hands the keys back to the page (keys in fields are otherwise theirs).
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || !opened || document.activeElement !== opened || e.defaultPrevented) return;
  opened.blur();
  opened = null;
});

export function run(cmd: Cmd, n: number) {
  // React may have rewritten the cursor block's classes: put the ring back.
  if (cursor?.isConnected && !ring?.classList.contains("art-cursor")) paintCursor(cursor);
  if (keysMode() === "visual") return visual(cmd, n);
  switch (cmd) {
    case "down":
    case "up":
      return step(cmd === "down" ? 1 : -1, n);
    case "left":
    case "right":
      return sideways(cmd === "right" ? 1 : -1, n);
    case "halfDown":
    case "halfUp":
      return half(cmd === "halfDown" ? 1 : -1, n);
    case "top":
    case "bottom": {
      const list = blocks();
      if (!list.length) return scrollEnd(cmd === "top" ? -1 : 1);
      return setCursor(cmd === "top" ? list[0]! : list[list.length - 1]!, true);
    }
    case "nextSection":
    case "prevSection":
      return section(cmd === "nextSection" ? 1 : -1, n);
    case "nextChange":
    case "prevChange":
      return change(cmd === "nextChange" ? 1 : -1, n);
    case "nextThread":
    case "prevThread":
      return thread(cmd === "nextThread" ? 1 : -1, n);
    case "open":
      return open();
    case "comment":
      return comment();
    case "visual":
      return enterVisual();
    case "listen":
      return listen();
    case "yank":
      return yank();
    case "find":
      return openFind();
    case "findNext":
    case "findPrev":
      return findStep(cmd === "findNext" ? n : -n);
    case "escape":
      return escape();
  }
}

/** Whether Escape has anything to clear here. */
export function busy(): boolean {
  return Boolean(cursor) || hits.length > 0 || (findBar !== null && !findBar.hidden) || keysMode() === "visual";
}

export function escape() {
  if (keysMode() === "visual") leaveVisual(true);
  setCursor(null);
  closeFind(true);
}

// ---- blocks and the cursor -------------------------------------------------------------

/** The page's blocks in reading order: innermost ones, atomic ones whole, nothing hidden or of ours. */
function blocks(): Element[] {
  const root = keysRoot();
  const found = [...root.querySelectorAll(BLOCKS)].filter((el) => !el.closest(SKIP) && !el.parentElement?.closest(ATOMIC));
  const containers = new Set<Element>();
  for (const el of found) for (let up = el.parentElement; up && up !== root; up = up.parentElement) containers.add(up);
  return found.filter((el) => {
    if (containers.has(el)) return false;
    const r = el.getBoundingClientRect();
    return r.height > 0 && r.width > 0;
  });
}

/** Where the cursor is in the list; with none (or one that re-rendered away), the first block on screen. */
function at(list: Element[]): { i: number; fresh: boolean } {
  const i = cursor?.isConnected ? list.indexOf(cursor) : -1;
  if (i >= 0) return { i, fresh: false };
  const top = Math.max(0, keysRoot().getBoundingClientRect().top);
  const first = list.findIndex((el) => el.getBoundingClientRect().bottom > top + 4);
  // Everything is above the screen (scrolled past the end): the last block.
  return { i: first < 0 ? list.length - 1 : first, fresh: true };
}

/** The element wearing the ring: the cursor block, or the rounded box around it. */
let ring: Element | null = null;

const radius = (el: Element) => parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;

/**
 * Where the ring goes: a block that is the only thing in a rounded box (a table in its card and scroller, the
 * one paragraph of a Summary) rings the box, so the ring follows the box's corners instead of cutting across
 * them inside it.
 */
function ringTarget(el: Element): Element {
  let target = el;
  for (let depth = 0; depth < 3 && !radius(target); depth++) {
    const up = target.parentElement;
    if (!up || up === keysRoot() || up.childElementCount !== 1) break;
    target = up;
  }
  return radius(target) ? target : el;
}

/** Whether a ring drawn outside the element would be cut off by something that clips around it (a card, a scroller). */
function clipped(el: Element): boolean {
  const r = el.getBoundingClientRect();
  for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
    const s = getComputedStyle(up);
    if (s.overflowX === "visible" && s.overflowY === "visible") continue;
    const c = up.getBoundingClientRect();
    // The outline (2px, 4px out) must fit inside the clipping box.
    return r.left - 6 < c.left || r.right + 6 > c.right || r.top - 6 < c.top || r.bottom + 6 > c.bottom;
  }
  return false;
}

function paintCursor(el: Element) {
  ring?.classList.remove("art-cursor", "art-cursor-inset");
  ring = ringTarget(el);
  ring.classList.add("art-cursor");
  // Where it would be cut off, the ring is drawn just inside the edge instead, on the same corners.
  ring.classList.toggle("art-cursor-inset", clipped(ring));
}

function setCursor(el: Element | null, jump = false) {
  ring?.classList.remove("art-cursor", "art-cursor-inset");
  ring = null;
  cursor = el;
  if (!el) return;
  paintCursor(el);
  reveal(el, jump);
  if (jump) land(ring ?? el);
}

let landing: HTMLDivElement | null = null;
/** A long jump lands with a halo that fades out, on a layer of its own over the block, so the artifact's own look and animations are left alone. */
function land(el: Element) {
  const r = el.getBoundingClientRect();
  landing?.remove();
  landing = document.createElement("div");
  landing.className = "art-landing";
  landing.setAttribute("aria-hidden", "true");
  landing.setAttribute("data-print", "hide");
  // The halo takes the ringed box's corners (a card's 12px, a paragraph's 6px).
  const corners = getComputedStyle(el).borderRadius;
  Object.assign(landing.style, {
    top: `${r.top + scrollY}px`,
    left: `${r.left + scrollX}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
    borderRadius: parseFloat(corners) ? corners : "6px",
  });
  const mine = landing;
  mine.addEventListener("animationend", () => mine.remove(), { once: true });
  document.body.append(mine);
}

/** Bring a block into view with some room around it; a jump puts it a third of the way down. */
function reveal(el: Element, jump: boolean) {
  const scroller = scrollerOf(el);
  // An app's own scrolling pane: let the browser work out the panes.
  if (scroller !== window) return el.scrollIntoView({ block: jump ? "center" : "nearest", inline: "nearest", behavior: "instant" });
  const r = el.getBoundingClientRect();
  const room = Math.min(96, innerHeight / 6);
  if (r.top >= room && r.bottom <= innerHeight - room) return;
  const tall = r.height > innerHeight - 2 * room;
  if (jump || tall) scrollBy({ top: r.top - (tall ? room : innerHeight / 3), behavior: "instant" });
  else el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
}

/** The element that scrolls this block: an app's own scrolling pane (or body), or the page. */
function scrollerOf(el: Element | null): Element | Window {
  for (let up = el?.parentElement; up && up !== document.documentElement; up = up.parentElement) {
    const s = getComputedStyle(up);
    if (/(auto|scroll)/.test(s.overflowY) && up.scrollHeight > up.clientHeight + 1) return up;
  }
  return window;
}

function step(dir: 1 | -1, n: number) {
  const list = blocks();
  if (!list.length) return scrollerOf(keysRoot().firstElementChild).scrollBy({ top: dir * n * 0.15 * innerHeight, behavior: "instant" });
  let { i, fresh } = at(list);
  // The first press shows where you are; a count goes on from there.
  if (fresh) n -= 1;
  for (let k = 0; k < n; k++) {
    // A block taller than the screen scrolls through before the cursor moves on.
    const r = list[i]!.getBoundingClientRect();
    if (r.height > innerHeight * 0.6 && (dir > 0 ? r.bottom > innerHeight - 8 : r.top < 8)) {
      scrollerOf(list[i]!).scrollBy({ top: (dir * innerHeight) / 3, behavior: "instant" });
      continue;
    }
    i = Math.max(0, Math.min(list.length - 1, i + dir));
  }
  if (list[i] !== cursor) setCursor(list[i]!);
}

function half(dir: 1 | -1, n: number) {
  const list = blocks();
  const y = cursor?.isConnected ? cursor.getBoundingClientRect().top : innerHeight / 3;
  scrollerOf(cursor ?? list[0] ?? keysRoot().firstElementChild).scrollBy({ top: (dir * n * innerHeight) / 2, behavior: "instant" });
  if (!list.length) return;
  // The cursor keeps its place on screen, as in vim.
  let best = list[0]!;
  let gap = Infinity;
  for (const el of list) {
    const d = Math.abs(el.getBoundingClientRect().top - y);
    if (d < gap) [best, gap] = [el, d];
  }
  if (best !== cursor) setCursor(best);
}

const scrollsSideways = (el: Element) => /(auto|scroll)/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1;

/** h and l: scroll what's wide at the cursor (a table's scroller, a code block, a wide diagram) sideways. */
function sideways(dir: 1 | -1, n: number) {
  const el = current();
  if (!el) return;
  let box: Element | null = null;
  for (let up: Element | null = el; up && up !== keysRoot() && !box; up = up.parentElement) if (scrollsSideways(up)) box = up;
  box ??= [...el.querySelectorAll("*")].find(scrollsSideways) ?? null;
  if (!box) return note("Nothing here scrolls sideways");
  const by = Math.max(80, box.clientWidth / 3) * n * dir;
  const was = box.scrollLeft;
  box.scrollBy({ left: by, behavior: "instant" });
  if (box.scrollLeft === was) note(dir > 0 ? "At the right edge" : "At the left edge");
}

function scrollEnd(dir: 1 | -1) {
  scrollerOf(keysRoot().firstElementChild).scrollTo({ top: dir < 0 ? 0 : 1e9, behavior: "instant" });
}

function section(dir: 1 | -1, n: number) {
  const list = blocks();
  if (!list.length) return;
  let { i } = at(list);
  for (let k = 0; k < n; k++) {
    let j = i + dir;
    while (j >= 0 && j < list.length && !/^H[1-6]$/.test(list[j]!.tagName)) j += dir;
    if (j < 0 || j >= list.length) break;
    i = j;
  }
  if (list[i] === cursor || !/^H[1-6]$/.test(list[i]!.tagName)) return note(dir > 0 ? "No more headings" : "No earlier headings");
  setCursor(list[i]!, true);
}

/** The next target after (or before) the cursor, in page order: never one that holds the cursor or sits inside it. */
function nextOf<T>(items: T[], node: (t: T) => Element, dir: 1 | -1, n: number): T | null {
  const list = blocks();
  let from: Element | null = cursor?.isConnected ? cursor : (list[at(list).i] ?? null);
  let found: T | null = null;
  for (let k = 0; k < n; k++) {
    const pick = (dir > 0 ? items : [...items].reverse()).find((t) => {
      const el = node(t);
      if (!from) return true;
      if (el === from || el.contains(from) || from.contains(el)) return false;
      const after = Boolean(from.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
      return dir > 0 ? after : !after;
    });
    if (!pick) break;
    found = pick;
    from = node(pick);
  }
  return found;
}

/** The cursor's stop for an element: the block it is, sits in, or the first block inside it. */
function blockFor(el: Element): Element {
  const list = blocks();
  return list.find((b) => b === el || b.contains(el)) ?? list.find((b) => el.contains(b)) ?? el;
}

function change(dir: 1 | -1, n: number) {
  const changed = [...keysRoot().querySelectorAll(".art-changed")];
  if (!changed.length) return note("No changes since your last visit");
  const target = nextOf(changed, (el) => el, dir, n);
  if (!target) return note(dir > 0 ? "No more changes" : "No earlier changes");
  setCursor(blockFor(target), true);
}

function thread(dir: 1 | -1, n: number) {
  const all = threadNodes();
  if (!all.length) return note("No comments on this page");
  const target = nextOf(all, (t) => t.node, dir, n);
  if (!target) return note(dir > 0 ? "No more comments" : "No earlier comments");
  setCursor(blockFor(target.node));
  // The comment's own flash (and the drawer's highlight) shows where it landed.
  focusThread(target.id);
}

/** The cursor block, putting the cursor on the first block on screen when there is none. */
function current(): Element | null {
  if (cursor?.isConnected) return cursor;
  const list = blocks();
  if (!list.length) return null;
  setCursor(list[at(list).i]!);
  return cursor;
}

function open() {
  if (!cursor?.isConnected) return;
  const here = threadNodes().find((t) => cursor!.contains(t.node) || t.node.contains(cursor!));
  if (here) return send({ t: "comment:open", thread: here.id });
  const control = cursor.matches(CONTROLS) ? cursor : (cursor.querySelector(CONTROLS) ?? cursor.closest("a[href]"));
  if (!(control instanceof HTMLElement)) return note("Nothing to open here");
  control.focus();
  opened = control;
}

function comment() {
  if (!commentAllowed()) return note("Sign in to comment");
  const el = current();
  if (!el) return;
  const block = el.closest("[data-b]");
  const text = (el.textContent ?? "").trim();
  // Text gets a quote, so the comment points at exactly this paragraph; charts, images and long blocks get the block.
  if (text && text.length <= MAX_QUOTE && !el.querySelector(".recharts-wrapper, canvas")) {
    const range = document.createRange();
    range.selectNodeContents(el);
    send({ t: "comment:new", anchor: anchorFromRange(range) });
  } else if (block) send({ t: "comment:new", anchor: blockAnchor(block) });
  else note("Select some words with v to comment on them");
}

function listen() {
  const el = current();
  if (!document.documentElement.hasAttribute("data-listening")) {
    speakFrom(el);
    return send({ t: "key", cmd: "listen" });
  }
  // Reading already: s on another block reads from there; on the one being read, pauses or plays.
  const jumped = el ? speakJumpTo(el) : "current";
  if (jumped === "current") send({ t: "key", cmd: "listen" });
  else if (jumped === "none") note("Listen doesn't read this block");
}

function yank() {
  const el = current();
  const target = el?.closest("[data-b]") ?? el?.closest("[id]");
  send({ t: "key", cmd: "yank", arg: target?.getAttribute("data-b") ?? target?.id ?? "" });
}

// ---- selecting words (visual mode) ------------------------------------------------------

/** The block, the selection's start and end in its text, and the text it last painted (to notice the mouse taking over). */
let sel: { block: Element; start: number; end: number; painted: string } | null = null;

function enterVisual() {
  if (!commentAllowed()) return note("Sign in to comment");
  const block = current();
  if (!block) return;
  const first = /\S+/.exec(textIndex(block).text);
  if (!first) return note("No words to select here");
  sel = { block, start: first.index, end: first.index + first[0].length, painted: "" };
  setKeysMode("visual");
  paintSelection();
}

function leaveVisual(clear = false) {
  setKeysMode("normal");
  sel = null;
  showcmd("");
  if (clear) document.getSelection()?.removeAllRanges();
}

function paintSelection() {
  if (!sel) return;
  const index = textIndex(sel.block);
  const range = rangeAt(index, sel.start, sel.end);
  if (!range) return leaveVisual(true);
  sel.painted = range.toString();
  document.getSelection()?.setBaseAndExtent(range.startContainer, range.startOffset, range.endContainer, range.endOffset);
  showcmd("Selecting · c comment · y copy · Esc", true);
}

function visual(cmd: Cmd, n: number) {
  if (!sel?.block.isConnected) return leaveVisual(true);
  // Read the block afresh each key: React may have replaced its text since.
  const index = textIndex(sel.block);
  if (sel.end > index.text.length) return leaveVisual(true);
  const ends = [...index.text.matchAll(/\S+/g)].map((m) => m.index! + m[0].length);
  const sentences = [...index.text.matchAll(/[^.!?]+[.!?]*/g)].map((m) => m.index! + m[0].trimEnd().length);
  const later = (list: number[]) => list.find((x) => x > sel!.end);
  const earlier = (list: number[]) => [...list].reverse().find((x) => x < sel!.end && x > sel!.start);
  for (let k = 0; k < n; k++) {
    const next =
      cmd === "wordNext" || cmd === "wordEnd" ? later(ends)
      : cmd === "wordBack" ? earlier(ends)
      : cmd === "sentenceNext" ? later(sentences)
      : cmd === "sentenceBack" ? earlier(sentences)
      : undefined;
    if (next === undefined) break;
    sel.end = next;
  }
  switch (cmd) {
    case "comment": {
      const range = rangeAt(index, sel.start, sel.end);
      if (range) send({ t: "comment:new", anchor: anchorFromRange(range) });
      return leaveVisual(true);
    }
    case "yank":
      send({ t: "key", cmd: "yank", text: index.text.slice(sel.start, sel.end) });
      return leaveVisual(true);
    case "escape":
      return leaveVisual(true);
    default:
      return paintSelection();
  }
}

// ---- find ------------------------------------------------------------------------------

let findBar: HTMLDivElement | null = null;
let findInput: HTMLInputElement | null = null;
let findCount: HTMLSpanElement | null = null;
/** Where the focus was before /, so closing the bar puts it back. */
let beforeFind: HTMLElement | null = null;
let hits: Range[] = [];
let hit = -1;
let query = "";

function openFind() {
  if (!findBar) {
    findBar = document.createElement("div");
    findBar.className = "art-keys-find";
    findBar.setAttribute("role", "search");
    findBar.setAttribute("data-print", "hide");
    findInput = document.createElement("input");
    findInput.type = "search";
    findInput.placeholder = "Find on the page";
    findInput.setAttribute("aria-label", "Find on the page");
    findInput.enterKeyHint = "search";
    findCount = document.createElement("span");
    findCount.className = "art-keys-find-count";
    findCount.setAttribute("role", "status");
    findBar.append(findInput, findCount);
    document.body.append(findBar);
    findInput.addEventListener("input", () => search(findInput!.value));
    findInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) findStep(-1);
        // Enter keeps the matches lit and hands the keys back to the page: n and N go on from here.
        else closeFind(false);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeFind(true);
      }
    });
  }
  if (findBar.hidden || document.activeElement !== findInput) beforeFind = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  findBar.hidden = false;
  findInput!.value = query;
  findInput!.focus();
  findInput!.select();
}

function closeFind(clear: boolean) {
  if (findBar && !findBar.hidden) {
    findBar.hidden = true;
    if (document.activeElement === findInput) {
      if (beforeFind?.isConnected && beforeFind !== document.body) beforeFind.focus({ preventScroll: true });
      else findInput!.blur();
    }
    beforeFind = null;
  }
  if (clear) {
    hits = [];
    hit = -1;
    paintHits();
  }
}

function search(q: string) {
  query = q;
  hits = [];
  hit = -1;
  const needle = q.trim().toLowerCase();
  if (needle) {
    const index = textIndex(keysRoot());
    // Lowercasing that changes the text's length (a dotted İ) would shift every match after it: match as written then.
    const lower = index.text.toLowerCase();
    const hay = lower.length === index.text.length ? lower : index.text;
    for (let i = hay.indexOf(needle); i !== -1 && hits.length < MAX_HITS; i = hay.indexOf(needle, i + needle.length)) {
      const range = rangeAt(index, i, i + needle.length);
      if (range && !range.startContainer.parentElement?.closest(SKIP)) hits.push(range);
    }
    // The first match at or after the cursor (or the screen's top).
    const from = cursor?.isConnected ? cursor.getBoundingClientRect().top : 0;
    hit = Math.max(0, hits.findIndex((r) => r.getBoundingClientRect().top >= from - 2));
  }
  paintHits();
}

function findStep(by: number) {
  if (!query.trim()) return note("Press / to find");
  // The page re-rendered since: find again.
  if (!hits.length || hits.some((r) => r.collapsed || !r.startContainer.isConnected)) search(query);
  if (!hits.length) return note(`No matches for “${query.trim()}”`);
  hit = (((hit + by) % hits.length) + hits.length) % hits.length;
  paintHits();
}

function paintHits() {
  if (highlights && HighlightCtor) {
    highlights.set("art-find", new HighlightCtor(...hits.filter((_, i) => i !== hit)));
    highlights.set("art-find-current", new HighlightCtor(...(hits[hit] ? [hits[hit]!] : [])));
  }
  const label = !query.trim() ? "" : hits.length ? `${hit + 1} of ${hits.length}${hits.length === MAX_HITS ? "+" : ""}` : "No matches";
  if (findCount) findCount.textContent = label;
  const range = hits[hit];
  if (!range) return;
  const el = range.startContainer.parentElement;
  if (el) {
    const block = blockFor(el);
    if (block !== cursor) setCursor(block);
  }
  const r = range.getBoundingClientRect();
  if (r.top < 64 || r.bottom > innerHeight - 64) {
    const scroller = scrollerOf(el);
    if (scroller === window) scrollBy({ top: r.top - innerHeight / 3, behavior: "instant" });
    else el?.scrollIntoView({ block: "center", behavior: "instant" });
  }
  if (findBar?.hidden !== false) note(label);
}
