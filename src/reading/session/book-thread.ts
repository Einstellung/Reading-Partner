// The top-bar AI button's one decision: which conversation it opens (docs/03).
//
// There is one book-level thread per book, and threads-<bookId>.json is the only
// record of it. The store's cache is not: a book whose file has not been read
// yet answers "no book thread" from memory just as convincingly as a book that
// has never had one — the press can land before open-book's load has resolved,
// or after a sync pull re-read the file under it. Deciding from that answer is
// what started a second conversation on top of a history the user could not see
// (tests/reading/session/book-thread.test.ts).
//
// So the file is read on every press. It costs one read per press of a button
// pressed a handful of times a session, and it is the only way the answer can be
// trusted.

import {
  createBookThread,
  getBookThread,
  loadThreads,
  type Thread,
} from "../../platform/app/threads";

export interface BookThreadIo {
  loadThreads: (bookId: string) => Promise<unknown>;
  getBookThread: (bookId: string) => Thread | undefined;
  createBookThread: (bookId: string, threadId: string) => Thread;
  newThreadId: () => string;
}

export const bookThreadIo: BookThreadIo = {
  loadThreads,
  getBookThread,
  createBookThread,
  newThreadId: () => crypto.randomUUID(),
};

export type BookThreadResult =
  // The thread to open: the one this book already had, or the one just created.
  | { status: "ok"; thread: Thread }
  // The file is there but could not be read. Nothing is created: an empty new
  // conversation would be the second one, and the user is told instead.
  | { status: "unreadable" }
  // The reader moved on while the file was being read.
  | { status: "cancelled" };

export async function resolveBookThread(
  bookId: string,
  cancelled: () => boolean = () => false,
  io: BookThreadIo = bookThreadIo,
): Promise<BookThreadResult> {
  try {
    await io.loadThreads(bookId);
  } catch (e) {
    console.error("failed to load threads", e);
    return { status: "unreadable" };
  }
  if (cancelled()) return { status: "cancelled" };
  const existing = io.getBookThread(bookId);
  return { status: "ok", thread: existing ?? io.createBookThread(bookId, io.newThreadId()) };
}
