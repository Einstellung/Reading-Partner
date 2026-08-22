// The pure half of a side conversation (src/reading/aside): how much of the
// parent its turn opens on, which selection is worth opening one on, which rows
// may offer it, what it opens as, the way back, and the line it leaves behind.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  asideAnchorAt,
  asideAnchorLabel,
  asideFraming,
  asideParentTail,
  asideReceipt,
  asideReceiptItems,
  asideReceiptSummary,
  asideReturn,
  asideSpan,
  carriesAsideReceipt,
  openAsideReceipt,
  ASIDE_ANCHOR_MAX,
  ASIDE_KICKOFF,
  ASIDE_PARENT_MAX_MESSAGES,
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

// Rounds are counted by the reader's questions, so they bound nothing when the
// reader asked none: an entry that opened on the model's turn, or a stretch of
// drawn cards, used to hand back the whole conversation.
test("a parent with no question in it is still bounded", () => {
  const aiOnly = Array.from({ length: 60 }, (_, i) => ({
    role: "ai" as const,
    text: `a${i}`,
    ts: i + 1,
  }));
  const tail = asideParentTail(aiOnly, null);
  expect(tail.length).toBe(ASIDE_PARENT_MAX_MESSAGES);
  // The end of the conversation, which is what the reader was looking at.
  expect(tail[tail.length - 1].text).toBe("a59");
});

