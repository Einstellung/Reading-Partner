// The top-bar AI button's decision (src/reading/session/book-thread.ts).
//
// Pressing it with the book's threads not in memory used to read as "this book
// has never had a conversation", and the button then started a second one — the
// visible half of the incident that emptied a thread file. So the test drives
// the real thread store over an in-memory file and presses the button in the
// states the cache can be in: never loaded, and re-read by a sync pull.
// Run: bun test.

import { expect, test } from "bun:test";
import { resolveBookThread, type BookThreadIo } from "../../../src/reading/session/book-thread";
import { createThreadStore, type Thread, type ThreadStore } from "../../../src/platform/app/threads";

const BOOK = "book1";
const FILE = `threads-${BOOK}.json`;

function bookThread(id: string): Thread {
  return {
    id,
    annotationId: "",
    book: true,
    path: BOOK,
    createdAt: 1,
    messages: [{ role: "user", text: "what is this book about", ts: 1 }],
  };
}

function fixture(contents?: string): {
  store: ThreadStore;
  io: BookThreadIo;
  files: Map<string, string>;
  made: string[];
} {
  const files = new Map<string, string>();
  if (contents !== undefined) files.set(FILE, contents);
  const store = createThreadStore({
    read: async (file) => {
      await Promise.resolve();
      const text = files.get(file);
      if (text === "EIO") throw new Error("EIO");
      return text ?? null;
    },
    write: async (file, text) => {
      files.set(file, text);
    },
    // Never reached: no file here is unparseable.
    quarantine: async () => null,
    // Never fires: what reaches disk is not what this file is about.
    timer: { schedule: () => 0, cancel: () => {} },
    exit: () => {},
  });
  const made: string[] = [];
  let n = 0;
  const io: BookThreadIo = {
    loadThreads: (bookId) => store.load(bookId),
    getBookThread: (bookId) => store.getBook(bookId),
    createBookThread: (bookId, threadId) => {
      made.push(threadId);
      return store.createBook(bookId, threadId);
    },
    newThreadId: () => `made-${++n}`,
  };
  return { store, io, files, made };
}

const withThreads = (threads: Thread[]): string =>
  JSON.stringify({ threads: Object.fromEntries(threads.map((t) => [t.id, t])) });

test("a press before the book's threads are in memory reopens the one on disk", async () => {
  const { io, made } = fixture(withThreads([bookThread("bt-1")]));

  const result = await resolveBookThread(BOOK, () => false, io);

  expect(result.status).toBe("ok");
  expect(result.status === "ok" && result.thread.id).toBe("bt-1");
  expect(result.status === "ok" && result.thread.messages).toHaveLength(1);
  expect(made).toEqual([]);
});

test("a press after a sync pull re-read the file reopens it too", async () => {
  const { store, io, files, made } = fixture(withThreads([bookThread("bt-1")]));
  await store.load(BOOK);
  // The other device's copy arrives and the pull route re-reads it.
  files.set(FILE, withThreads([bookThread("bt-1"), bookThread("bt-elsewhere")]));
  store.drop(BOOK);

  const result = await resolveBookThread(BOOK, () => false, io);

  expect(result.status === "ok" && result.thread.id).toBe("bt-1");
  expect(made).toEqual([]);
});

test("the first press on a book creates one, and the next press reopens that", async () => {
  const { io, made } = fixture();

  const first = await resolveBookThread(BOOK, () => false, io);
  expect(first.status === "ok" && first.thread.book).toBe(true);
  const second = await resolveBookThread(BOOK, () => false, io);

  expect(second.status === "ok" && second.thread.id).toBe(
    first.status === "ok" ? first.thread.id : "",
  );
  expect(made).toEqual(["made-1"]);
});

test("a file that cannot be read starts nothing", async () => {
  const { io, made } = fixture("EIO");

  expect((await resolveBookThread(BOOK, () => false, io)).status).toBe("unreadable");
  expect(made).toEqual([]);
});

test("a book closed while the file was being read starts nothing", async () => {
  const { io, made } = fixture();

  expect((await resolveBookThread(BOOK, () => true, io)).status).toBe("cancelled");
  expect(made).toEqual([]);
});
