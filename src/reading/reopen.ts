// Reopening a conversation that already exists (docs/03).
//
// Four doors lead back into one: a mark tapped on the page, a mark tapped on a
// reply, a row of the trace list, the receipt chip in a transcript. What each of
// them holds is a record out of the threads file; what the call needs is which
// of the three kinds that record is (platform/app/threads.ts: threadKind).
//
// Deriving that at each door is how the book's conversation came to be reopened
// as an ordinary one — the trace list knew a thread id and a mark id and passed
// both, and neither says "this is the lesson". The kind is read off the record
// here, once, and the doors carry the record.

import { asideFraming, type AsideFraming } from "./aside";
import type { CallView } from "./call-state";
import type { Annotation } from "../platform/app/reader-contract";
import { threadKind, type Thread } from "../platform/app/threads";

// The identity half of an opening call: which conversation, what it is anchored
// on, and which of the three it is. The view and the anchor are the door's.
export interface ReopenedCall {
  threadId: string;
  annotationId: string;
  isBook?: boolean;
  aside?: AsideFraming & { parentView?: CallView };
}

// The words a mark shows: what was marked, or the note written on it when the
// mark itself carries no text.
export function markExcerpt(ann: Annotation | undefined): string {
  if (!ann) return "";
  if (typeof ann.text === "string" && ann.text) return ann.text;
  if (typeof ann.comment === "string" && ann.comment) return ann.comment;
  return "";
}

// `markText` is the passage a drawn aside hangs on, which the record does not
// hold (asideFraming). `parentView` is the view the conversation this one came
// off was in, which only a door opened while that one is on screen knows.
export function reopenCall(
  thread: Pick<Thread, "id" | "annotationId" | "book" | "parentThreadId" | "asideAnchor">,
  markText = "",
  parentView?: CallView,
): ReopenedCall {
  const kind = threadKind(thread);
  // The record's own anchor, never the mark the reader pressed. The send path
  // looks the annotation up by this id and puts its words in the prompt's
  // anchor slot (reading/turn.ts), so a foreign one seats a stray sentence in
  // the middle of a conversation about something else.
  const on = { threadId: thread.id, annotationId: kind === "book" ? "" : thread.annotationId };
  if (kind === "book") return { ...on, isBook: true };
  const framing = kind === "aside" ? asideFraming(thread, markText) : null;
  if (!framing) return on;
  return { ...on, aside: { ...framing, ...(parentView ? { parentView } : {}) } };
}
