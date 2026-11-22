// The shell's side of a support case's in-page conversation (src/shell/conversation.ts): the page gets the one
// thread the Worker named, and its replies go only there. Without ShellBoot.conversation nothing is relayed.
import { expect, test } from "bun:test";
import { conversationView, readReply, REPLY_MAX } from "../src/shell/conversation.ts";
import type { Thread } from "../src/shared/protocol.ts";

const thread: Thread = {
  id: "tabc",
  anchor: null,
  version: 1,
  by: "ana@corp.com",
  at: "2026-11-21T10:00:00.000Z",
  resolved: null,
  comments: [
    { id: "c1", by: "ana@corp.com", text: "The table is blank", at: "2026-11-21T10:00:00.000Z", seq: 1 },
    { id: "c2", by: "agent", text: "Which phone?", at: "2026-11-21T11:00:00.000Z", seq: 2, reactions: [{ emoji: "👍", by: ["ana@corp.com"] }] },
    { id: "c3", by: "op@corp.com", text: "Looking", at: "2026-11-21T12:00:00.000Z", seq: 3 },
  ],
};

test("the page gets the thread's comments with names to show, the operator's assistant as Support", () => {
  const view = conversationView(thread, [{ email: "op@corp.com", name: "Michael" }], "ana@corp.com", true);
  expect(view.comments.map((c) => c.name)).toEqual(["You", "Support", "Michael"]);
  expect(view.comments[1].reactions).toEqual([{ emoji: "👍", by: ["ana@corp.com"] }]);
  expect(view).toMatchObject({ canReply: true, me: "ana@corp.com" });
  expect(conversationView(undefined, [], null, false)).toEqual({ comments: [], canReply: false, me: null });
});

test("a reply from the page goes only on a case's page, well formed, from someone who may reply", () => {
  const ok = { cid: "abc123", text: "  It's an iPhone  " };
  // Any other page: whatever the frame posts is ignored.
  expect(readReply(undefined, true, ok)).toBeNull();
  expect(readReply("tabc", true, ok)).toEqual({ cid: "abc123", text: "It's an iPhone" });
  expect(readReply("tabc", true, { cid: "bad cid!", text: "x" })).toBeNull();
  expect(readReply("tabc", true, { cid: "abc", text: 42 })).toBeNull();
  expect(readReply("tabc", true, { cid: "abc", text: "   " })).toEqual({ cid: "abc", error: "Write something to send." });
  expect(readReply("tabc", true, { cid: "abc", text: "x".repeat(REPLY_MAX + 1) })).toMatchObject({ cid: "abc", error: expect.stringContaining("limited") });
  expect(readReply("tabc", false, ok)).toEqual({ cid: "abc123", error: "Sign in to reply." });
});
