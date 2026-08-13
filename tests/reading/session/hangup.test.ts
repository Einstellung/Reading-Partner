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
