// Opening a PDF as a lesson on the phone, in order (docs/71). The phone has no
// PDF reader and does not want one: what a lesson needs is the full text, and
// nothing else on the desk's open sequence — no engine, no pagination table, no
// figures, no prep — is on the way to it.
//
// The order that matters here is where the bytes come from. The full-text cache
// is local-only (palace/kinds.ts, sync: "local"), so a book the desk has already
// read is still unread here; but once this phone has read it, a second lesson
// needs no bytes at all, which is why the cache is asked before the library and
// the library before the account.
//
// Pure over an io, so the order can be read and tested without a webview.

import { libraryHas, readLibraryBook } from "../../platform/app/library";
import { logEvent, type EventPayload } from "../../platform/app/events";
import { AI_EVENT_TOPIC } from "../../platform/app/structured-output";
import { ensureFulltext, getFulltext } from "../../fulltext/store";
import type { Fulltext } from "../../fulltext/types";
import { fetchBook } from "../../platform/sync";
import type { TableChapter } from "../chapters";
import { loadChapterTable } from "../lecture/live";
import { lessonStatus, type LessonOpenFailure } from "./status";

export interface PhonePdfIo {
  /** The full text this device has already read out of the book, or null. */
  getFulltext(bookId: string): Promise<Fulltext | null>;
  /** Whether the library holds this book's bytes. */
  hasBook(bookId: string): Promise<boolean>;
  /** Pull the one book out of the account. Throws when it cannot. */
  fetchBook(bookId: string): Promise<void>;
  readBook(bookId: string): Promise<Uint8Array>;
  /** Read the text out of the bytes and cache it under the book id. */
  ensureFulltext(bookId: string, buffer: ArrayBuffer): Promise<Fulltext>;
  loadChapterTable(bookId: string, ft: Fulltext): Promise<TableChapter[] | null>;
  /** Where the timing line goes. Fire-and-forget, like every other event. */
  log(payload: EventPayload): void;
  now(): number;
}

export const phonePdfIo: PhonePdfIo = {
  getFulltext,
  hasBook: libraryHas,
  fetchBook,
  readBook: readLibraryBook,
  ensureFulltext: (bookId, buffer) => ensureFulltext(bookId, buffer),
  loadChapterTable: (bookId, ft) => loadChapterTable(bookId, ft, []),
  // Filed under the AI log rather than a topic's, beside page-window and for
  // the same reason: what this measures belongs to a face of the app, not to a
  // book, and the number is only worth anything read against the other turns.
  log: (payload) => logEvent(AI_EVENT_TOPIC, "lesson-open", payload),
  now: () => Date.now(),
};

/**
 * A lesson that could not be opened at all, as opposed to one whose PDF turned
 * out to hold no text — that comes back as a `Fulltext` with a status, because
 * it is an answer about the file rather than a failure to get one.
 */
export class LessonOpenError extends Error {
  readonly why: LessonOpenFailure;
  // What was actually thrown underneath. Carried as a field rather than through
  // Error's `cause` option, which this build's lib does not declare.
  readonly reason: unknown;
  constructor(why: LessonOpenFailure, reason?: unknown) {
    super(lessonStatus({ kind: "failed", why }));
    this.name = "LessonOpenError";
    this.why = why;
    this.reason = reason;
  }
}

export interface OpenedLesson {
  // `status` is "no-text-layer" for a scan: the caller shows noTextStatus()
  // and does not start a lesson.
  fulltext: Fulltext;
  // Null when no source of chapters survived the filtering — the lesson then
  // runs without a chapter sheet and read_chapter takes page ranges.
  chapters: TableChapter[] | null;
}

/**
 * Get a PDF ready to be taught on the phone. `onStatus` is given the one line
 * the screen shows while this runs; it is not called at all when the full text
 * is already here, because nothing takes long enough to say so.
 *
 * Throws `LessonOpenError` when the bytes could not be got or read. A file that
 * parsed but holds no text is not a throw: it comes back with its status.
 */
export async function openPhonePdf(
  bookId: string,
  io: PhonePdfIo,
  onStatus: (line: string) => void,
): Promise<OpenedLesson> {
  const startedAt = io.now();

  const cached = await io.getFulltext(bookId).catch(() => null);
  if (cached) {
    const chapters = await chaptersFor(bookId, io, cached);
    report(io, {
      cached: true,
      downloaded: false,
      ms: io.now() - startedAt,
      extractMs: null,
      ft: cached,
      chapters,
    });
    return { fulltext: cached, chapters };
  }

  let downloaded = false;
  if (!(await io.hasBook(bookId).catch(() => false))) {
    onStatus(lessonStatus({ kind: "downloading" }));
    try {
      await io.fetchBook(bookId);
      downloaded = true;
    } catch (e) {
      throw new LessonOpenError("download", e);
    }
  }

  let bytes: Uint8Array;
  try {
    bytes = await io.readBook(bookId);
  } catch (e) {
    throw new LessonOpenError("download", e);
  }
  // One copy, the way the desk keeps one: pdf.js detaches what it is handed.
  const buffer = bytes.slice().buffer as ArrayBuffer;

  onStatus(lessonStatus({ kind: "reading" }));
  const extractStart = io.now();
  let fulltext: Fulltext;
  try {
    fulltext = await io.ensureFulltext(bookId, buffer);
  } catch (e) {
    throw new LessonOpenError("unreadable", e);
  }
  const extractMs = io.now() - extractStart;

  const chapters = await chaptersFor(bookId, io, fulltext);
  report(io, {
    cached: false,
    downloaded,
    ms: io.now() - startedAt,
    extractMs,
    ft: fulltext,
    chapters,
  });
  return { fulltext, chapters };
}

// Best-effort, like every other read of it (reading/lecture/live.ts): a lesson
// without a chapter table is a lesson, and a table that would not load must not
// be the reason a paper does not open.
async function chaptersFor(
  bookId: string,
  io: PhonePdfIo,
  ft: Fulltext,
): Promise<TableChapter[] | null> {
  try {
    return await io.loadChapterTable(bookId, ft);
  } catch (e) {
    console.warn("failed to load the chapter table", e);
    return null;
  }
}

// How long it took and over how many pages, which is the pair that says whether
// reading a paper on a phone is a wait or a stall. Ids and numbers only, like
// every other line in the log.
function report(
  io: PhonePdfIo,
  r: {
    cached: boolean;
    downloaded: boolean;
    ms: number;
    extractMs: number | null;
    ft: Fulltext;
    chapters: TableChapter[] | null;
  },
): void {
  io.log({
    cached: r.cached,
    downloaded: r.downloaded,
    pages: r.ft.pages.length,
    status: r.ft.status,
    chapters: r.chapters?.length ?? 0,
    ms: Math.round(r.ms),
    extractMs: r.extractMs === null ? null : Math.round(r.extractMs),
  });
}
