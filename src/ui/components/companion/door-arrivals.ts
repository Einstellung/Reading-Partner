// What lands in the door's conversation through the thread store while it is
// open (use-door-chat.ts): this view's own lines, the runtime's landed rows, a
// bell, the brief's opening. Listened to from the moment the thread is loaded,
// not from the render after it: the opening is appended as soon as the day's
// file has been read, which on a fast disk is before that render, and an append
// nobody was listening to never reaches the screen.

import { onThreadMessage, type ThreadMessage } from "../../../platform/app/threads";

/** The rows on screen with one that arrived added, unless a row with its role and timestamp is there already. */
export function withArrivedRow<T extends { ts: number; role: string }>(rows: T[], row: T): T[] {
  return rows.some((m) => m.ts === row.ts && m.role === row.role) ? rows : [...rows, row];
}

/**
 * The rows on screen with the one under this row's role and timestamp swapped
 * for it: a later version of a message already drawn, pulled from another
 * device. Every other row is kept as the object it was, and a row that is not
 * on screen stays off it.
 */
export function withUpdatedRow<T extends { ts: number; role: string }>(rows: T[], row: T): T[] {
  const i = rows.findIndex((m) => m.ts === row.ts && m.role === row.role);
  if (i < 0) return rows;
  const next = rows.slice();
  next[i] = row;
  return next;
}

/**
 * Hear the messages appended to one thread under `key`, and with `update` the
 * later versions of messages it already held (ThreadAppend). Returns the undo.
 */
export function listenToThread(
  key: string,
  threadId: string,
  arrived: (message: ThreadMessage, update: boolean) => void,
  listen: typeof onThreadMessage = onThreadMessage,
): () => void {
  return listen((append) => {
    if (append.key === key && append.threadId === threadId) arrived(append.message, append.update === true);
  });
}
