// How much of the parent conversation an aside's turn opens on
// (src/reading/aside). Pure. Run: bun test.

import { expect, test } from "bun:test";
import { asideParentTail, ASIDE_KICKOFF, ASIDE_PARENT_ROUNDS } from "../../src/reading/aside";

// u1 a1 u2 a2 u3 a3 u4 a4, at ts 1..8.
const lesson = [
  { role: "user" as const, text: "u1", ts: 1 },
  { role: "ai" as const, text: "a1", ts: 2 },
  { role: "user" as const, text: "u2", ts: 3 },
  { role: "ai" as const, text: "a2", ts: 4 },
  { role: "user" as const, text: "u3", ts: 5 },
  { role: "ai" as const, text: "a3", ts: 6 },
  { role: "user" as const, text: "u4", ts: 7 },
  { role: "ai" as const, text: "a4", ts: 8 },
];

const texts = (ms: { text: string }[]): string[] => ms.map((m) => m.text);

test("the tail ends on the message the span came from and reaches back three rounds", () => {
  expect(ASIDE_PARENT_ROUNDS).toBe(3);
  expect(texts(asideParentTail(lesson, 8))).toEqual(["u2", "a2", "u3", "a3", "u4", "a4"]);
});

// 3 of the 13 measured cases quoted the reply before last, 2 the one before
// that: the window has to reach past the end of the conversation, not just to it.
test("a span pulled out of an older reply still opens on its own question", () => {
  expect(texts(asideParentTail(lesson, 6))).toEqual(["u1", "a1", "u2", "a2", "u3", "a3"]);
  expect(texts(asideParentTail(lesson, 4))).toEqual(["u1", "a1", "u2", "a2"]);
});

// A mark-anchored aside was drawn on the page while the lesson ran: there is no
// anchored message, so the live end of the lesson is what the reader was looking
// at. Same answer for a chat span whose message no longer resolves.
test("no anchor takes the live end of the conversation", () => {
  expect(texts(asideParentTail(lesson, null))).toEqual(["u2", "a2", "u3", "a3", "u4", "a4"]);
  expect(texts(asideParentTail(lesson, 999))).toEqual(["u2", "a2", "u3", "a3", "u4", "a4"]);
});

// The cut lands on a question. A reply whose question is outside the window
// would be the model reading its own words with nothing to hang them on.
test("the cut never leaves a dangling reply at the front", () => {
  const opensOnReply = [{ role: "ai" as const, text: "a0", ts: 0 }, ...lesson];
  expect(texts(asideParentTail(opensOnReply, 6, 1))).toEqual(["u3", "a3"]);
  expect(texts(asideParentTail(opensOnReply, 2, 3))).toEqual(["u1", "a1"]);
});

test("a conversation shorter than the window is taken whole", () => {
  expect(texts(asideParentTail(lesson.slice(0, 2), 2))).toEqual(["u1", "a1"]);
  expect(asideParentTail([], 1)).toEqual([]);
  expect(asideParentTail(lesson, 8, 0)).toEqual([]);
});

// A stretch where the model answered twice, or where a turn produced no reply,
// cuts by the reader's questions all the same.
test("rounds are counted by the reader's questions, not by pairs", () => {
  const uneven = [
    { role: "user" as const, text: "u1", ts: 1 },
    { role: "ai" as const, text: "a1a", ts: 2 },
    { role: "ai" as const, text: "a1b", ts: 3 },
    { role: "user" as const, text: "u2", ts: 4 },
    { role: "user" as const, text: "u3", ts: 5 },
    { role: "ai" as const, text: "a3", ts: 6 },
  ];
  expect(texts(asideParentTail(uneven, 6, 2))).toEqual(["u2", "u3", "a3"]);
});

// Every provider wants the exchange to open on a user turn. Nothing was marked
// on the page here, so the mark thread's stand-in would send the model looking
// for a passage the prompt does not carry.
test("the aside's stand-in opening says nothing about a marked passage", () => {
  expect(ASIDE_KICKOFF).not.toContain("marked");
  expect(ASIDE_KICKOFF.trim()).not.toBe("");
});
