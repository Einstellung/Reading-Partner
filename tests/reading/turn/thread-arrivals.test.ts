// Which appends the open conversation has to show (src/reading/thread-arrivals).
// The view hears about every message written to any thread file, including the
// ones it wrote itself; what it must do with each is decided here. Pure.
// Run: bun test.

import { expect, test } from "bun:test";
import { arrivedMessage, createOwnAppends } from "../../../src/reading/turn/thread-arrivals";
import type { ThreadAppend, ThreadMessage } from "../../../src/platform/app/threads";

const OPEN = { threadId: "t1", home: "/books/a.pdf" };

function append(over: Partial<ThreadAppend> = {}): ThreadAppend {
  return {
    key: OPEN.home,
    threadId: OPEN.threadId,
    message: { id: "t-aaa", role: "ai", text: "the run is done", ts: 5 },
    ...over,
  };
}

// The ids in these tests are handed out in order, so a case can name the one a
// mint is about to give away.
function ids(): () => string {
  let n = 0;
  return () => `t-mine-${++n}`;
}

test("a message written by someone else into the open conversation is shown", () => {
  expect(arrivedMessage(append(), OPEN, createOwnAppends(ids()))?.text).toBe("the run is done");
});

test("nothing is shown for another thread, another book, or no open call", () => {
  const own = createOwnAppends(ids());
  expect(arrivedMessage(append({ threadId: "t2" }), OPEN, own)).toBeNull();
  expect(arrivedMessage(append({ key: "/books/b.pdf" }), OPEN, own)).toBeNull();
  expect(arrivedMessage(append(), null, own)).toBeNull();
});

test("the view's own append is not shown a second time", () => {
  const own = createOwnAppends(ids());
  const minted = own.mint({ role: "user", text: "what about chapter 3", ts: 1 });
  expect(minted.id).toBe("t-mine-1");
  // The channel calls its listeners inside the append, so this is the same
  // message coming straight back.
  expect(arrivedMessage(append({ message: minted }), OPEN, own)).toBeNull();
});

test("a message that only looks like ours is shown", () => {
  const own = createOwnAppends(ids());
  const minted = own.mint({ role: "ai", text: "same words", ts: 1 });
  // Identity, not content: another writer's message with the same text, role and
  // timestamp is another message.
  const twin: ThreadMessage = { ...minted, id: "t-theirs" };
  expect(arrivedMessage(append({ message: twin }), OPEN, own)?.id).toBe("t-theirs");
  // And ours is still ours.
  expect(arrivedMessage(append({ message: minted }), OPEN, own)).toBeNull();
});

test("a message with no id at all is shown", () => {
  const own = createOwnAppends(ids());
  const old: ThreadMessage = { role: "ai", text: "written before ids existed", ts: 1 };
  expect(arrivedMessage(append({ message: old }), OPEN, own)?.text).toBe(
    "written before ids existed",
  );
});

test("an id a caller brought is remembered as ours", () => {
  const own = createOwnAppends(ids());
  const minted = own.mint({ id: "t-resend", role: "user", text: "again", ts: 2 });
  expect(minted.id).toBe("t-resend");
  expect(arrivedMessage(append({ message: minted }), OPEN, own)).toBeNull();
});

test("our append into a conversation that is not open is still claimed", () => {
  const own = createOwnAppends(ids());
  // The receipt written back into the lesson as the reader leaves a side
  // conversation: ours, and for a thread nobody is looking at.
  const receipt = own.mint({ role: "ai", text: "we talked about this", ts: 3 });
  expect(arrivedMessage(append({ threadId: "parent", message: receipt }), OPEN, own)).toBeNull();
  // Claimed on the way through, so the same id arriving again is someone else's
  // and the set does not grow a member per receipt.
  expect(arrivedMessage(append({ message: receipt }), OPEN, own)?.id).toBe(receipt.id);
});
