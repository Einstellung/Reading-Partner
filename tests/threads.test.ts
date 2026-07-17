// Unit tests for the thread store's book-level thread (docs/03: the top-bar AI
// button). The store keys off an in-memory cache, so create/get round-trips
// without touching disk. Run: bun test.

import { expect, test } from "bun:test";
import {
  appendMessage,
  createBookThread,
  createThread,
  getBookThread,
  getThread,
  type Thread,
} from "../src/threads";

test("createBookThread marks the thread and leaves it unanchored", () => {
  const path = "/books/book-thread-a.pdf";
  const thread = createBookThread(path, "bt-1");
  expect(thread.book).toBe(true);
  expect(thread.annotationId).toBe("");
  expect(thread.messages).toEqual([]);
  // Reachable both by its id and by the book-thread lookup.
  expect(getThread(path, "bt-1")).toBe(thread);
  expect(getBookThread(path)).toBe(thread);
});

test("getBookThread ignores mark-anchored threads", () => {
  const path = "/books/book-thread-b.pdf";
  createThread(path, "ann-1", "th-1");
  expect(getBookThread(path)).toBeUndefined();
  expect(getThread(path, "th-1")?.book).toBeUndefined();

  const book = createBookThread(path, "bt-2");
  // A book thread and mark threads coexist; only the marked one is returned.
  expect(getBookThread(path)).toBe(book);
});

test("the book thread hosts messages like any other", () => {
  const path = "/books/book-thread-c.pdf";
  createBookThread(path, "bt-3");
  appendMessage(path, "bt-3", { role: "user", text: "what is this chapter about", ts: 1 });
  appendMessage(path, "bt-3", { role: "ai", text: "it covers X", ts: 2 });
  expect(getThread(path, "bt-3")?.messages).toHaveLength(2);
});

test("the book marker survives the JSON persistence shape", () => {
  const thread: Thread = {
    id: "bt-4",
    annotationId: "",
    book: true,
    path: "/books/book-thread-d.pdf",
    createdAt: 123,
    messages: [],
  };
  const restored = JSON.parse(JSON.stringify({ threads: { "bt-4": thread } })) as {
    threads: Record<string, Thread>;
  };
  expect(restored.threads["bt-4"].book).toBe(true);
  expect(restored.threads["bt-4"].annotationId).toBe("");
});
