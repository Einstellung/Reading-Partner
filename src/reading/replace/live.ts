// What the replacement pipeline (replace.ts) is wired to in the app: the
// library, the topics, the supplements, the marks, the positions and the
// conversations. Shared by the translation and by a new version of a book, so
// the two cannot drift in how they touch the shelf. None of it runs under bun.

import { contentHash } from "../../platform/app/content-hash";
import { loadAnnotations, saveAnnotations } from "../../platform/app/annotations";
import { importBook } from "../../platform/app/library";
import type { Annotation } from "../../platform/app/reader-contract";
import { getViewState, saveViewState } from "../../platform/app/storage";
import { addSupplement, removeSupplement } from "../../platform/app/supplements";
import { adoptThreads, listThreads, loadThreads } from "../../platform/app/threads";
import { addFileToTopic } from "../../platform/app/topics";
import { carryPdfMarks } from "../engine/carry-pdf";
import { isEpub } from "../epub/file/sniff";
import { parseEpub, type EpubBook } from "../epub/file/parse";
import { carryMarks, carryPosition, carryTargetsOf, type MarkRecord } from "./carry-marks";
import type { ReplaceDeps } from "./replace";

/**
 * How a replaced original is retired: the work moves to the successor and the
 * original's bytes go (reading/delete/retire-book.ts). Registered rather than
 * imported: reading/delete reaches the retell and rehearsal units, and those
 * reach back up to reading/desk, so importing it here would put a cycle in the
 * directory graph (tests/layering.test.ts). The shell knows both and hands it
 * down at startup (ui/components/common/useShellBootstrap.ts).
 */
export type BookRetirer = (bookId: string, successor: { hash: string; path: string }) => Promise<void>;
let retirer: BookRetirer | null = null;

export function setBookRetirer(fn: BookRetirer): void {
  retirer = fn;
}

/** Null until the shell has handed it down. */
export function bookRetirer(): BookRetirer | null {
  return retirer;
}

// One parse per file per replacement: the marks and the position both read it.
const parsed = new WeakMap<Uint8Array, EpubBook>();
function epubOf(bytes: Uint8Array): EpubBook {
  let book = parsed.get(bytes);
  if (!book) {
    book = parseEpub(bytes);
    parsed.set(bytes, book);
  }
  return book;
}

export function liveReplaceDeps(retireOriginal: BookRetirer): ReplaceDeps {
  return {
    hash: contentHash,
    importBook,
    attach: (topicId, path, hash) => addFileToTopic(topicId, path, hash),
    // Listed before the original is taken off, so the book is never a book
    // with one supplement fewer than the reader put there.
    replaceSupplement: async (bookId, oldHash, supplement) => {
      await addSupplement(bookId, { ...supplement, addedAt: Date.now() });
      await removeSupplement(bookId, oldHash);
    },
    loadMarks: async (bookId) => (await loadAnnotations(bookId)) as unknown as MarkRecord[],
    saveMarks: async (bookId, marks) => {
      saveAnnotations(bookId, marks as unknown as Annotation[]);
    },
    carryMarks: async (marks, _original, successor) =>
      isEpub(successor)
        ? carryMarks(marks, carryTargetsOf(epubOf(successor)))
        : carryPdfMarks(marks, successor),
    getViewState,
    saveViewState,
    // A PDF position is a page and an offset on it, which a new version keeps
    // as well as it keeps anything; only an EPUB's CFI is tied to the old tree.
    carryPosition: async (state, original, successor) =>
      isEpub(original) && isEpub(successor)
        ? carryPosition(state, epubOf(original), carryTargetsOf(epubOf(successor)))
        : state,
    loadThreads: async (bookId) => {
      await loadThreads(bookId);
      return listThreads(bookId);
    },
    adoptThreads: async (bookId, threads) => {
      await loadThreads(bookId);
      adoptThreads(bookId, threads);
    },
    retireOriginal,
  };
}
