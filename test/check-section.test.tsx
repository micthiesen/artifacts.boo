// The render check loads the frame top-level (no shell), so a section to look at
// comes in the URL and the frame must scroll there by itself before the screenshot.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, test } from "bun:test";
import { join } from "node:path";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { boot } = await import("../src/kit/runtime.tsx?check-section"); // its own instance: boot() runs once per module

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

test("a check with ?section= scrolls to that heading's block before reporting", async () => {
  (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL("https://w.example/frame/a1?v=1&check=1&section=ranked");
  document.body.innerHTML = `<div id="root"></div><script type="application/json" id="art-boot">${JSON.stringify({
    artifactId: "a1",
    version: 1,
    entry: join(import.meta.dir, "fixtures/check-entry.tsx"),
    data: {},
    title: "Test",
    check: true,
  })}</script>`;
  const scrolled: string[] = [];
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this.getAttribute("data-b") ?? this.id);
  };
  try {
    await boot({ parent: { postMessage() {} } as unknown as Window });
    // Before the result is published (600 ms), so the screenshot already shows the section.
    for (let i = 0; i < 25 && !scrolled.length; i++) await tick();
    expect(scrolled).toEqual(["ranked"]);
    expect(document.getElementById("art-check")).toBeNull();
    for (let i = 0; i < 40 && !document.getElementById("art-check"); i++) await tick();
    expect(JSON.parse(document.getElementById("art-check")!.textContent!).status).toBe("rendered");
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});
