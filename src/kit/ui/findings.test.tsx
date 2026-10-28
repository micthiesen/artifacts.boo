// <Findings>: rows in rank order with their levels as words, the status roll-up, the inventory's first rows with
// "Show all", and a bad file shown as its problems instead of a broken page.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const store = await import("../store.ts");
const { Findings } = await import("./findings.tsx");

let container: HTMLElement;
let root: { render(el: React.ReactElement): void; unmount(): void };

const base = { change: "Do it.", benefit: "Faster.", confidence: "estimated" };
const findings = {
  question: "Why is CI slow?",
  answer: "The e2e suite runs alone.",
  method: { window: "October", sample: "412 runs", caveats: ["Cancelled runs left out."] },
  findings: [
    { ...base, id: "low", title: "Skip docs runs", impact: "low", effort: "small", status: "shipped" },
    { ...base, id: "big", title: "Shard e2e", impact: "high", effort: "large", status: "doing", metrics: [{ label: "e2e", before: 840, after: 250, unit: "s", better: "down" }] },
    { ...base, id: "quick", title: "Cache dependencies", impact: "high", effort: "small", confidence: "measured", status: "shipped" },
    { ...base, id: "call", title: "Bigger runners", impact: "medium", effort: "small", status: "decide", owner: "Dana" },
  ],
  notWorth: [{ title: "Self-hosted runners", why: "Too few minutes." }],
  inventory: { title: "Every job", data: "jobs.json", top: 3 },
};
const jobs = Array.from({ length: 7 }, (_, i) => ({ job: `job-${i}`, seconds: 100 - i }));

function boot(data: Record<string, unknown>) {
  store.reset();
  store.setBoot({ artifactId: "a1", version: 1, entry: "@art/index.mdx", data, title: "t" } as never);
  store.init({ viewer: { email: "me@x.dev", role: "edit" }, shared: {}, local: {}, presence: [], theme: "dark" });
}

beforeEach(() => {
  boot({ "data/findings.json": findings, "data/jobs.json": jobs });
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

async function show(el: React.ReactElement) {
  await act(async () => root.render(el));
  for (let i = 0; i < 10 && !container.querySelector(".art-findings, [role=note]"); i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
  await act(async () => new Promise((r) => setTimeout(r, 10)));
}

test("rows are ranked and each level is a word, with the reader's decisions marked Your call", async () => {
  await show(<Findings />);
  const rows = [...container.querySelectorAll("li[id^=finding-]")];
  expect(rows.map((r) => r.id)).toEqual(["finding-quick", "finding-big", "finding-call", "finding-low"]);
  const first = rows[0]!.querySelector("summary")!.textContent!;
  for (const w of ["1", "Cache dependencies", "Shipped", "High impact", "Small effort", "Measured"]) expect(first).toContain(w);
  expect(rows[2]!.querySelector("summary")!.textContent).toContain("Your call");
  expect(rows[2]!.textContent).toContain("Owner: Dana");
});

test("the roll-up counts statuses under the answer", async () => {
  await show(<Findings />);
  const text = container.querySelector(".art-findings")!.textContent!;
  expect(text).toContain("Why is CI slow?");
  expect(text).toContain("2 shipped");
  expect(text).toContain("1 doing");
  expect(text).toContain("1 your call");
  expect(text).not.toContain("open");
});

test("not-worth-doing and the method are there; the inventory shows its top rows and Show all", async () => {
  await show(<Findings />);
  const text = container.textContent!;
  expect(text).toContain("Not worth doing (1)");
  expect(text).toContain("Too few minutes.");
  expect(text).toContain("412 runs");
  expect(text).toContain("Cancelled runs left out.");
  expect(container.querySelectorAll("tbody tr").length).toBe(3);
  const more = [...container.querySelectorAll("button")].find((b) => b.textContent === "Show all 7 rows")!;
  await act(async () => more.click());
  expect(container.querySelectorAll("tbody tr").length).toBe(7);
});

test("a bad file shows what to fix instead of the page", async () => {
  boot({ "data/findings.json": { ...findings, findings: [{ ...findings.findings[0], impact: "huge" }] }, "data/jobs.json": jobs });
  await show(<Findings />);
  expect(container.querySelector(".art-findings")).toBeNull();
  expect(container.textContent).toContain('"impact" is one of high, medium, low');
});
