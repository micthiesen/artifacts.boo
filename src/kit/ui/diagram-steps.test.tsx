// Stepped diagrams: which step shows, what each step lights (subgraphs and collapsed groups too), the bar's
// keys, and the rule that a step may only name nodes the diagram has.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import type { FrameMessage } from "../../shared/protocol.ts";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { render } = await import("pele");
await (await import("pele/lazy")).load("flowchart");
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { canMove, focusIds, stepTo, unknownFocus } = await import("../../shared/diagram-steps.ts");
const { decorate, knownIds, StepBar } = await import("./diagram-impl.tsx");
type StepState = import("../../shared/diagram-steps.ts").StepState;

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await GlobalRegistrator.unregister();
});

test("focus is node ids separated by any whitespace; none is empty", () => {
  expect(focusIds(" a  b\nc_d ")).toEqual(["a", "b", "c_d"]);
  expect(focusIds("")).toEqual([]);
  expect(focusIds(undefined)).toEqual([]);
});

test("Previous and Next stop at the ends; All toggles, and moving from All returns to the step you were on", () => {
  let s: StepState = { at: 0, all: false };
  expect(canMove(s, "prev", 3)).toBe(false);
  expect(stepTo(s, "prev", 3)).toEqual({ at: 0, all: false });
  s = stepTo(stepTo(s, "next", 3), "next", 3);
  expect(s).toEqual({ at: 2, all: false });
  expect(canMove(s, "next", 3)).toBe(false);
  expect(stepTo(s, "next", 3)).toEqual({ at: 2, all: false });
  s = stepTo(s, "all", 3);
  expect(s).toEqual({ at: 2, all: true });
  expect(canMove(s, "next", 3)).toBe(true);
  expect(stepTo(s, "next", 3)).toEqual({ at: 2, all: false });
  expect(stepTo(s, "prev", 3)).toEqual({ at: 2, all: false });
  expect(stepTo(s, "all", 3)).toEqual({ at: 2, all: false });
  expect(stepTo({ at: 1, all: false }, "first", 3)).toEqual({ at: 0, all: false });
  expect(stepTo({ at: 1, all: false }, "last", 3)).toEqual({ at: 2, all: false });
  // Steps that shrink under the reader (a live data file) don't leave it past the end.
  expect(stepTo({ at: 7, all: false }, "prev", 3)).toEqual({ at: 1, all: false });
});

test("a step naming a node the diagram doesn't have is a problem, one line per id", () => {
  const known = new Set(["a", "b"]);
  expect(unknownFocus([{ focus: "a b" }, { focus: "" }], known)).toEqual([]);
  expect(unknownFocus([{ focus: "a" }, { focus: "b zz" }], known)).toEqual([`step 2's focus "zz" isn't a node in the diagram`]);
});

const grouped = `flowchart TD
  start[Start] --> load[Load]
  subgraph G[Work]
    one[One] --> two[Two]
  end
  load --> one
  two --> done[Done]`;
const collapsed = `${grouped}\n  G@{ view: collapsed }`;

function draw(code: string) {
  const root = document.createElement("div");
  root.innerHTML = render(code).svg;
  return root;
}
const cls = (root: HTMLElement, sel: string) => root.querySelector(sel)!.classList;

test("a subgraph's id lights everything in it, and the edges between lit nodes light too", () => {
  const root = draw(grouped);
  decorate(root, grouped, new Set(["G", "load"]));
  expect(cls(root, 'g.pele-node[data-id="one"]').contains("art-lit")).toBe(true);
  expect(cls(root, 'g.pele-node[data-id="two"]').contains("art-lit")).toBe(true);
  expect(cls(root, 'g.pele-node[data-id="start"]').contains("art-dim")).toBe(true);
  expect(cls(root, 'g.pele-cluster[data-id="G"]').contains("art-lit")).toBe(true);
  expect(cls(root, 'g.pele-edge[data-id="L_load_one_0"]').contains("art-lit")).toBe(true);
  expect(cls(root, 'g.pele-edge[data-id="L_one_two_0"]').contains("art-lit")).toBe(true);
  expect(cls(root, 'g.pele-edge[data-id="L_two_done_0"]').contains("art-dim")).toBe(true);
});

