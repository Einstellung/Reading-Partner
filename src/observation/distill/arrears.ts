// What the observations still owe the reader, and which single debt to pay next.
//
// Distillation used to have two triggers, hangup and a trimmed history, so a
// reader who marked up a whole book without ever asking a question was invisible:
// the topic never got a memory- directory at all. The replacement is arrears
// rather than a dirty flag — every debt here is derived from what is already on
// disk (the marks in annotations-<bookId>.json against the book's cursor, the
// messages in threads-<bookId>.json against the thread's), so losing power, the
// network or the process loses nothing. The next sweep works it out again.
//
// Pure: live.ts reads the files and runs the job this picks.

import type { Annotation } from "../../platform/app/reader-contract";
import { annotationPage } from "../../platform/app/reader-contract";
import { countNewReaderMessages, type DistillAnnotation, type DistillMessage } from "./distill";

// How often the app looks, while it is open.
export const SWEEP_INTERVAL_MS = 30 * 60_000;
// How long a topic rests after a pass before it may have another. Time and
// volume both have to be met: a reader who marks two lines an hour all day would
// otherwise spend a sub-agent run on each pair.
export const MIN_DISTILL_GAP_MS = 30 * 60_000;
// New marks that make a pass worth its cost on their own.
export const MIN_NEW_MARKS = 5;
// New reader messages that make a pass worth its cost on their own. One is
// enough: something the reader said is the scarce thing.
export const MIN_NEW_MESSAGES = 1;

// --- what counts as one conversation ---

// A thread as the unit rule sees it. Structural, so the rule can be applied to
// the live store's records and to the sweep's on-disk ones without either side
// importing the other's shape.
export interface UnitThread {
  id: string;
  annotationId: string;
  parentThreadId?: string;
  messages: readonly DistillMessage[];
}

// One conversation's worth of transcript, and the thread whose cursor covers it.
export interface DistillUnit {
  threadId: string;
  annotationId: string;
  messages: DistillMessage[];
}

// Whether a thread's transcript is folded into another's, and whose.
//
// A chat-span aside has no annotation, so the sweep resolves it to page null and
// markedText "" — it would spend a sub-agent run on a pass that cannot say where
// in the book it happened. It is not a conversation of its own anyway: the
// reader pulled a sentence out of the lesson and went back to it. So it joins
// its parent, whose cursor then advances over both, and one learn session
// distils once.
//
// A mark-anchored aside has a mark and a page, so it stays a unit, exactly like
// the mark thread it is drawn beside. "Does it have an annotation" is the whole
// test; there is no switch on how the aside was opened.
//
// An aside whose parent is not here is a unit of its own rather than nothing.
// Deleting a parent cascades, but sync can leave one behind
// (platform/app/threads.ts), and folding into a thread that does not exist is
// how the reader's best material would go quietly missing.
function foldsInto(t: UnitThread, present: ReadonlySet<string>): string | null {
  if (t.annotationId !== "" || !t.parentThreadId) return null;
  return present.has(t.parentThreadId) ? t.parentThreadId : null;
}

// Only the three fields a transcript is made of, the same narrowing the hangup
// path has always done: a stored message also carries image filenames and the
// display row's parts, and neither is the talk.
function plain(messages: readonly DistillMessage[]): DistillMessage[] {
  return messages.map(({ role, text, ts }) => ({ role, text, ts }));
}

// Every thread of one book reduced to the passes that should run over it.
//
// A folded transcript is merged into its parent's by timestamp. An aside opens
// mid-lesson and the reader goes back to the lesson after, so a merge by ts is
// append-only in time — which is what lets one cursor, counted in messages,
// index the lot across restarts.
export function distillUnits(threads: readonly UnitThread[]): DistillUnit[] {
  const present = new Set(threads.map((t) => t.id));
  const folded = new Map<string, DistillMessage[]>();
  for (const t of threads) {
    const into = foldsInto(t, present);
    if (into === null) continue;
    folded.set(into, [...(folded.get(into) ?? []), ...plain(t.messages)]);
  }
  const units: DistillUnit[] = [];
  for (const t of threads) {
    if (foldsInto(t, present) !== null) continue;
    const joined = folded.get(t.id);
    const messages = joined ? [...plain(t.messages), ...joined] : plain(t.messages);
    if (joined) messages.sort((a, b) => a.ts - b.ts);
    units.push({ threadId: t.id, annotationId: t.annotationId, messages });
  }
  return units;
}

// The unit one thread belongs to — the parent's when it folds in, its own
// otherwise. Null when the thread is not among the ones given.
export function distillUnitOf(
  threads: readonly UnitThread[],
  threadId: string,
): DistillUnit | null {
  const self = threads.find((t) => t.id === threadId);
  if (!self) return null;
  const into = foldsInto(self, new Set(threads.map((t) => t.id))) ?? threadId;
  return distillUnits(threads).find((u) => u.threadId === into) ?? null;
}

export interface ThreadArrears {
  threadId: string;
  annotationId: string;
  page: number | null;
  markedText: string;
  // The whole thread, oldest first. A conversation about one passage is the
  // unit; the cursor only decides whether to run.
  messages: DistillMessage[];
  newMessages: number;
}

