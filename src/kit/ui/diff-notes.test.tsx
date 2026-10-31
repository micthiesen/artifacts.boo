// Notes on a diff's lines: where each lands (a line, a range, a name wherever it appears), what's refused, and
// that they show as gutter numbers and a list under the lines, with nothing to hover.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import type { FrameMessage } from "../../shared/protocol.ts";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { placeNotes } = await import("../../shared/diff-notes.ts");
const { Diff } = await import("./diff.tsx");

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await GlobalRegistrator.unregister();
});

const lines = [
  " function handle(record) {",
  "-  return save(record);",
  "+  const error = validateInput(record);",
  "+  if (error) return error;",
  "+  return save(record);",
  " }",
];

test("a note lands on a line, a range, or every line using a name", () => {
  const { placed, problems } = placeNotes(lines, [
    { at: "L3", text: "One check." },
    { at: "L3-L5", text: "The new path." },
    { at: "save", text: "Unchanged." },
  ]);
  expect(problems).toEqual([]);
  expect(placed.map((p) => p.rows)).toEqual([[2], [2, 3, 4], [1, 4]]);
  expect(placed[2]!.symbol).toBe("save");
  // "L3-5" reads as the same range.
  expect(placeNotes(lines, [{ at: "L3-5", text: "x" }]).placed[0]!.rows).toEqual([2, 3, 4]);
});

test("a name matches whole words only, after the sign column", () => {
  expect(placeNotes(["+  saveAll(x)"], [{ at: "save", text: "x" }]).problems.join()).toContain(`"save", which isn't in the diff's lines`);
  expect(placeNotes(["+$el.x"], [{ at: "$el", text: "x" }]).placed[0]!.rows).toEqual([0]);
  expect(placeNotes(["+a.b(c)"], [{ at: "a.b", text: "x" }]).placed).toHaveLength(1);
});

test("a note pointing at nothing is refused with how to fix it", () => {
  const bad = (notes: unknown) => placeNotes(lines, notes).problems.join("\n");
  expect(bad([{ at: "L7", text: "x" }])).toContain("note 1 points at L7, but the diff has lines L1 to L6");
  expect(bad([{ at: "L5-L3", text: "x" }])).toContain("a range runs low to high");
  expect(bad([{ at: "L0", text: "x" }])).toContain("points at L0");
  expect(bad([{ at: "two words", text: "x" }])).toContain(`"L3", "L3-L5" or one name`);
  expect(bad([{ at: "L1" }])).toContain("note 1 is {at, text}");
  expect(bad({ at: "L1", text: "x" })).toContain(`"notes" is a list`);
  expect(bad(Array.from({ length: 7 }, () => ({ at: "L1", text: "x" })))).toContain("keep it to 6");
  expect(bad([{ at: "L1", text: "x".repeat(241) }])).toContain("keep notes to 240");
  expect(placeNotes(lines, undefined)).toEqual({ placed: [], problems: [] });
});

let container: HTMLElement;
let root: { render(el: React.ReactElement): void; unmount(): void };
let sent: FrameMessage[] = [];
beforeEach(async () => {
  sent = [];
  (await import("../store.ts")).setTransport((m) => sent.push(m));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

test("notes show as gutter numbers and a list under the lines, a name underlined where it appears", async () => {
  const notes = [
    { at: "L3-L4", text: "Checks before `save` sees it." },
    { at: "validateInput", text: "Blank names fail." },
  ];
  await act(async () => root.render(<Diff file="src/a.ts" code={lines.join("\n")} notes={notes} />));
  const rows = [...container.querySelectorAll("pre > div")];
  const gutter = (r: number) => rows[r]!.firstElementChild!.querySelector("[aria-hidden]")?.textContent ?? "";
  expect(gutter(2)).toBe("1,2");
  // A screen reader hears which notes a line has, in line with the code.
  expect(rows[2]!.querySelector(".sr-only")?.textContent).toBe("(note 1, 2) ");
  expect(gutter(3)).toBe("");
  // A range's rows carry a bar, so where it ends shows without the list.
  expect(rows[3]!.className).toContain("shadow-");
  expect(rows[2]!.querySelector("span.underline")?.textContent).toBe("validateInput");
  const items = [...container.querySelectorAll("ol[aria-label=Notes] li")].map((li) => li.textContent);
  expect(items).toEqual(["1lines 3–4Checks before save sees it.", "2validateInputBlank names fail."]);
  expect(container.querySelector("ol code")?.textContent).toBe("save");
  expect(sent.filter((m) => m.t === "error")).toEqual([]);
});

test("a diff without notes draws as before, and a bad note fails the render check", async () => {
  await act(async () => root.render(<Diff code={lines.join("\n")} />));
  expect(container.querySelector("ol")).toBeNull();
  expect(container.querySelector("pre > div")!.children).toHaveLength(2);
  await act(async () => root.render(<Diff code={lines.join("\n")} notes={[{ at: "L9", text: "x" }]} />));
  expect(sent).toContainEqual({ t: "error", message: "Diff: note 1 points at L9, but the diff has lines L1 to L6" });
});

test("a hunk header is a line too: it carries its number, and a name in it is underlined", async () => {
  const code = "@@ -1,3 +1,4 @@ function validateInput\n-a\n+b";
  expect(placeNotes(code.split("\n"), [{ at: "validateInput", text: "x" }]).placed[0]!.rows).toEqual([0]);
  // Without a sign column the first character is text, not a sign.
  expect(placeNotes(["save()"], [{ at: "save", text: "x" }]).placed[0]!.rows).toEqual([0]);
  await act(async () => root.render(<Diff code={code} notes={[{ at: "validateInput", text: "x" }, { at: "L1-L2", text: "y" }]} />));
  const header = container.querySelector("pre > div")!;
  expect(header.firstElementChild!.querySelector("[aria-hidden]")?.textContent).toBe("1,2");
  expect(header.querySelector("span.underline")?.textContent).toBe("validateInput");
  expect(header.className).toContain("shadow-");
});

test("a longer noted name isn't cut short by a shorter one it starts with", async () => {
  await act(async () => root.render(<Diff code={"+foo.bar(foo)"} notes={[{ at: "foo", text: "x" }, { at: "foo.bar", text: "y" }]} />));
  expect([...container.querySelectorAll("span.underline")].map((u) => u.textContent)).toEqual(["foo.bar", "foo"]);
});
