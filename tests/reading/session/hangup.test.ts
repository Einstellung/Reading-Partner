// What a hangup hands to distillation (src/reading/session/hangup): which page
// the talk belongs to, what it was marked on, what of the thread goes, and when
// it is read.
// Run: bun test.

import { expect, test } from "bun:test";
import { deferHangup, hangupPass, type HangupPass } from "../../../src/reading/session/hangup";
import type { Annotation } from "../../../src/platform/app/reader-contract";

const context = {
  topicId: "topic-1",
  topicName: "Attention",
  bookId: "book-1",
  bookName: "A Book.pdf",
  pageIndex: 11,
};

const mark = { id: "mark-1", text: "the marked sentence", position: { pageIndex: 4 } } as unknown as Annotation;

const stored = [
  { role: "user" as const, text: "why?", ts: 1 },
  { role: "ai" as const, text: "because", ts: 2 },
];

test("a mark-anchored talk is pinned to the mark's page, not to where the reader is", () => {
  const pass = hangupPass({
    call: { threadId: "t1", annotationId: "mark-1" },
    context,
    annotation: mark,
    stored,
    annotations: [],
  });

  expect(pass.page).toBe(5);
  expect(pass.markedText).toBe("the marked sentence");
  expect(pass.annotationId).toBe("mark-1");
  expect(pass.trigger).toBe("hangup");
});

test("the book-level thread has no mark, so it is pinned to the page being read", () => {
  const pass = hangupPass({
    call: { threadId: "t2", annotationId: "", isBook: true },
    context,
    annotation: undefined,
    stored,
    annotations: [],
  });

  expect(pass.page).toBe(12);
  expect(pass.markedText).toBe("");
});

test("the book-level thread from the library, with no page open, is pinned nowhere", () => {
  const pass = hangupPass({
    call: { threadId: "t2", annotationId: "", isBook: true },
    context: { ...context, pageIndex: null },
    annotation: undefined,
    stored,
    annotations: [],
  });

  expect(pass.page).toBeNull();
});

test("a mark deleted under the talk leaves it with no page and no quote", () => {
  const pass = hangupPass({
    call: { threadId: "t1", annotationId: "mark-1" },
    context,
    annotation: undefined,
    stored,
    annotations: [],
  });

  expect(pass.page).toBeNull();
  expect(pass.markedText).toBe("");
});

test("a mark with no text of its own contributes no quote", () => {
  const pass = hangupPass({
    call: { threadId: "t1", annotationId: "mark-1" },
    context,
    annotation: { id: "mark-1", position: { pageIndex: 0 } } as unknown as Annotation,
    stored,
    annotations: [],
  });

  expect(pass.markedText).toBe("");
  expect(pass.page).toBe(1);
});

// `Annotation` is the engine's own bag ([key: string]: unknown), so `text` is
// whatever it put there — an image mark carries no sentence at all.
test("a mark whose text is not a sentence contributes no quote", () => {
  const pass = hangupPass({
    call: { threadId: "t1", annotationId: "mark-1" },
    context,
    annotation: { id: "mark-1", type: "image", text: { rects: 3 }, position: { pageIndex: 0 } } as unknown as Annotation,
    stored,
    annotations: [],
  });

  expect(pass.markedText).toBe("");
});

// The book-level thread quotes nothing even with a mark in hand: it is about the
// book, and a sentence lifted from wherever the reader last marked would be a
// quote the talk never made.
test("the book-level thread never quotes a mark", () => {
  const pass = hangupPass({
    call: { threadId: "t2", annotationId: "", isBook: true },
    context,
    annotation: mark,
    stored,
    annotations: [],
  });

  expect(pass.markedText).toBe("");
  expect(pass.page).toBe(12);
});

test("the transcript is the three fields a talk is made of, and nothing the screen added", () => {
  const pass = hangupPass({
    call: { threadId: "t1", annotationId: "mark-1" },
    context,
    annotation: mark,
    stored: [
      {
        role: "ai",
        text: "because",
        ts: 2,
        // What a display row picks up on the way past: never the talk.
        streaming: true,
        notice: "left out chapter 2",
      } as unknown as { role: "ai"; text: string; ts: number },
    ],
    annotations: [],
  });

  expect(pass.messages).toEqual([{ role: "ai", text: "because", ts: 2 }]);
});

test("the marks the book carries ride along for the silent-marks pass", () => {
  const annotations = [{ id: "m", page: 3, text: "quiet", note: "", createdAt: 5 }];
  const pass = hangupPass({
    call: { threadId: "t1", annotationId: "mark-1" },
    context,
    annotation: mark,
    stored,
    annotations,
  });

  expect(pass.annotations).toBe(annotations);
  expect(pass.topicId).toBe("topic-1");
  expect(pass.bookName).toBe("A Book.pdf");
});

