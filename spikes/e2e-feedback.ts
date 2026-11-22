// Live check of agent feedback, in a throwaway workspace: its agent files a note with agent_feedback (a repeat only
// counts), the operator sees it in support_feedback as counts and, with items, as text, then closes it with
// support_feedback_update, which deletes its text. The operator's agent token on the support workspace is made
// for the run and revoked after; deleting the workspace deletes whatever notes are left.
// Usage: bun spikes/e2e-feedback.ts   (reads DOMAIN, OPERATOR_TOKEN and OPERATOR_EMAILS from .env)
import { apex, call, check, domain, finish, operator, setup, slug } from "./e2e-lib.ts";

const stage = process.env.STAGE && process.env.STAGE !== "prod" ? process.env.STAGE : null;
const support = `https://support${stage ? `--${stage}` : ""}.${domain}`;
const op = (process.env.OPERATOR_EMAILS ?? "").split(",")[0].trim().toLowerCase();
const text = (r: { content?: { type: string; text?: string }[] }) => r.content?.find((c) => c.type === "text")?.text ?? "";

let opToken: { id: string; token: string } | null = null;
let id = 0;
async function asOperator(name: string, args: unknown) {
  const res = await fetch(`${support}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${opToken!.token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }),
  });
  const body = (await res.json()) as any;
  if (body.error) throw new Error(`${name}: ${body.error.message}`);
  return body.result;
}

await setup();
const summary = `E2E check ${slug}: placeholder note, safe to ignore`;
try {
  const note = { kind: "friction", area: "other", summary, expected: "Nothing; this is an automated check.", happened: "Nothing.", workaround: "none", impact: "slowed" };
  const filed = await call("agent_feedback", note);
  const noted = /^Noted \((f_\w+)\)/.exec(text(filed));
  check("an agent files a note", Boolean(noted) && !filed.isError, text(filed));
  const fid = noted?.[1] ?? "";
  const again = await call("agent_feedback", { ...note, summary: summary.toUpperCase() });
  check("the same note again only counts", text(again) === `Already noted (${fid}); nothing added.`, text(again));

  opToken = await operator(`/workspaces/support/tokens`, { email: op, label: "E2E feedback check" });
  const counts = await asOperator("support_feedback", {});
  check("counts show the open note, without its text", counts.structuredContent?.open >= 1 && !text(counts).includes(summary), text(counts).slice(0, 300));
  check("…by area", counts.structuredContent?.byArea?.other?.notes >= 1, counts.structuredContent?.byArea);

  const items = await asOperator("support_feedback", { items: true, area: "other" });
  check("items carry the text, under the line saying agents wrote it", text(items).startsWith("(Quoted text below was written by other people's agents") && text(items).includes(summary), text(items).slice(0, 300));
  check("…sent twice", (items.structuredContent?.items as { id: string; count: number }[]).find((f) => f.id === fid)?.count === 2);
  check("…and no address", !text(items).includes("@example.com"));

  const closed = await asOperator("support_feedback_update", { ids: [fid], outcome: "mistake" });
  check("closing it", JSON.stringify(closed.structuredContent?.closed) === JSON.stringify([fid]), text(closed));
  const after = await asOperator("support_feedback", { items: true, area: "other" });
  check("…takes it out of the open notes", !text(after).includes(fid), text(after).slice(0, 300));
} finally {
  if (opToken) await operator(`/workspaces/support/tokens`, { id: opToken.id, email: op }, "DELETE").then(
    (r) => check("the operator's token is revoked", r.revoked === true, r),
    (err) => check("the operator's token is revoked", false, String(err)),
  );
  console.log(`apex ${apex}`);
}
await finish();
