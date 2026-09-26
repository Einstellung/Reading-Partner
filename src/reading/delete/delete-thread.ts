// Deleting a conversation from outside a live call: the phone's shelf and lesson
// menus (docs/50 「手机上的删除入口」). The desk deletes the open conversation
// through use-call.ts releaseThreads, which also stops a turn and clears what the
// hook holds; what both do to the record is the same, and is this:
//
// - the conversation and the asides off it leave the book's threads file;
// - each one's images under images/threads/<threadId>/ go;
// - each one gets a thread-delete line in the topic's event log;
// - a page mark that was the door to one of them goes too (chat-marks.ts
//   hostMarkIds); marks drawn on replies stay.
//
// Nothing here is held by a session, so the book's threads file is loaded first:
// the store removes nothing from a book it has not read. A file that will not
// load throws, and nothing is deleted.

import { deleteAnnotations, loadAnnotations } from "../../platform/app/annotations";
import { logEvent } from "../../platform/app/events";
import type { Annotation } from "../../platform/app/reader-contract";
import { deleteThreadImages } from "../../platform/app/thread-images";
import {
  deleteThreadTree,
  flushThreads,
  getBookThread,
  getThread,
  loadThreads,
  patchThreadMessage,
  removeThreadMessage,
  type Thread,
  type ThreadMessage,
} from "../../platform/app/threads";
import { receiptWithoutAside } from "../aside";
import { hostMarkIds } from "../chat-marks";

export interface DeleteThreadDeps {
  loadThreads(bookId: string): Promise<unknown>;
  getThread(bookId: string, threadId: string): Thread | undefined;
  getBookThread(bookId: string): Thread | undefined;
  deleteThreadTree(bookId: string, threadId: string): string[];
  patchMessage(bookId: string, threadId: string, ts: number, patch: Partial<ThreadMessage>): void;
  removeMessage(bookId: string, threadId: string, ts: number): void;
  flushThreads(): Promise<void>;
  loadAnnotations(bookId: string): Promise<Annotation[]>;
  deleteAnnotations(bookId: string, ids: string[]): void;
  removeThreadImages(threadId: string): Promise<void>;
  logThreadDelete(topicId: string, threadId: string): void;
}

export const liveDeleteThreadDeps: DeleteThreadDeps = {
  loadThreads,
  getThread,
  getBookThread,
  deleteThreadTree,
  patchMessage: patchThreadMessage,
  removeMessage: removeThreadMessage,
  flushThreads,
  loadAnnotations,
  deleteAnnotations,
  removeThreadImages: deleteThreadImages,
  logThreadDelete: (topicId, threadId) =>
    logEvent(topicId, "thread-delete", { threadId, book: false }),
};

/** The book a conversation is in, and the topic whose event log records the delete. */
export interface ConversationTarget {
  bookId: string;
  topicId: string;
}

export interface DeletedConversation {
  /** Every thread that went: the ones asked for and the asides off them. */
  threads: string[];
  /** The page marks that were doors to those threads. */
  marks: string[];
}

// Everything keyed by a thread id that is gone, after the store has let go of
// the threads themselves. Images are best-effort: the conversation is already
// deleted, and a folder that would not go is an orphan, not a conversation.
async function settle(
  target: ConversationTarget,
  threads: string[],
  deps: DeleteThreadDeps,
): Promise<DeletedConversation> {
  for (const id of threads) {
    try {
      await deps.removeThreadImages(id);
    } catch (e) {
      console.warn("failed to delete a deleted thread's images", id, e);
    }
    deps.logThreadDelete(target.topicId, id);
  }
  const marks = threads.length > 0 ? hostMarkIds(await deps.loadAnnotations(target.bookId), threads) : [];
  if (marks.length > 0) deps.deleteAnnotations(target.bookId, marks);
  await deps.flushThreads();
  return { threads, marks };
}

/**
 * Delete one conversation and the asides off it: the general case the two below
 * are named for. The phone reader's mark delete does the same from the marks it
 * holds (ui/components/phone/delete-mark.ts).
 */
export async function deleteConversation(
  target: ConversationTarget,
  threadId: string,
  deps: DeleteThreadDeps = liveDeleteThreadDeps,
): Promise<DeletedConversation> {
  await deps.loadThreads(target.bookId);
  return settle(target, deps.deleteThreadTree(target.bookId, threadId), deps);
}

/**
 * Delete a book's book-level conversation with its asides: an EPUB's
 * conversation, or a PDF's lesson (docs/74) — a lesson is that same thread, so
 * the next one starts from the beginning. The book, its marks and its reading
 * position stay. Every book-level thread goes: a file two devices each started
 * one in holds two, and leaving the second would be the conversation coming
 * back.
 */
export async function deleteBookConversation(
  target: ConversationTarget,
  deps: DeleteThreadDeps = liveDeleteThreadDeps,
): Promise<DeletedConversation> {
  await deps.loadThreads(target.bookId);
  const threads: string[] = [];
  for (let t = deps.getBookThread(target.bookId); t; t = deps.getBookThread(target.bookId)) {
    const gone = deps.deleteThreadTree(target.bookId, t.id);
    if (gone.length === 0) break;
    threads.push(...gone);
  }
  return settle(target, threads, deps);
}

/** A PDF's lesson is its book-level conversation (docs/74). */
export const deleteLesson = deleteBookConversation;

/**
 * Delete one aside of a lesson or a book conversation, and its row in the
 * parent (aside.ts receiptWithoutAside). The parent stays.
 */
export async function deleteAside(
  target: ConversationTarget,
  asideId: string,
  deps: DeleteThreadDeps = liveDeleteThreadDeps,
): Promise<DeletedConversation> {
  await deps.loadThreads(target.bookId);
  const parentId = deps.getThread(target.bookId, asideId)?.parentThreadId;
  const parent = parentId ? deps.getThread(target.bookId, parentId) : undefined;
  if (parent) {
    for (const edit of receiptWithoutAside(parent.messages, asideId)) {
      if (edit.mode === "remove") deps.removeMessage(target.bookId, parent.id, edit.ts);
      else deps.patchMessage(target.bookId, parent.id, edit.ts, { text: edit.text, parts: edit.parts });
    }
  }
  return settle(target, deps.deleteThreadTree(target.bookId, asideId), deps);
}
