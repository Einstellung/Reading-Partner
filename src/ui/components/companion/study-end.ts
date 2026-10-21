// A study's end on this device (docs/info/91 结束): end_study's card confirmed
// files the current version's book into a reading topic the way the info
// shelf's Move to… files a topic volume (ui/components/info/info-shelf.ts
// fileVolume: an add, since the book is on no topic yet), stops the study, and
// deletes the other versions' books through the book-delete cascade. The info
// shelf is info/issue's file, which info/topic-search may not read, so where a
// study's books are is found here. ui/components/info imports this directory,
// so fileVolume's two lines are repeated rather than imported.

import type { StudyMoveCardData } from "../../../info/topic-search/cards";
import { INFO_SHELF_FILE, parseShelf, type InfoShelf } from "../../../info/issue/types";
import { stopStudy, studyKept } from "../../../info/topic-search/live";
import { currentVersion, loadStudy, type StudyRollback } from "../../../info/topic-search/study";
import { endStudy, type MoveTarget } from "../../../info/topic-search/study-lines";
import { appData } from "../../../platform/app/appdata";
import { documentPath, listLibraryEntries } from "../../../platform/app/library";
import { addFileToTopic, createTopic } from "../../../platform/app/topics";
import { deleteBook } from "../../../reading/delete/delete-book";

/**
 * A study's books on the shelf: the current version's (the newest, unless the
 * reader went back to one) and the other versions'. A row from before versions
 * were recorded is version 1. Null and none when the study has no row. Pure.
 */
export function studyRowBooks(
  shelf: InfoShelf,
  searchId: string,
  rollbacks: readonly StudyRollback[],
): { current: { version: number; bookId: string } | null; others: string[] } {
  const row = shelf.issues.find((issue) => issue.key === `first:${searchId}`);
  if (!row) return { current: null, others: [] };
  const versions = row.study?.versions ?? [];
  if (versions.length === 0) return { current: { version: 1, bookId: row.bookId }, others: [] };
  const n = currentVersion(versions, rollbacks);
  const v = versions.find((x) => x.n === n) ?? versions[versions.length - 1];
  return { current: { version: v.n, bookId: v.bookId }, others: [...new Set(versions.map((x) => x.bookId))].filter((id) => id !== v.bookId) };
}

async function readShelf(): Promise<InfoShelf> {
  return parseShelf((await appData.exists(INFO_SHELF_FILE)) ? await appData.readText(INFO_SHELF_FILE) : null);
}

async function booksOf(searchId: string) {
  const [shelf, study] = await Promise.all([readShelf(), loadStudy(searchId)]);
  return studyRowBooks(shelf, searchId, study.rollbacks);
}

/** end_study's look at the shelf: the version the reader has and its book. */
export async function liveStudyBook(searchId: string): Promise<{ version: number; bookId: string } | null> {
  return (await booksOf(searchId)).current;
}

/** The move card's confirm on this device; null when the book could not be filed. */
export function endStudyLive(card: StudyMoveCardData, target: MoveTarget): Promise<StudyMoveCardData | null> {
  return endStudy(card, target, {
    makeTopic: async (name) => {
      const topic = await createTopic(name);
      return { id: topic.id, name: topic.name };
    },
    fileBook: async (c, topic) => {
      const entry = (await listLibraryEntries())[c.bookId];
      const title = entry?.title || c.name;
      const elsewhere = await addFileToTopic(topic.id, documentPath(c.bookId, entry?.originalFilename || `${title}.epub`), c.bookId, title);
      return elsewhere ? elsewhere.topic.name : topic.name;
    },
    stop: stopStudy,
    oldBooks: async (searchId, keep) => (await booksOf(searchId)).others.filter((id) => id !== keep),
    deleteBook: (bookId) => deleteBook(bookId),
    kept: studyKept,
  });
}
