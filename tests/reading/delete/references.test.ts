// Reference counting before a delete (docs/50 「引用计数」), and the files that
// are found through something else before they go: a thread's images, a prep's
// paper caches.

import { expect, test } from "bun:test";
import {
  deleteBook,
  deleteIfUnreferenced,
  isLastReference,
  listFilesOnlyInTopic,
  removeFromTopic,
  type DeleteBookDeps,
} from "../../../src/reading/delete/delete-book";
import { deleteTopic, type DeleteTopicDeps } from "../../../src/reading/delete/delete-topic";
import {
  filesOnlyInTopic,
  hasOtherReference,
  isLastReferenceToBook,
  orphanedTogether,
} from "../../../src/reading/delete/pick";
import type { Topic } from "../../../src/platform/app/topics";

const X = "xxxx0000";
const Y = "yyyy1111";
const Z = "zzzz2222";
const S = "ssss3333";

// A little world: topics and supplement lists that the fake deps edit, so a
// later step reads what an earlier one left.
function world(topics: Topic[], lists: Record<string, string[]>) {
  const tombstoned: string[] = [];
  const removed: string[] = [];
  const deps: DeleteBookDeps = {
    tombstone: async (id) => void tombstoned.push(id),
    removeLibraryEntry: async () => {},
    removeViewState: async () => {},
    listTopics: async () => topics.map((t) => ({ ...t, files: [...t.files] })),
    unlinkFile: async (topicId, path) => {
      const t = topics.find((x) => x.id === topicId)!;
      t.files = t.files.filter((f) => f.path !== path);
    },
    listObservations: async () => [],
    deleteObservations: async () => {},
    listStatements: async () => [],
    listSupplements: async (bookId) =>
      (lists[bookId] ?? []).map((hash) => ({ hash, title: hash, addedAt: 1 })),
    listSupplementLists: async () =>
      Object.entries(lists).map(([bookId, hashes]) => ({
        bookId,
        items: hashes.map((hash) => ({ hash })),
      })),
    listRetells: async () => [],
    deleteRetell: async () => {},
    outlineIdOfRetell: async () => null,
    deleteTalkOutline: async () => {},
    removeFile: async (p) => {
      removed.push(p);
      const m = /^supplements-(.+)\.json$/.exec(p);
      if (m) delete lists[m[1]];
    },
    removeDir: async (p) => void removed.push(p),
    threadIdsOf: async (id) => (id === Y ? ["th-1", "th-2"] : []),
    removeThreadImages: async (id) => void removed.push(`images/threads/${id}`),
    prepCacheFiles: async (id) => (id === Y ? ["fulltext-k1.json", "figures-k1.json"] : []),
  };
  return { deps, tombstoned, removed, topics, lists };
}

const topic = (id: string, files: Array<[string, string]>): Topic =>
  ({ id, name: id, files: files.map(([path, hash], i) => ({ path, hash, addedAt: i })) }) as Topic;

test("two books with the same supplement: deleting one keeps the supplement", async () => {
  const w = world([topic("t", [["a", Y], ["b", Z]])], { [Y]: [S], [Z]: [S] });
  await deleteBook(Y, w.deps);
  expect(w.tombstoned).toEqual([Y]);
  expect(w.removed).not.toContain(`library/${S}.pdf`);
  // Deleting the second one takes it, because nothing else lists it now.
  await deleteBook(Z, w.deps);
  expect(w.tombstoned).toEqual([Y, Z, S]);
});

test("an article on a shelf and a supplement of a book survives either going", async () => {
  const w = world([topic("t", [["x", X], ["y", Y]])], { [Y]: [X] });
  // Taken off the shelf: still Y's supplement, so only the link goes.
  expect(await removeFromTopic("t", { path: "x", hash: X, addedAt: 0 } as never, w.deps)).toBe(false);
  expect(w.tombstoned).toEqual([]);
  expect(w.topics[0].files.map((f) => f.hash)).toEqual([Y]);

  // Put back on the shelf, then removed from Y's supplements (desk.ts removes
  // the row and asks): the shelf still has it.
  w.topics[0].files.push({ path: "x", hash: X, addedAt: 9 } as never);
  w.lists[Y] = [];
  expect(await deleteIfUnreferenced(X, w.deps)).toBe(false);

  // Y deleted with X back in its list and on the shelf: X stays.
  w.lists[Y] = [X];
  await deleteBook(Y, w.deps);
  expect(w.tombstoned).toEqual([Y]);

  // The last reference: off the shelf, nothing lists it, it goes.
  expect(await removeFromTopic("t", { path: "x", hash: X, addedAt: 9 } as never, w.deps)).toBe(true);
  expect(w.tombstoned).toEqual([Y, X]);
});

test("the confirmation counts supplement lists too", async () => {
  const topics = [topic("t", [["x", X]])];
  const file = topics[0].files[0];
  expect(isLastReferenceToBook(topics, "t", file)).toBe(true);
  expect(isLastReferenceToBook(topics, "t", file, [{ bookId: Y, items: [{ hash: X }] }])).toBe(false);
  const w = world(topics, { [Y]: [X] });
  expect(await isLastReference(topics, "t", file, w.deps)).toBe(false);
  // A book listing itself, and the books the sweep is deleting, keep nothing.
  expect(hasOtherReference(X, [], [{ bookId: X, items: [{ hash: X }] }])).toBe(false);
  expect(hasOtherReference(X, [], [{ bookId: Y, items: [{ hash: X }] }], new Set([Y]))).toBe(false);
});

