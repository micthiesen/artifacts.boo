// Shortlist: ranked rows that open one at a time, ruled-out options folded away, and a Decision that
// recommends the pick.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const store = await import("../store.ts");
const { Shortlist } = await import("./shortlist.tsx");

const data = {
  question: "Which router?",
  pick: "a",
  why: "Fast and quiet.",
  checked: "2026-10-20",
  criteria: ["Speed", "Noise"],
  options: [
    { id: "c", name: "Gamma", verdict: "conditional", summary: "Only with fibre.", url: "https://c.example", deciding: "Do you have fibre?" },
    { id: "z", name: "Zeta", verdict: "no", summary: "Discontinued." },
    { id: "a", name: "Alpha", verdict: "pick", summary: "The quiet one.", price: "€199", pros: ["Silent"], cons: ["Pricey"], evidence: [{ label: "Review", url: "https://r.example", kind: "report" }] },
    { id: "b", name: "Beta", verdict: "close", summary: "Cheaper.", url: "https://b.example", facts: [{ label: "Range", value: "40 m" }] },
  ],
  decide: { options: "all" },
};

let container: HTMLElement;
let root: { render(el: React.ReactElement): void; unmount(): void };

beforeEach(async () => {
  store.reset();
  store.setTransport(() => {});
  store.setBoot({ artifactId: "a1", version: 1, entry: "@art/index.mdx", data: { "data/shortlist.json": data }, title: "t" } as never);
  store.init({ viewer: { email: "me@x.dev", role: "edit" }, shared: {}, local: {}, presence: [], theme: "dark" } as never);
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<Shortlist />));
  await act(async () => new Promise((r) => setTimeout(r, 20)));
});
afterEach(async () => {
  await act(async () => root.unmount());
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await GlobalRegistrator.unregister();
});

const rows = () => [...container.querySelectorAll<HTMLElement>("ol[aria-label='Options, best first'] > li")];
const toggleOf = (li: HTMLElement) => li.querySelector<HTMLButtonElement>("button[aria-expanded]")!;

test("rows are ranked by verdict, numbered, with the verdict as a word", () => {
  const text = rows().map((li) => li.textContent);
  expect(text.length).toBe(3);
  expect(text[0]).toContain("1.Alpha");
  expect(text[0]).toContain("Pick");
  expect(text[0]).toContain("€199 · The quiet one.");
  expect(text[1]).toContain("2.Beta");
  expect(text[2]).toContain("3.Gamma");
  expect(text[2]).toContain("Conditional");
  expect(container.textContent).toContain("Pick: Alpha");
  expect(container.textContent).toContain("What matters, in order: Speed · Noise");
});

test("a row opens to its details, and opening another closes it", async () => {
  const [alpha, beta] = rows();
  expect(toggleOf(alpha!).getAttribute("aria-expanded")).toBe("false");
  expect(alpha!.textContent).not.toContain("Silent");
  await act(async () => toggleOf(alpha!).click());
  expect(toggleOf(alpha!).getAttribute("aria-expanded")).toBe("true");
  expect(alpha!.textContent).toContain("Silent");
  expect(alpha!.textContent).toContain("Pricey");
  const panel = document.getElementById(toggleOf(alpha!).getAttribute("aria-controls")!);
  expect(panel?.querySelector("a[href='https://r.example']")?.textContent).toBe("Review");

  await act(async () => toggleOf(beta!).click());
  expect(toggleOf(alpha!).getAttribute("aria-expanded")).toBe("false");
  expect(alpha!.textContent).not.toContain("Silent");
  expect(beta!.textContent).toContain("40 m");

  await act(async () => toggleOf(beta!).click());
  expect(beta!.textContent).not.toContain("40 m");
});

test("the button is named by the row and sits outside its readable text", () => {
  const b = toggleOf(rows()[0]!);
  const name = b
    .getAttribute("aria-labelledby")!
    .split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .join(" ");
  expect(name).toBe("Alpha ✓Pick €199");
  // Listen skips buttons, so the text the row reads must not be inside it.
  expect(b.textContent).toBe("");
  expect(rows()[0]!.getAttribute("data-speak")).toBe("option");
});

test("ruled-out options stay folded until asked for", async () => {
  expect(container.textContent).not.toContain("Zeta");
  const more = [...container.querySelectorAll("button")].find((b) => b.textContent?.startsWith("Ruled out"))!;
  expect(more.getAttribute("aria-expanded")).toBe("false");
  await act(async () => more.click());
  expect(container.textContent).toContain("Zeta");
  expect(container.textContent).toContain("Discontinued.");
});

test("the Decision offers the live options and recommends the pick", () => {
  const radios = [...container.querySelectorAll<HTMLInputElement>("input[type=radio]")].map((r) => r.value);
  expect(radios).toEqual(["a", "b", "c"]);
  const recommended = container.querySelector("[data-choice='a']")?.textContent;
  expect(recommended).toContain("Recommended");
});
