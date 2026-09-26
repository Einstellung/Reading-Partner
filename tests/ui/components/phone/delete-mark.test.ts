// Deleting a mark on the phone takes its conversation with it, and the page
// marks hosting the asides off that conversation, the way the desktop does.

import { expect, test } from "bun:test";

import type { Annotation } from "../../../../src/platform/app/reader-contract";
import {
  deletePhoneMark,
  markThreadId,
  type MarkDeleteIo,
} from "../../../../src/ui/components/phone/delete-mark";

const TARGET = { bookId: "book", topicId: "topic" };

function mark(id: string, aiThreadId?: string, chatAnchor?: object): Annotation {
  return { id, type: "highlight", aiThreadId, chatAnchor } as unknown as Annotation;
}

// A threads file of one conversation "t1" with one aside "t2" off it.
function fakeIo(opts: { loadFails?: boolean } = {}) {
  const calls: string[] = [];
  let loaded = false;
  const io: MarkDeleteIo = {
    loadThreads: async (bookId) => {
      calls.push(`load:${bookId}`);
      if (opts.loadFails) throw new Error("unreadable");
      loaded = true;
    },
    deleteThreadTree: (bookId, threadId) => {
      calls.push(`tree:${bookId}:${threadId}`);
      if (!loaded) return [];
      return threadId === "t1" ? ["t1", "t2"] : [threadId];
    },
    deleteAnnotations: (bookId, ids) => void calls.push(`marks:${bookId}:${ids.join(",")}`),
    logThreadDelete: (topicId, threadId) => void calls.push(`log:${topicId}:${threadId}`),
    removeThreadImages: async (threadId) => void calls.push(`images:${threadId}`),
  };
  return { io, calls };
}

test("a mark with no conversation is deleted alone, without reading the threads file", async () => {
  const { io, calls } = fakeIo();
  const ids = await deletePhoneMark(TARGET, [mark("a"), mark("b", "t1")], "a", io);
  expect(ids).toEqual(["a"]);
  expect(calls).toEqual(["marks:book:a"]);
});

test("a mark with a conversation takes the conversation, its asides and their page marks", async () => {
  const { io, calls } = fakeIo();
  const marks = [
    mark("a", "t1"),
    mark("aside-host", "t2"),
    // Drawn on a reply in the aside: the reader's, so it stays.
    mark("on-reply", "t2", { threadId: "t2", messageTs: 1, text: "x" }),
    mark("unrelated", "t9"),
  ];
  const ids = await deletePhoneMark(TARGET, marks, "a", io);
  expect(ids).toEqual(["a", "aside-host"]);
  expect(calls).toEqual([
    "load:book",
    "tree:book:t1",
    "log:topic:t1",
    "images:t1",
    "log:topic:t2",
    "images:t2",
    "marks:book:a,aside-host",
  ]);
});

test("a threads file that will not load still lets the mark go", async () => {
  const { io, calls } = fakeIo({ loadFails: true });
  const ids = await deletePhoneMark(TARGET, [mark("a", "t1")], "a", io);
  expect(ids).toEqual(["a"]);
  expect(calls).toEqual(["load:book", "marks:book:a"]);
});

test("which conversation a mark carries", () => {
  expect(markThreadId(mark("a", "t1"))).toBe("t1");
  expect(markThreadId(mark("a"))).toBeNull();
  expect(markThreadId(mark("a", ""))).toBeNull();
  expect(markThreadId(undefined)).toBeNull();
});
