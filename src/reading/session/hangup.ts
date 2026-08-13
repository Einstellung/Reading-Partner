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

// A talk as the thread file holds it. Only the three fields a transcript is made
// of go to distillation: a display row's trace, images and notices are not the
// talk.
export interface HangupMessage {
  role: "user" | "ai";
  text: string;
  ts: number;
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
  // The thread as the file holds it.
  stored: HangupMessage[];
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

// When a hangup's pass is built. Hanging up mid-answer waits for the turn: the
// reply is still being written, so a transcript read now would end on a half
// sentence and lose the exchange the reader just had. What the pass is built
// from is split accordingly — the thread file is read late, through
// `readStored`, once the turn has written its answer into it, while the book and
// its marks are values read at hangup time, because a deferred pass can land
// after the reader has moved to another book and by then they would be that
// book's.
export interface HangupIo {
  call: HangupCall;
  context: HangupContext;
  // The mark this conversation hangs on, absent for the book-level thread and
  // for a mark deleted under it.
  annotation: Annotation | undefined;
  annotations: DistillAnnotation[];
  // The thread as the file holds it now — called when the pass is built.
  readStored(): HangupMessage[];
  // Hand the pass to the turn still writing on that thread; false when nothing
  // is in flight and it can be built at once.
  whenSettled(threadId: string, run: () => void): boolean;
  distill(pass: HangupPass): void;
}

export function deferHangup(io: HangupIo): void {
  const run = () =>
    io.distill(
      hangupPass({
        call: io.call,
        context: io.context,
        annotation: io.annotation,
        stored: io.readStored(),
        annotations: io.annotations,
      }),
    );
  if (!io.whenSettled(io.call.threadId, run)) run();
}