export interface BookArrears {
  bookId: string;
  bookName: string;
  // Every mark on the book, unfiltered — the pass filters against the cursor it
  // reads for itself, so a sweep and a pass can never disagree about it.
  marks: DistillAnnotation[];
  newMarks: number;
  threads: ThreadArrears[];
}

export interface TopicArrears {
  topicId: string;
  topicName: string;
  lastDistilledAt: number | null;
  books: BookArrears[];
}

export type DistillJob =
  | { kind: "thread"; topicId: string; topicName: string; book: BookArrears; thread: ThreadArrears }
  | { kind: "marks"; topicId: string; topicName: string; book: BookArrears };

// Engine annotations reduced to what distillation reads. `now` fills in for a
// mark whose stored date is missing or unparseable — treating it as new is the
// safe direction: it gets looked at once and then sits behind the cursor.
export function toDistillAnnotations(
  annotations: readonly Annotation[],
  now: () => number = Date.now,
): DistillAnnotation[] {
  return annotations.map((a) => {
    const created = typeof a.dateCreated === "string" ? Date.parse(a.dateCreated) : NaN;
    return {
      id: a.id,
      page: annotationPage(a as { position?: { pageIndex?: number } }),
      text: typeof a.text === "string" ? a.text : "",
      comment: typeof a.comment === "string" ? a.comment : undefined,
      createdAt: Number.isFinite(created) ? created : now(),
    };
  });
}

// Marks created strictly after the book's cursor. Marks with neither a passage
// nor a note are dropped, matching what a pass would actually be shown
// (selectSilentMarks).
export function countNewMarks(
  marks: readonly DistillAnnotation[],
  since: number | null,
): number {
  let n = 0;
  for (const a of marks) {
    if (since !== null && a.createdAt <= since) continue;
    if (a.text.trim() === "" && (a.comment ?? "").trim() === "") continue;
    n++;
  }
  return n;
}

// The arrears of one thread, given how many of its messages are already folded in.
export function threadArrears(
  thread: Omit<ThreadArrears, "newMessages">,
  cursor: number,
): ThreadArrears {
  return { ...thread, newMessages: countNewReaderMessages(thread.messages, cursor) };
}

export function topicDebt(topic: TopicArrears): { marks: number; messages: number } {
  let marks = 0;
  let messages = 0;
  for (const book of topic.books) {
    marks += book.newMarks;
    for (const thread of book.threads) messages += thread.newMessages;
  }
  return { marks, messages };
}

// The most any one book owes in marks. The mark threshold is per book, not per
// topic: a pass runs over one book, so three unread marks here and two there is
// not five marks' worth of anything.
export function maxBookMarks(topic: TopicArrears): number {
  let most = 0;
  for (const book of topic.books) most = Math.max(most, book.newMarks);
  return most;
}

// Enough time since the last pass, and enough owed. A topic never distilled has
// no gap to wait out — the first pass is the one this whole mechanism exists for.
export function isTopicDue(topic: TopicArrears, now: number): boolean {
  if (topic.lastDistilledAt !== null && now - topic.lastDistilledAt < MIN_DISTILL_GAP_MS) {
    return false;
  }
  const { messages } = topicDebt(topic);
  return messages >= MIN_NEW_MESSAGES || maxBookMarks(topic) >= MIN_NEW_MARKS;
}

// The one job to run this tick, or null. One at a time on purpose: a sweep that
// fired every due topic at once would spend a burst of sub-agent runs the moment
// the app came back from a week away.
//
// Within the chosen topic a conversation wins over marks. Something the reader
// said is the scarcer signal, and the transcript pass folds that book's marks in
// on the way past anyway.
export function selectDistillJob(
  topics: readonly TopicArrears[],
  now: number,
): DistillJob | null {
  let best: { topic: TopicArrears; score: number } | null = null;
  for (const topic of topics) {
    if (!isTopicDue(topic, now)) continue;
    const { marks, messages } = topicDebt(topic);
    const score = marks + messages;
    // Ties go to the earlier topic id, so a sweep is reproducible.
    if (!best || score > best.score || (score === best.score && topic.topicId < best.topic.topicId)) {
      best = { topic, score };
    }
  }
  if (!best) return null;
  const { topic } = best;

  let talked: { book: BookArrears; thread: ThreadArrears } | null = null;
  for (const book of topic.books) {
    for (const thread of book.threads) {
      if (thread.newMessages === 0) continue;
      if (!talked || thread.newMessages > talked.thread.newMessages) talked = { book, thread };
    }
  }
  if (talked) {
    return {
      kind: "thread",
      topicId: topic.topicId,
      topicName: topic.topicName,
      book: talked.book,
      thread: talked.thread,
    };
  }

  let marked: BookArrears | null = null;
  for (const book of topic.books) {
    if (book.newMarks < MIN_NEW_MARKS) continue;
    if (!marked || book.newMarks > marked.newMarks) marked = book;
  }
  if (!marked) return null;
  return { kind: "marks", topicId: topic.topicId, topicName: topic.topicName, book: marked };
}
