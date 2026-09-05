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
//   5..6 The retells and the files. Best-effort, one at a time: by the time the
//      book is off the shelf and tombstoned it is deleted as far as the reader
//      and the other devices are concerned, and a transcript that would not
//      unlink must not put it back on the shelf. Anything left behind is an
//      orphan, and every reader of these is already null-tolerant.
//
// The steps up to 4 do throw. They are the ones a partial result would show the
// reader — a book still on the shelf with its observations gone — and the caller
// surfaces that rather than reporting a delete that did not happen.

import { appData } from "../../platform/app/appdata";
import { appendDeletedBook } from "../../platform/app/deleted-books";
import { removeLibraryEntry } from "../../platform/app/library";
import { removeViewState } from "../../platform/app/storage";
import { listTopics, removeFileFromTopic, type Topic } from "../../platform/app/topics";
import { ObservationFileStore } from "../../memory/observations/store";
import type { Observation } from "../../memory/observations/types";
import type { Statement } from "../../memory/statements/types";
import { listStatements } from "../../memory/live/statements";
import { observationFs } from "../../memory/live/fs";
import { deleteRetell, listAllRetells } from "../retell/store";
import type { Retell } from "../retell/types";
import { deleteTalkOutline, talkOutlineOfRetell } from "../talk/store";
import { deadLocalPathsFor, observationIdsToDelete, retellIdsToDelete } from "./pick";

// Everything this reaches outside itself, so the order can be tested without a
// filesystem, a sync engine or a topic on disk.
export interface DeleteBookDeps {
  tombstone: (bookId: string) => Promise<void>;
  removeLibraryEntry: (bookId: string) => Promise<void>;
  removeViewState: (bookId: string) => Promise<void>;
  listTopics: () => Promise<Topic[]>;
  unlinkFile: (topicId: string, path: string) => Promise<void>;
  listObservations: (topicId: string) => Promise<Observation[]>;
  deleteObservation: (topicId: string, id: string) => Promise<void>;
  listStatements: () => Promise<Statement[]>;
  listRetells: () => Promise<Retell[]>;
  deleteRetell: (retellId: string) => Promise<void>;
  outlineIdOfRetell: (retellId: string) => Promise<string | null>;
  deleteTalkOutline: (outlineId: string) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  removeDir: (path: string) => Promise<void>;
}

// A file or directory that is not there is already in the state this asks for.
async function removeIfPresent(path: string, remove: (p: string) => Promise<void>): Promise<void> {
  if (!(await appData.exists(path))) return;
  await remove(path);
}

export const liveDeleteBookDeps: DeleteBookDeps = {
  tombstone: (bookId) => appendDeletedBook(bookId),
  removeLibraryEntry,
  removeViewState,
  listTopics,
  unlinkFile: removeFileFromTopic,
  listObservations: (topicId) => new ObservationFileStore(topicId, observationFs).list(),
  deleteObservation: async (topicId, id) => {
    await new ObservationFileStore(topicId, observationFs).delete(id);
  },
  listStatements: () => listStatements(),
  listRetells: listAllRetells,
  deleteRetell,
  outlineIdOfRetell: async (retellId) => (await talkOutlineOfRetell(retellId))?.id ?? null,
  deleteTalkOutline,
  removeFile: (path) => removeIfPresent(path, (p) => appData.remove(p)),
  removeDir: (path) => removeIfPresent(path, (p) => appData.removeDir(p)),
};

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
  await deps.tombstone(bookId);

  await deps.removeLibraryEntry(bookId);
  await deps.removeViewState(bookId);

  const topics = await deps.listTopics();
  for (const topic of topics) {
    for (const file of topic.files) {
      if (file.hash === bookId) await deps.unlinkFile(topic.id, file.path);
    }
  }

  // One read of the statements for the whole sweep: they are not scoped to a
  // topic, and what they cite does not change while this runs.
  const statements = await deps.listStatements();
  for (const topic of topics) {
    const observations = await deps.listObservations(topic.id);
    for (const id of observationIdsToDelete(observations, statements, bookId)) {
      await deps.deleteObservation(topic.id, id);
    }
  }

  await deleteRetells(bookId, deps);
  await deleteLocalFiles(bookId, deps);
}

// A retell of this book alone, with the talk it produced and the rehearsals of
// that talk. The outline goes before the retell, because the retell is how the
// outline is found.
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
      const outlineId = await deps.outlineIdOfRetell(retellId);
      if (outlineId) await deps.deleteTalkOutline(outlineId);
      // The rehearsals of that talk go with the retell: deleteRetell takes them
      // (retell/store.ts), which is where the cascade has always lived.
      await deps.deleteRetell(retellId);
    } catch (e) {
      console.warn("failed to delete a retell of a deleted book", retellId, e);
    }
  }
}

async function deleteLocalFiles(bookId: string, deps: DeleteBookDeps): Promise<void> {
  const { files, dirs } = deadLocalPathsFor(bookId);
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
}