// When the pass is built, which is not when the ✕ was pressed. The bug this
// pins: a pass built eagerly and only handed over deferred distils the
// transcript as it stood mid-answer, and the exchange the reader just had is
// missing from it.
test("a hangup mid-answer distils the exchange the turn was still writing", () => {
  const thread: { role: "user" | "ai"; text: string; ts: number }[] = [
    { role: "user", text: "why?", ts: 1 },
  ];
  const inFlight: (() => void)[] = [];
  const distilled: HangupPass[] = [];

  deferHangup({
    call: { threadId: "t1", annotationId: "mark-1" },
    context,
    annotation: mark,
    annotations: [],
    readStored: () => thread,
    whenSettled: (threadId, run) => {
      expect(threadId).toBe("t1");
      inFlight.push(run);
      return true;
    },
    distill: (pass) => void distilled.push(pass),
  });

  // The turn is still writing: nothing has been distilled yet.
  expect(distilled).toEqual([]);

  // It lands, writing its answer into the thread file, and only then does the
  // pass get built.
  thread.push({ role: "ai", text: "because the mark is on that page", ts: 2 });
  inFlight[0]?.();

  expect(distilled).toHaveLength(1);
  expect(distilled[0]?.messages).toEqual([
    { role: "user", text: "why?", ts: 1 },
    { role: "ai", text: "because the mark is on that page", ts: 2 },
  ]);
  expect(distilled[0]?.page).toBe(5);
});

test("a hangup with nothing in flight distils the thread as it stands", () => {
  const distilled: HangupPass[] = [];
  deferHangup({
    call: { threadId: "t1", annotationId: "mark-1" },
    context,
    annotation: mark,
    annotations: [],
    readStored: () => stored,
    whenSettled: () => false,
    distill: (pass) => void distilled.push(pass),
  });

  expect(distilled).toHaveLength(1);
  expect(distilled[0]?.messages).toEqual(stored);
});

// --- asides (docs/03) ---

const lesson = {
  id: "bt",
  annotationId: "",
  messages: [
    { role: "user" as const, text: "teach me ch.3", ts: 1 },
    { role: "ai" as const, text: "chapter 3 is about", ts: 2 },
  ],
};

// A chat-span aside has no mark, so a pass of its own would be one with page
// null and markedText "" — a sub-agent run that cannot say where in the book it
// happened. It belongs to the lesson it was pulled out of.
test("hanging up inside a chat-span aside distils the lesson it came out of", () => {
  const pass = hangupPass({
    call: { threadId: "as", annotationId: "" },
    context,
    annotation: undefined,
    stored: [{ role: "user", text: "what does routing mean", ts: 3 }],
    annotations: [],
    threads: [lesson, { id: "as", annotationId: "", parentThreadId: "bt", messages: [] }],
  });

  expect(pass.threadId).toBe("bt");
  expect(pass.annotationId).toBe("");
  // The lesson's position is where the reader is, as it is when it hangs up itself.
  expect(pass.page).toBe(12);
  expect(pass.markedText).toBe("");
  expect(pass.messages.map((m) => m.text)).toEqual([
    "teach me ch.3",
    "chapter 3 is about",
    "what does routing mean",
  ]);
});

// The same unit from the other end: hanging up on the lesson owes the asides'
// transcripts too, or the parent's cursor steps over messages no pass has seen.
test("hanging up on the lesson takes the asides opened out of it", () => {
  const pass = hangupPass({
    call: { threadId: "bt", annotationId: "", isBook: true },
    context,
    annotation: undefined,
    stored: [...lesson.messages, { role: "user", text: "carry on", ts: 5 }],
    annotations: [],
    threads: [
      lesson,
      {
        id: "as",
        annotationId: "",
        parentThreadId: "bt",
        messages: [{ role: "user", text: "what does routing mean", ts: 3 }],
      },
    ],
  });

  expect(pass.threadId).toBe("bt");
  expect(pass.messages.map((m) => m.text)).toEqual([
    "teach me ch.3",
    "chapter 3 is about",
    "what does routing mean",
    "carry on",
  ]);
});

// An aside drawn on the page has a mark and a page, so it is a unit like any
// mark thread and hangs up as one.
test("a mark-anchored aside hangs up as its own conversation", () => {
  const pass = hangupPass({
    call: { threadId: "as", annotationId: "mark-1" },
    context,
    annotation: mark,
    stored,
    annotations: [],
    threads: [lesson, { id: "as", annotationId: "mark-1", parentThreadId: "bt", messages: [] }],
  });

  expect(pass.threadId).toBe("as");
  expect(pass.page).toBe(5);
  expect(pass.markedText).toBe("the marked sentence");
  expect(pass.messages).toEqual(stored);
});

// Sync can leave an aside whose parent was deleted elsewhere. Folding it into a
// thread that is not there is how the reader's best material goes missing.
test("an aside with no parent left hangs up on its own", () => {
  const pass = hangupPass({
    call: { threadId: "as", annotationId: "" },
    context,
    annotation: undefined,
    stored,
    annotations: [],
    threads: [{ id: "as", annotationId: "", parentThreadId: "gone", messages: [] }],
  });

  expect(pass.threadId).toBe("as");
  expect(pass.messages).toEqual(stored);
});
