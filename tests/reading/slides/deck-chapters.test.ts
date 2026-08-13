// The chapter list a deck is planned against (src/reading/slides/live.ts
// planMaterial), and that it is the same list the rehearsal walked
// (src/reading/rehearsal/skeleton.ts buildSkeleton).
//
// A talk qualifies for a deck when *any* of its materials has notes, but the
// plan stage reads every material. A second book with no notes therefore
// reached the planner with an empty chapter table, which then became the
// citable set validateDeckPlan checks the model's sourceChapters against — so
// every citation into that book was rejected as a chapter that does not exist,
// and the book silently contributed nothing to the deck.
//
// Run: bun test.

import { beforeEach, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
const blobs = new Map<string, Uint8Array>();

mock.module("@tauri-apps/plugin-fs", () => ({
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

// The stores write through the Rust atomic writer, not the fs plugin, and read
// JSON back through readGuardedJson. mock.module replaces the module for every
// file in the run, so the whole surface has to be here.
mock.module("../../../src/platform/app/atomic-fs", () => ({
  APPDATA: { baseDir: 1 },
  readJson: async (path: string) => {
    const raw = files.get(path);
    return raw === undefined ? null : JSON.parse(raw);
  },
  readJsonOr: async (path: string, fallback: unknown) => {
    const raw = files.get(path);
    return raw === undefined ? fallback : JSON.parse(raw);
  },
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

const { planMaterial } = await import("../../../src/reading/slides/live");
const { buildSkeleton } = await import("../../../src/reading/rehearsal/skeleton");
const { citableWithOutline } = await import("../../../src/reading/slides/outline");

const WITH_NOTES = "book-with-notes";
const NO_NOTES = "book-without-notes";

// A book whose text layer is on disk with a table of contents, and nothing else:
// no notes run has ever touched it.
function putFulltext(bookId: string) {
  files.set(
    `fulltext-${bookId}.json`,
    JSON.stringify({
      version: 1,
      status: "ok",
      pages: Array.from({ length: 8 }, (_, i) => `Page ${i + 1}.`),
      outline: [
        { title: "Seeing", page: 1, level: 0 },
        { title: "Believing", page: 5, level: 0 },
      ],
    }),
  );
}

function putNotes(bookId: string) {
  files.set(
    `notes-${bookId}/state.json`,
    JSON.stringify({
      version: 1,
      bookId,
      bookName: "Eye and Brain",
      createdAt: 1,
      planStatus: "done",
      chapters: [
        { index: 1, title: "One", startPage: 1, endPage: 4, status: "done" },
        { index: 2, title: "Two", startPage: 5, endPage: 8, status: "done" },
      ],
      overviewStatus: "done",
    }),
  );
  files.set(`notes-${bookId}/chapter-01.md`, "The first chapter argues that seeing is inference.");
  files.set(`notes-${bookId}/chapter-02.md`, "The second chapter argues that belief follows.");
}

beforeEach(() => {
  files.clear();
  blobs.clear();
});

test("a book with notes is planned against its notes chapters", async () => {
  putFulltext(WITH_NOTES);
  putNotes(WITH_NOTES);
  files.set(
    `figures-${WITH_NOTES}.json`,
    JSON.stringify({
      version: 2,
      figures: [{ id: "3", page: 2, caption: "Ganglion density", bbox: null }],
    }),
  );
  const book = await planMaterial(WITH_NOTES);
  // The figures the plan may cite come off disk with the rest of the material.
  expect(book.figures).toEqual([{ id: "3", caption: "Ganglion density" }]);
  expect(book.chapters.map((c) => [c.index, c.title, c.hasNote])).toEqual([
    [1, "One", true],
    [2, "Two", true],
  ]);
  expect(book.chapters[0].digest).toContain("seeing is inference");
});

// The bug: the second book of a talk. It has a text layer and a table of
// contents, so the rehearsal walked two real chapters of it; the planner used to
// see none, because it only ever looked at the notes state.
test("a book with no notes is planned against the same chapters the rehearsal walked", async () => {
  putFulltext(NO_NOTES);
  const fulltext = JSON.parse(files.get(`fulltext-${NO_NOTES}.json`)!);
  const skeleton = buildSkeleton({
    notesChapters: null,
    outline: fulltext.outline,
    pageCount: fulltext.pages.length,
  });
  expect(skeleton.chapters.length).toBe(2);

  const book = await planMaterial(NO_NOTES);
  // The table of contents, spelled out rather than only compared against the
  // skeleton: both sides run through buildSkeleton now, so an equality on its
  // own would survive that function returning anything at all.
  expect(book.chapters.map((c) => [c.index, c.title, c.startPage, c.endPage])).toEqual([
    [1, "Seeing", 1, 4],
    [2, "Believing", 5, 8],
  ]);
  expect(book.chapters.map((c) => [c.index, c.title, c.startPage, c.endPage])).toEqual(
    skeleton.chapters.map((c) => [c.index, c.title, c.startPage, c.endPage]),
  );
  // No note was ever written, so nothing claims one is there to distil from.
  expect(book.chapters.every((c) => c.hasNote === false)).toBe(true);
});

// What the empty table cost: with nothing citable, every sourceChapters the
// model returned for that book was a chapter that does not exist.
test("the citable set for a talk's second book is not empty", async () => {
  putFulltext(WITH_NOTES);
  putNotes(WITH_NOTES);
  putFulltext(NO_NOTES);
  const books = await Promise.all([planMaterial(WITH_NOTES), planMaterial(NO_NOTES)]);
  const citable = citableWithOutline(books, null);
  expect(citable.map((b) => b.chapters.map((c) => c.index))).toEqual([
    [1, 2],
    [1, 2],
  ]);
});
