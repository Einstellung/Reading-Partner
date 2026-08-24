// The talk's two disk paths against one in-memory AppData; they share a file, so
// they share the disk.
//
//   store.ts    — the talk file: the round trip, the listing that is the
//                 directory rather than a registry, the read-modify-write that
//                 merges one decision in, and what an unreadable file does.
//   material.ts — a talk's materials, assembled from what is already on disk
//                 under each book's content hash, with no reader and no engine.
//
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { FIGURES_VERSION } from "../../../src/reading/figures/types";
import { CHAPTER_SPINE_VERSION } from "../../../src/reading/prep/chapters/types";
import {
  loadMaterial,
  loadMaterials,
  readMaterialBytes,
} from "../../../src/reading/talks/material";
import {
  deleteTalk,
  listTalksForTopic,
  loadTalk,
  recordTalkDecision,
  startTalk,
  talkFile,
  talkIdOf,
  talkThreadKey,
  updateTalk,
} from "../../../src/reading/talks/store";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

const MATERIALS = [{ bookId: "book-hash", title: "Eye and Brain" }];

function decision(chapter: number, points: string[], updatedAt: number) {
  return {
    bookId: "book-hash",
    chapter,
    title: `Chapter ${chapter}`,
    include: true,
    points,
    updatedAt,
  };
}

beforeEach(() => {
  disk = installAppData();
});

const BOOK = "book-hash";

function library(entries: Record<string, string>) {
  disk.files.set(
    "library.json",
    JSON.stringify({
      books: Object.fromEntries(
        Object.entries(entries).map(([hash, title]) => [hash, { hash, title, addedAt: 1 }]),
      ),
    }),
  );
}

test("a talk id that has never been started reads as absent, not as an error", async () => {
  expect(await loadTalk("nope")).toBeNull();
});

test("starting a talk writes it under its own id and names it after its material", async () => {
  const talk = await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 1_700 });
  expect(talk.id).toBe("1700");
  expect(talk.name).toBe("Eye and Brain");
  expect(disk.files.has(talkFile("1700"))).toBe(true);
  expect((await loadTalk("1700"))?.topicId).toBe("topic-1");
});

// The id is also the deck's directory name (slides/<talkId>/), so two talks
// cannot share one.
test("two talks started in the same millisecond get different ids", async () => {
  const first = await startTalk({ topicId: "t", materials: MATERIALS, now: 1_700 });
  const second = await startTalk({ topicId: "t", materials: MATERIALS, now: 1_700 });
  expect(second.id).not.toBe(first.id);
});

test("the list is the directory, newest first, and scoped to one topic", async () => {
  await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 100 });
  await startTalk({ topicId: "topic-2", materials: MATERIALS, now: 200 });
  await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 300 });
  expect((await listTalksForTopic("topic-1")).map((t) => t.id)).toEqual(["300", "100"]);
});

// The conversation is a thread file keyed by the talk; its name must not be
// mistaken for a talk file by the listing.
test("the conversation file is not mistaken for a talk", async () => {
  await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 100 });
  disk.files.set(`threads-${talkThreadKey("100")}.json`, "{}");
  expect((await listTalksForTopic("topic-1")).map((t) => t.id)).toEqual(["100"]);
  expect(talkIdOf("threads-talk-100.json")).toBeNull();
  expect(talkIdOf("talk-100.json")).toBe("100");
  expect(talkIdOf("talks.json")).toBeNull();
});

test("a decision is merged into the talk and the file says so", async () => {
  const talk = await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 10 });
  await recordTalkDecision(talk.id, decision(2, ["b"], 20));
  await recordTalkDecision(talk.id, decision(1, ["a"], 30));
  const stored = await loadTalk(talk.id);
  expect(stored?.decisions.map((d) => d.chapter)).toEqual([2, 1]);
  expect(stored?.updatedAt).toBe(30);
});

test("recording a chapter twice replaces its decision, in place", async () => {
  const talk = await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 10 });
  await recordTalkDecision(talk.id, decision(1, ["first take"], 20));
  await recordTalkDecision(talk.id, decision(2, ["other chapter"], 21));
  await recordTalkDecision(talk.id, decision(1, ["second take"], 22));
  const stored = await loadTalk(talk.id);
  expect(stored?.decisions).toHaveLength(2);
  expect(stored?.decisions[0].points).toEqual(["second take"]);
});

// A turn still running when the talk is deleted must not write the file back.
test("a decision for a talk that is gone is dropped, not resurrected", async () => {
  const talk = await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 10 });
  await deleteTalk(talk.id);
  expect(await recordTalkDecision(talk.id, decision(1, ["a"], 20))).toBeNull();
  expect(disk.files.has(talkFile(talk.id))).toBe(false);
});

test("an edit reads, patches and writes back", async () => {
  const talk = await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 10 });
  await updateTalk(talk.id, (t) => ({ ...t, name: "Renamed" }), 99);
  const stored = await loadTalk(talk.id);
  expect(stored?.name).toBe("Renamed");
  expect(stored?.updatedAt).toBe(99);
});

test("a file this build cannot read is absent, not a crash", async () => {
  disk.files.set(talkFile("x"), JSON.stringify({ version: 99, id: "x" }));
  expect(await loadTalk("x")).toBeNull();
  disk.files.set(talkFile("x"), "{not json");
  expect(await loadTalk("x")).toBeNull();
});

