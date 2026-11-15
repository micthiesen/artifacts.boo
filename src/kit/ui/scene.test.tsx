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
