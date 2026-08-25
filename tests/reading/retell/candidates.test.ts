// Starting a talk from a topic (src/reading/retell/candidates.ts): which of a
// topic's files are offered as material, and what a start records.
//
// Runs against one in-memory AppData, so the marks a candidate carries are read
// the way the app reads them and a file that will not parse fails the way a
// corrupt one does. The event log is the injected one — the real logger only
// writes under Tauri, so nothing would be observable otherwise.
//
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import type { EventPayload, EventType } from "../../../src/platform/app/events";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
import { createTalk, talkCandidates } from "../../../src/reading/retell/candidates";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

// The library's naming rule is passed in; here it is one the assertions can see
// through.
const title = (name: string) => `<${name}>`;

const logged: { topicId: string; type: EventType; payload: EventPayload }[] = [];
const log = (topicId: string, type: EventType, payload: EventPayload = {}) => {
  logged.push({ topicId, type, payload });
};

function file(over: Partial<FileRef> & { name: string }): FileRef {
  return { path: `/books/${over.name}`, addedAt: 1, ...over };
}

function topic(fileRefs: FileRef[]): Topic {
  return { id: "topic-c", name: "Perception", createdAt: 1, files: fileRefs };
}

function marks(bookId: string, count: number): void {
  disk.files.set(
    `annotations-${bookId}.json`,
    JSON.stringify(
      Array.from({ length: count }, (_, i) => ({ id: `${bookId}-${i}`, text: "a mark" })),
    ),
  );
}

beforeEach(() => {
  disk = installAppData();
  logged.length = 0;
});

test("a file with no book id is not offered as material", async () => {
  marks("cand-a", 3);
  const candidates = await talkCandidates(
    topic([
      file({ name: "Eye and Brain.pdf", hash: "cand-a", addedAt: 2 }),
      file({ name: "Never opened.pdf", addedAt: 1 }),
    ]),
    title,
  );
  expect(candidates).toEqual([{ bookId: "cand-a", title: "<Eye and Brain.pdf>", marks: 3 }]);
});

test("a topic where nothing has a book id offers nothing", async () => {
  expect(await talkCandidates(topic([file({ name: "A.pdf" })]), title)).toEqual([]);
});

test("marks that will not read count as zero rather than taking the picker down", async () => {
  // A corrupt annotations file: loadAnnotations rethrows a genuine read error.
  disk.files.set("annotations-cand-bad.json", "{ not json");
  marks("cand-good", 2);
  const candidates = await talkCandidates(
    topic([
      file({ name: "Bad.pdf", hash: "cand-bad", addedAt: 2 }),
      file({ name: "Good.pdf", hash: "cand-good", addedAt: 1 }),
    ]),
    title,
  );
  expect(candidates.map((c) => [c.bookId, c.marks])).toEqual([
    ["cand-bad", 0],
    ["cand-good", 2],
  ]);
});

test("a book with no annotations file at all is offered with no marks", async () => {
  const candidates = await talkCandidates(
    topic([file({ name: "Fresh.pdf", hash: "cand-fresh" })]),
    title,
  );
  expect(candidates).toEqual([{ bookId: "cand-fresh", title: "<Fresh.pdf>", marks: 0 }]);
});

test("candidates come in the topic's order, most recently opened first", async () => {
  const candidates = await talkCandidates(
    topic([
      file({ name: "Old.pdf", hash: "cand-old", addedAt: 10 }),
      file({ name: "Recent.pdf", hash: "cand-recent", addedAt: 1, lastOpenedAt: 99 }),
    ]),
    title,
  );
  expect(candidates.map((c) => c.bookId)).toEqual(["cand-recent", "cand-old"]);
});

test("starting a talk logs one talk-start carrying how much material went in", async () => {
  const talk = await createTalk(
    "topic-c",
    [
      { bookId: "cand-a", title: "Eye and Brain" },
      { bookId: "cand-b", title: "Vision" },
    ],
    log,
  );
  expect(logged).toEqual([
    { topicId: "topic-c", type: "talk-start", payload: { talkId: talk.id, materials: 2 } },
  ]);
});

test("the started talk is on disk with the materials it was given", async () => {
  const talk = await createTalk("topic-c", [{ bookId: "cand-a", title: "Eye and Brain" }], log);
  const written = disk.files.get(`talk-${talk.id}.json`);
  expect(written).toBeDefined();
  expect(JSON.parse(written as string)).toMatchObject({
    topicId: "topic-c",
    materials: [{ bookId: "cand-a", title: "Eye and Brain" }],
  });
});
