// The soul's tail (src/soul/tail.ts, docs/61): the last thing the reader said
// anywhere, replayed in front of what the desk itself carries. Run: bun test.

import { expect, test } from "bun:test";
import {
  assembleTail,
  bookTitles,
  deskLabel,
  soulTail,
  TURN_KEEP,
  type ConversationSpan,
  type TailSpan,
} from "../../src/soul";
import { HISTORY_KEEP } from "../../src/reading/desk";
import type { ConversationIo } from "../../src/conversations";
import { threadFileName, type Thread } from "../../src/platform/app/threads";

// The tail and the item's span share one budget, and the number is the one the
// reading desk has always trimmed to. Held here because the two are declared
// apart: a capability may not import a domain.
test("a turn replays as many messages as it always did", () => {
  expect(TURN_KEEP).toBe(HISTORY_KEEP);
});

function span(over: Partial<ConversationSpan> = {}): ConversationSpan {
  return {
    fileKey: "info-2026-07-21",
    threadId: "t1",
    kind: "info",
    firstTs: 0,
    lastTs: 0,
    messageCount: 0,
    topicId: null,
    desk: { on: "day", id: "2026-07-21" },
    ...over,
  };
}

function stretch(s: ConversationSpan, label: string, msgs: [string, number][]): TailSpan {
  return {
    span: s,
    label,
    messages: msgs.map(([text, ts], i) => ({
      id: `${s.threadId}-${i}`,
      role: i % 2 === 0 ? ("user" as const) : ("ai" as const),
      text,
      ts,
    })),
  };
}

test("what was on the desk is one line, and a book off the shelf is named by nothing", () => {
  const titles = new Map([["abc123", "Attention Is All You Need"]]);
  expect(deskLabel(span({ desk: { on: "book", id: "abc123" } }), titles)).toBe(
    "over the book: Attention Is All You Need",
  );
  expect(deskLabel(span({ desk: { on: "book", id: "gone" } }), titles)).toBe("over a book");
  expect(deskLabel(span({ desk: { on: "day", id: "2026-07-21" } }), titles)).toBe(
    "over the briefing of 2026-07-21",
  );
  expect(deskLabel(span({ desk: { on: "none", id: "" } }), titles)).toBe("at the door");
});

test("each stretch opens with the line that says where it was said, and only its first message", () => {
  const a = span({ threadId: "t1" });
  const b = span({ threadId: "t2", fileKey: "door-2026-09-10", desk: { on: "none", id: "" } });
  const out = assembleTail(
    [
      stretch(a, "over the briefing of 2026-07-21", [
        ["the debt cycle", 10],
        ["say more", 20],
      ]),
      stretch(b, "at the door", [["I have ten minutes", 30]]),
    ],
    TURN_KEEP,
  );
  expect(out.map((m) => m.text)).toEqual([
    "[over the briefing of 2026-07-21]\nthe debt cycle",
    "say more",
    "[at the door]\nI have ten minutes",
  ]);
  expect(out.map((m) => m.role)).toEqual(["user", "ai", "user"]);
});

test("messages come out in time order however the stretches were listed", () => {
  const a = span({ threadId: "t1" });
  const b = span({ threadId: "t2" });
  const out = assembleTail(
    [stretch(a, "A", [["late", 90]]), stretch(b, "B", [["early", 10]])],
    TURN_KEEP,
  );
  expect(out.map((m) => m.text)).toEqual(["[B]\nearly", "[A]\nlate"]);
});

test("the same message twice is replayed once", () => {
  const a = span({ threadId: "t1" });
  const twice = stretch(a, "A", [["once", 10]]);
  const out = assembleTail([twice, twice], TURN_KEEP);
  expect(out).toHaveLength(1);
});

test("a tail longer than its budget loses the oldest, and never opens on a reply", () => {
  const a = span({ threadId: "t1" });
  const out = assembleTail(
    [
      stretch(a, "A", [
        ["one", 10],
        ["two", 20],
        ["three", 30],
        ["four", 40],
      ]),
    ],
    3,
  );
  // Three would leave "two" (a reply) at the front, so the tail opens one later.
  expect(out.map((m) => m.text)).toEqual(["[A]\nthree", "four"]);
});

test("no budget is no tail", () => {
  expect(assembleTail([stretch(span(), "A", [["x", 1]])], 0)).toEqual([]);
});

// --- off the store ---------------------------------------------------------

function thread(id: string, texts: string[]): Thread {
  return {
    id,
    annotationId: "",
    path: "",
    createdAt: 0,
    messages: texts.map((text, i) => ({
      id: `${id}-${i}`,
      role: i % 2 === 0 ? "user" : "ai",
      text,
      ts: (i + 1) * 10,
    })),
  } as Thread;
}

function io(files: Record<string, Thread[]>, texts: Record<string, string> = {}): ConversationIo {
  return {
    listRoot: async () => Object.keys(files),
    readText: async (path) => texts[path] ?? null,
    peekThreads: async (fileKey) => files[threadFileName(fileKey)] ?? [],
  };
}

test("the conversation the turn is being held in is never part of its own tail", async () => {
  const here = span({ fileKey: "door-2026-09-10", threadId: "mine", lastTs: 99, messageCount: 2 });
  const there = span({ fileKey: "info-2026-07-21", threadId: "t1", lastTs: 50, messageCount: 1 });
  const out = await soulTail({
    spans: [there, here],
    exclude: { fileKey: "door-2026-09-10", threadId: "mine" },
    keep: TURN_KEEP,
    io: io({
      "conversation-2026-09-10.json": [thread("mine", ["mine one", "mine two"])],
      "threads-info-2026-07-21.json": [thread("t1", ["theirs"])],
    }),
  });
  expect(out.map((m) => m.text)).toEqual(["[over the briefing of 2026-07-21]\ntheirs"]);
});

test("a book's title is read off the shelf's own file", async () => {
  const titles = await bookTitles(
    io({}, { "library.json": JSON.stringify({ books: { abc123: { title: "Principles" } } }) }),
  );
  expect(titles.get("abc123")).toBe("Principles");
  expect(await bookTitles(io({}, { "library.json": "{ not json" }))).toEqual(new Map());
  expect(await bookTitles(io({}))).toEqual(new Map());
});

test("a span the store no longer holds contributes nothing", async () => {
  const out = await soulTail({
    spans: [span({ fileKey: "info-2026-07-21", threadId: "gone", lastTs: 10, messageCount: 2 })],
    exclude: { fileKey: "door-2026-09-10", threadId: "mine" },
    keep: TURN_KEEP,
    io: io({ "threads-info-2026-07-21.json": [] }),
  });
  expect(out).toEqual([]);
});
