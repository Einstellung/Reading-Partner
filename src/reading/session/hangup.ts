// What a hangup hands to distillation (docs/02, docs/03). Which conversation the
// talk belongs to, which page, and what it was marked on are decided nowhere
// else, so they sit here, out of the hook, where they can be read and tested.

import { annotationPage, type Annotation } from "../../platform/app/reader-contract";
import { listThreads } from "../../platform/app/threads";
import {
  distillUnitOf,
  pagelessMarkIds,
  type DistillAnnotation,
  type DistillMessage,
  type DistillUnitPart,
  type UnitThread,
} from "../../observation";

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
  // The threads this transcript was merged from, so the pass moves a cursor per
  // thread (observation/distill/arrears.ts).
  parts: DistillUnitPart[];
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
  // The book's threads, so the pass runs over the whole conversation rather than
  // one branch of it. A chat-span aside is not a unit of its own — it folds into
  // the thread it was pulled out of (observation/distill/arrears.ts) — and a
  // lesson that had asides open owes their transcripts too. Absent leaves every
  // line below exactly as it was before asides existed.
  threads?: readonly UnitThread[];
}): HangupPass {
  const { call, context, annotation, stored, annotations } = input;
  const own = stored.map(({ role, text, ts }) => ({ role, text, ts }));
  // The open thread's messages are the live ones, not the file's: hanging up
  // mid-answer waited for the reply and the file may be a debounce behind.
  const records: UnitThread[] = (input.threads ?? []).map((t) =>
    t.id === call.threadId ? { ...t, messages: own } : t,
  );
  if (!records.some((t) => t.id === call.threadId)) {
    records.push({ id: call.threadId, annotationId: call.annotationId, messages: own });
  }
  const unit = distillUnitOf(records, call.threadId, pagelessMarkIds(annotations)) ?? {
    threadId: call.threadId,
    annotationId: call.annotationId,
    messages: own,
    parts: [{ threadId: call.threadId, messages: own }],
  };
  // Where the pass says it happened follows the unit, not the call. Hanging up
  // inside an aside distils the lesson it belongs to, and the lesson's position
  // is where the reader is — the same answer the lesson gives when it hangs up
  // itself. A parent that turns out to carry a mark is not resolvable from here
  // (the annotation in hand is the call's), so it gets neither.
  const currentPage = context.pageIndex !== null ? context.pageIndex + 1 : null;
  const isSelf = unit.threadId === call.threadId;
  return {
    topicId: context.topicId,
    topicName: context.topicName,
    bookId: context.bookId,
    bookName: context.bookName,
    threadId: unit.threadId,
    trigger: "hangup",
    annotationId: unit.annotationId,
    // The book-level thread has no mark: pin its position to the current page.
    page: isSelf
      ? call.isBook
        ? currentPage
        : annotationPage(annotation as { position?: { pageIndex?: number } } | undefined)
      : unit.annotationId === ""
        ? currentPage
        : null,
    markedText:
      isSelf && !call.isBook && typeof annotation?.text === "string" ? annotation.text : "",
    messages: unit.messages,
    parts: unit.parts,
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
  // The book's threads, read at the same moment and for the same reason: which
  // conversation this hangup belongs to is a fact about the thread's neighbours
  // (hangupPass). Defaults to the live store, so no caller has to remember it.
  readBookThreads?(): readonly UnitThread[];
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
        threads: (io.readBookThreads ?? (() => listThreads(io.context.bookId)))(),
      }),
    );
  if (!io.whenSettled(io.call.threadId, run)) run();
}
