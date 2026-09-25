// Deleting a mark in the phone reader. A mark with a conversation on it is that
// conversation's only door, so the two go together, the same pairing the desktop
// trace list makes (reading/session/use-mark-doors.ts, use-call.ts dropThread):
// the conversation and the asides off it leave the book's threads file, and any
// other page mark hosting one of those asides goes with them. Marks drawn on
// replies stay (reading/chat-marks.ts: hostMarkIds).
//
// The phone reader holds no threads of its own, so the book's threads file is
// loaded first; the store removes nothing from a book it has not read. A file
// that will not load leaves the conversation where it is and the mark still
// goes, which is what the delete did before it knew about conversations.

import type { Annotation } from "../../../platform/app/reader-contract";
import { hostMarkIds } from "../../../reading/chat-marks";

export interface MarkDeleteIo {
  loadThreads(bookId: string): Promise<unknown>;
  deleteThreadTree(bookId: string, threadId: string): string[];
  deleteAnnotations(bookId: string, ids: string[]): void;
  logThreadDelete(topicId: string, threadId: string): void;
}

// The conversation deleting this mark would take with it, if any.
export function markThreadId(mark: Annotation | undefined): string | null {
  const id = mark?.aiThreadId;
  return typeof id === "string" && id.length > 0 ? id : null;
}

// Deletes the mark and whatever hangs off it; answers with every mark id that
// went, the one asked for first.
export async function deletePhoneMark(
  target: { bookId: string; topicId: string },
  marks: readonly Annotation[],
  markId: string,
  io: MarkDeleteIo,
): Promise<string[]> {
  const threadId = markThreadId(marks.find((m) => m.id === markId));
  let gone: string[] = [];
  if (threadId) {
    const loaded = await io.loadThreads(target.bookId).then(
      () => true,
      (e: unknown) => {
        console.error(`threads for ${target.bookId} did not load; the conversation stays`, e);
        return false;
      },
    );
    if (loaded) gone = io.deleteThreadTree(target.bookId, threadId);
    for (const id of gone) io.logThreadDelete(target.topicId, id);
  }
  const ids = [markId, ...hostMarkIds(marks, gone).filter((id) => id !== markId)];
  io.deleteAnnotations(target.bookId, ids);
  return ids;
}
