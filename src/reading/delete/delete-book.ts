// Deleting a book: the tombstone, the records that name it, and the files that
// are only about it (docs/50).
//
// A domain module rather than a capability, and not inside any one of the units
// it drives: it reaches across the library, the topics, the observation stores
// and the retell/talk/rehearsal trio, and the thing it owns is the order they go
// in — which is the product decision about what "delete this book" means, not a
// service anything calls into.
//
// The order is the whole design:
//
//   1. The tombstone first. It is what makes the rest travel: every other device
//      reads it and drops the same things, and this device reads it back on the
//      next pass and keeps the remote from pushing the files in again (pitfall
//      208). Written before anything is taken away, so a crash in the middle
//      leaves a deletion that finishes itself rather than half a book.
//   2..4 The records: the shelf entry, the reading position, the topic links,
//      the observations. Record-level deletes travel on their own.
//   5..7 The retells, the supplements (each deleted the same way, recursively)
//      and the files. Best-effort, one at a time: by the time the
//      book is off the shelf and tombstoned it is deleted as far as the reader
//      and the other devices are concerned, and a transcript that would not
//      unlink must not put it back on the shelf. Anything left behind is an
//      orphan, and every reader of these is already null-tolerant.
//
// The steps up to 4 do throw. They are the ones a partial result would show the
// reader — a book still on the shelf with its observations gone — and the caller
// surfaces that rather than reporting a delete that did not happen.

import { appData } from "../../platform/app/appdata";
import { recordDeletion } from "../../platform/app/deleted-books";
import { removeLibraryEntry } from "../../platform/app/library";
import { removeViewState } from "../../platform/app/storage";
import { listSupplements, supplementsFile, type SupplementRef } from "../../platform/app/supplements";
import { deleteThreadImages } from "../../platform/app/thread-images";
import { listTopics, removeFileFromTopic, type FileRef, type Topic } from "../../platform/app/topics";
import { ObservationFileStore } from "../../memory/observations/store";
import type { Observation } from "../../memory/observations/types";
import type { Statement } from "../../memory/statements/types";
import { listStatements } from "../../memory/live/statements";
import { observationFs } from "../../memory/live/fs";
import { deleteRetell, listAllRetells } from "../retell/store";
import type { Retell } from "../retell/types";
import { talkOutlineOfRetell } from "../talk/store";
import { deleteOutlineWithRehearsals, deleteRetellWithTalk } from "./delete-retell";
import { prepPaperCacheFiles } from "./prep-files";
import {
  deadLocalPathsFor,
  filesOnlyInTopic,
  hasOtherReference,
  isLastReferenceToBook,
  observationIdsToDelete,
  retellIdsToDelete,
  type SupplementList,
} from "./pick";

