// Log (newest first, older entries folded), Record (both item shapes, links) and Figure (enlarges in a dialog).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const store = await import("../store.ts");
const { Log, Record, Figure } = await import("./records.tsx");
const { sortLog, recordItems } = await import("./records-impl.tsx");

let container: HTMLElement;
let root: { render(el: React.ReactElement): void; unmount(): void };

const log = [
  { date: "2026-10-03", title: "Kickoff" },
  { date: "2026-10-24", title: "Checkpoint", body: "Two blockers left.", tone: "caution", tags: ["ops"] },
  { date: "not a date", title: "Undated" },
  { date: "2026-10-10", title: "Venue booked", tone: "positive" },
  { date: "2026-10-17T09:30:00Z", title: "Budget signed" },
];

beforeEach(() => {
  store.reset();
  store.setBoot({ artifactId: "a1", version: 1, entry: "@art/index.mdx", data: { "data/log.json": log, "data/facts.json": { Clinic: "North", Booked: "https://example.com/b" } }, title: "t" } as never);
  store.init({ viewer: { email: "me@x.dev", role: "edit" }, shared: {}, local: {}, presence: [], theme: "dark" });
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

/** Renders and lets the lazy body load. */
async function show(el: React.ReactElement) {
  await act(async () => root.render(el));
  for (let i = 0; i < 5 && container.querySelector(".animate-pulse, [class*=skeleton]"); i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
  await act(async () => new Promise((r) => setTimeout(r, 10)));
}

test("sortLog: newest first, undated entries last in file order, entries without a title dropped", () => {
  expect(sortLog([...log, { date: "2026-11-01" }, null]).map((e) => e.title)).toEqual(["Checkpoint", "Budget signed", "Venue booked", "Kickoff", "Undated"]);
  expect(() => sortLog({})).toThrow("array");
});

test("Log shows the newest entries and folds the rest behind Show N earlier", async () => {
  await show(<Log title="Progress" show={2} />);
  const titles = () => [...container.querySelectorAll("li")].map((li) => li.querySelector(".font-medium")?.textContent);
  expect(titles()).toEqual(["Caution: Checkpoint", "Budget signed"]);
  expect(container.querySelector("li time")?.className).toContain("tabular-nums");
  const more = [...container.querySelectorAll("button")].find((b) => b.textContent === "Show 3 earlier")!;
  expect(more.getAttribute("aria-expanded")).toBe("false");
  await act(async () => more.click());
  expect(titles()).toHaveLength(5);
  expect(more.textContent).toBe("Show fewer");
  await act(async () => more.click());
  expect(titles()).toHaveLength(2);
});

test("recordItems takes a list or a map; Record links URLs and its own url", async () => {
  expect(recordItems({ a: 1 })).toEqual([{ label: "a", value: 1 }]);
  expect(recordItems([{ label: "Spec", value: "v2", url: "/a/abc" }, { nope: 1 }])).toEqual([{ label: "Spec", value: "v2", url: "/a/abc" }]);
  await show(<Record data="facts.json" title="Consultation" />);
  expect([...container.querySelectorAll("dt")].map((d) => d.textContent)).toEqual(["Clinic", "Booked"]);
  const a = container.querySelector("dd a")!;
  expect(a.getAttribute("href")).toBe("https://example.com/b");
  expect(a.getAttribute("target")).toBe("_blank");
});

test("Figure lazy-loads its image and enlarges it in a dialog", async () => {
  await show(<Figure src="data:image/png;base64,AAAA" alt="Floor plan" caption="Ground floor" credit="Studio K" creditUrl="https://example.com/k" />);
  const img = container.querySelector("img")!;
  expect(img.getAttribute("loading")).toBe("lazy");
  expect(container.querySelector("figcaption")?.textContent).toContain("Credit: Studio K");
  await act(async () => container.querySelector<HTMLButtonElement>("figure button")!.click());
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  const dialog = document.querySelector("[role=dialog]");
  expect(dialog?.querySelector("img")?.getAttribute("alt")).toBe("Floor plan");
});