test("a collapsed subgraph stands in for the nodes it hides, and edges into them follow it", () => {
  const root = draw(collapsed);
  // Pele draws the group as one node; its members aren't drawn.
  expect(root.querySelector('g.pele-node[data-id="G"]')).not.toBeNull();
  expect(root.querySelector('g.pele-node[data-id="one"]')).toBeNull();
  decorate(root, collapsed, new Set(["one", "load"]));
  expect(cls(root, 'g.pele-node[data-id="G"]').contains("art-lit")).toBe(true);
  expect(cls(root, 'g.pele-edge[data-id="L_load_one_0"]').contains("art-lit")).toBe(true);
  expect(cls(root, 'g.pele-edge[data-id="L_two_done_0"]').contains("art-dim")).toBe(true);
  // Hidden members still count as nodes a step may name.
  expect([...knownIds(root, collapsed)].sort()).toEqual(["G", "done", "load", "one", "start", "two"]);
});

test("showing every node again (All) clears the dimming on edges as well as nodes", () => {
  const root = draw(grouped);
  decorate(root, grouped, new Set(["start"]));
  expect(root.querySelectorAll(".art-dim").length).toBeGreaterThan(0);
  decorate(root, grouped, null);
  expect(root.querySelectorAll(".art-dim, .art-lit").length).toBe(0);
});

test("the zoom buttons' icons beside the drawing aren't taken for the drawing", () => {
  const root = draw(grouped);
  const zoom = document.createElement("div");
  zoom.className = "pele pele-zoom";
  zoom.innerHTML = `<button><svg><g class="pele-node" data-id="x"></g></svg></button>`;
  root.append(zoom);
  decorate(root, grouped, new Set(["start"]));
  expect(cls(root, 'svg.pele g.pele-node[data-id="start"]').contains("art-lit")).toBe(true);
  expect(zoom.querySelector(".art-dim")).toBeNull();
});

// ---- the bar ------------------------------------------------------------------------------

const steps = [
  { focus: "start", title: "It starts", text: "The page asks." },
  { focus: "load", text: "It loads." },
  { focus: "G", title: "The work", text: "Both parts run." },
];
let container: HTMLElement;
let root: { render(el: React.ReactElement): void; unmount(): void };
let sent: FrameMessage[] = [];

function Harness({ onState }: { onState?: (s: StepState) => void }) {
  const [state, setState] = React.useState<StepState>({ at: 0, all: false });
  return (
    <StepBar
      steps={steps}
      state={state}
      onState={(s) => {
        onState?.(s);
        setState(s);
      }}
    />
  );
}

beforeEach(async () => {
  sent = [];
  (await import("../store.ts")).setTransport((m) => sent.push(m));
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

const button = (name: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === name)!;
const text = () => container.textContent ?? "";
const key = (k: string) => act(async () => button("Next").dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })));

test("the bar says where you are, and Previous / Next / All move through the steps", async () => {
  await act(async () => root.render(<Harness />));
  expect(text()).toContain("Step 1 of 3");
  expect(text()).toContain("It starts");
  // At the first step Previous can't move, but stays focusable so focus isn't dropped.
  expect(button("Previous").getAttribute("aria-disabled")).toBe("true");
  expect(button("Previous").disabled).toBe(false);
  await act(async () => button("Next").click());
  expect(text()).toContain("Step 2 of 3");
  expect(text()).toContain("It loads.");
  await act(async () => button("All").click());
  expect(text()).toContain("All 3 steps");
  expect(button("All").getAttribute("aria-pressed")).toBe("true");
  await act(async () => button("Next").click());
  expect(text()).toContain("Step 2 of 3");
});

test("arrow keys, Home and End move while the bar has focus, and the page's own keys leave them be", async () => {
  await act(async () => root.render(<Harness />));
  await key("ArrowRight");
  expect(text()).toContain("Step 2 of 3");
  await key("End");
  expect(text()).toContain("Step 3 of 3");
  expect(button("Next").getAttribute("aria-disabled")).toBe("true");
  await key("ArrowLeft");
  expect(text()).toContain("Step 2 of 3");
  await key("Home");
  expect(text()).toContain("Step 1 of 3");
  const e = new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true });
  await act(async () => button("Next").dispatchEvent(e));
  expect(e.defaultPrevented).toBe(true);
  // A modified arrow is someone else's shortcut.
  await act(async () => button("Next").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", altKey: true, bubbles: true })));
  expect(text()).toContain("Step 2 of 3");
});

test("Listen reads the step's words and skips the controls", async () => {
  await act(async () => root.render(<Harness />));
  const skipped = container.querySelector('[data-speak="skip"]')!;
  expect(skipped.contains(button("Next"))).toBe(true);
  expect(skipped.textContent).toContain("Step 1 of 3");
  const read = [...container.querySelectorAll("p")].filter((p) => !p.closest('[data-speak="skip"]')).map((p) => p.textContent);
  expect(read).toEqual(["It starts", "The page asks."]);
  expect(sent).toEqual([]);
});