// Everything this reaches outside itself, so the order can be tested without a
// filesystem, a sync engine or a topic on disk.
export interface DeleteBookDeps {
  tombstone: (bookId: string) => Promise<void>;
  removeLibraryEntry: (bookId: string) => Promise<void>;
  removeViewState: (bookId: string) => Promise<void>;
  listTopics: () => Promise<Topic[]>;
  unlinkFile: (topicId: string, path: string) => Promise<void>;
  listObservations: () => Promise<Observation[]>;
  deleteObservations: (ids: readonly string[]) => Promise<void>;
  listStatements: () => Promise<Statement[]>;
  listSupplements: (bookId: string) => Promise<SupplementRef[]>;
  /** Every book's supplements list on this device, for reference counting. */
  listSupplementLists: () => Promise<SupplementList[]>;
  listRetells: () => Promise<Retell[]>;
  deleteRetell: (retellId: string) => Promise<void>;
  outlineIdOfRetell: (retellId: string) => Promise<string | null>;
  deleteTalkOutline: (outlineId: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  removeDir: (path: string) => Promise<void>;
  /** The ids in a book's thread file, read before the file goes. */
  threadIdsOf: (bookId: string) => Promise<string[]>;
  removeThreadImages: (threadId: string) => Promise<void>;
  /** The downloaded papers' caches of a book's prep, read before prep goes. */
  prepCacheFiles: (bookId: string) => Promise<string[]>;
}

// A file or directory that is not there is already in the state this asks for.
async function removeIfPresent(path: string, remove: (p: string) => Promise<void>): Promise<void> {
  if (!(await appData.exists(path))) return;
  await remove(path);
}

export const liveDeleteBookDeps: DeleteBookDeps = {
  tombstone: (bookId) => recordDeletion("book", bookId, Date.now()),
  removeLibraryEntry,
  removeViewState,
  listTopics,
  unlinkFile: removeFileFromTopic,
  listObservations: () => new ObservationFileStore(observationFs).list(),
  deleteObservations: async (ids) => {
    await new ObservationFileStore(observationFs).deleteMany(ids);
  },
  listStatements: () => listStatements(),
  listSupplements,
  listSupplementLists: liveSupplementLists,
  listRetells: listAllRetells,
  deleteRetell,
  outlineIdOfRetell: async (retellId) => (await talkOutlineOfRetell(retellId))?.id ?? null,
  deleteTalkOutline: deleteOutlineWithRehearsals,
  removeFile: (path) => removeIfPresent(path, (p) => appData.remove(p)),
  removeDir: (path) => removeIfPresent(path, (p) => appData.removeDir(p)),
  threadIdsOf: liveThreadIds,
  removeThreadImages: deleteThreadImages,
  prepCacheFiles: (bookId) => prepPaperCacheFiles(bookId),
};

// Every supplements-<bookId>.json at the AppData root. An unreadable one
// throws: a list that could not be read may hold the reference that keeps a
// document alive, and a delete that cannot count must not run.
async function liveSupplementLists(): Promise<SupplementList[]> {
  const out: SupplementList[] = [];
  for (const entry of await appData.readDir(".")) {
    if (!entry.isFile) continue;
    const m = /^supplements-(.+)\.json$/.exec(entry.name);
    if (!m || supplementsFile(m[1]) !== entry.name) continue;
    out.push({ bookId: m[1], items: await listSupplements(m[1]) });
  }
  return out;
}

// The thread ids in a book's thread file, asides included (they are rows of the
// same map). Read straight off disk rather than through the thread store: the
// book is being deleted, and loading it would put its threads in the cache.
async function liveThreadIds(bookId: string): Promise<string[]> {
  const path = `threads-${bookId}.json`;
  if (!(await appData.exists(path))) return [];
  const parsed = JSON.parse(await appData.readText(path)) as { threads?: Record<string, unknown> };
  return Object.keys(parsed.threads ?? {});
}

/**
 * Delete a book and everything that is about it. What is about the reader —
 * every statement, and the observations a statement rests on — is left alone.
 *
 * Idempotent: a second call on the same book writes no second tombstone line,
 * finds no records left to drop and asks for files that are already gone.
 */
export async function deleteBook(
  bookId: string,
  deps: DeleteBookDeps = liveDeleteBookDeps,
): Promise<void> {
  await deleteOne(bookId, deps, new Set());
}

// `seen` is what keeps the recursion finite. A supplement is a document like any
// other, so nothing in the data stops two books from listing each other, and a
// book already being deleted must not be deleted again half way through.
async function deleteOne(
  bookId: string,
  deps: DeleteBookDeps,
  seen: Set<string>,
): Promise<void> {
  seen.add(bookId);
  await deps.tombstone(bookId);

  await deps.removeLibraryEntry(bookId);
  await deps.removeViewState(bookId);

  const topics = await deps.listTopics();
  for (const topic of topics) {
    for (const file of topic.files) {
      if (file.hash === bookId) await deps.unlinkFile(topic.id, file.path);
    }
  }

  // One read of the statements and one of the observations for the whole sweep:
  // neither is scoped to a topic, and what they say does not change while this
  // runs. Which topic an observation is filed under does not come into it — a
  // book is deleted by book id, and the store is one flat directory (docs/48).
  const statements = await deps.listStatements();
  const observations = await deps.listObservations();
  await deps.deleteObservations(observationIdsToDelete(observations, statements, bookId));

  await deleteRetells(bookId, deps);
  await deleteSupplements(bookId, deps, seen);
  await deleteLocalFiles(bookId, deps);
}

// The documents this book took in from its own conversation (docs/67). Each is a
// document of this book's alone — it is in no topic and on no shelf — so it goes
// the same way the book does, marks, threads, pagination and all. Before the
// files, because supplements-<bookId>.json is one of them.
//
// Best-effort, like the retells: by the time the book is tombstoned it is
// deleted as far as the reader and the other devices are concerned, and a
// supplement that would not go is an orphan rather than a half-deleted book.
async function deleteSupplements(
  bookId: string,
  deps: DeleteBookDeps,
  seen: Set<string>,
): Promise<void> {
  let refs: SupplementRef[];
  let topics: Topic[];
  let lists: SupplementList[];
  try {
    refs = await deps.listSupplements(bookId);
    topics = await deps.listTopics();
    lists = await deps.listSupplementLists();
  } catch (e) {
    console.warn("failed to list the supplements of a deleted book", bookId, e);
    return;
  }
  for (const ref of refs) {
    if (seen.has(ref.hash)) continue;
    // Listed somewhere else too — on a shelf, or by a book this sweep is not
    // deleting — so only this book's reference goes, with its list.
    if (hasOtherReference(ref.hash, topics, lists, seen)) continue;
    try {
      await deleteOne(ref.hash, deps, seen);
    } catch (e) {
      console.warn("failed to delete a supplement of a deleted book", ref.hash, e);
    }
  }
}

// A retell of this book alone, with the talk it produced and the rehearsals of
// that talk (delete-retell.ts). Each is logged under its own id: the retell
// rides on the book by a rule about its materials, not by its name, so the
// book's own line in the log reaches none of its files.
async function deleteRetells(bookId: string, deps: DeleteBookDeps): Promise<void> {
  let retells: Retell[];
  try {
    retells = await deps.listRetells();
  } catch (e) {
    console.warn("failed to list the retells of a deleted book", bookId, e);
    return;
  }
  for (const retellId of retellIdsToDelete(retells, bookId)) {
    try {
      await deleteRetellWithTalk(retellId, deps);
    } catch (e) {
      console.warn("failed to delete a retell of a deleted book", retellId, e);
    }
  }
}

// The thread ids and the paper caches are read first: the ids are in the thread
// file and the caches are found through the prep state, and both go below.
async function deleteLocalFiles(bookId: string, deps: DeleteBookDeps): Promise<void> {
  const threadIds = await deps.threadIdsOf(bookId).catch((e) => {
    console.warn("failed to read the threads of a deleted book", bookId, e);
    return [] as string[];
  });
  const caches = await deps.prepCacheFiles(bookId).catch((e) => {
    console.warn("failed to read the prep of a deleted book", bookId, e);
    return [] as string[];
  });
  const { files, dirs } = deadLocalPathsFor(bookId);
  files.push(...caches);
  for (const file of files) {
    try {
      await deps.removeFile(file);
    } catch (e) {
      console.warn("failed to delete", file, e);
    }
  }
  for (const dir of dirs) {
    try {
      await deps.removeDir(dir);
    } catch (e) {
      console.warn("failed to delete", dir, e);
    }
  }
  for (const threadId of threadIds) {
    try {
      await deps.removeThreadImages(threadId);
    } catch (e) {
      console.warn("failed to delete the images of", threadId, e);
    }
  }
}

/**
 * Delete a document nothing lists any more, and leave it alone while something
 * does (docs/50 「引用计数」). The reader takes one reference away — unlinks it
 * from a topic, removes it from a book's supplements — and this decides whether
 * that was the last. Answers whether it deleted. A reference list that cannot
 * be read throws, and nothing is deleted.
 */
export async function deleteIfUnreferenced(
  hash: string,
  deps: DeleteBookDeps = liveDeleteBookDeps,
  // Documents the same sweep is deleting, whose supplement lists do not count
  // (pick.ts orphanedTogether): two that list each other can then both go.
  going: ReadonlySet<string> = new Set(),
): Promise<boolean> {
  const topics = await deps.listTopics();
  const lists = await deps.listSupplementLists();
  if (hasOtherReference(hash, topics, lists, going)) return false;
  await deleteBook(hash, deps);
  return true;
}

/** Take a file off a topic, and the document with it when that was the last reference. */
export async function removeFromTopic(
  topicId: string,
  file: FileRef,
  deps: DeleteBookDeps = liveDeleteBookDeps,
): Promise<boolean> {
  await deps.unlinkFile(topicId, file.path);
  return file.hash ? deleteIfUnreferenced(file.hash, deps) : false;
}

/** Whether removeFromTopic would delete the document: what the confirmation says. */
export async function isLastReference(
  topics: readonly Topic[],
  topicId: string,
  file: FileRef,
  deps: Pick<DeleteBookDeps, "listSupplementLists"> = liveDeleteBookDeps,
): Promise<boolean> {
  return isLastReferenceToBook(topics, topicId, file, await deps.listSupplementLists());
}

/**
 * The files the topic's delete confirmation offers to delete with it: the ones
 * nothing else lists once the topic is gone (pick.ts filesOnlyInTopic).
 */
export async function listFilesOnlyInTopic(
  topics: readonly Topic[],
  topicId: string,
  deps: Pick<DeleteBookDeps, "listSupplementLists"> = liveDeleteBookDeps,
): Promise<FileRef[]> {
  return filesOnlyInTopic(topics, topicId, await deps.listSupplementLists());
}
