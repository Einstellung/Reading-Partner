// What reading gives distillation to read (docs/58): one unit per conversation,
// one per book's marks, and one per rehearsal transcript, all through the source
// table. The cursor is the sweep's, so what is proved here per source is that a
// unit is listed with the id its cursor is keyed by, and that a cursor already
// past it leaves nothing owed — which is what makes a second sweep over
// unchanged material cost nothing.
//
// Run: bun test tests/reading/distill-source.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  collectSourceArrears,
  type CursorReader,
} from "../../src/memory/distill/collect";
import { rebuildAnnotationStoreForTests } from "../../src/platform/app/annotations";
import { rebuildThreadStoreForTests } from "../../src/platform/app/threads";
import { registerReadingDistillSources } from "../../src/reading/distill/source";
import { installAppData, type FakeDisk } from "../support/appdata-fake";

const BOOK = "book-hash-1";

let disk: FakeDisk;
let undo: () => void = () => {};

beforeEach(() => {
  disk = installAppData();
  rebuildThreadStoreForTests();
  rebuildAnnotationStoreForTests();
  undo = registerReadingDistillSources();
});

afterEach(() => {
  undo();
});

function put(name: string, value: unknown): void {
  disk.files.set(name, JSON.stringify(value, null, 2));
}

function shelf(): void {
  put("topics.json", {
    topics: [
      {
        id: "t1",
        name: "investing",
        createdAt: 1,
        files: [{ path: "/books/a.pdf", name: "a.pdf", hash: BOOK, addedAt: 1 }],
      },
    ],
  });
}

function said(texts: string[], from = 1000): Record<string, unknown>[] {
  return texts.flatMap((text, i) => [
    { role: "user", text, ts: from + i * 2 },
    { role: "ai", text: `about ${text}`, ts: from + i * 2 + 1 },
  ]);
}

function threadFile(key: string, threads: Record<string, unknown>): void {
  put(`threads-${key}.json`, { threads });
}

function thread(id: string, texts: string[], over: Record<string, unknown> = {}) {
  return { id, annotationId: "", path: "", createdAt: 1000, messages: said(texts), ...over };
}

// Every cursor at zero, which is a topic nothing has ever been distilled for.
const fresh = (): CursorReader => ({ messages: () => 0, marks: () => null });

async function owed(cursors: CursorReader = fresh()) {
  const byTopic = await collectSourceArrears(() => cursors);
  return (byTopic.get("t1") ?? []).map((a) => [a.source, a.unit.id, a.owed] as const);
}

test("a book's conversation is a unit under its thread id, and a passed cursor owes nothing", async () => {
  shelf();
  threadFile(BOOK, { "thread-1": thread("thread-1", ["why owner earnings"]) });

  expect(await owed()).toEqual([["reading-thread", "thread-1", 1]]);
  // The same material read again with the cursor a finished pass would leave.
  expect(await owed({ messages: () => 2, marks: () => null })).toEqual([
    ["reading-thread", "thread-1", 0],
  ]);
});

test("an aside with no page is folded into the lesson, and owes through its own cursor", async () => {
  shelf();
  threadFile(BOOK, {
    lesson: thread("lesson", ["the lesson"], { book: true }),
    aside: thread("aside", ["the aside"], { parentThreadId: "lesson" }),
  });

  // One unit, the lesson's, and both threads' messages inside it.
  expect(await owed()).toEqual([["reading-thread", "lesson", 2]]);
  // The lesson's own cursor is past its half; the aside's is not.
  const owing = await owed({
    messages: (threadId: string) => (threadId === "lesson" ? 2 : 0),
    marks: () => null,
  });
  expect(owing).toEqual([["reading-thread", "lesson", 1]]);
});

test("a book's marks are a unit of their own, under the book id", async () => {
  shelf();
  put(`annotations-${BOOK}.json`, [
    { id: "m1", type: "highlight", text: "one", dateCreated: "2026-09-01T00:00:00.000Z" },
    { id: "m2", type: "highlight", text: "two", dateCreated: "2026-09-02T00:00:00.000Z" },
  ]);

  expect(await owed()).toEqual([["annotations", BOOK, 2]]);
  const after = await owed({
    messages: () => 0,
    marks: () => Date.parse("2026-09-01T00:00:00.000Z"),
  });
  expect(after).toEqual([["annotations", BOOK, 1]]);
});

