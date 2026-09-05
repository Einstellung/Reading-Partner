// What a deleted book takes with it (src/reading/delete/pick.ts). Run: bun test.
//
// Three questions with an answer that is not "everything with this book's id on
// it": an observation a statement rests on, a retell that also covers two other
// books, and a PDF the reader put in two topics.

import { expect, test } from "bun:test";
import {
  deadLocalPathsFor,
  isLastReferenceToBook,
  observationIdsToDelete,
  retellIdsToDelete,
} from "../../../src/reading/delete/pick";
import type { Observation } from "../../../src/memory/observations/types";
import type { Statement } from "../../../src/memory/statements/types";
import type { FileRef, Topic } from "../../../src/platform/app/topics";
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

// --- the last reference ------------------------------------------------------

const ref = (path: string, hash?: string): FileRef => ({ path, addedAt: 1, hash }) as FileRef;

function topic(id: string, files: FileRef[]): Topic {
  return { id, name: id, files, createdAt: 1 } as Topic;
}

test("the only topic holding the book is the last reference", () => {
  const file = ref("/books/a.pdf", BOOK);
  const topics = [topic("t1", [file]), topic("t2", [ref("/books/b.pdf", OTHER)])];
  expect(isLastReferenceToBook(topics, "t1", file)).toBe(true);
});

test("the same book in a second topic is not the last reference", () => {
  const file = ref("/books/a.pdf", BOOK);
  // A different path, because a FileRef is the file where the reader added it.
  const topics = [topic("t1", [file]), topic("t2", [ref("/elsewhere/a.pdf", BOOK)])];
  expect(isLastReferenceToBook(topics, "t1", file)).toBe(false);
});

test("a file with no book id yet is never the last reference", () => {
  const file = ref("/books/a.pdf");
  expect(isLastReferenceToBook([topic("t1", [file])], "t1", file)).toBe(false);
});

// --- the files ---------------------------------------------------------------

test("the local paths cover the synced ones, the caches and the blob", () => {
  const { files, dirs } = deadLocalPathsFor(BOOK);
  expect(files).toEqual([
    `annotations-${BOOK}.json`,
    `threads-${BOOK}.json`,
    `fulltext-${BOOK}.json`,
    `figures-${BOOK}.json`,
    `library/${BOOK}.pdf`,
  ]);
  // No trailing slash: this goes to a directory remove, not to a path matcher.
  expect(dirs).toEqual([`prep-${BOOK}`]);
});
