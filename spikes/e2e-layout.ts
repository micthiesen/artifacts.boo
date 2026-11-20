// Phone-width layout check (390 px) of every page against a deployed Worker,
// in a throwaway workspace: fails on anything that sticks out sideways.
// Usage: bun spikes/e2e-layout.ts   (reads DOMAIN and OPERATOR_TOKEN from .env; STAGE=<name> for a stage)
import { apex, call, check, cookieFor, finish, operator, origin, owner, setup, slug } from "./e2e-lib.ts";

await setup();
const guest = `guest-${slug}@example.com`;
const long = "A deliberately long title that keeps going to see whether it wraps on a phone screen";
const files = {
  "index.mdx": `import Box from "./box";\n\n# ${long}\n\n<Summary>Wide things below.</Summary>\n\n<Approval id="go" title="${long}" approvers={["${guest}"]} />\n\n<Form id="f" fields={[{ name: "team", label: "Team", type: "select", options: ["${long}"] }]} />\n\n<Box />\n`,
  // A scene whose title, description and label are all too long for a phone.
  "box.tsx": `import * as THREE from "three";\nimport { Scene } from "@a/ui";\nexport default () => <Scene title="${long}" description="${long}" build={({ scene, solid, label }) => { const box = solid(new THREE.BoxGeometry(3, 1, 1)); scene.add(box); label("${long}", box); }} />;\n`,
};
const created = await call("artifact_create", { title: long, description: long, files, share: [{ email: guest, role: "edit" }], notify: false });
const id = created.structuredContent?.id as string;
check("artifact for the layout check", Boolean(id), created);

const host = new URL(apex).hostname;
const ownerApex = await cookieFor(owner, host);
const ownerHere = await cookieFor(owner);
const guestHere = await cookieFor(guest);
// A whole-page comment carrying every reaction, opened in the drawer by its link.
const ws = new WebSocket(`${origin.replace(/^http/, "ws")}/a/${id}/sync`, { headers: { Cookie: guestHere, Origin: origin } } as never);
const got: any[] = [];
ws.addEventListener("message", (e) => got.push(JSON.parse(String(e.data))));
await new Promise((resolve, reject) => (ws.addEventListener("open", resolve), ws.addEventListener("error", reject)));
const wait = async (cid: string) => {
  for (let i = 0; i < 80 && !got.some((m) => m.cid === cid); i++) await Bun.sleep(100);
  return got.find((m) => m.cid === cid);
};
ws.send(JSON.stringify({ t: "comment", cid: "c1", anchor: null, text: long }));
const thread = (await wait("c1"))?.thread;
const emoji = ["👍", "❤️", "🎉", "😄", "👀", "✅"];
for (const [i, e] of emoji.entries()) ws.send(JSON.stringify({ t: "react", cid: `x${i}`, comment: thread?.comments[0].id, emoji: e, on: true }));
const reacted = (await wait("x5"))?.thread;
check("a comment with all six reactions", reacted?.comments[0].reactions?.length === 6, reacted ?? got.slice(-3));
ws.close();
const pages: [string, string, string | undefined][] = [
  ["splash", `${apex}/`, undefined],
  ["sign-in", `${apex}/login`, undefined],
  ["privacy", `${apex}/privacy`, undefined],
  ["terms", `${apex}/terms`, undefined],
  ["security", `${apex}/security`, undefined],
  ["help", `${apex}/help`, undefined],
  ["report", `${apex}/report?url=${encodeURIComponent(`${origin}/a/${id}`)}`, undefined],
  ["your workspaces", `${apex}/workspaces`, ownerApex],
  ["account", `${apex}/me`, ownerApex],
  ["help & feedback", `${apex}/support`, ownerApex],
  ["inbox", `${apex}/inbox`, ownerApex],
  ["artifact list", `${origin}/`, ownerHere],
  ["archived list", `${origin}/archived`, ownerHere],
  ["workspace settings", `${origin}/settings`, ownerHere],
  ["workspace notifications", `${origin}/me`, ownerHere],
  ["artifact (owner)", `${origin}/a/${id}`, ownerHere],
  ["artifact (guest)", `${origin}/a/${id}`, guestHere],
  ["comments drawer with reactions", `${origin}/a/${id}#thread=${thread?.id}`, ownerHere],
];
// The pricing page exists only while billing is on.
if ((await fetch(`${apex}/pricing`)).status === 200) pages.push(["pricing", `${apex}/pricing`, undefined]);
for (const [name, url, cookie] of pages) {
  const r = await operator("/layout", { url, ...(cookie ? { cookie } : {}) });
  const detail = r.error ?? `${r.scrollWidth}px wide at ${r.width}px: ${r.offenders?.map((o: any) => `${o.el} → ${o.right}px “${o.text}”`).join("; ")}`;
  check(`no sideways overflow: ${name}`, r.ok === true, detail);
  if (r.screenshot) {
    const file = `/tmp/layout-${name.replace(/\W+/g, "-")}.jpg`;
    await Bun.write(file, Buffer.from(r.screenshot, "base64"));
    console.log(`  screenshot: ${file}`);
  }
}
await finish();
