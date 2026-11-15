// <Scene> where there is no WebGL (this test's DOM has none, like an old device): the title and description
// still say what it is, the page's keys and Listen treat it as one block, and the render check isn't left waiting.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { afterAll, expect, test } from "bun:test";

GlobalRegistrator.register();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
Element.prototype.scrollIntoView = () => {};
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const store = await import("../store.ts");
const { checkHeld } = await import("../check.ts");
const { collectSpeech } = await import("../speak.ts");
const { runKeyWidget } = await import("../key-widget.ts");
const { Scene } = await import("./scene.tsx");

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 20));
  await GlobalRegistrator.unregister();
});

const settle = () => React.act(async () => void (await new Promise((r) => setTimeout(r, 30))));

async function mount(node: React.ReactNode) {
  const el = document.body.appendChild(document.createElement("div"));
  const root = createRoot(el);
  await React.act(async () => root.render(node));
  return { el, root };
}

const posted: { t: string; message?: string }[] = [];
store.setTransport((m) => posted.push(m as never));
// three.js logs when it can't get a context; that is the case under test.
console.error = () => {};

test("without WebGL it shows its title and description, and says why there is no picture", async () => {
  store.setBoot({ artifactId: "a", version: 1, entry: "@art/app.tsx", title: "t", data: {} });
  let built = 0;
  const { el, root } = await mount(<Scene title="Home rack" description="A 12U rack with the UPS at the bottom." build={() => void built++} />);
  await settle();
  const figure = el.querySelector("figure")!;
  // One block for Listen and one stop for the page's keys, as src/kit/keys-page.test.ts lays it out.
  expect(figure.getAttribute("data-speak")).toBe("scene");
  expect(figure.hasAttribute("data-key-stop")).toBe(true);
  expect(figure.querySelector("[role=status]")!.textContent).toContain("can't draw 3D");
  expect(figure.querySelector("figcaption")!.textContent).toBe("Home rack");
  expect(figure.textContent).toContain("This device can't draw 3D here");
  expect(figure.querySelector("[data-scene-about]")!.textContent).toBe("A 12U rack with the UPS at the bottom.");
  // Nothing to build into, nothing to turn: no view buttons, and no error sent to the shell for a device's limit.
  expect(built).toBe(0);
  expect(figure.querySelector("[role=group]")).toBeNull();
  expect(figure.querySelector("[role=application]")!.hasAttribute("hidden")).toBe(true);
  expect(posted).toEqual([]);

  // Listen reads the title, what it is, and the description; the notice is for the eye.
  expect(collectSpeech(el).units.map((u) => u.text)).toEqual(["Home rack. A 3D scene. A 12U rack with the UPS at the bottom."]);
  // The page's h, l and Enter have nothing to do here, so they move on.
  expect(runKeyWidget(figure, el, (w) => w.across?.(1))).toBeNull();
  expect(runKeyWidget(figure, el, (w) => w.enter?.())).toBeNull();
  await React.act(async () => root.unmount());
});

test("a render check waits for a scene, and is let go once it can't draw or goes away", async () => {
  store.setBoot({ artifactId: "a", version: 1, entry: "@art/app.tsx", title: "t", data: {}, check: true });
  expect(checkHeld()).toBe(false);
  posted.length = 0;
  // Seen from a sibling as the page is put together: the scene holds the check before anything can finish it.
  let whenMounted = false;
  const Probe = () => {
    React.useLayoutEffect(() => void (whenMounted = checkHeld()), []);
    return null;
  };
  const first = await mount(
    <>
      <Scene title="A" description="B" build={() => {}} />
      <Probe />
    </>,
  );
  expect(whenMounted).toBe(true);
  await settle();
  expect(checkHeld()).toBe(false);
  // In a check, no WebGL means nothing was looked at: that is said, not passed over.
  expect(posted.map((m) => m.message)).toEqual([`Scene "A": WebGL didn't start in the render check, so the scene wasn't drawn or checked. Keep to a few scenes a page; with only a few, run artifact_check again`]);
  // One that never gets as far as drawing (its chunk still loading when the page goes) doesn't hold the check forever.
  const second = await mount(<Scene title="C" description="D" build={() => {}} />);
  await React.act(async () => second.root.unmount());
  expect(checkHeld()).toBe(false);
  await React.act(async () => first.root.unmount());
});

test("a Scene without a build function, or with nothing to say what it is, says so instead of drawing", async () => {
  store.setBoot({ artifactId: "a", version: 1, entry: "@art/app.tsx", title: "t", data: {} });
  for (const [node, says] of [
    [<Scene title="A" description="B" build={undefined as never} />, "needs build="],
    [<Scene title="A" description="  " build={() => {}} />, "needs a title and a description"],
    [<Scene title="A" description="B" view={"iso" as never} build={() => {}} />, 'view is one of "angle", "front", "side", "top"'],
  ] as const) {
    posted.length = 0;
    const { el, root } = await mount(node);
    await settle();
    expect(el.textContent).toContain(says);
    // Reaches the shell, and so the render check.
    expect(posted.some((m) => m.t === "error" && m.message?.includes(says))).toBe(true);
    await React.act(async () => root.unmount());
  }
});