// The ceiling cuts where the walk would have: onto a question, when one is left
// in the window.
test("the ceiling lands on a question when the window still holds one", () => {
  const long = [
    { role: "user" as const, text: "u1", ts: 1 },
    ...Array.from({ length: 20 }, (_, i) => ({ role: "ai" as const, text: `a${i}`, ts: i + 2 })),
    { role: "user" as const, text: "u2", ts: 30 },
    { role: "ai" as const, text: "last", ts: 31 },
  ];
  const tail = asideParentTail(long, 31);
  expect(tail.length).toBeLessThanOrEqual(ASIDE_PARENT_MAX_MESSAGES);
  expect(tail[0].role).toBe("user");
  expect(tail[0].text).toBe("u2");
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

// A conversation with nothing in it but prose: the row an aside would join is
// not there, so every receipt written onto this one is a row of its own.
const prose = [{ text: "some prose", ts: 10, parts: [{ type: "text" as const, text: "some prose" }] }];

// One receipt row as the file holds it, with `items` on the card.
function row(ts: number, id: string, items: unknown[], text = "[Aside, now closed: …]") {
  return {
    text,
    ts,
    parts: [{ type: "card" as const, id, card: { kind: "aside", items } }],
  };
}

test("the receipt is the aside's first question, taken without a second model call", () => {
  const receipt = asideReceipt({
    threadId: "aside-1",
    span: "attention heads",
    messages: asked,
    parent: [],
  });
  expect(receipt?.mode).toBe("new");
  expect(receipt?.card).toEqual({
    kind: "aside",
    items: [
      { threadId: "aside-1", span: "attention heads", question: "what is a head, concretely?" },
    ],
  });
  // The sentence the model reads next turn carries the question and reads as a
  // note rather than as something it said out loud.
  expect(receipt?.text).toContain("what is a head, concretely?");
  expect(receipt?.text.startsWith("[")).toBe(true);
  // The same line is written when the reader hangs up in the aside instead of
  // stepping back, so it may not say they came back.
  expect(receipt?.text).not.toContain("came back");
  expect(receipt?.text).toContain("now closed");
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
  expect(receipt?.card.items?.[0].question).toHaveLength(ASIDE_QUESTION_MAX);
});

test("an aside drawn on the book carries the page it was drawn on", () => {
  const on = (page: number | null) =>
    asideReceipt({ threadId: "aside-1", span: "attention heads", page, messages: asked, parent: [] })
      ?.card.items?.[0];
  expect(on(96)).toMatchObject({ page: 96 });
  expect(asideAnchorLabel(on(96)!)).toBe("p.96");
  // One pulled out of a reply has no page; its row shows the words instead.
  expect(on(null)).not.toHaveProperty("page");
  expect(asideAnchorLabel(on(null)!)).toBe("“attention heads”");
  expect(asideAnchorLabel({ threadId: "a", span: "", question: "q" })).toBe("");
  const long = { threadId: "a", span: "w".repeat(ASIDE_ANCHOR_MAX * 2), question: "q" };
  expect(asideAnchorLabel(long)).toHaveLength(ASIDE_ANCHOR_MAX + 2);
});

// Reopening an aside from its row and stepping back again must not restate the
// same sentence on the lesson.
test("a conversation that already carries the line does not get it twice", () => {
  const parent = [...prose, row(11, "aside-aside-1", [{ threadId: "aside-1", span: "s", question: "q" }])];
  expect(carriesAsideReceipt(parent, "aside-1")).toBe(true);
  expect(carriesAsideReceipt(parent, "aside-2")).toBe(false);
  expect(carriesAsideReceipt([{ parts: undefined }], "aside-1")).toBe(false);
  expect(asideReceipt({ threadId: "aside-1", span: "s", messages: asked, parent })).toBeNull();
  expect(asideReceipt({ threadId: "aside-2", span: "s", messages: asked, parent })).not.toBeNull();
});

// --- several asides on one row ---------------------------------------------

test("an aside left straight after another joins its row", () => {
  const parent = [
    ...prose,
    row(11, "card-1", [{ threadId: "aside-1", span: "s1", question: "q1" }], "[Aside 1]"),
  ];
  const receipt = asideReceipt({ threadId: "aside-2", span: "s2", messages: asked, parent });
  expect(receipt).toMatchObject({ mode: "merge", ts: 11, cardId: "card-1" });
  expect(receipt?.card.items).toEqual([
    { threadId: "aside-1", span: "s1", question: "q1" },
    { threadId: "aside-2", span: "s2", question: "what is a head, concretely?" },
  ]);
  // One sentence per aside, in the order they were left: the model reads the
  // same lines whether they were written one to a row or several.
  expect(receipt?.text.startsWith("[Aside 1]\n[Aside, now closed")).toBe(true);
});

test("anything said in the lesson since starts a new row", () => {
  const parent = [
    row(11, "card-1", [{ threadId: "aside-1", span: "s1", question: "q1" }]),
    { text: "carry on", ts: 12, parts: [{ type: "text" as const, text: "carry on" }] },
  ];
  expect(asideReceipt({ threadId: "aside-2", span: "s2", messages: asked, parent })?.mode).toBe(
    "new",
  );
  // Nor does a row that carries the receipt beside something else take one.
  const mixed = [
    {
      text: "prose and a card",
      ts: 13,
      parts: [
        { type: "text" as const, text: "prose and a card" },
        {
          type: "card" as const,
          id: "card-1",
          card: { kind: "aside", items: [{ threadId: "aside-1", span: "s1", question: "q1" }] },
        },
      ],
    },
  ];
  expect(openAsideReceipt(mixed[0])).toBeNull();
  expect(asideReceipt({ threadId: "aside-2", span: "s2", messages: asked, parent: mixed })?.mode).toBe(
    "new",
  );
});

// The reader steps out twice through the same aside — from the row, then back
// again. The second pass is dropped whole, so the row it would have joined does
// not end up naming that aside twice.
test("merging cannot repeat an aside already on the row", () => {
  const parent = [
    ...prose,
    row(11, "card-1", [
      { threadId: "aside-1", span: "s1", question: "q1" },
      { threadId: "aside-2", span: "s2", question: "q2" },
    ]),
  ];
  expect(carriesAsideReceipt(parent, "aside-2")).toBe(true);
  expect(asideReceipt({ threadId: "aside-2", span: "s2", messages: asked, parent })).toBeNull();
});

// The records already on disk: one aside per card, its fields at the top level.
// They are read as a receipt of one, and the next aside joins them.
test("a receipt written before items reads as one item", () => {
  const old = { kind: "aside" as const, threadId: "aside-1", span: "s", question: "q" };
  expect(asideReceiptItems(old)).toEqual([{ threadId: "aside-1", span: "s", question: "q" }]);
  expect(asideReceiptItems({ kind: "aside" })).toEqual([]);
  const parent = [
    ...prose,
    { text: "[Aside 1]", ts: 11, parts: [{ type: "card" as const, id: "card-1", card: old }] },
  ];
  const receipt = asideReceipt({ threadId: "aside-2", span: "s2", messages: asked, parent });
  expect(receipt?.mode).toBe("merge");
  expect(receipt?.card.items?.map((i) => i.threadId)).toEqual(["aside-1", "aside-2"]);
});

test("a receipt of several is collapsed to a count", () => {
  expect(asideReceiptSummary(5)).toBe("5 questions while you were reading");
});
