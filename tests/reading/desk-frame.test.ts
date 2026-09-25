// What shape of conversation a reading turn is taken on
// (src/reading/desk-frame.ts). Run: bun test.

import { expect, test } from "bun:test";
import { threadFrame, type FrameRef } from "../../src/reading/desk-frame";
import type { Annotation } from "../../src/platform/app/reader-contract";

const mark = { id: "ann-1", text: "marked", comment: "why", position: { pageIndex: 11 } } as unknown as Annotation;

function ref(over: Partial<FrameRef> = {}): FrameRef {
  return { annotationId: "", annotation: undefined, context: { pageIndex: 29 }, ...over };
}

test("the book-level thread is about the reader's own page", () => {
  const f = threadFrame(ref(), { annotationId: "", book: true });
  expect(f.kind).toBe("book");
  expect(f.isBook).toBe(true);
  expect(f.bookLevel).toBe(true);
  expect(f.onMark).toBe(false);
  expect(f.aside).toBeNull();
  expect(f.page).toBe(30);
  expect(f.currentPage).toBe(30);
  expect(f.selectionText).toBe("");
});

test("an unknown thread with no mark answers as the lesson", () => {
  expect(threadFrame(ref(), undefined).kind).toBe("book");
});

test("a mark thread is about the marked page and carries its passage and note", () => {
  const f = threadFrame(ref({ annotationId: "ann-1", annotation: mark }), undefined);
  expect(f.kind).toBe("mark");
  expect(f.bookLevel).toBe(false);
  expect(f.onMark).toBe(true);
  expect(f.page).toBe(12);
  expect(f.currentPage).toBe(30);
  expect(f.selectionText).toBe("marked");
  expect(f.selectionComment).toBe("why");
});

test("an aside drawn on the page is anchored like a mark but framed like the lesson", () => {
  const f = threadFrame(ref({ annotationId: "ann-1", annotation: mark }), {
    annotationId: "ann-1",
    parentThreadId: "lesson",
  });
  expect(f.kind).toBe("aside");
  expect(f.bookLevel).toBe(true);
  expect(f.aside).toEqual({ from: "mark" });
  expect(f.page).toBe(12);
  expect(f.selectionText).toBe("marked");
});

test("a chat-span aside takes its passage from the thread and its page from the reader", () => {
  const f = threadFrame(ref(), {
    annotationId: "",
    parentThreadId: "lesson",
    asideAnchor: { messageTs: 5, text: "the span" },
  });
  expect(f.aside).toEqual({ from: "chat" });
  expect(f.page).toBe(30);
  expect(f.selectionText).toBe("the span");
});

test("a page is cited under the supplement's title while one is on screen", () => {
  expect(threadFrame(ref(), undefined).pageAnchor(4)).toBe("[p.4]");
  expect(threadFrame(ref({ viewing: { title: "Some Article" } }), undefined).pageAnchor(4)).toBe(
    "[Some Article p.4]",
  );
});

test("no position means no page", () => {
  const f = threadFrame(ref({ context: { pageIndex: null } }), undefined);
  expect(f.currentPage).toBeNull();
  expect(f.page).toBeNull();
});
