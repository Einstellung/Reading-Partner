// What a hangup hands to distillation (docs/02, docs/03). Which page the talk
// belongs to and what it was marked on are two rules with two cases each, and a
// call ending is the only place they are decided — so they sit here, out of the
// hook, where they can be read and tested.

import { annotationPage, type Annotation } from "../../platform/app/reader-contract";
import type { DistillAnnotation, DistillMessage } from "../../observation";

export interface HangupCall {
  threadId: string;
  annotationId: string;
  // The book-level thread (docs/03: the top-bar AI button) has no mark.
  isBook?: boolean;
}

export interface HangupContext {
  topicId: string;
  topicName: string;
  bookId: string;
  bookName: string;
  // Where the reader is, 0-based, for the thread that has no mark to point at.
  pageIndex: number | null;
}

export interface HangupPass {
  topicId: string;
  topicName: string;
  bookId: string;
  bookName: string;
  threadId: string;
  trigger: "hangup";
  annotationId: string;
  page: number | null;
  markedText: string;
  messages: DistillMessage[];
  annotations: DistillAnnotation[];
}

export function hangupPass(input: {
  call: HangupCall;
  context: HangupContext;
  // The mark this conversation hangs on, absent for the book-level thread and
  // for a mark deleted under it.
  annotation: Annotation | undefined;
  // The thread as the file holds it. Only the three fields a transcript is made
  // of go: a display row's trace, images and notices are not the talk.
  stored: { role: "user" | "ai"; text: string; ts: number }[];
  annotations: DistillAnnotation[];
}): HangupPass {
  const { call, context, annotation, stored, annotations } = input;
  return {
    topicId: context.topicId,
    topicName: context.topicName,
    bookId: context.bookId,
    bookName: context.bookName,
    threadId: call.threadId,
    trigger: "hangup",
    annotationId: call.annotationId,
    // The book-level thread has no mark: pin its position to the current page.
    page: call.isBook
      ? context.pageIndex !== null
        ? context.pageIndex + 1
        : null
      : annotationPage(annotation as { position?: { pageIndex?: number } } | undefined),
    markedText: call.isBook ? "" : typeof annotation?.text === "string" ? annotation.text : "",
    messages: stored.map(({ role, text, ts }) => ({ role, text, ts })),
    annotations,
  };
}
