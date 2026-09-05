// The order deleting a book goes in (src/reading/delete/delete-book.ts).
// Run: bun test.
//
// Two things are worth pinning. The tombstone is first, because it is what makes
// the deletion travel and what keeps the remote from pushing the files back in
// (docs/50, pitfall 208) — everything after it is allowed to be a retry. And the
// second half is best-effort: a transcript that will not unlink must not leave
// the book on the shelf, so a failure in the retells or the files does not undo
// the tombstone, the registry, the topics or the observations.

import { expect, test } from "bun:test";
import {
  deleteBook,
  type DeleteBookDeps,
} from "../../../src/reading/delete/delete-book";
import type { Observation } from "../../../src/memory/observations/types";
import type { Statement } from "../../../src/memory/statements/types";
import type { Topic } from "../../../src/platform/app/topics";
import type { Retell } from "../../../src/reading/retell/types";

const BOOK = "aaaa1111";
const OTHER = "bbbb2222";

const TOPICS = [
  {
    id: "t1",
    name: "attention",
    files: [
      { path: "/books/a.pdf", addedAt: 1, hash: BOOK },
      { path: "/books/b.pdf", addedAt: 2, hash: OTHER },
    ],
  },
  { id: "t2", name: "compilers", files: [{ path: "/shared/a.pdf", addedAt: 3, hash: BOOK }] },
] as Topic[];

const OBSERVATIONS: Record<string, Observation[]> = {
  t1: [
    { id: "m-1", bookId: BOOK } as Observation,
    { id: "m-2", bookId: BOOK } as Observation,
    { id: "m-3", bookId: OTHER } as Observation,
  ],
  t2: [{ id: "m-4", bookId: BOOK } as Observation],
};

const STATEMENTS = [
  { id: "s-1", evidence: ["m-2"], contradictedBy: [] } as unknown as Statement,
];

const RETELLS = [
  { id: "r-1", materials: [{ bookId: BOOK, title: "A" }] },
  { id: "r-2", materials: [{ bookId: OTHER, title: "B" }] },
] as Retell[];

interface Log {
  calls: string[];
}

function deps(log: Log, over: Partial<DeleteBookDeps> = {}): DeleteBookDeps {
  const note =
    (name: string) =>
    async (...args: string[]): Promise<void> => {
      log.calls.push([name, ...args].join(" "));
    };
  return {
    tombstone: note("tombstone"),
    removeLibraryEntry: note("library"),
    removeViewState: note("position"),
    listTopics: async () => TOPICS,
    unlinkFile: async (topicId, path) => {
      log.calls.push(`unlink ${topicId} ${path}`);
    },
    listObservations: async (topicId) => OBSERVATIONS[topicId] ?? [],
    deleteObservation: async (topicId, id) => {
      log.calls.push(`observation ${topicId} ${id}`);
    },
    listStatements: async () => STATEMENTS,
    listRetells: async () => RETELLS,
    deleteRetell: note("retell"),
    outlineIdOfRetell: async (retellId) => (retellId === "r-1" ? "o-1" : null),
    deleteTalkOutline: note("outline"),
    removeFile: note("file"),
    removeDir: note("dir"),
    ...over,
  };
}

test("the whole order, once, from the tombstone down to the files", async () => {
  const log: Log = { calls: [] };
  await deleteBook(BOOK, deps(log));
  expect(log.calls).toEqual([
    "tombstone " + BOOK,
    "library " + BOOK,
    "position " + BOOK,
    "unlink t1 /books/a.pdf",
    "unlink t2 /shared/a.pdf",
    // m-2 is a statement's evidence and stays; m-3 is another book's.
    "observation t1 m-1",
    "observation t2 m-4",
    // The talk goes before the retell it came out of, which is how it is found.
    "outline o-1",
    "retell r-1",
    `file annotations-${BOOK}.json`,
    `file threads-${BOOK}.json`,
    `file fulltext-${BOOK}.json`,
    `file figures-${BOOK}.json`,
    `file library/${BOOK}.pdf`,
    `dir prep-${BOOK}`,
  ]);
});

test("a retell that will not delete leaves the record deletions standing", async () => {
  const log: Log = { calls: [] };
  await deleteBook(
    BOOK,
    deps(log, {
      deleteRetell: async () => {
        throw new Error("disk full");
      },
    }),
  );
  expect(log.calls.slice(0, 3)).toEqual(["tombstone " + BOOK, "library " + BOOK, "position " + BOOK]);
  expect(log.calls).toContain("unlink t2 /shared/a.pdf");
  expect(log.calls).toContain("observation t1 m-1");
  // And the files after it still go.
  expect(log.calls).toContain(`file library/${BOOK}.pdf`);
});

test("a file that will not delete does not stop the ones after it", async () => {
  const log: Log = { calls: [] };
  await deleteBook(
    BOOK,
    deps(log, {
      removeFile: async (path) => {
        if (path === `threads-${BOOK}.json`) throw new Error("locked");
        log.calls.push(`file ${path}`);
      },
    }),
  );
  expect(log.calls).toContain(`file library/${BOOK}.pdf`);
  expect(log.calls).toContain(`dir prep-${BOOK}`);
});

test("a shelf that cannot be rewritten stops the delete before anything else", async () => {
  const log: Log = { calls: [] };
  await expect(
    deleteBook(
      BOOK,
      deps(log, {
        removeLibraryEntry: async () => {
          throw new Error("library.json could not be read");
        },
      }),
    ),
  ).rejects.toThrow("library.json");
  // The tombstone is already down, so the next attempt — or the next pass on
  // any device — finishes what this one started.
  expect(log.calls).toEqual(["tombstone " + BOOK]);
});
