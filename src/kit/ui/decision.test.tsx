// Decision: answered on the page, changed only after asking, decided only by its deciders, and an
// answer on an older version still stands.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import type { FrameMessage } from "../../shared/protocol.ts";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const store = await import("../store.ts");
const { Decision } = await import("./decision.tsx");

let sent: FrameMessage[] = [];
let container: HTMLElement;
let root: { render(el: React.ReactElement): void; unmount(): void };
const ME = "me@x.dev";
const DANA = "dana@x.dev";
const options = [{ value: "hall", label: "Town hall", detail: "Seats 80" }, "park"];

beforeEach(() => {
  store.reset();
  sent = [];
  store.setTransport((m) => sent.push(m));
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await GlobalRegistrator.unregister();
});

async function show(shared: Record<string, unknown>, props: { deciders?: string[] } = {}, version = 1, role: "edit" | "view" = "edit") {
  store.setBoot({ artifactId: "a1", version, entry: "@art/index.mdx", data: {}, title: "t" } as never);
  store.init({ viewer: { email: ME, role }, shared: shared as never, local: {}, presence: [], theme: "dark" });
  await act(async () => root.render(<Decision id="venue" question="Where do we meet?" options={options} recommended="hall" {...props} />));
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  return container.textContent ?? "";
}

const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
const sets = () => sent.filter((m): m is Extract<FrameMessage, { t: "shared:set" }> => m.t === "shared:set");

test("open: the recommended option is marked in words; Decide writes the choice, note and version", async () => {
  const text = await show({}, {}, 3);
  expect(text).toContain("Recommended");
  expect(text).toContain("Seats 80");
  expect(button("Decide")?.disabled).toBe(true);
  await act(async () => container.querySelector<HTMLInputElement>("input[value=park]")!.click());
  const note = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(note, " sunny ");
    note.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => button("Decide")!.click());
  expect(sets().at(-1)).toMatchObject({ key: "decide/venue", value: { choice: "park", note: "sunny", version: 3 } });
  expect(container.textContent).toContain("Decided: park");
  expect(container.textContent).toContain("by you");
});

test("decided: shows who and the label; Change asks first, then reopens with the current choice", async () => {
  const text = await show({ "decide/venue": { choice: "hall", by: DANA, at: Date.now() - 60_000, version: 1 } });
  expect(text).toContain("Decided: Town hall");
  expect(text).not.toContain("decided on v");
  await act(async () => button("Change")!.click());
  expect(container.textContent).toContain("Change this decision?");
  expect(sets()).toHaveLength(0);
  await act(async () => button("Keep")!.click());
  expect(container.textContent).not.toContain("Change this decision?");
  await act(async () => button("Change")!.click());
  await act(async () => button("Change it")!.click());
  expect(container.querySelector<HTMLInputElement>("input[value=hall]")!.checked).toBe(true);
  expect(button("Change decision")).toBeDefined();
});

test("a decision made on an older version still stands and says which version, quietly", async () => {
  const text = await show({ "decide/venue": { choice: "park", by: DANA, at: Date.now(), version: 2 } }, {}, 5);
  expect(text).toContain("Decided: park");
  expect(text).toContain("decided on v2");
});

test("with deciders, everyone else sees who it's waiting for and can't choose", async () => {
  const text = await show({}, { deciders: ["Dana@x.dev"] });
  expect(text).toContain("Waiting for");
  expect(button("Decide")).toBeUndefined();
  expect(container.querySelector<HTMLInputElement>("input[type=radio]")!.disabled).toBe(true);

  await act(async () => root.render(<></>));
  const decided = await show({ "decide/venue": { choice: "hall", by: DANA, at: Date.now(), version: 1 } }, { deciders: [DANA] });
  expect(decided).toContain("Decided: Town hall");
  expect(button("Change")).toBeUndefined();
});

test("view access reads the decision without controls", async () => {
  const text = await show({}, {}, 1, "view");
  expect(text).toContain("read-only");
  expect(button("Decide")).toBeUndefined();
});
