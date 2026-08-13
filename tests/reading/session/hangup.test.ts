// What a hangup hands to distillation (src/reading/session/hangup): which page
// the talk belongs to, what it was marked on, and what of the thread goes.
// Run: bun test.

import { expect, test } from "bun:test";
import { hangupPass } from "../../../src/reading/session/hangup";
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
