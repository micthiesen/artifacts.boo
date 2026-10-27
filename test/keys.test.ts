// The key engine behind the vim-style keys (src/shared/keys.ts): counts, sequences, and staying out of the way of
// anyone typing or working a widget.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, expect, test } from "bun:test";

GlobalRegistrator.register();
afterAll(() => GlobalRegistrator.unregister());
const { ctrlKeys, KEYMAP, keyEngine, keysCookieName, keyToken, readKeysCookie } = await import("../src/shared/keys.ts");
type Cmd = import("../src/shared/keys.ts").Cmd;

let ran: [Cmd, number][];
let shown: string[];
let mode: "normal" | "visual";
let on: boolean;
const engine = keyEngine({
  enabled: () => on,
  mode: () => mode,
  where: () => "artifact",
  run: (cmd, n) => (ran.push([cmd, n]), cmd !== "pin"),
  show: (t) => shown.push(t),
});

beforeEach(() => {
  ran = [];
  shown = [];
  mode = "normal";
  on = true;
  engine.reset();
  document.body.innerHTML = `<p id="text">Words</p><input id="field"><input id="box" type="checkbox"><textarea id="area"></textarea>
    <div role="tablist"><button id="tab" role="tab">A</button></div><a id="link" href="/x">x</a><dialog id="modal" open><button id="inside">x</button></dialog>`;
});

function press(key: string, opts: { on?: string; ctrl?: boolean; meta?: boolean; repeat?: boolean } = {}) {
  const target = document.getElementById(opts.on ?? "text")!;
  const e = new KeyboardEvent("keydown", { key, ctrlKey: opts.ctrl, metaKey: opts.meta, repeat: opts.repeat, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  engine.handle(e);
  return e.defaultPrevented;
}

test("single keys run their command and take the key", () => {
  expect(press("j")).toBe(true);
  expect(press("G")).toBe(true);
  expect(ran).toEqual([["down", 1], ["bottom", 1]]);
});

test("a count repeats: 3j, 12k; 0 alone is no count", () => {
  press("3");
  press("j");
  press("1");
  press("2");
  press("k");
  expect(press("0")).toBe(false);
  expect(ran).toEqual([["down", 3], ["up", 12]]);
});

test("sequences wait for their next key, and show what was typed", () => {
  expect(press("g")).toBe(true);
  expect(ran).toEqual([]);
  expect(shown.at(-1)).toBe("g");
  press("g");
  press("]");
  press("c");
  expect(ran).toEqual([["top", 1], ["nextChange", 1]]);
  expect(shown.at(-1)).toBe("");
});

test("a sequence nothing knows is swallowed, not run as its last key", () => {
  press("g");
  expect(press("j")).toBe(true);
  expect(ran).toEqual([]);
  press("j");
  expect(ran).toEqual([["down", 1]]);
});

test("a half-typed sequence times out", async () => {
  const quick = keyEngine({ enabled: () => true, mode: () => "normal", where: () => "artifact", run: (c, n) => (ran.push([c, n]), true), timeoutMs: 20 });
  const e = (key: string) => new KeyboardEvent("keydown", { key, cancelable: true });
  quick.handle(e("g"));
  await new Promise((r) => setTimeout(r, 40));
  quick.handle(e("g"));
  expect(ran).toEqual([]);
});

test("Ctrl d and Ctrl u are half pages on a Mac only; Ctrl Shift and Cmd stay the browser's", () => {
  const k = (key: string, mods: { ctrlKey?: boolean; shiftKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) =>
    ({ key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...mods });
  expect(keyToken(k("d", { ctrlKey: true }), true)).toBe("C-d");
  expect(keyToken(k("d", { ctrlKey: true }), false)).toBe(null);
  expect(keyToken(k("D", { ctrlKey: true, shiftKey: true }), true)).toBe(null);
  expect(keyToken(k("j", { metaKey: true }), true)).toBe(null);
  expect(ctrlKeys("MacIntel")).toBe(true);
  expect(ctrlKeys("Win32")).toBe(false);
});

test("symbols typed with Option or AltGr count (German [ and {), letters with them don't", () => {
  const k = (key: string, mods: { ctrlKey?: boolean; altKey?: boolean }) => ({ key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...mods });
  expect(keyToken(k("[", { altKey: true }))).toBe("[");
  expect(keyToken(k("{", { altKey: true, ctrlKey: true }))).toBe("{");
  expect(keyToken(k("j", { altKey: true }))).toBe(null);
  expect(keyToken(k("∆", { altKey: true }))).toBe("∆");
});

test("holding a key repeats moves, not one-shot commands", () => {
  press("j", { repeat: true });
  press("c", { repeat: true });
  expect(ran).toEqual([["down", 1]]);
});

test("nothing happens while typing or working a widget", () => {
  for (const on of ["field", "area", "tab", "inside"]) expect(press("j", { on })).toBe(false);
  // A checkbox can't be typed in.
  expect(press("j", { on: "box" })).toBe(true);
  // Enter on a link follows it.
  expect(press("Enter", { on: "link" })).toBe(false);
  expect(ran).toEqual([["down", 1]]);
});

test("a key the page already handled is the page's", () => {
  const target = document.getElementById("text")!;
  target.addEventListener("keydown", (e) => e.preventDefault(), { once: true });
  press("j");
  expect(ran).toEqual([]);
});

test("turned off, keys do nothing", () => {
  on = false;
  expect(press("j")).toBe(false);
  expect(ran).toEqual([]);
});

test("a command that does nothing here leaves the key to the browser", () => {
  mode = "normal";
  const e = new KeyboardEvent("keydown", { key: "p", cancelable: true });
  const list = keyEngine({ enabled: () => true, mode: () => "normal", where: () => "list", run: (c) => c !== "pin" });
  list.handle(e);
  expect(e.defaultPrevented).toBe(false);
});

test("selecting has its own keys, and the shell's still work", () => {
  mode = "visual";
  press("w");
  press("2");
  press(")");
  press("?");
  press("j");
  expect(ran).toEqual([["wordNext", 1], ["sentenceNext", 2], ["help", 1]]);
});

test("every binding is reachable: no key is both a command and the start of a longer one", () => {
  for (const mode of ["normal", "visual"] as const) {
    for (const where of ["artifact", "list", "drawer", "any"] as const) {
      const live = KEYMAP.filter((k) => k.mode === mode && (k.where.includes(where) || k.where.includes("any")));
      for (const k of live) {
        const shadowed = live.some((o) => o !== k && o.keys.length > k.keys.length && k.keys.every((x, i) => x === o.keys[i]));
        expect(`${mode} ${where} ${k.keys.join(" ")} ${shadowed}`).toBe(`${mode} ${where} ${k.keys.join(" ")} false`);
      }
    }
  }
});

test("the keys cookie sits beside the Sounds one and is on unless turned off", () => {
  expect(keysCookieName("art_sounds")).toBe("art_keys");
  expect(keysCookieName("art_sounds_stage")).toBe("art_keys_stage");
  expect(readKeysCookie("", "art_keys")).toBe(true);
  expect(readKeysCookie("a=1; art_keys=0", "art_keys")).toBe(false);
  expect(readKeysCookie("art_keys=1", "art_keys")).toBe(true);
  expect(readKeysCookie("art_keys_stage=0", "art_keys")).toBe(true);
});
