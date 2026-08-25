// The chapter list a deck is planned against (src/reading/slides/live.ts
// planMaterial), and that it is the same list the retell walked
// (src/reading/retell/skeleton.ts buildSkeleton).
//
// A retell qualifies for a deck when *any* of its materials has notes, but the
// plan stage reads every material. A second book with no notes therefore
// reached the planner with an empty chapter table, which then became the
// citable set validateDeckPlan checks the model's sourceChapters against — so
// every citation into that book was rejected as a chapter that does not exist,
// and the book silently contributed nothing to the deck.
//
// Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import { FIGURES_VERSION } from "../../../src/reading/figures/types";
import { CHAPTER_SPINE_VERSION } from "../../../src/reading/prep/chapters/types";
import { buildSkeleton } from "../../../src/reading/retell/skeleton";
import { planMaterial } from "../../../src/reading/slides/live";
import { citableWithOutline } from "../../../src/reading/slides/outline";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

let disk: FakeDisk;

const WITH_NOTES = "book-with-notes";
const NO_NOTES = "book-without-notes";

// A book whose text layer is on disk with a table of contents, and nothing else:
// no notes run has ever touched it.
function putFulltext(bookId: string) {
  disk.files.set(
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
  disk.files.set(
    `prep-${bookId}/chapters/state.json`,
    JSON.stringify({
      version: CHAPTER_SPINE_VERSION,
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
  disk.files.set(`prep-${bookId}/chapters/chapter-01.md`, "The first chapter argues that seeing is inference.");
  disk.files.set(`prep-${bookId}/chapters/chapter-02.md`, "The second chapter argues that belief follows.");
}

beforeEach(() => {
  disk = installAppData();
});

test("a book with notes is planned against its notes chapters", async () => {
  putFulltext(WITH_NOTES);
  putNotes(WITH_NOTES);
  disk.files.set(
    `figures-${WITH_NOTES}.json`,
    JSON.stringify({
      version: FIGURES_VERSION,
      status: "ok",
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

// The bug: the second book of a retell. It has a text layer and a table of
// contents, so the retell walked two real chapters of it; the planner used to
// see none, because it only ever looked at the notes state.
test("a book with no notes is planned against the same chapters the retell walked", async () => {
  putFulltext(NO_NOTES);
  const fulltext = JSON.parse(disk.files.get(`fulltext-${NO_NOTES}.json`)!);
  const skeleton = buildSkeleton({
    spineChapters: null,
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
test("the citable set for a retell's second book is not empty", async () => {
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
