// Deleting a conversation from outside a live call (reading/delete/delete-thread.ts):
// a lesson or book conversation with its asides, one aside and its row, each with
// its images, its event line and the page marks that were its doors. Run against
// a real thread store over an in-memory file.

import { expect, test } from "bun:test";

import type { Annotation } from "../../../src/platform/app/reader-contract";
import {
  createThreadStore,
  threadFileName,
  type Thread,
  type ThreadMessage,
} from "../../../src/platform/app/threads";
import {
  deleteAside,
  deleteBookConversation,
  deleteConversation,
  deleteLesson,
  type DeleteThreadDeps,
} from "../../../src/reading/delete/delete-thread";

const TARGET = { bookId: "book", topicId: "topic" };

function thread(id: string, extra: Partial<Thread> = {}, messages: ThreadMessage[] = []): Thread {
  return { id, annotationId: "", bookId: "book", createdAt: 1, messages, ...extra } as Thread;
}

function receipt(ts: number, threadIds: string[]): ThreadMessage {
  return {
    role: "ai",
    ts,
    text: threadIds.map((id) => `[Aside, now closed: ${id}]`).join("\n"),
    parts: [
      {
        type: "card",
        id: `card-${ts}`,
        card: { kind: "aside", items: threadIds.map((threadId) => ({ threadId, span: "", question: threadId })) },
      },
    ],
  };
}

function setup(threads: Thread[], marks: Annotation[] = [], opts: { unreadable?: boolean } = {}) {
  const files = new Map<string, string>();
  const file = threadFileName("book");
  files.set(file, JSON.stringify({ threads: Object.fromEntries(threads.map((t) => [t.id, t])) }));
  const store = createThreadStore({
    read: async (f) => {
      if (opts.unreadable) throw new Error("EIO");
      return files.get(f) ?? null;
    },
    write: async (f, contents) => void files.set(f, contents),
    quarantine: async () => null,
  });
  const calls: string[] = [];
  const deps: DeleteThreadDeps = {
    loadThreads: (bookId) => store.load(bookId),
    getThread: (bookId, id) => store.get(bookId, id),
    getBookThread: (bookId) => store.getBook(bookId),
    deleteThreadTree: (bookId, id) => store.removeTree(bookId, id),
    patchMessage: (bookId, id, ts, patch) => store.patch(bookId, id, ts, patch),
    removeMessage: (bookId, id, ts) => store.removeMessage(bookId, id, ts),
    flushThreads: () => store.flush(),
    loadAnnotations: async () => marks,
    deleteAnnotations: (bookId, ids) => void calls.push(`marks:${bookId}:${ids.join(",")}`),
    removeThreadImages: async (id) => void calls.push(`images:${id}`),
    logThreadDelete: (topicId, id) => void calls.push(`log:${topicId}:${id}`),
  };
  const onDisk = (): Record<string, Thread> =>
    (JSON.parse(files.get(file)!) as { threads: Record<string, Thread> }).threads;
  return { deps, calls, onDisk };
}

function mark(id: string, aiThreadId?: string): Annotation {
  return { id, type: "highlight", aiThreadId } as unknown as Annotation;
}

test("deleting a lesson takes the book thread and its asides, and leaves marked passages' conversations", async () => {
  const { deps, calls, onDisk } = setup(
    [
      thread("lesson", { book: true }),
      thread("a1", { parentThreadId: "lesson" }),
      thread("a2", { parentThreadId: "lesson", annotationId: "m2" }),
      thread("passage", { annotationId: "m9" }),
    ],
    [mark("m2", "a2"), mark("m9", "passage")],
  );
  expect(deleteLesson).toBe(deleteBookConversation);
  const out = await deleteLesson(TARGET, deps);
  expect(out.threads.sort()).toEqual(["a1", "a2", "lesson"]);
  expect(out.marks).toEqual(["m2"]);
  expect(Object.keys(onDisk())).toEqual(["passage"]);
  for (const id of ["lesson", "a1", "a2"]) {
    expect(calls).toContain(`images:${id}`);
    expect(calls).toContain(`log:topic:${id}`);
  }
  expect(calls).toContain("marks:book:m2");
});

test("every book-level thread goes, so a second one from another device does not come back", async () => {
  const { deps, onDisk } = setup([
    thread("b1", { book: true, createdAt: 1 }),
    thread("b2", { book: true, createdAt: 2 }),
  ]);
  const out = await deleteBookConversation(TARGET, deps);
  expect(out.threads.sort()).toEqual(["b1", "b2"]);
  expect(onDisk()).toEqual({});
});

test("a book with no conversation deletes nothing and touches no marks", async () => {
  const { deps, calls } = setup([thread("passage", { annotationId: "m9" })]);
  const out = await deleteBookConversation(TARGET, deps);
  expect(out).toEqual({ threads: [], marks: [] });
  expect(calls).toEqual([]);
});

test("a threads file that cannot be read throws and deletes nothing", async () => {
  const { deps, calls } = setup([thread("lesson", { book: true })], [], { unreadable: true });
  await expect(deleteBookConversation(TARGET, deps)).rejects.toThrow();
  expect(calls).toEqual([]);
});

test("deleting an aside takes it and its row off the lesson, and leaves the lesson", async () => {
  const { deps, calls, onDisk } = setup([
    thread("lesson", { book: true }, [
      { role: "user", ts: 1, text: "teach" },
      receipt(2, ["a1"]),
      { role: "ai", ts: 3, text: "on we go" },
      receipt(4, ["a2", "a3"]),
    ]),
    thread("a1", { parentThreadId: "lesson" }),
    thread("a2", { parentThreadId: "lesson" }),
    thread("a3", { parentThreadId: "lesson" }),
  ]);
  await deleteAside(TARGET, "a1", deps);
  await deleteAside(TARGET, "a3", deps);
  const disk = onDisk();
  expect(Object.keys(disk).sort()).toEqual(["a2", "lesson"]);
  const messages = disk.lesson.messages;
  expect(messages.map((m) => m.ts)).toEqual([1, 3, 4]);
  expect(messages[2].text).toBe("[Aside, now closed: a2]");
  const card = (messages[2].parts![0] as unknown as { card: { items: { threadId: string }[] } }).card;
  expect(card.items.map((i) => i.threadId)).toEqual(["a2"]);
  expect(calls).toEqual(["images:a1", "log:topic:a1", "images:a3", "log:topic:a3"]);
});

test("deleting one conversation takes its asides and their page marks", async () => {
  const { deps, onDisk } = setup(
    [thread("t1", { annotationId: "m1" }), thread("t2", { parentThreadId: "t1" }), thread("t3")],
    [mark("m1", "t1"), mark("m3", "t3")],
  );
  const out = await deleteConversation(TARGET, "t1", deps);
  expect(out.threads.sort()).toEqual(["t1", "t2"]);
  expect(out.marks).toEqual(["m1"]);
  expect(Object.keys(onDisk())).toEqual(["t3"]);
});
