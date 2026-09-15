// The two identities a reading session has (docs/67 「辅助资料」).
//
// `bookId` is the book the session belongs to: its conversation, its prep, its
// event log, its outline. `docId` is the bytes on screen, which is the book
// itself or one of its supplements. They are the same id for all of a session
// spent in the book, and that is why one ref used to do for both.
//
// Everything that is "this file on screen" follows docId — marks, reading
// position, full text, figures, the engine. Everything that is "this reading
// session" follows bookId.

/** The session's two ids, as the callbacks read them. */
export interface SessionDocs {
  bookId: string | null;
  docId: string | null;
}

/** Whether the bytes on screen are the book's own. */
export function readingTheBook(docs: SessionDocs): boolean {
  return docs.docId !== null && docs.docId === docs.bookId;
}

// As much of a conversation as the answer below reads.
export interface ThreadOwner {
  isBook?: boolean;
  aside?: unknown;
}

/**
 * Which document's thread file holds this conversation.
 *
 * The book-level thread is the book's wherever the reader is standing — the
 * top-bar button opens it while a supplement is on screen — and so is every
 * side conversation, because an aside only ever comes off the book-level
 * thread (call-state.ts: mayOpenAside). A mark's conversation belongs to the
 * document the mark is drawn on, which is the supplement when one is open.
 */
export function threadHome(call: ThreadOwner | null | undefined, docs: SessionDocs): string | null {
  if (call && (call.isBook === true || call.aside)) return docs.bookId;
  return docs.docId;
}
