// Live check of <Scene> labels in the render check, in a throwaway workspace: a stepped scene whose step 2
// points two labels 5 px apart gets a warning naming that step, artifact_check's step and scene show one
// scene full size, and two labels on fittings 4 units apart sit side by side on a phone.
// Usage: bun spikes/e2e-scene.ts   (reads DOMAIN and OPERATOR_TOKEN from .env; OUT=<dir> keeps the screenshots)
import { call, check, finish, setup } from "./e2e-lib.ts";

const dir = `${import.meta.dir}/scene-fixtures`;
const files = {
  "index.mdx": 'import Crowded from "./crowded"\nimport Pair from "./pair"\n\n# Scene labels\n\n<Crowded />\n\n<Pair />\n',
  "crowded.tsx": await Bun.file(`${dir}/crowded.tsx`).text(),
  "pair.tsx": await Bun.file(`${dir}/pair.tsx`).text(),
};
const out = process.env.OUT;
const keep = async (name: string, r: { content?: { type: string; data?: string }[] }) => {
  const image = r.content?.find((c) => c.type === "image")?.data;
  if (out && image) await Bun.write(`${out}/${name}.jpg`, Buffer.from(image, "base64"));
  return image;
};
const text = (r: { content?: { type: string; text?: string }[] }) => r.content?.find((c) => c.type === "text")?.text ?? "";

await setup();
try {
  const created = await call("artifact_create", { title: "Scene labels", files });
  const id = created.structuredContent?.id as string;
  const said = text(created);
  check("the save passes the render check", said.includes("rendered without errors"), said);
  check("it warns that step 2's labels crowd, naming both", /step 2, on a phone \(390 px\)[^\n]*"IN" and "Tape here" point to places \d+ px apart/.test(said), said);
  check("the two fittings 4 units apart draw no warning", !said.includes("Two fittings"), said);

  const step = await call("artifact_check", { id, step: 2 });
  check("step 2 on its own", text(step).includes("scene 1, step 2, as a reader first sees it"), text(step));
  check("…with a screenshot", Boolean(await keep("crowded-step2", step)));
  check("…and the same warning", text(step).includes('"IN" and "Tape here"'), text(step));

  const pair = await call("artifact_check", { id, scene: "Two fittings 4 units apart", phone: true });
  check("a scene by its title, on a phone", text(pair).includes('scene "Two fittings 4 units apart", as a reader first sees it, 390×844'), text(pair));
  check("…without a warning of its own", !text(pair).includes("Scene \"Two fittings"), text(pair));
  await keep("pair-phone", pair);

  const missing = await call("artifact_check", { id, scene: "3" });
  check("a scene that isn't there is an error that says how many there are", text(missing).includes('no such scene on this page (it has 2'), text(missing));
  const both = await call("artifact_check", { id, section: "x", step: 1 });
  check("section and step together are refused", both.isError === true, text(both));
} finally {
  await finish();
}
