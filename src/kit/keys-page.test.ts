// Walks pages with the vim-style keys (src/kit/keys-page.ts) the way a reader would, on a laid-out page: each
// element's box comes from its data-box="left top width height" (no data-box: nothing to see). Checks the rules
// that keep the keys trustworthy: every stop shows, j and k agree, everything is reachable, folded content is
// skipped, components' own stops and actions win over guessing.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, beforeEach, expect, test } from "bun:test";

GlobalRegistrator.register();
afterAll(() => GlobalRegistrator.unregister());

Element.prototype.getBoundingClientRect = function (this: Element) {
  const v = this.getAttribute("data-box")?.split(" ").map(Number);
  const [left, top, width, height] = v && v.length === 4 ? v : [0, 0, 0, 0];
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} } as DOMRect;
};
Element.prototype.scrollIntoView = () => {};
window.scrollBy = () => {};
window.scrollTo = () => {};

const { installKeys } = await import("./keys.ts");
const { run } = await import("./keys-page.ts");
const { registerKeyWidget } = await import("./key-widget.ts");

let root: HTMLElement;
const sent: unknown[] = [];

function page(html: string) {
  document.body.innerHTML = `<div id="root" data-box="0 0 400 2000">${html}</div>`;
  root = document.getElementById("root")!;
  installKeys(root, (m) => sent.push(m));
  // A fresh page: no cursor left from the last test.
  run("escape", 1);
}
const cursor = () => {
  const lit = document.querySelectorAll(".art-cursor");
  expect(lit.length).toBeLessThanOrEqual(1);
  return lit[0] ?? null;
};
const id = () => cursor()?.id ?? null;
const press = (cmd: Parameters<typeof run>[0], n = 1) => run(cmd, n);

/** j from the top until the cursor stops moving: the ids it stopped on. */
function walk(cmd: "down" | "up"): string[] {
  const out: string[] = [];
  for (let k = 0; k < 50; k++) {
    press(cmd);
    const here = id();
    if (!here || out.at(-1) === here) break;
    out.push(here);
  }
  return out;
}

// A heading, a paragraph, three Stat cells, two cards side by side, a folded section, a paragraph.
const mixed = `
  <h1 id="h1" data-box="0 0 400 40">Title</h1>
  <p id="p1" data-box="0 50 400 40">Intro.</p>
  <div data-box="0 100 400 60">
    <div id="s1" data-speak="stat" data-box="0 100 120 60">A</div>
    <div id="s2" data-speak="stat" data-box="140 100 120 60">B</div>
    <div id="s3" data-speak="stat" data-box="280 100 120 60">C</div>
  </div>
  <div data-box="0 170 400 100">
    <div data-box="0 170 190 100"><p id="a1" data-box="0 170 190 40">A one.</p><p id="a2" data-box="0 220 190 40">A two.</p></div>
    <div data-box="210 170 190 100"><p id="b1" data-box="210 170 190 40">B one.</p><p id="b2" data-box="210 220 190 40">B two.</p></div>
  </div>
  <details id="d" data-box="0 280 400 40"><summary id="sum" data-box="0 280 400 40">More</summary><p id="hidden" data-box="0 330 400 40">Folded.</p></details>
  <p id="end" data-box="0 380 400 40">The end.</p>`;

beforeEach(() => {
  sent.length = 0;
});

test("j walks rows top to bottom, every stop is a visible element, and folded content is skipped", () => {
  page(mixed);
  const down = walk("down");
  expect(down).toEqual(["h1", "p1", "s1", "a1", "a2", "sum", "end"]);
  for (const i of down) expect(document.getElementById(i)!.getAttribute("data-box")).toBeTruthy();
  expect(down).not.toContain("hidden");
});

test("k walks the same rows back up", () => {
  page(mixed);
  const top = (i: string) => document.getElementById(i)!.getBoundingClientRect().top;
  const down = walk("down");
  // The walk up starts on the last stop, so it lists the others.
  const up = [down.at(-1)!, ...walk("up")];
  expect(new Set(up.map(top))).toEqual(new Set(down.map(top)));
});

test("h and l reach what j skips: the rest of each row", () => {
  page(mixed);
  const seen = new Set<string>();
  for (const stop of walk("down")) {
    seen.add(stop);
    // Back to this row's first block, then along it.
    run("escape", 1);
    let guard = 0;
    while (id() !== stop && guard++ < 50) press("down");
    for (let k = 0; k < 5; k++) {
      press("right");
      if (id()) seen.add(id()!);
    }
  }
  for (const want of ["s2", "s3", "b1", "b2"]) expect(seen.has(want)).toBe(true);
});

test("Enter on a summary opens its section, and then j goes into it", () => {
  page(mixed);
  while (id() !== "sum") press("down");
  press("open");
  expect((document.getElementById("d") as HTMLDetailsElement).open).toBe(true);
  press("down");
  expect(id()).toBe("hidden");
});

test("inside a component's scope, only its declared stops count", () => {
  page(`
    <p id="before" data-box="0 0 400 40">Before.</p>
    <div data-key-scope data-box="0 50 400 200">
      <h2 id="title" data-key-stop data-box="0 50 400 40">Findings</h2>
      <p id="inner" data-box="0 100 400 40">Not a stop: the component didn't declare it.</p>
      <div id="row" data-key-stop data-box="0 150 400 40"><p data-box="0 150 400 40">A row's text.</p></div>
    </div>
    <div id="decision" data-key-stop data-box="0 260 400 80"><p data-box="0 270 400 20">Ship?</p></div>`);
  expect(walk("down")).toEqual(["before", "title", "row", "decision"]);
});

test("a component's own action runs for h and l, and the key moves on at its ends", () => {
  page(`
    <div id="tabs" data-box="0 0 400 100">
      <p id="panel" data-box="0 0 190 40">Tab one.</p>
    </div>
    <p id="beside" data-box="210 0 190 40">Beside.</p>`);
  let at = 0;
  registerKeyWidget(document.getElementById("tabs")!, { across: (dir) => (at + dir >= 0 && at + dir <= 2 ? ((at += dir), true) : false) });
  press("down");
  expect(id()).toBe("panel");
  press("right");
  press("right");
  expect(at).toBe(2);
  expect(id()).toBe("panel");
  // At the last tab, l goes on to the block beside.
  press("right");
  expect(id()).toBe("beside");
});

test("Enter runs a component's own action first", () => {
  page(`<div id="row" data-key-stop data-box="0 0 400 40">A row</div>`);
  let opened = 0;
  registerKeyWidget(document.getElementById("row")!, { enter: () => (opened++, true) });
  press("down");
  press("open");
  expect(opened).toBe(1);
});

test("a widget with nothing to do for a key leaves it to the one around it", () => {
  page(`
    <div id="tabs" data-box="0 0 400 200">
      <figure id="diagram" data-speak="diagram" data-box="0 0 400 100">A plain diagram</figure>
    </div>`);
  let tab = 0;
  registerKeyWidget(document.getElementById("tabs")!, { across: () => ((tab += 1), true) });
  // A plain diagram registers an across that has nothing to step through.
  registerKeyWidget(document.getElementById("diagram")!, { across: () => false });
  press("down");
  expect(id()).toBe("diagram");
  press("right");
  expect(tab).toBe(1);
});

test("a stop Listen skips can still be a declared stop", () => {
  page(`<div data-key-scope data-box="0 0 400 200"><ul id="files" data-key-stop data-speak="skip" data-box="0 0 400 40"><li data-box="0 0 400 20">a.ts</li></ul></div>`);
  expect(walk("down")).toEqual(["files"]);
});
