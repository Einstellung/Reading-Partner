// Retiring a book another one has replaced: a translation takes the original's
// place (reading/translate/replace.ts), and what goes is the original's bytes,
// not the reading done on it (docs/50 「翻译替换」).
//
// deleteBook's split is "about the book or about the reader". A replacement
// draws a finer line inside "about the book": what is about the work — where
// the reader is, what the retells say about its chapters, the documents it
// picked up, the prep notes, the observations its conversations produced — is
// the same work in another language and moves to the new id; what is about
// these bytes — the file, its covers, text and figure caches, its pagination —
// goes. The marks and the conversations are moved by the caller before this
// runs; their old files are among what goes.
//
// Two phases. Everything that moves is moved first, and any of it failing
// throws before anything is taken away: the reader is left with both documents,
// which is the state replace.ts already treats as safe to be interrupted in.
// Then the retirement, in deleteBook's order — tombstone, records, files — with
// the files best-effort.

import { appData } from "../../platform/app/appdata";
import { recordDeletion } from "../../platform/app/deleted-books";
import { removeLibraryEntry } from "../../platform/app/library";
import type { ViewState } from "../../platform/app/reader-contract";
import { getViewState, removeViewState, saveViewState } from "../../platform/app/storage";
import {
  addSupplement,
  listSupplements,
  removeSupplement,
  type SupplementRef,
} from "../../platform/app/supplements";
import { addFileToTopic, listTopics, removeFileFromTopic, type Topic } from "../../platform/app/topics";
import { localDate } from "../../platform/std/day";
import { ObservationFileStore } from "../../memory/observations/store";
import { observationFs } from "../../memory/live/fs";
import { listAllRetells, updateRetell } from "../retell/store";
import type { Retell } from "../retell/types";
import { movePrep, prepPaperCacheFiles } from "./prep-files";
import { liveDeleteBookDeps } from "./delete-book";
import { deadLocalPathsFor, retellWithMaterialReplaced, type SupplementList } from "./pick";

/** The document that takes the retired one's place, as a topic lists it. */
export interface Successor {
  hash: string;
  path: string;
}

export interface RetireBookDeps {
  tombstone: (bookId: string) => Promise<void>;
  removeLibraryEntry: (bookId: string) => Promise<void>;
  getViewState: (bookId: string) => Promise<ViewState | null>;
  saveViewState: (bookId: string, state: ViewState) => Promise<void>;
  removeViewState: (bookId: string) => Promise<void>;
  listTopics: () => Promise<Topic[]>;
  attachFile: (topicId: string, path: string, hash: string) => Promise<void>;
  unlinkFile: (topicId: string, path: string) => Promise<void>;
  listSupplements: (bookId: string) => Promise<SupplementRef[]>;
  listSupplementLists: () => Promise<SupplementList[]>;
  addSupplement: (bookId: string, ref: SupplementRef) => Promise<void>;
  removeSupplement: (bookId: string, hash: string) => Promise<void>;
  listRetells: () => Promise<Retell[]>;
  replaceRetellMaterial: (retellId: string, fromId: string, toId: string) => Promise<void>;
  moveObservations: (fromId: string, toId: string) => Promise<void>;
  movePrep: (fromId: string, toId: string) => Promise<boolean>;
  prepCacheFiles: (bookId: string) => Promise<string[]>;
  removeFile: (path: string) => Promise<void>;
  removeDir: (path: string) => Promise<void>;
}

export const liveRetireBookDeps: RetireBookDeps = {
  tombstone: (bookId) => recordDeletion("book", bookId, Date.now()),
  removeLibraryEntry,
  getViewState,
  saveViewState,
  removeViewState,
  listTopics,
  attachFile: addFileToTopic,
  unlinkFile: removeFileFromTopic,
  listSupplements,
  listSupplementLists: liveDeleteBookDeps.listSupplementLists,
  addSupplement: async (bookId, ref) => {
    await addSupplement(bookId, ref);
  },
  removeSupplement,
  listRetells: listAllRetells,
  replaceRetellMaterial: async (retellId, fromId, toId) => {
    await updateRetell(retellId, (r) => retellWithMaterialReplaced(r, fromId, toId) ?? r);
  },
  moveObservations: async (fromId, toId) => {
    await new ObservationFileStore(observationFs).moveBook(fromId, toId);
  },
  movePrep: (fromId, toId) => movePrep(fromId, toId),
  prepCacheFiles: (bookId) => prepPaperCacheFiles(bookId),
  removeFile: async (path) => {
    if (await appData.exists(path)) await appData.remove(path);
  },
  removeDir: async (path) => {
    if (await appData.exists(path)) await appData.removeDir(path);
  },
};

/**
 * Put `successor` in the place of `bookId` everywhere the reader put it, move
 * the reading done on it across, and delete what is left of it.
 *
 * Every reference moves, not only the one the translation was asked from: the
 * marks and the conversations have already moved to the successor, so the
 * original is no longer the document any shelf or book was pointing at.
 */
export async function retireReplacedBook(
  bookId: string,
  successor: Successor,
  deps: RetireBookDeps = liveRetireBookDeps,
): Promise<void> {
  const to = successor.hash;
  if (to === bookId) return;

  // --- what moves ----------------------------------------------------------

  // Where the reader was. Not over a position the successor already has.
  const position = await deps.getViewState(bookId);
  if (position && !(await deps.getViewState(to))) await deps.saveViewState(to, position);

  // The documents this one picked up are the successor's now.
  for (const ref of await deps.listSupplements(bookId)) {
    if (ref.hash !== to) await deps.addSupplement(to, ref);
  }

  // Every shelf and every book that listed the original lists the successor.
  for (const topic of await deps.listTopics()) {
    const listed = topic.files.some((f) => f.hash === bookId);
    if (listed && !topic.files.some((f) => f.hash === to)) {
      await deps.attachFile(topic.id, successor.path, to);
    }
  }
  for (const list of await deps.listSupplementLists()) {
    if (list.bookId === bookId) continue;
    const ref = (list.items as SupplementRef[]).find((s) => s.hash === bookId);
    if (!ref) continue;
    if (list.bookId !== to && !list.items.some((s) => s.hash === to)) {
      await deps.addSupplement(list.bookId, { ...ref, hash: to });
    }
    await deps.removeSupplement(list.bookId, bookId);
  }

  for (const retell of await deps.listRetells()) {
    if (retellWithMaterialReplaced(retell, bookId, to)) {
      await deps.replaceRetellMaterial(retell.id, bookId, to);
    }
  }
  await deps.moveObservations(bookId, to);

  // Read before the move: a prep the successor already had is not overwritten,
  // and then these caches are the original's to delete below.
  const caches = await deps.prepCacheFiles(bookId).catch(() => [] as string[]);
  const prepMoved = await deps.movePrep(bookId, to);

  // --- what goes -----------------------------------------------------------

  await deps.tombstone(bookId);
  await deps.removeLibraryEntry(bookId);
  await deps.removeViewState(bookId);
  for (const topic of await deps.listTopics()) {
    for (const file of topic.files) {
      if (file.hash === bookId) await deps.unlinkFile(topic.id, file.path);
    }
  }

  // Not the thread images: the threads moved with their ids, and so did they.
  const { files, dirs } = deadLocalPathsFor(bookId);
  if (!prepMoved) files.push(...caches);
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
