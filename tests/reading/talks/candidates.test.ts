// Starting a talk from a topic (src/reading/talks/candidates.ts): which of a
// topic's files are offered as material, and what a start records.
//
// Runs against one in-memory AppData, so the marks a candidate carries are read
// the way the app reads them and a file that will not parse fails the way a
// corrupt one does. The event log is the injected one — the real logger only
// writes under Tauri, so nothing would be observable otherwise.
//
// Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";
import type { EventPayload, EventType } from "../../../src/platform/app/events";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
import { pluginFsSurface } from "../../support/stub-surface";

const files = new Map<string, string>();
const blobs = new Map<string, Uint8Array>();

// The whole surface, for the reason store.test.ts gives: mock.module swaps the
// module out for the run, and a half-mocked plugin breaks whichever other file
// imports the rest.
mock.module("@tauri-apps/plugin-fs", () => ({
  ...pluginFsSurface(),
  BaseDirectory: { AppData: 1 },
  exists: async (p: string) => files.has(p) || blobs.has(p),
  mkdir: async () => {},
  readDir: async () => [...files.keys()].map((name) => ({ name, isFile: true, isDirectory: false })),
  readFile: async (p: string) => {
    const v = blobs.get(p);
    if (v === undefined) throw new Error("no file");
    return v;
  },
  stat: async () => {
    throw new Error("no file");
  },
  writeFile: async () => {},
  readTextFile: async (p: string) => {
    const v = files.get(p);
    if (v === undefined) throw new Error("no file");
    return v;
  },
  remove: async (p: string) => {
    files.delete(p);
  },
  writeTextFile: async (p: string, body: string) => {
    files.set(p, body);
  },
}));

// The rest of the module is the real one, imported after the plugin above so it
// links against this file's disk rather than the host. Dynamic, because a static
// import of anything under src/ from a test file pins the chain at the state it
// had when the file loaded, and every mock.module after that stops reaching it.
const realAtomicFs = await import("../../../src/platform/app/atomic-fs");
mock.module("../../../src/platform/app/atomic-fs", () => ({
  ...realAtomicFs,
  writeTextAtomic: async (path: string, contents: string) => {
    files.set(path, contents);
  },
  quarantineFile: async () => null,
  onCorruptFile: () => {},
  readGuardedJson: async (path: string, validate?: (raw: unknown) => unknown) => {
    const raw = files.get(path);
    if (raw === undefined) return { status: "missing" };
    try {
      const parsed = JSON.parse(raw);
      const value = validate ? validate(parsed) : parsed;
      return value === null ? { status: "corrupt", savedAs: null } : { status: "ok", value };
    } catch {
      return { status: "corrupt", savedAs: null };
    }
  },
}));

const { createTalk, talkCandidates } = await import("../../../src/reading/talks/candidates");

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
  files.set(
    `annotations-${bookId}.json`,
    JSON.stringify(
      Array.from({ length: count }, (_, i) => ({ id: `${bookId}-${i}`, text: "a mark" })),
    ),
  );
}

beforeEach(() => {
  files.clear();
  blobs.clear();
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
  files.set("annotations-cand-bad.json", "{ not json");
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
  const written = files.get(`talk-${talk.id}.json`);
  expect(written).toBeDefined();
  expect(JSON.parse(written as string)).toMatchObject({
    topicId: "topic-c",
    materials: [{ bookId: "cand-a", title: "Eye and Brain" }],
  });
});