test("a retell conversation is a unit, and carries the pass it wants run", async () => {
  put("retell-r1.json", {
    version: 1,
    id: "r1",
    name: "Debt cycles",
    topicId: "t1",
    materials: [{ bookId: BOOK, title: "a.pdf" }],
    createdAt: 1,
    updatedAt: 1,
    decisions: [],
  });
  threadFile("retell-r1", { "retell-thread-1": thread("retell-thread-1", ["chapter one is"]) });

  const byTopic = await collectSourceArrears(() => fresh());
  const [only] = byTopic.get("t1") ?? [];
  expect([only.source, only.unit.id, only.owed]).toEqual(["retell-thread", "retell-thread-1", 1]);
  expect(only.unit.cursor === "distilledMessages" && only.unit.retell).toEqual({
    retellId: "r1",
    retellName: "Debt cycles",
    materials: ["a.pdf"],
  });
  expect(await owed({ messages: () => 2, marks: () => null })).toEqual([
    ["retell-thread", "retell-thread-1", 0],
  ]);
});

test("a talk's conversation is a unit under the outline's topic", async () => {
  put("outline-o1.json", {
    version: 1,
    id: "o1",
    topicId: "t1",
    retellId: null,
    name: "Thirty minutes on debt",
    spine: { kind: "note" },
    segments: [],
    createdAt: 1,
    updatedAt: 1,
  });
  threadFile("talk-o1", { "talk-thread-1": thread("talk-thread-1", ["cut the second part"]) });

  expect(await owed()).toEqual([["talk-thread", "talk-thread-1", 1]]);
  expect(await owed({ messages: () => 2, marks: () => null })).toEqual([
    ["talk-thread", "talk-thread-1", 0],
  ]);
});

test("a rehearsal transcript is a unit under the run id, in the reader's own voice", async () => {
  put("rehearsal-h1.json", {
    version: 1,
    id: "h1",
    topicId: "t1",
    name: "Thirty minutes on debt",
    outlineId: "o1",
    retellId: null,
    createdAt: 1,
    updatedAt: 1,
  });
  put("runs-rehearsal-h1.json", {
    version: 1,
    rehearsalId: "h1",
    runs: [
      {
        id: "run-uuid-1",
        ordinal: 1,
        rehearsalId: "h1",
        startedAt: 1000,
        endedAt: 2000,
        lastMomentAt: 2000,
        segmentIds: [],
        spokenSegmentIds: [],
        wordsSpoken: 9,
        pages: [
          { index: 0, kind: "", title: "one", enteredAt: 1000, leftAt: 1500, transcript: "so the first thing" },
          { index: 1, kind: "", title: "two", enteredAt: 1500, leftAt: 2000, transcript: "and then the second" },
          { index: 2, kind: "", title: "three", enteredAt: 2000, leftAt: null, transcript: "   " },
        ],
      },
      // A pass the reader gave in silence leaves nothing to distil.
      {
        id: "run-uuid-2",
        ordinal: 2,
        rehearsalId: "h1",
        startedAt: 3000,
        endedAt: 4000,
        lastMomentAt: 4000,
        segmentIds: [],
        spokenSegmentIds: [],
        wordsSpoken: 0,
        pages: [],
      },
    ],
  });

  expect(await owed()).toEqual([["rehearsal-run", "run-uuid-1", 2]]);
  expect(await owed({ messages: () => 2, marks: () => null })).toEqual([
    ["rehearsal-run", "run-uuid-1", 0],
  ]);
});

test("a book listed on no topic is not swept, and a topic with nothing owes nothing", async () => {
  // No topics.json at all: the shelf is where a book's id comes from, so there
  // is nothing on disk for the conversations to be filed under.
  threadFile(BOOK, { "thread-1": thread("thread-1", ["why"]) });
  expect((await collectSourceArrears(() => fresh())).size).toBe(0);
});
