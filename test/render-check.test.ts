// The render check's reading of what the frame published (src/worker/check.ts): warnings come through with the
// result, and artifact_check's scene and step reach the frame's URL.
import { describe, expect, test } from "bun:test";
import { describeView, describeWarnings, isDefaultView, renderCheck } from "../src/worker/check.ts";

/** A Browser Run binding that answers with this frame result, and remembers what it was asked. */
function browser(result: unknown) {
  const asked: Record<string, unknown>[] = [];
  const html = `<pre id="art-check">${JSON.stringify(result).replace(/"/g, "&quot;")}</pre>`;
  return {
    asked,
    BROWSER: { quickAction: async (_: string, options: Record<string, unknown>) => (asked.push(options), Response.json({ success: true, result: { content: html, screenshot: "img" } })) },
    SESSION_SECRET: "s".repeat(32),
  };
}

describe("render check", () => {
  test("a page that renders with warnings passes, and keeps them", async () => {
    const env = browser({ status: "rendered", errors: [], warnings: ['Scene "Plumbing", step 2, on a phone (390 px): labels crowd'], textLength: 40 });
    const out = await renderCheck(env, "https://w.example", "a1", 3, "w");
    expect("check" in out && out.check).toEqual({ status: "ok", ms: expect.any(Number), textLength: 40, warnings: ['Scene "Plumbing", step 2, on a phone (390 px): labels crowd'], logic: 2 });
  });

  test("no warnings, no warnings field", async () => {
    const out = await renderCheck(browser({ status: "rendered", errors: [], warnings: [], textLength: 4 }), "https://w.example", "a1", 3, "w");
    expect("check" in out && out.check).toEqual({ status: "ok", ms: expect.any(Number), textLength: 4, logic: 2 });
  });

  test("a scene and step go to the frame as query parameters", async () => {
    const env = browser({ status: "rendered", errors: [], textLength: 4 });
    await renderCheck(env, "https://w.example", "a1", 3, "w", { scene: "Build the new one", step: 2 });
    expect(String(env.asked[0]!.url)).toContain("&scene=Build%20the%20new%20one&step=2");
    await renderCheck(env, "https://w.example", "a1", 3, "w", { step: 4 });
    expect(String(env.asked[1]!.url)).toContain("&scene=1&step=4");
  });

  test("describing views and warnings", () => {
    expect(isDefaultView({ step: 2 })).toBe(false);
    expect(describeView({ step: 2 })).toBe("scene 1, step 2, as a reader first sees it, 1024×768");
    expect(describeView({ scene: "Teardown", phone: true })).toBe('scene "Teardown", as a reader first sees it, 390×844 (phone)');
    expect(describeWarnings(["a"], undefined, ["b"])).toBe("\nWarnings (saved anyway; fix with another edit):\n- a\n- b");
    expect(describeWarnings(undefined, [])).toBe("");
  });
});