// ---- values a step sets --------------------------------------------------------------------

const { stateAt, stateProblems } = await import("../../shared/diagram-steps.ts");

const held: import("../../shared/diagram-steps.ts").DiagramStep[] = [
  { focus: "A", text: "Starts.", state: { "A.count": "0", "B.cookie": "none" } },
  { focus: "B", text: "Nothing set." },
  { focus: "A", text: "Counts.", state: { "A.count": "1", "B.cookie": "none" } },
  { focus: "B", text: "Signs in.", state: { "B.cookie": "sid=1", "B.user": "alice" } },
];

test("values carry from step to step; a step's change keeps what it was, and a first value is new", () => {
  expect(stateAt(held, 0)).toEqual([
    { node: "A", name: "count", value: "0", added: true },
    { node: "B", name: "cookie", value: "none", added: true },
  ]);
  // A step that sets nothing still shows the values so far, none of them changed.
  expect(stateAt(held, 1)).toEqual([
    { node: "A", name: "count", value: "0" },
    { node: "B", name: "cookie", value: "none" },
  ]);
  // Setting a value to what it already was isn't a change.
  expect(stateAt(held, 2)).toEqual([
    { node: "A", name: "count", value: "1", was: "0" },
    { node: "B", name: "cookie", value: "none" },
  ]);
  expect(stateAt(held, 3)).toEqual([
    { node: "A", name: "count", value: "1" },
    { node: "B", name: "cookie", value: "sid=1", was: "none" },
    { node: "B", name: "user", value: "alice", added: true },
  ]);
  expect(stateAt([{}], 0)).toBeNull();
});

test("a value is keyed by a node the diagram has, and is short text", () => {
  const known = new Set(["A", "B"]);
  expect(stateProblems(held, known)).toEqual([]);
  const bad = stateProblems(
    [
      { state: { "C.count": "1" } },
      { state: { count: "1", "A.x": "", "A.y": "x".repeat(41) } },
      { state: ["A.count"] as unknown as Record<string, string> },
    ],
    known,
  ).join("\n");
  expect(bad).toContain(`step 1's state key "C.count" names "C", which isn't a node in the diagram`);
  expect(bad).toContain(`step 2's state key "count" is "Node.name"`);
  expect(bad).toContain(`step 2's state "A.x" is a short text value`);
  expect(bad).toContain("keep values to 40");
  expect(bad).toContain(`step 3's "state" is {"Node.name": "value"}`);
  // Without the diagram's ids only the shape is checked.
  expect(stateProblems([{ state: { "C.count": "1" } }])).toEqual([]);
  const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`A.v${i}`, "1"]));
  expect(stateProblems([{ state: many }], known).join()).toContain("show at most 12");
});

function HeldHarness() {
  const [state, setState] = React.useState<StepState>({ at: 0, all: false });
  return <StepBar steps={held} state={state} onState={setState} />;
}

test("the bar lists the values at each step, striking through what a step changed", async () => {
  await act(async () => root.render(<HeldHarness />));
  const list = () => container.querySelector("[role=group][aria-label^=Values]")!;
  const said = () => container.querySelector("[aria-live] .sr-only")?.textContent ?? "";
  expect(list().getAttribute("aria-label")).toBe("Values at this step");
  expect(said()).toBe("A.count is 0; B.cookie is none");
  expect(list().textContent).toContain("A.countnew: 0new");
  await act(async () => button("Next").click());
  expect(list().textContent).not.toContain("new");
  await act(async () => button("Next").click());
  expect(list().querySelector("s")?.textContent).toBe("was 0");
  // Moving on announces what changed, not the whole list.
  expect(said()).toBe("A.count was 0, now 1");
  expect(list().textContent).toContain("now 1");
  // All shows where the values end, with nothing struck through.
  await act(async () => button("All").click());
  expect(list().getAttribute("aria-label")).toBe("Values at the end");
  expect(list().querySelector("s")).toBeNull();
  expect(list().textContent).toContain("B.useralice");
});

test("the render check reads a diagram's ids for the values too", () => {
  const known = knownIds(document.createElement("div"), "flowchart LR\n  A --> B");
  expect(stateProblems([{ state: { "Z.x": "1" } }], known)).toHaveLength(1);
  expect(stateProblems(held, known)).toEqual([]);
});
