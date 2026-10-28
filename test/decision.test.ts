// <Decision>: one shared answer at decide/<id>, made by people on the page and stamped by the server.
import { beforeEach, expect, test } from "bun:test";
import { ADMIN, createHub, type Harness } from "./support/do-harness.ts";
import { handleMcp, type Ctx } from "../src/worker/mcp.ts";

let h: Harness;
const OWNER = "owner@corp.com";
const SAM = "sam@corp.com";
const ROB = "rob@corp.com";

// Defined on the page so this test doesn't hang on the kit's export list; the server reads the same tags either way.
const page = [
  "export function Decision() { return null }",
  "",
  "# Venue",
  "",
  '<Decision id="venue" question="Where?" options={["Hall", "Park"]} />',
  "",
  '<Decision id="budget" question="Budget?" options={[{ value: "low", label: "Low > none" }, "high"]} deciders={["Sam@corp.com"]} />',
  "",
].join("\n");

async function make() {
  const r = await h.hub.create({ title: "Venue", files: { "index.mdx": page }, owner: OWNER });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  h.hub.share(r.id, { add: [{ email: SAM, role: "edit" }, { email: ROB, role: "edit" }] });
  return r.id;
}

beforeEach(async () => {
  h = await createHub();
  await h.hub.setMember(OWNER, "member", ADMIN);
});

test("a person's decision is stamped with who, when and the version; anyone who can edit may change it", async () => {
  const id = await make();
  h.hub.setState(id, { "decide/venue": { choice: " Hall ", note: "  closer  ", by: ROB, at: 1, version: 99 } }, SAM, undefined, { role: "edit" });
  const d = h.hub.state(id)["decide/venue"] as Record<string, unknown>;
  expect(d).toMatchObject({ choice: "Hall", note: "closer", by: SAM, version: 1 });
  expect(d.at).toBeGreaterThan(1);

  h.hub.setState(id, { "decide/venue": { choice: "Park" } }, ROB, undefined, { role: "edit" });
  expect(h.hub.state(id)["decide/venue"]).toMatchObject({ choice: "Park", by: ROB });
  expect(h.hub.state(id)["decide/venue"]).not.toHaveProperty("note");

  expect(() => h.hub.setState(id, { "decide/venue": { choice: "" } }, ROB)).toThrow("needs a choice");
  expect(() => h.hub.setState(id, { "decide/venue": "Park" }, ROB)).toThrow("must be an object");
  expect(() => h.hub.setState(id, { 'decide/a"b': { choice: "x" } }, ROB)).toThrow("isn't a valid decision id");
});

test("with deciders, only they may decide (read from the page's source, in any case)", async () => {
  const id = await make();
  expect(() => h.hub.setState(id, { "decide/budget": { choice: "low" } }, ROB, undefined, { role: "edit" })).toThrow("only the people this decision names");
  expect(() => h.hub.setState(id, { "decide/budget": { choice: "low" } }, OWNER, undefined, { role: "owner" })).toThrow("only the people this decision names");
  h.hub.setState(id, { "decide/budget": { choice: "low" } }, SAM, undefined, { role: "edit" });
  expect(h.hub.state(id)["decide/budget"]).toMatchObject({ choice: "low", by: SAM });
  // Clearing it is theirs too.
  expect(() => h.hub.setState(id, { "decide/budget": null }, ROB, undefined, { role: "edit" })).toThrow("only the people");
});

test("agents can't make, change or clear a decision", async () => {
  const id = await make();
  const ctx: Ctx = { hub: h.hub as never, origin: "https://acme.artifacts.test", env: h.env as never, slug: "acme", person: OWNER, actor: "agent" };
  const res = await handleMcp(
    new Request("https://acme.artifacts.test/mcp", {
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "artifact_state", arguments: { id, set: { "decide/venue": { choice: "Hall" } } } } }),
    }),
    ctx,
  );
  const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
  expect(body.result.isError).toBe(true);
  expect(body.result.content[0].text).toContain("decisions are made by people on the page");
  expect(() => h.hub.setState(id, { "decide/venue": null }, OWNER, undefined, { role: "owner", agent: true })).toThrow("people on the page");
  expect(h.hub.state(id)["decide/venue"]).toBeUndefined();
});

test("decidersIn reads literal deciders from MDX and TSX, ignoring other ids and components", async () => {
  // hub.ts loads only after the harness mocks cloudflare:workers.
  const { decidersIn } = await import("../src/worker/hub.ts");
  const files = {
    "index.mdx": page,
    "app.tsx": `export default () => <><DecisionLog id="venue" deciders={["x@y.z"]} /><Decision\n  id={"ship"}\n  deciders={[ 'A@b.co', "c@d.co" ]}\n/></>;`,
    "data/x.json": '{"<Decision id=\\"venue\\" deciders={[\\"z@z.z\\"]}": 1}',
  };
  expect(decidersIn(files, "venue")).toBeNull();
  expect(decidersIn(files, "budget")).toEqual(["sam@corp.com"]);
  expect(decidersIn(files, "ship")).toEqual(["a@b.co", "c@d.co"]);
  expect(decidersIn(files, "missing")).toBeNull();
});
