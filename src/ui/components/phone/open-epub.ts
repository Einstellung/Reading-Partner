// Opening a book on the phone, in order (docs/70). The desk's sequence
// (reading/session/open-book.ts) with everything the phone does not have taken
// out: no full text, no figures, no threads, no prep, no distillation — there
// is no AI on this shell to read any of it.
//
// What is left is the order that still matters: the pages are cut before the
// marks are loaded, because a mark's page number is read off the table that was
// just written, and the reading position is seeded before the pane mounts, so
// the first write for this book lands on the position it opened at.
//
// Pure over an io, so the order can be read and tested without a webview.

import { loadAnnotations } from "../../../platform/app/annotations";
import { readLibraryBook } from "../../../platform/app/library";
import {
  isPageMark,
  pageMarks,
  type Annotation,
  type ViewState,
} from "../../../platform/app/reader-contract";
import { getViewState } from "../../../platform/app/storage";
import { markOpened } from "../../../platform/app/topics";
import type { OutlineItem } from "../../../fulltext/types";
import { acquireEpub, outlineFor, preparePagination, releaseEpub } from "../../../reading/epub";
import { keepReadingPosition, seedReadingPosition } from "../../../reading/reading-position";
import { cuttingStatus, openingViewState } from "../../../reading/session/open-book";

// The desk's own line, re-exported rather than restated: the reader is told the
// same thing on both machines while the same table is being cut.
export { cuttingStatus };

export interface PhoneBookIo {
  readBook(bookId: string): Promise<Uint8Array>;
  getViewState(bookId: string): Promise<ViewState | null>;
  // Cut the book (or read its stored table back) and give the chapters their
  // page numbers. The table itself never leaves this call: the shell only asks
  // it where the chapters are.
  prepare(
    bookId: string,
    buffer: ArrayBuffer,
    onProgress: (done: number, total: number) => void,
  ): Promise<{ outline: OutlineItem[] }>;
  loadAnnotations(bookId: string): Promise<Annotation[]>;
  seedReadingPosition(bookId: string, state: ViewState | null): void;
  keepReadingPosition(bookId: string, state: ViewState): void;
  release(bookId: string): void;
  markOpened(topicId: string, path: string): Promise<void>;
}

// The real one. The pagination is cut in the webview like everywhere else, and
// the outline is read off the table that comes back, so the chapter a reader
// taps lands on the same block number the top bar counts in.
export const phoneBookIo: PhoneBookIo = {
  readBook: readLibraryBook,
  getViewState,
  async prepare(bookId, buffer, onProgress) {
    const book = acquireEpub(bookId, buffer);
    const { pagination } = await preparePagination(bookId, book, undefined, onProgress);
    return { outline: outlineFor(book, pagination) };
  },
  loadAnnotations,
  seedReadingPosition,
  keepReadingPosition,
  release: releaseEpub,
  markOpened,
};

/** What the reader screen needs to mount the pane. */
export interface OpenedBook {
  buffer: ArrayBuffer;
  viewState: ViewState;
  // The page-anchored half, the same half the desk hands its engine: a mark
  // drawn on an AI reply has no page to sit on.
  annotations: Annotation[];
  // Every mark, which is what is written back.
  allAnnotations: Annotation[];
  outline: OutlineItem[];
}

/**
 * The state the phone mounts with. The saved one, from whichever device left
 * it, with the layout forced back to the scroll: the phone has one view and it
 * is not the paged flip, so a book last read paged on an iPad must not open
 * here claiming to be.
 */
export function phoneViewState(saved: ViewState | null): ViewState {
  return { ...openingViewState(saved), layout: "vertical" };
}

/**
 * Open a book on the phone. `onStatus` is given the one line the top bar shows
 * while the pages are being cut, and null when there is nothing left to say.
 */
export async function openPhoneBook(
  bookId: string,
  io: PhoneBookIo,
  onStatus: (line: string | null) => void,
): Promise<OpenedBook> {
  const bytes = await io.readBook(bookId);
  // One copy, the way the desk keeps one: everything downstream reads this
  // buffer rather than slicing its own.
  const buffer = bytes.slice().buffer as ArrayBuffer;

  // Optional, like the desk's: a position that will not load is not a book that
  // will not open.
  let state: ViewState | null = null;
  try {
    state = await io.getViewState(bookId);
  } catch (e) {
    console.error("failed to load the reading position", e);
  }

  let outline: OutlineItem[] = [];
  try {
    const prepared = await io.prepare(bookId, buffer, (done, total) =>
      onStatus(cuttingStatus(done, total)),
    );
    outline = prepared.outline;
  } catch (e) {
    console.error("failed to lay the book's pages out", e);
  }
  onStatus(null);

  let saved: Annotation[] = [];
  try {
    saved = await io.loadAnnotations(bookId);
  } catch (e) {
    console.error("failed to load annotations", e);
  }

  io.seedReadingPosition(bookId, state);

  return {
    buffer,
    viewState: phoneViewState(state),
    annotations: pageMarks(saved),
    allAnnotations: saved,
    outline,
  };
}

/**
 * What is written back when the pane hands over its marks. The pane only ever
 * has the page-anchored half (the desk's rule, pageMarks), so whatever else the
 * book carries — a mark drawn on an AI reply, from a session on the desk — is
 * kept rather than saved away.
 */
export function mergeSavedMarks(
  all: readonly Annotation[],
  fromPane: readonly Annotation[],
): Annotation[] {
  return [...all.filter((a) => !isPageMark(a)), ...fromPane];
}

/**
 * Leaving the book. What close-book.ts does that still applies: the position is
 * written, the unzipped archive is let go, and the topic records that this book
 * was the last one opened — which is what the home screen's Continue reading
 * reads back.
 */
export function closePhoneBook(
  io: PhoneBookIo,
  book: { bookId: string; topicId: string; path: string },
  last: ViewState | null,
): void {
  if (last) io.keepReadingPosition(book.bookId, last);
  io.release(book.bookId);
  void io.markOpened(book.topicId, book.path).catch((e) => {
    console.warn("failed to mark the book as opened", e);
  });
}
