// A support case's page shows its conversation inside the page (ShellBoot.conversation). It is the one place a
// frame gets comments, so it stays narrow: the Worker names the thread, and only for a case's own page, whose
// source the service writes; the shell sends that one thread and relays replies to it alone, as the viewer.
// Every other page's frame still only reports anchors and clicks (threads.ts).
import type { ConversationView, Person, Thread } from "../shared/protocol.ts";

/** The hub's limit on a comment. */
export const REPLY_MAX = 5000;
const CID = /^[A-Za-z0-9_-]{1,40}$/;

/** What the page is sent: the thread's comments with the names to show ("Support" for the operator's assistant). */
export function conversationView(thread: Thread | undefined, people: Person[], me: string | null, canReply: boolean): ConversationView {
  const name = (by: string) => (by === "agent" ? "Support" : by === me ? "You" : (people.find((p) => p.email === by)?.name ?? by.split("@")[0]));
  return {
    comments: (thread?.comments ?? []).map((c) => ({ id: c.id, by: c.by, name: name(c.by), text: c.text, at: c.at, ...(c.reactions?.length ? { reactions: c.reactions } : {}) })),
    canReply,
    me,
  };
}

/**
 * A reply the page asked to send. null when it isn't one to act on: not a case's page, or not a well-formed
 * message (artifact code could post anything). An error says why a real reply can't go, so the page keeps the text.
 */
export function readReply(conversation: string | undefined, canReply: boolean, msg: { cid?: unknown; text?: unknown }): { cid: string; text: string } | { cid: string; error: string } | null {
  if (!conversation || typeof msg.cid !== "string" || !CID.test(msg.cid) || typeof msg.text !== "string") return null;
  const text = msg.text.trim();
  if (!canReply) return { cid: msg.cid, error: "Sign in to reply." };
  if (!text) return { cid: msg.cid, error: "Write something to send." };
  if (text.length > REPLY_MAX) return { cid: msg.cid, error: `Replies are limited to ${REPLY_MAX} characters.` };
  return { cid: msg.cid, text };
}
