// When the talk's conversation is waiting on the coach
// (src/ui/components/rehearsal/coach-thread.ts). It is the one condition that
// starts a turn, so both ways one starts — a pass handed in and a line typed —
// go through it and neither needs a flag of its own.
// Run: bun test.

import { expect, test } from "bun:test";
import { awaitingReply, coachThreadId } from "../../../src/ui/components/rehearsal/coach-thread";

const said = (role: "user" | "ai", text: string) => ({ role, text });

test("a conversation whose last word was the reader's is waiting", () => {
  expect(awaitingReply([said("user", "I have just given this talk out loud")])).toBe(true);
  expect(awaitingReply([said("user", "…"), said("ai", "you skipped the why")])).toBe(false);
});

test("an empty conversation is not waiting on anything", () => {
  expect(awaitingReply([])).toBe(false);
});

// A card row is a receipt for what the coach wrote, persisted with its payload
// in `parts` and no text of its own. It is not something anyone said, so it must
// not decide whether the conversation is answered.
test("a card row does not count as an answer or as a question", () => {
  expect(awaitingReply([said("user", "pass 1"), said("ai", "")])).toBe(true);
  expect(awaitingReply([said("user", "pass 1"), said("ai", "here it is"), said("ai", "")])).toBe(
    false,
  );
});

// One conversation per talk, so nothing has to be looked up.
test("the thread of a talk is the outline itself", () => {
  expect(coachThreadId("o-17")).toBe("o-17");
});
