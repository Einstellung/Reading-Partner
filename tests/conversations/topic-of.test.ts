// Which topic a conversation belongs to, over the four thread kinds that say it
// four different ways (src/conversations/topic-of.ts). A literal store rather
// than the real one: what is under test is the four hops, not the domains'
// writers. Run: bun test.

import { expect, test } from "bun:test";
import { threadKindOf, topicOfThreadFile, type ConversationIo } from "../../src/conversations";

function io(files: Record<string, string>): ConversationIo {
  return {
    listRoot: async () => Object.keys(files),
    readText: async (path) => files[path] ?? null,
    peekThreads: async () => [],
  };
}

const TOPICS = JSON.stringify({
  topics: [
    { id: "t-other", name: "Other", files: [{ path: "/x.pdf", hash: "zzz" }] },
    { id: "t-attention", name: "Attention", files: [{ path: "/a.pdf", hash: "book-1" }] },
  ],
});

test("a thread file's kind comes off the catalogue, and nothing else does", () => {
  expect(threadKindOf("threads-book-1.json")).toBe("reading-thread");
  expect(threadKindOf("threads-retell-7.json")).toBe("retell-thread");
  expect(threadKindOf("threads-talk-9.json")).toBe("talk-thread");
  expect(threadKindOf("threads-info-2026-07-21.json")).toBe("info-thread");
  expect(threadKindOf("annotations-book-1.json")).toBeNull();
  expect(threadKindOf("library.json")).toBeNull();
});

test("a book's thread takes the topic that lists its hash", async () => {
  const disk = io({ "topics.json": TOPICS });
  expect(await topicOfThreadFile("book-1", disk)).toBe("t-attention");
  expect(await topicOfThreadFile("book-missing", disk)).toBeNull();
});

test("a retell's thread takes the retell's topic", async () => {
  const disk = io({ "retell-7.json": JSON.stringify({ id: "7", topicId: "t-attention" }) });
  expect(await topicOfThreadFile("retell-7", disk)).toBe("t-attention");
  expect(await topicOfThreadFile("retell-8", disk)).toBeNull();
});

test("a talk's thread goes through its outline to the retell", async () => {
  const disk = io({
    "outline-9.json": JSON.stringify({ id: "9", retellId: "7" }),
    "retell-7.json": JSON.stringify({ id: "7", topicId: "t-attention" }),
    // An outline brought in from outside a retell says so with a null.
    "outline-10.json": JSON.stringify({ id: "10", retellId: null }),
  });
  expect(await topicOfThreadFile("talk-9", disk)).toBe("t-attention");
  expect(await topicOfThreadFile("talk-10", disk)).toBeNull();
});

test("an info thread carries its own topic, and none until it has one", async () => {
  const disk = io({});
  expect(await topicOfThreadFile("info-2026-07-21", disk, { topicId: "t-attention" })).toBe(
    "t-attention",
  );
  // No queue to fall back on: a conversation nobody has said what is about is
  // filed under nothing (docs/21).
  expect(await topicOfThreadFile("info-2026-07-21", disk)).toBeNull();
});

test("a file the catalogue does not know is nobody's conversation", async () => {
  expect(await topicOfThreadFile("", io({}))).toBeNull();
});
