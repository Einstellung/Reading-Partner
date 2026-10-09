// What a deleted book takes with it (src/reading/delete/pick.ts). Run: bun test.
//
// Two questions with an answer that is not "everything with this book's id on
// it": an observation a statement rests on, and a retell that also covers two
// other books.

import { expect, test } from "bun:test";
import {
  deadLocalPathsFor,
  observationIdsToDelete,
  retellIdsToDelete,
} from "../../../src/reading/delete/pick";
import type { Observation } from "../../../src/memory/observations/types";
import type { Statement } from "../../../src/memory/statements/types";
import type { Retell } from "../../../src/reading/retell/types";

const BOOK = "aaaa1111";
const OTHER = "bbbb2222";

function obs(id: string, bookId?: string): Observation {
  return {
    id,
    type: "belief",
    summary: id,
    body: "",
    created: "2026-09-01",
    updated: "2026-09-01",
    anchors: { annotationIds: [], messageIds: [] },
    ...(bookId ? { bookId } : {}),
  } as Observation;
}

function statement(evidence: string[], contradictedBy: string[] = []): Statement {
  return {
    id: "s-1",
    kind: "profile",
    text: "reads late",
    author: "dream",
    evidence,
    contradictedBy,
    established: "2026-09-01",
    lastSupported: "2026-09-01",
  } as Statement;
}

// --- observations ------------------------------------------------------------

test("only this book's observations go", () => {
  const observations = [obs("m-1", BOOK), obs("m-2", OTHER), obs("m-3")];
  expect(observationIdsToDelete(observations, [], BOOK)).toEqual(["m-1"]);
});

test("an observation a statement rests on stays", () => {
  const observations = [obs("m-1", BOOK), obs("m-2", BOOK), obs("m-3", BOOK)];
  const statements = [statement(["m-1"]), statement([], ["m-3"])];
  expect(observationIdsToDelete(observations, statements, BOOK)).toEqual(["m-2"]);
});

// --- retells -----------------------------------------------------------------

test("a retell of this book alone goes; one that spans another stays", () => {
  const retells = [
    { id: "r-only", materials: [{ bookId: BOOK, title: "A" }] },
    { id: "r-both", materials: [{ bookId: BOOK, title: "A" }, { bookId: OTHER, title: "B" }] },
    { id: "r-other", materials: [{ bookId: OTHER, title: "B" }] },
    { id: "r-empty", materials: [] },
  ] as Retell[];
  expect(retellIdsToDelete(retells, BOOK)).toEqual(["r-only"]);
});

// --- the files ---------------------------------------------------------------

test("the local paths cover the synced ones, the caches and the blob", () => {
  const { files, dirs } = deadLocalPathsFor(BOOK);
  // In the table's order (palace/kinds.ts): the paths are folded off it.
  expect(files).toEqual([
    `library/${BOOK}.pdf`,
    `library/${BOOK}.epub`,
    `annotations-${BOOK}.json`,
    // The list of what this book took in from its own conversation. The
    // supplements themselves are books and are deleted as books (delete-book.ts).
    `supplements-${BOOK}.json`,
    `threads-${BOOK}.json`,
    `fulltext-${BOOK}.json`,
    `pagination-${BOOK}.json`,
    `figures-${BOOK}.json`,
    // The cover, the author record beside it and the marker that says why there
    // is no cover: a deleted book must not be a picture on the next shelf, and
    // covers are filed under the book id, so re-importing the same PDF would
    // otherwise show the old one.
    `covers/${BOOK}.failed.json`,
    `covers/${BOOK}.jpg`,
    `covers/${BOOK}.json`,
  ]);
  // No trailing slash: this goes to a directory remove, not to a path matcher.
  expect(dirs).toEqual([`prep-${BOOK}`]);
});
