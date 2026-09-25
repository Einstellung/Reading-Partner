// Reference counting before a delete (docs/50 「引用计数」), and the files that
// are found through something else before they go: a thread's images, a prep's
// paper caches.

import { expect, test } from "bun:test";
import {
  deleteBook,
  deleteIfUnreferenced,
  isLastReference,
  removeFromTopic,
  type DeleteBookDeps,
} from "../../../src/reading/delete/delete-book";
import { hasOtherReference, isLastReferenceToBook } from "../../../src/reading/delete/pick";
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