// A file this build's version knows may still hold an entry written by a shorter
// lived shape. The entry goes, the talk stays: a lost decision is re-made in one
// exchange, an unopenable talk is not.
test("a decision the file cannot use is dropped, not thrown", async () => {
  disk.files.set(
    talkFile("x"),
    JSON.stringify({
      version: 1,
      id: "x",
      name: "A talk",
      topicId: "topic-1",
      materials: MATERIALS,
      createdAt: 1,
      updatedAt: 5,
      decisions: [
        { bookId: BOOK, chapter: 2, title: "Two", include: true, points: ["a", 3], updatedAt: 5 },
        { bookId: BOOK, chapter: "nope", title: "x", include: true, points: [], updatedAt: 5 },
        { chapter: 4, title: "no book", include: true, points: [], updatedAt: 5 },
        { bookId: BOOK, chapter: 2, title: "duplicate", include: false, points: [], updatedAt: 6 },
        { bookId: BOOK, chapter: 1, title: "One", include: false, points: [], updatedAt: 4 },
      ],
    }),
  );
  const talk = await loadTalk("x");
  expect(talk?.decisions.map((d) => d.chapter)).toEqual([2, 1]);
  expect(talk?.decisions[0].points).toEqual(["a"]);
  expect(talk?.decisions[0].title).toBe("Two");
});

// The rehearsal-<bookId>.json this replaced was written for hours; a leftover
// must not take the topic's list down with it.
test("one unreadable file does not stop the rest of the list", async () => {
  await startTalk({ topicId: "topic-1", materials: MATERIALS, now: 100 });
  disk.files.set(talkFile("broken"), "{not json");
  disk.files.set("rehearsal-book-hash.json", JSON.stringify({ version: 1, decisions: [] }));
  expect((await listTalksForTopic("topic-1")).map((t) => t.id)).toEqual(["100"]);
});

// --- a talk's materials, read off disk (material.ts) ---

test("a book with nothing on disk still becomes a material", async () => {
  const m = await loadMaterial({ bookId: "unknown", title: "From the talk file" });
  // The stored title is the fallback when the library has no entry.
  expect(m.title).toBe("From the talk file");
  expect(m.fulltext).toBeNull();
  expect(m.annotations).toEqual([]);
  expect(m.figures).toEqual([]);
  // One stretch rather than no skeleton at all.
  expect(m.skeleton.source).toBe("whole-book");
  expect(m.skeleton.chapters).toHaveLength(1);
});

test("the skeleton comes from the notes plan the reader's notes pass wrote", async () => {
  library({ [BOOK]: "Eye and Brain" });
  disk.files.set(
    `fulltext-${BOOK}.json`,
    JSON.stringify({ version: 1, status: "ok", pages: ["a", "b", "c"], outline: [] }),
  );
  disk.files.set(
    `prep-${BOOK}/chapters/state.json`,
    JSON.stringify({
      version: CHAPTER_SPINE_VERSION,
      chapters: [
        { index: 1, title: "Openings", startPage: 1, endPage: 2, status: "done" },
        { index: 2, title: "Endings", startPage: 3, endPage: 3, status: "pending" },
      ],
    }),
  );
  const m = await loadMaterial({ bookId: BOOK, title: "stale.pdf" });
  expect(m.title).toBe("Eye and Brain");
  expect(m.skeleton.source).toBe("notes-plan");
  expect(m.skeleton.chapters.map((c) => c.hasNote)).toEqual([true, false]);
});

test("with no notes plan the book's own table of contents does", async () => {
  disk.files.set(
    `fulltext-${BOOK}.json`,
    JSON.stringify({
      version: 1,
      status: "ok",
      pages: ["a", "b", "c", "d"],
      outline: [
        { title: "One", page: 1, level: 0 },
        { title: "Two", page: 3, level: 0 },
      ],
    }),
  );
  const m = await loadMaterial({ bookId: BOOK, title: "x" });
  expect(m.skeleton.source).toBe("outline");
  expect(m.skeleton.chapters.map((c) => c.title)).toEqual(["One", "Two"]);
});

test("marks arrive flattened, and the ones that point at nothing are dropped", async () => {
  disk.files.set(
    `annotations-${BOOK}.json`,
    JSON.stringify([
      { id: "a", text: "the claim", position: { pageIndex: 0 } },
      { id: "b", comment: "does this follow?", position: { pageIndex: 2 } },
      // Neither text nor comment: evidence of nothing.
      { id: "c", position: { pageIndex: 1 } },
    ]),
  );
  const m = await loadMaterial({ bookId: BOOK, title: "x" });
  expect(m.annotations).toEqual([
    { page: 1, text: "the claim", comment: "" },
    { page: 3, text: "", comment: "does this follow?" },
  ]);
});

test("the figure index comes off disk too, with no engine", async () => {
  disk.files.set(
    `figures-${BOOK}.json`,
    JSON.stringify({
      version: FIGURES_VERSION,
      status: "ok",
      figures: [{ id: "3", page: 2, caption: "Ganglion density", bbox: null }],
    }),
  );
  const m = await loadMaterial({ bookId: BOOK, title: "x" });
  expect(m.figures.map((f) => f.id)).toEqual(["3"]);
});

test("several materials load together", async () => {
  const loaded = await loadMaterials([
    { bookId: BOOK, title: "a" },
    { bookId: "other", title: "b" },
  ]);
  expect(loaded.map((m) => m.bookId)).toEqual([BOOK, "other"]);
});

// Only view_figure and a figure card ever ask for this, so a hundred megabytes
// is never read to assemble a prompt.
test("the book's bytes come from the library copy, on request", async () => {
  disk.blobs.set(`library/${BOOK}.pdf`, new Uint8Array([1, 2, 3]));
  expect((await readMaterialBytes(BOOK))?.byteLength).toBe(3);
  expect(await readMaterialBytes("missing")).toBeNull();
});
