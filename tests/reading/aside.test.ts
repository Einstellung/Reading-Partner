// The pure half of a side conversation (src/reading/aside): how much of the
// parent its turn opens on, which selection is worth opening one on, which rows
// may offer it, what it opens as, the way back, and the line it leaves behind.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  asideAnchorAt,
  asideFraming,
  asideParentTail,
  asideReceipt,
  asideReturn,
  asideSpan,
  carriesAsideReceipt,
  mayOpenAside,
  ASIDE_KICKOFF,
  ASIDE_PARENT_ROUNDS,
  ASIDE_QUESTION_MAX,
  ASIDE_SPAN_MAX,
} from "../../src/reading/aside";

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

// --- the span --------------------------------------------------------------

test("a selection is stored as one line", () => {
  expect(asideSpan("  attention\n  heads  ")).toBe("attention heads");
});

test("a selection with nothing in it opens nothing", () => {
  expect(asideSpan("")).toBeNull();
  expect(asideSpan("   \n ")).toBeNull();
  expect(asideSpan("a")).toBeNull();
  expect(asideSpan("ab")).toBe("ab");
});

// The span rides tier 0 of the budget, which is never dropped, so a reader who
// swept three paragraphs must not be able to push the inlined chapter out.
test("a selection longer than the cap is cut, and marked as cut", () => {
  const swept = asideSpan("x".repeat(ASIDE_SPAN_MAX * 3));
  expect(swept).toHaveLength(ASIDE_SPAN_MAX);
  expect(swept?.endsWith("…")).toBe(true);
});

test("the anchor carries the reply the span came out of", () => {
  expect(asideAnchorAt(1700, " query  vector ")).toEqual({ messageTs: 1700, text: "query vector" });
  expect(asideAnchorAt(1700, " ")).toBeNull();
});

// --- which rows offer it ---------------------------------------------------

const reply = { role: "ai" as const, text: "attention heads are three matrices" };

test("only a settled reply in the book-level conversation offers an aside", () => {
  expect(mayOpenAside(reply, true)).toBe(true);
  // Outside the lesson there is no affordance at all, which is what keeps an
  // aside one level deep: inside one there is no row to open a second from.
  expect(mayOpenAside(reply, false)).toBe(false);
  expect(mayOpenAside({ role: "user", text: "what is a head" }, true)).toBe(false);
  // Every delta rebuilds a streaming row, so a Range into it is dead in a frame.
  expect(mayOpenAside({ ...reply, streaming: true }, true)).toBe(false);
  // The app's words standing in for a reply, not the model's.
  expect(mayOpenAside({ ...reply, failed: true }, true)).toBe(false);
  expect(mayOpenAside({ role: "ai", text: "  " }, true)).toBe(false);
});

// --- what a record opens as ------------------------------------------------

const chatAside = {
  annotationId: "",
  parentThreadId: "lesson",
  asideAnchor: { messageTs: 9, text: "attention heads" },
};
const drawnAside = { annotationId: "mark-1", parentThreadId: "lesson" };

test("a span pulled out of a reply frames as itself, a drawn one as its mark", () => {
  expect(asideFraming(chatAside, "")).toEqual({
    parentThreadId: "lesson",
    from: "chat",
    span: "attention heads",
  });
  expect(asideFraming(drawnAside, " the softmax\nnormalises ")).toEqual({
    parentThreadId: "lesson",
    from: "mark",
    span: "the softmax normalises",
  });
});

test("a conversation that is not a side one has no framing", () => {
  expect(asideFraming({ annotationId: "", book: true }, "")).toBeNull();
  expect(asideFraming({ annotationId: "mark-1" }, "text")).toBeNull();
});

test("going back leads to the parent, reopened as itself", () => {
  expect(asideReturn({ id: "lesson", annotationId: "", book: true })).toEqual({
    threadId: "lesson",
    annotationId: "",
    isBook: true,
  });
  expect(asideReturn({ id: "t2", annotationId: "mark-9" })).toEqual({
    threadId: "t2",
    annotationId: "mark-9",
    isBook: false,
  });
});

// One level deep. A record naming a parent that is itself an aside is a record
// this shape says cannot exist, so it is not followed anywhere.
test("a parent that is itself an aside is not gone back to", () => {
  expect(asideReturn({ id: "t3", ...chatAside })).toBeNull();
});

// --- the receipt -----------------------------------------------------------

const asked = [
  { role: "user" as const, text: "  what is a head,\n  concretely?  " },
  { role: "ai" as const, text: "three matrices" },
  { role: "user" as const, text: "and the softmax?" },
];

test("the receipt is the aside's first question, taken without a second model call", () => {
  const receipt = asideReceipt({
    threadId: "aside-1",
    span: "attention heads",
    messages: asked,
    parent: [],
  });
  expect(receipt?.card).toEqual({
    kind: "aside",
    threadId: "aside-1",
    span: "attention heads",
    question: "what is a head, concretely?",
  });
  // The sentence the model reads next turn carries the question and reads as a
  // note rather than as something it said out loud.
  expect(receipt?.text).toContain("what is a head, concretely?");
  expect(receipt?.text.startsWith("[")).toBe(true);
});

test("an aside nobody asked anything in leaves nothing behind", () => {
  expect(
    asideReceipt({ threadId: "aside-1", span: "attention heads", messages: [], parent: [] }),
  ).toBeNull();
  expect(
    asideReceipt({
      threadId: "aside-1",
      span: "attention heads",
      messages: [{ role: "ai", text: "unprompted" }],
      parent: [],
    }),
  ).toBeNull();
});

test("a long first question is cut to a line", () => {
  const receipt = asideReceipt({
    threadId: "aside-1",
    span: "s",
    messages: [{ role: "user", text: "q".repeat(ASIDE_QUESTION_MAX * 2) }],
    parent: [],
  });
  expect(receipt?.card.question).toHaveLength(ASIDE_QUESTION_MAX);
});

// Reopening an aside from its chip and stepping back again must not restate the
// same sentence on the lesson.
test("a conversation that already carries the line does not get it twice", () => {
  const parent = [
    { parts: [{ type: "text" as const, text: "some prose" }] },
    {
      parts: [
        {
          type: "card" as const,
          id: "aside-aside-1",
          card: { kind: "aside", threadId: "aside-1", span: "s", question: "q" },
        },
      ],
    },
  ];
  expect(carriesAsideReceipt(parent, "aside-1")).toBe(true);
  expect(carriesAsideReceipt(parent, "aside-2")).toBe(false);
  expect(carriesAsideReceipt([{ parts: undefined }], "aside-1")).toBe(false);
  expect(
    asideReceipt({ threadId: "aside-1", span: "s", messages: asked, parent }),
  ).toBeNull();
  expect(asideReceipt({ threadId: "aside-2", span: "s", messages: asked, parent })).not.toBeNull();
});
