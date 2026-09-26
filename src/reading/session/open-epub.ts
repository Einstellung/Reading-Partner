// Opening a book on the phone, in order (docs/70, docs/77). The desk's sequence
// (reading/session/open-book.ts) with what the phone does not have taken out: no
// supplements, no prep, no distillation on the way in, and the threads are not
// read here — the Learn button reads the book's own when it is pressed
// (book-thread.ts), the way the desk's top-bar button does.
//
// What is left is the order that still matters: the pages are cut before the
// marks are loaded, because a mark's page number is read off the table that was
// just written, and the reading position is seeded before the pane mounts, so
// the first write for this book lands on the position it opened at. Then the
// two things a lesson turn reads are started with the desk's own functions and
// handed over unfinished: the reader is drawn without waiting for either.
//
// Pure over an io, so the order can be read and tested without a webview.

import { loadAnnotations } from "../../platform/app/annotations";
import { readLibraryBook } from "../../platform/app/library";
import {
  isPageMark,
  pageMarks,
  type Annotation,
  type ViewState,
} from "../../platform/app/reader-contract";
import { getViewState } from "../../platform/app/storage";
import { markOpened } from "../../platform/app/topics";
import type { Fulltext, OutlineItem } from "../../fulltext/types";
import { acquireEpub, outlineFor, preparePagination, releaseEpub } from "../epub";
import type { FiguresIndex } from "../figures";
import { keepReadingPosition, seedReadingPosition } from "../reading-position";
import { bookOpenIo, cuttingStatus, openingViewState } from "./open-book";

// The desk's own line, re-exported rather than restated: the reader is told the
// same thing on both machines while the same table is being cut.
export { cuttingStatus };

export interface PhoneBookIo {
  readBook(bookId: string): Promise<Uint8Array>;
  getViewState(bookId: string): Promise<ViewState | null>;
  // Cut the book (or read its stored table back) and give the chapters their
  // page numbers. The table itself never leaves this call: the shell only asks
  // it where the chapters are, and the extractions below whether it was just
  // replaced.
  prepare(
    bookId: string,
    buffer: ArrayBuffer,
    onProgress: (done: number, total: number) => void,
  ): Promise<{ outline: OutlineItem[]; recut: boolean }>;
  loadAnnotations(bookId: string): Promise<Annotation[]>;
  // The full text and the figure index, sliced off the table. `stale` says the
  // table was just replaced, so a cache counted in its old page numbers is
  // another book's (open-book.ts).
  ensureFulltext(bookId: string, buffer: ArrayBuffer, stale: boolean): Promise<Fulltext>;
  ensureFigures(bookId: string, buffer: ArrayBuffer, stale: boolean): Promise<FiguresIndex>;
  // The crops of the book read before this one.
  clearFigureCache(): void;
  seedReadingPosition(bookId: string, state: ViewState | null): void;
  keepReadingPosition(bookId: string, state: ViewState): void;
  release(bookId: string): void;
  markOpened(topicId: string, path: string): Promise<void>;
}

// The real one. The pagination is cut in the webview like everywhere else, and
// the outline is read off the table that comes back, so the chapter a reader
// taps lands on the same block number the top bar counts in. The text and the
// figures are the desk's own calls: the pages a lesson cites here are the pages
// the iPad cites, because both slice them off the one synced table.
export const phoneBookIo: PhoneBookIo = {
  readBook: readLibraryBook,
  getViewState,
  async prepare(bookId, buffer, onProgress) {
    const book = acquireEpub(bookId, buffer);
    const { pagination, recut } = await preparePagination(bookId, book, undefined, onProgress);
    return { outline: outlineFor(book, pagination), recut };
  },
  loadAnnotations,
  ensureFulltext: (bookId, buffer, stale) => bookOpenIo.ensureFulltext(bookId, buffer, "epub", stale),
  ensureFigures: (bookId, buffer, stale) => bookOpenIo.ensureFigures(bookId, buffer, "epub", stale),
  clearFigureCache: bookOpenIo.clearFigureCache,
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
  // What a lesson turn reads (docs/77), still running when the book is handed
  // over. The shapes useCall awaits (currentFulltextRef, currentFiguresRef);
  // null when the extraction failed.
  fulltext: Promise<Fulltext | null>;
  figures: Promise<FiguresIndex | null>;
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
  let recut = false;
  try {
    const prepared = await io.prepare(bookId, buffer, (done, total) =>
      onStatus(cuttingStatus(done, total)),
    );
    outline = prepared.outline;
    recut = prepared.recut;
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

  // Fire-and-forget, in the desk's order. Neither is awaited here: the pane
  // mounts now, and a lesson asked for before the text is in waits for it.
  io.clearFigureCache();
  const figures = io.ensureFigures(bookId, buffer, recut).catch((e) => {
    console.warn("failed to extract figures", e);
    return null;
  });
  const fulltext = io.ensureFulltext(bookId, buffer, recut).catch((e) => {
    console.warn("failed to extract fulltext", e);
    return null;
  });

  return {
    buffer,
    viewState: phoneViewState(state),
    annotations: pageMarks(saved),
    allAnnotations: saved,
    outline,
    fulltext,
    figures,
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
