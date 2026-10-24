// Diagram marks and diffs: what a change does is readable without colour.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, test } from "bun:test";

GlobalRegistrator.register();
const { render } = await import("pele");
const { decorate } = await import("./diagram-impl.tsx");
// <Diagram> mounts through pele/lazy, which has loaded the type before it draws; do the same here.
await (await import("pele/lazy")).load("flowchart");
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { Diff } = await import("./diff.tsx");
const { MARKED } = await import("./diagram.tsx");

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const code = `flowchart LR
  page_scrolls([Page scrolls]) --> old_path[Script moves it]:::removed
  old_path --> screen([Screen])
  page_scrolls --> new_path[Browser moves it]:::added
  new_path --> screen
  draw[Draw]:::changed --> screen`;

function mount() {
  const root = document.createElement("div");
  root.innerHTML = render(code).svg;
  return root;
}

test("marked nodes carry their sign, and edges into new or removed nodes follow them, ids with underscores too", () => {
  const root = mount();
  decorate(root, code, null);
  const sign = (id: string) => root.querySelector(`g.pele-node[data-id="${id}"] .art-sign`)?.textContent?.trim();
  expect(sign("old_path")).toBe("−");
  expect(sign("new_path")).toBe("+");
  expect(sign("draw")).toBe("~");
  expect(sign("screen")).toBeUndefined();
  const edge = (id: string) => root.querySelector(`g.pele-edge[data-id="${id}"]`)!.classList;
  expect(edge("L_page_scrolls_old_path_0").contains("removed")).toBe(true);
  expect(edge("L_page_scrolls_new_path_0").contains("added")).toBe(true);
  expect(edge("L_draw_screen_0").contains("added")).toBe(false);
  // Drawing again (Pele re-renders on resize) doesn't add a second sign.
  decorate(root, code, null);
  expect(root.querySelectorAll(`g.pele-node[data-id="old_path"] .art-sign`).length).toBe(1);
});

test("a focus dims everything it doesn't name", () => {
  const root = mount();
  decorate(root, code, new Set(["new_path", "screen"]));
  const dim = (sel: string) => root.querySelector(sel)!.classList.contains("art-dim");
  expect(dim('g.pele-node[data-id="new_path"]')).toBe(false);
  expect(dim('g.pele-node[data-id="old_path"]')).toBe(true);
  expect(dim('g.pele-edge[data-id="L_new_path_screen_0"]')).toBe(false);
  expect(dim('g.pele-edge[data-id="L_old_path_screen_0"]')).toBe(true);
});

test("only diagrams with the kit's marks offer the before/after switch", () => {
  expect(MARKED.test(code)).toBe(true);
  expect(MARKED.test("flowchart LR\n  A --> B\n  class B added")).toBe(true);
  expect(MARKED.test("flowchart LR\n  A[Added] --> B")).toBe(false);
});

test("diff lines show their sign in its own column and drop git's file headers", () => {
  const html = renderToStaticMarkup(
    React.createElement(Diff, { file: "a.css", code: "--- a/a.css\n+++ b/a.css\n@@ -1 +1 @@\n-  position: fixed;\n+  position: absolute;\n   top: 0;" }),
  );
  expect(html).toContain("a.css");
  expect(html).not.toContain("+++ b/a.css");
  expect(html).toContain("−<span class=\"sr-only\">removed</span>");
  expect(html).toContain("+<span class=\"sr-only\">added</span>");
  expect(html).toContain("  position: absolute;");
});

test("content lines that look like file headers are kept; headers before the first hunk go", () => {
  const html = renderToStaticMarkup(React.createElement(Diff, { code: "@@ -1,2 +1,2 @@\n--- old comment\n+++ new comment\n " }));
  expect(html).toContain("-- old comment");
  expect(html).toContain("++ new comment");
});
