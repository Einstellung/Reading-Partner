// The time index over every conversation the app holds (src/soul/sequence.ts,
// docs/61). The derivation is pure and tested as such; the rebuild is run
// against a literal store rather than a disk. Run: bun test.

import { expect, test } from "bun:test";
import {
  currentStamp,
  deskOfFile,
  isStale,
  orderSpans,
  readSequence,
  rebuildSequence,
  SEQUENCE_FILE,
  SEQUENCE_VERSION,
  spanOf,
  type ConversationSpan,
  type Sequence,
  type SequenceIo,
} from "../../src/soul";
import { threadFileName, type Thread } from "../../src/platform/app/threads";

function thread(id: string, stamps: number[], over: Partial<Thread> = {}): Thread {
  return {
    id,
    annotationId: "",
    path: "",
    createdAt: stamps[0] ?? 0,
    messages: stamps.map((ts, i) => ({ role: i % 2 === 0 ? "user" : "ai", text: `m${ts}`, ts })),
    ...over,
  } as Thread;
}

interface FakeStore {
  files: Record<string, Thread[]>;
  texts?: Record<string, string>;
  mtimes?: Record<string, number>;
}

function io(store: FakeStore): SequenceIo & { written: Record<string, string> } {
  const written: Record<string, string> = {};
  return {
    written,
    conversations: {
      listRoot: async () => Object.keys(store.files),
      readText: async (path) => store.texts?.[path] ?? written[path] ?? null,
      peekThreads: async (fileKey) => store.files[threadFileName(fileKey)] ?? [],
    },
    mtime: async (path) => store.mtimes?.[path] ?? 1,
    readText: async (path) => store.texts?.[path] ?? written[path] ?? null,
    writeText: async (path, text) => {
      written[path] = text;
    },
  };
}

test("a file says what was on the desk while its conversations were held", () => {
  expect(deskOfFile({ kind: "reading-thread", fileKey: "abc123" })).toEqual({
    on: "book",
    id: "abc123",
  });
  expect(deskOfFile({ kind: "info-thread", fileKey: "info-2026-07-21" })).toEqual({
    on: "day",
    id: "2026-07-21",
  });
  expect(deskOfFile({ kind: "retell-thread", fileKey: "retell-7" })).toEqual({
    on: "retell",
    id: "7",
  });
  expect(deskOfFile({ kind: "talk-thread", fileKey: "talk-9" })).toEqual({ on: "outline", id: "9" });
  expect(deskOfFile({ kind: "conversation", fileKey: "door-2026-09-10" })).toEqual({
    on: "none",
    id: "",
  });
});

// The three reading doors are one file's three kinds of thread, so the span's
// kind cannot be read off the file name alone.
test("a reading file's spans are book, mark or aside by the thread", () => {
  const file = { kind: "reading-thread" as const, fileKey: "abc123" };
  expect(spanOf(file, thread("t1", [1], { book: true }), null).kind).toBe("book");
  expect(spanOf(file, thread("t2", [1], { annotationId: "a1" }), null).kind).toBe("mark");
  expect(spanOf(file, thread("t3", [1], { parentThreadId: "t1" }), null).kind).toBe("aside");
});

test("a span carries the stretch of time its messages cover", () => {
  const span = spanOf(
    { kind: "info-thread", fileKey: "info-2026-07-21" },
    thread("t1", [30, 10, 20]),
    "topic-1",
  );
  expect({ ...span }).toEqual({
    fileKey: "info-2026-07-21",
    threadId: "t1",
    kind: "info",
    firstTs: 10,
    lastTs: 30,
    messageCount: 3,
    topicId: "topic-1",
    desk: { on: "day", id: "2026-07-21" },
  });
});

test("a thread with no messages spans no time at all", () => {
  const span = spanOf({ kind: "conversation", fileKey: "door-2026-09-10" }, thread("t1", []), null);
  expect({ first: span.firstTs, last: span.lastTs, count: span.messageCount }).toEqual({
    first: 0,
    last: 0,
    count: 0,
  });
});

test("spans come out oldest first, and ties are broken by identity", () => {
  const at = (fileKey: string, threadId: string, lastTs: number): ConversationSpan => ({
    fileKey,
    threadId,
    kind: "book",
    firstTs: 0,
    lastTs,
    messageCount: 1,
    topicId: null,
    desk: { on: "book", id: fileKey },
  });
  const order = orderSpans([at("b", "t2", 5), at("a", "t1", 9), at("a", "t1", 5)]).map(
    (s) => `${s.fileKey}/${s.threadId}/${s.lastTs}`,
  );
  expect(order).toEqual(["a/t1/5", "b/t2/5", "a/t1/9"]);
});

test("every conversation file is walked, whatever kind it is", async () => {
  const disk = io({
    files: {
      "threads-abc123.json": [thread("t1", [10, 20], { book: true })],
      "threads-info-2026-07-21.json": [thread("t2", [30], { topicId: "topic-1" })],
      "conversation-2026-09-10.json": [thread("t3", [40])],
      "library.json": [],
      "topics.json": [],
    },
  });
  const seq = await rebuildSequence(disk);
  expect(seq.spans.map((s) => `${s.kind}:${s.threadId}`)).toEqual(["book:t1", "info:t2", "door:t3"]);
  expect(seq.spans.map((s) => s.topicId)).toEqual([null, "topic-1", null]);
  expect(Object.keys(seq.stamp).sort()).toEqual([
    "conversation-2026-09-10.json",
    "threads-abc123.json",
    "threads-info-2026-07-21.json",
  ]);
});

test("an index is stale when the files it was read off have moved on", async () => {
  const store: FakeStore = {
    files: { "threads-abc123.json": [thread("t1", [10])] },
    mtimes: { "threads-abc123.json": 100 },
  };
  const disk = io(store);
  const seq = await rebuildSequence(disk);
  expect(isStale(seq, await currentStamp(disk))).toBe(false);

  store.mtimes!["threads-abc123.json"] = 200;
  expect(isStale(seq, await currentStamp(disk))).toBe(true);

  store.mtimes!["threads-abc123.json"] = 100;
  store.files["conversation-2026-09-10.json"] = [thread("t2", [20])];
  expect(isStale(seq, await currentStamp(disk))).toBe(true);
});

test("an index from another version is stale whatever the files say", () => {
  const old: Sequence = { version: SEQUENCE_VERSION + 1, stamp: {}, spans: [] };
  expect(isStale(old, {})).toBe(true);
});

test("the index is written back once and read back rather than rebuilt", async () => {
  const store: FakeStore = { files: { "threads-abc123.json": [thread("t1", [10])] } };
  const disk = io(store);
  const first = await readSequence(disk);
  expect(disk.written[SEQUENCE_FILE]).toBeDefined();
  expect(first.spans).toHaveLength(1);

  // Nothing on disk has moved, so the second read is the cached bytes.
  delete store.files["threads-abc123.json"];
  store.files["threads-abc123.json"] = [thread("t1", [10])];
  const again = await readSequence(disk);
  expect(again.spans).toEqual(first.spans);
});

test("a cache that will not parse is rebuilt rather than believed", async () => {
  const store: FakeStore = {
    files: { "threads-abc123.json": [thread("t1", [10])] },
    texts: { [SEQUENCE_FILE]: "{ not json" },
  };
  const disk = io(store);
  const seq = await readSequence(disk);
  expect(seq.spans).toHaveLength(1);
});
