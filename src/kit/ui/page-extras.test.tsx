// <Collection>: a hub's contents from the pages that link to it, and the "Linked from" footer giving way to it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, test } from "bun:test";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const store = await import("../store.ts");
const { Collection, LinkedFrom } = await import("./page-extras.tsx");

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await GlobalRegistrator.unregister();
});

const VIEWER = { email: "a@example.com", name: "A", role: "owner", canWrite: true } as never;
const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

async function render(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return { container, unmount: () => act(async () => root.unmount()) };
}

test("a collection lists every linking page with its description, newest first or by title", async () => {
  store.init({
    viewer: VIEWER,
    local: {},
    shared: {},
    presence: [],
    theme: "dark",
    backlinks: [
      { id: "abbbbbbbbbbbb", title: "Patio", description: "Planting plan", updatedAt: day(1) },
      { id: "aaaaaaaaaaaaa", title: "Coffee", updatedAt: day(9) },
    ],
  });
  const { container, unmount } = await render(<Collection title="Pages" />);
  const titles = () => [...container.querySelectorAll("li a")].map((a) => a.textContent);
  expect(titles()).toEqual(["Patio", "Coffee"]);
  expect(container.querySelector("li a")!.getAttribute("href")).toBe("/a/abbbbbbbbbbbb");
  expect(container.textContent).toContain("Planting plan");
  expect(container.textContent).toContain("1 d ago");
  await unmount();
  const byTitle = await render(<Collection sort="title" />);
  expect([...byTitle.container.querySelectorAll("li a")].map((a) => a.textContent)).toEqual(["Coffee", "Patio"]);
  await byTitle.unmount();
});

test("the Linked from footer stands down while a collection is on the page", async () => {
  const alone = await render(<LinkedFrom />);
  expect(alone.container.textContent).toContain("Linked from");
  await alone.unmount();
  const both = await render(
    <>
      <Collection />
      <LinkedFrom />
    </>,
  );
  expect(both.container.textContent).not.toContain("Linked from");
  expect(both.container.querySelectorAll("li a").length).toBe(2);
  await both.unmount();
  // On a hand-sorted hub, only what it doesn't link to yet; nothing at all once everything has a place.
  const both2 = (linkTitles: Record<string, string>) =>
    store.init({ viewer: VIEWER, local: {}, shared: {}, presence: [], theme: "dark", linkTitles, backlinks: [{ id: "abbbbbbbbbbbb", title: "Patio" }, { id: "aaaaaaaaaaaaa", title: "Coffee" }] });
  both2({ abbbbbbbbbbbb: "Patio" });
  const sorted = await render(<Collection unlisted title="New" />);
  expect([...sorted.container.querySelectorAll("li a")].map((a) => a.textContent)).toEqual(["Coffee"]);
  await sorted.unmount();
  both2({ abbbbbbbbbbbb: "Patio", aaaaaaaaaaaaa: "Coffee" });
  const done = await render(<Collection unlisted title="New" />);
  expect(done.container.textContent).toBe("");
  await done.unmount();
  store.init({ viewer: VIEWER, local: {}, shared: {}, presence: [], theme: "dark", backlinks: [] });
  const none = await render(<Collection empty="No pages yet." />);
  expect(none.container.textContent).toContain("No pages yet.");
  await none.unmount();
});
