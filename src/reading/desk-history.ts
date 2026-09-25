// The replayed half of a reading turn (reading/desk.ts): how much of the
// conversation goes back to the model, what it opens on, where the page images
// ride, and the distillation that runs before older turns fall out of context.

import { ASIDE_KICKOFF } from "./aside";
import { EXPLAIN_KICKOFF } from "./intents";
import { attachPageWindow, type PageWindowImage, type PageWindowPlan } from "./figures/page-window";
import { listThreads, type ThreadMessage } from "../platform/app/threads";
import {
  distillThread,
  distillUnitOf,
  pagelessMarkIds,
  type DistillAnnotation,
  type DistillThreadOptions,
  type UnitThread,
} from "../memory";

// Replayed thread history is trimmed to this many messages per turn; crossing
// the cap fires the fallback distillation before older turns fall out
// of context (docs/02: hangup is the main trigger, trimming the backstop).
export const HISTORY_KEEP = 40;
// The trim-triggered distillation re-fires only after this many new messages.
export const TRIM_DISTILL_MIN_NEW = 20;
// How short the replayed history gets when the budget ladder reaches its last
// rung. Three exchanges: above the two rounds that are never dropped, below
// anything that would still be called a conversation.
export const HISTORY_KEEP_TIGHT = 6;

export interface ReadingTurnMessage {
  role: "user" | "ai";
  text: string;
  images?: { data: string; mediaType: string }[];
}

// How many messages are replayed, given what the budget gave up.
export function historyKeep(dropped: ReadonlySet<string>): number {
  return dropped.has("history-trim") ? HISTORY_KEEP_TIGHT : HISTORY_KEEP;
}

// How many messages of the parent's stretch survive into this turn. The joined
// history is trimmed from the front (composeMessages), so the borrowed half is
// the first thing to go — and on an aside long enough to fill the history by
// itself, or one whose parent is gone, there was never any. The prompt says so
// rather than describing a stretch that is not there.
export function replayedLesson(parentTail: number, prior: number, keep: number): number {
  const cut = Math.max(0, parentTail + prior - keep);
  return Math.max(0, parentTail - cut);
}

export interface ReplayInput {
  // The stretch of the parent an aside was pulled out of; empty on any other thread.
  parentTail: readonly ReadingTurnMessage[];
  // This conversation's own messages.
  prior: readonly ReadingTurnMessage[];
  // A message that is not in the thread: the bell a delegated run rang.
  trailing?: ReadingTurnMessage;
  keep: number;
  // Whether this thread is an aside, which decides the stand-in opening ask.
  aside: boolean;
  // The visual window this turn sends, or null when it sends none.
  pageWindow: { plan: PageWindowPlan; images: readonly PageWindowImage[] } | null;
}

export function composeMessages(input: ReplayInput): ReadingTurnMessage[] {
  const { parentTail, prior, trailing, keep, aside, pageWindow } = input;
  // The parent's stretch first, this conversation's own after. Trimmed from
  // the front, so the borrowed context is what the tight rung gives up before
  // it starts cutting into what the reader said here.
  const history = [...parentTail, ...prior, ...(trailing ? [trailing] : [])];
  const tail = history.length > keep ? history.slice(history.length - keep) : history;
  // Every provider wants the exchange to open on a user message. A thread the
  // reader started from a chip already does, and is replayed as it stands so
  // the model reads the ask they actually picked. What needs a stand-in is a
  // tail that opens on a reply: a thread from before the chips, and any thread
  // long enough that the trim above cut its first message off.
  const opensOnUser = tail.length > 0 && tail[0].role === "user";
  const msgs: ReadingTurnMessage[] = opensOnUser
    ? [...tail]
    : [{ role: "user" as const, text: aside ? ASIDE_KICKOFF : EXPLAIN_KICKOFF }, ...tail];
  // The pictures ride the message being answered and nothing else. Every
  // earlier turn of this thread was sent the same window when it was the
  // current one, so those messages carry the line that says so instead — one
  // window in context at a time, however long the conversation runs.
  if (!pageWindow) return msgs;
  return attachPageWindow(msgs, pageWindow.plan, pageWindow.images);
}

// The thread a turn is taken on, as the trim-triggered distillation needs it.
export interface TrimDistillThread {
  topicId: string;
  topicName: string;
  bookId: string;
  bookName: string;
  threadId: string;
  annotationId: string;
  // The page the turn is about, and the reader's own page.
  page: number | null;
  currentPage: number | null;
  selectionText: string;
  // The thread's own messages, not what gets replayed.
  messages: readonly ThreadMessage[];
}

// The pass the trim fires, given every thread of the book and its marks.
export function trimDistillOptions(
  t: TrimDistillThread,
  threads: readonly UnitThread[],
  marks: DistillAnnotation[],
): DistillThreadOptions {
  // Whose arrears these are (memory/observations/arrears.ts). A chat-span
  // aside has no mark, so it is no unit of its own and this stretch belongs to
  // the conversation it was pulled out of.
  const unit = distillUnitOf(threads, t.threadId, pagelessMarkIds(marks));
  // Where the pass says it happened follows the unit. Folded into the lesson,
  // the position is the reader's own page — the same answer the lesson gives
  // for itself — and there is no marked passage, because the lesson has none.
  const folded = !!unit && unit.threadId !== t.threadId;
  return {
    topicId: t.topicId,
    topicName: t.topicName,
    bookId: t.bookId,
    bookName: t.bookName,
    threadId: unit?.threadId ?? t.threadId,
    trigger: "trim",
    annotationId: unit?.annotationId ?? t.annotationId,
    page: folded ? (unit.annotationId === "" ? t.currentPage : null) : t.page,
    markedText: folded ? "" : t.selectionText,
    messages:
      unit?.messages ??
      t.messages.map(({ id, role, text, ts }) => ({ ...(id ? { id } : {}), role, text, ts })),
    ...(unit ? { parts: unit.parts } : {}),
    annotations: marks,
  };
}

// Replay only the tail of a long thread, and before the older turns fall
// out of context, run the fallback distillation (docs/02: hangup is the
// main trigger, the trim is the backstop).
//
// Counted on the thread's own messages, not on what gets replayed: the
// parent's tail rides an aside's every turn and is not a length this
// conversation reached.
export function distillOnTrim(
  t: Omit<TrimDistillThread, "topicId"> & {
    topicId: string | null;
    // The document on screen; its file holds a mark drawn on a supplement.
    docId: string;
    marks: () => DistillAnnotation[];
  },
): void {
  const { topicId } = t;
  if (t.messages.length <= HISTORY_KEEP || !topicId) return;
  const marks = t.marks();
  // Both files: the lesson and its asides are the book's, and a mark drawn on
  // a supplement has its conversation in that document's file (docs/67). A
  // stretch of either can be the unit this pass belongs to.
  const threads =
    t.docId === t.bookId
      ? listThreads(t.bookId)
      : [...listThreads(t.bookId), ...listThreads(t.docId)];
  void distillThread(trimDistillOptions({ ...t, topicId }, threads, marks), TRIM_DISTILL_MIN_NEW);
}