test("a reference list that cannot be read deletes nothing", async () => {
  const w = world([], {});
  w.deps.listSupplementLists = async () => {
    throw new Error("supplements-q.json could not be read");
  };
  await expect(deleteIfUnreferenced(X, w.deps)).rejects.toThrow("could not be read");
  expect(w.tombstoned).toEqual([]);
});

test("a deleted book takes its threads' images and its prep's paper caches", async () => {
  const w = world([topic("t", [["y", Y]])], {});
  await deleteBook(Y, w.deps);
  expect(w.removed).toContain("images/threads/th-1");
  expect(w.removed).toContain("images/threads/th-2");
  expect(w.removed).toContain("fulltext-k1.json");
  expect(w.removed).toContain("figures-k1.json");
});

// --- a topic's delete, with the files only in it ---------------------------

test("files only in a topic: not in another topic, not a surviving book's supplement", () => {
  const topics = [
    topic("gone", [["x", X], ["y", Y], ["z", Z], ["s", S], ["x2", X], ["new", ""]]),
    topic("kept", [["z", Z], ["w", "wwww4444"]]),
  ];
  // S is a supplement of a book in "kept", so it stays.
  const only = filesOnlyInTopic(topics, "gone", [{ bookId: "wwww4444", items: [{ hash: S }] }]);
  expect(only.map((f) => f.path)).toEqual(["x", "y"]);
  expect(filesOnlyInTopic(topics, "nope", [])).toEqual([]);
});

test("a supplement of a book that goes with the topic goes too; one of a surviving book stays", () => {
  const topics = [topic("gone", [["x", X], ["s", S]]), topic("kept", [["z", Z]])];
  const onlyTheTopic = filesOnlyInTopic(topics, "gone", [{ bookId: X, items: [{ hash: S }] }]);
  expect(onlyTheTopic.map((f) => f.hash)).toEqual([X, S]);
  // Two that list each other, both only here: both go.
  expect(
    orphanedTogether([X, S], [], [
      { bookId: X, items: [{ hash: S }] },
      { bookId: S, items: [{ hash: X }] },
    ]),
  ).toEqual(new Set([X, S]));
  // A surviving book lists S: S drops out, and X with it only if it needed S.
  expect(orphanedTogether([X, S], [], [{ bookId: Z, items: [{ hash: S }] }])).toEqual(new Set([X]));
});

function topicDeps(topics: Topic[]): DeleteTopicDeps {
  const none = async () => [];
  return {
    tombstone: async () => {},
    listRetells: none,
    outlineIdOfRetell: async () => null,
    deleteRetell: async () => {},
    listOutlines: none,
    deleteOutline: async () => {},
    listRehearsals: none,
    deleteRehearsal: async () => {},
    listSavedArticles: none,
    setArticleTopic: async () => {},
    listThreadFiles: none,
    clearThreadTopic: async () => {},
    clearDistillCursors: async () => {},
    removeFile: async () => {},
    flushThreads: async () => {},
    removeTopicRecord: async (id) => {
      const i = topics.findIndex((t) => t.id === id);
      if (i >= 0) topics.splice(i, 1);
    },
  };
}

test("deleting a topic with its files deletes the ones only in it, mutual supplements included", async () => {
  const topics = [topic("gone", [["x", X], ["y", Y], ["s", S]]), topic("kept", [["y", Y]])];
  const w = world(topics, { [X]: [S], [S]: [X] });
  const deleted = await deleteTopic("gone", topicDeps(topics), {
    alsoDeleteFiles: [X, S],
    bookDeps: w.deps,
  });
  expect(topics.map((t) => t.id)).toEqual(["kept"]);
  expect(new Set(deleted)).toEqual(new Set([X, S]));
  expect(new Set(w.tombstoned)).toEqual(new Set([X, S]));
  expect(w.tombstoned).not.toContain(Y);
});

test("a file filed somewhere else since the confirmation is counted again and stays", async () => {
  const topics = [topic("gone", [["x", X], ["z", Z]]), topic("kept", [["x", X]])];
  const w = world(topics, {});
  const deleted = await deleteTopic("gone", topicDeps(topics), {
    alsoDeleteFiles: [X, Z],
    bookDeps: w.deps,
  });
  expect(deleted).toEqual([Z]);
  expect(w.tombstoned).toEqual([Z]);
});

test("without the option the topic's files are left alone", async () => {
  const topics = [topic("gone", [["x", X]])];
  const w = world(topics, {});
  expect(await deleteTopic("gone", topicDeps(topics), { bookDeps: w.deps })).toEqual([]);
  expect(w.tombstoned).toEqual([]);
});

test("the confirmation's list is read with the supplement lists", async () => {
  const topics = [topic("gone", [["x", X], ["s", S]])];
  const w = world(topics, { [Z]: [S] });
  const only = await listFilesOnlyInTopic(topics, "gone", w.deps);
  expect(only.map((f) => f.hash)).toEqual([X]);
});