test("a stepped scene has a bar with the step's words, moved by its buttons and by the page's h and l", async () => {
  store.setBoot({ artifactId: "a", version: 1, entry: "@art/app.tsx", title: "t", data: {} });
  posted.length = 0;
  const steps = [
    { title: "Apart", text: "Three parts, apart." },
    { title: "Board in", text: "The board drops onto the standoffs." },
    { text: "The lid closes it.", view: "front" as const },
  ];
  const { el, root } = await mount(<Scene title="Assembly" description="How it goes together." steps={steps} build={() => {}} />);
  await settle();
  // The card is the stop; the figure inside is still one block for Listen, and the step's words are read after it.
  const card = el.firstElementChild!;
  expect(card.hasAttribute("data-key-stop")).toBe(true);
  expect(card.querySelector("figure")!.hasAttribute("data-key-stop")).toBe(false);
  const bar = card.querySelector("[role=group][aria-label=Steps]")!;
  expect(bar.textContent).toContain("Step 1 of 3");
  // A scene has no "every step at once".
  expect([...bar.querySelectorAll("button")].map((b) => b.textContent!.trim())).toEqual(["Previous", "Next"]);
  expect(collectSpeech(el).units.map((u) => u.text)).toEqual(["Assembly. A 3D scene. How it goes together.", "Apart.", "Three parts, apart."]);

  const press = (name: string) => React.act(async () => void [...bar.querySelectorAll("button")].find((b) => b.textContent!.includes(name))!.click());
  await press("Next");
  expect(bar.textContent).toContain("Step 2 of 3");
  expect(card.textContent).toContain("The board drops onto the standoffs.");
  // h and l walk the steps, and at either end leave the key to the page.
  await React.act(async () => void expect(runKeyWidget(card, el, (w) => w.across?.(1))).toBe(card));
  expect(bar.textContent).toContain("Step 3 of 3");
  await React.act(async () => void expect(runKeyWidget(card, el, (w) => w.across?.(1))).toBeNull());
  await React.act(async () => void expect(runKeyWidget(card, el, (w) => w.across?.(-1))).toBe(card));
  expect(bar.textContent).toContain("Step 2 of 3");
  await React.act(async () => root.unmount());
});

test("steps written wrong say so instead of showing a bar that goes nowhere", async () => {
  store.setBoot({ artifactId: "a", version: 1, entry: "@art/app.tsx", title: "t", data: {} });
  posted.length = 0;
  const { el, root } = await mount(<Scene title="A" description="B" steps={[{ text: "Only one." }]} build={() => {}} />);
  await settle();
  expect(el.textContent).toContain("<Scene steps>: steps is a list of at least two");
  expect(posted.some((m) => m.t === "error" && m.message?.includes("at least two"))).toBe(true);
  await React.act(async () => root.unmount());
});

test("a part that keeps its name glides from where it was; one that didn't move, or is new, doesn't", async () => {
  const THREE = await import("three");
  const { poses, movers, pose } = await import("./scene-impl.tsx");
  const part = (name: string, y: number, turn = 0) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
    o.name = name;
    o.position.y = y;
    o.rotation.y = turn;
    return o;
  };
  const before = new THREE.Scene().add(part("board", 40), part("lid", 70), part("base", 0), part("", 5));
  // The same name twice: the first is the part.
  before.add(part("board", 999));
  const after = new THREE.Scene().add(part("board", 10, Math.PI / 2), part("lid", 70), part("base", 0), part("clip", 3), part("", 9));
  const moving = movers(poses(before), after);
  expect(moving.map((m) => m.part.name)).toEqual(["board"]);
  const board = moving[0]!.part;
  // At 0 it is where it was, half-way it is half-way (and half turned), at 1 exactly where it was built.
  pose(moving, 0);
  expect(board.position.y).toBe(40);
  expect(board.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
  pose(moving, 0.5);
  expect(board.position.y).toBe(25);
  expect(board.quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(Math.PI / 4, 6);
  pose(moving, 1);
  expect(board.position.y).toBe(10);
  expect(board.quaternion.equals(moving[0]!.to.q)).toBe(true);
});

test("a label on a part rides with it, turning and all, and ends where it was put", async () => {
  const THREE = await import("three");
  const { ride } = await import("./scene-impl.tsx");
  const scene = new THREE.Scene();
  const arm = new THREE.Group();
  arm.position.set(10, 0, 0);
  const tip = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  tip.position.set(2, 0, 0);
  scene.add(arm.add(tip));
  scene.updateMatrixWorld(true);
  // The label sits one above the tip, in the world; the kit keeps it in the tip's own frame.
  const placed = new THREE.Vector3(12, 1, 0);
  const anchors = [{ part: tip, local: tip.worldToLocal(placed.clone()) }, null];
  const places = [placed.clone(), new THREE.Vector3(5, 5, 5)];
  // The arm swings a quarter turn about y and rises: the tip, and its label, go with it.
  arm.rotation.y = Math.PI / 2;
  arm.position.y = 4;
  ride(anchors, places);
  expect(places[0]!.x).toBeCloseTo(10, 6);
  expect(places[0]!.y).toBeCloseTo(5, 6);
  expect(places[0]!.z).toBeCloseTo(-2, 6);
  // A label on a place, not a part, stays put.
  expect(places[1]!.toArray()).toEqual([5, 5, 5]);
  arm.rotation.y = 0;
  arm.position.y = 0;
  ride(anchors, places);
  expect(places[0]!.distanceTo(placed)).toBeLessThan(1e-9);
});
