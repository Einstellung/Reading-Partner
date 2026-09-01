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
import {
  countNewUnitMessages,
  type DistillAnnotation,
  type DistillMessage,
  type DistillUnitPart,
} from "./distill";

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

// One conversation's worth of transcript: the merged view that goes to the
// model, the thread the pass is named for, and the threads whose cursors the
// pass moves.
export interface DistillUnit {
  threadId: string;
  annotationId: string;
  messages: DistillMessage[];
  parts: DistillUnitPart[];
}

// Whether a thread's transcript is folded into another's, and whose.
//
// An aside with no page resolves to page null and markedText "" — it would spend
// a sub-agent run on a pass that cannot say where in the book it happened. It is
// not a conversation of its own anyway: the reader pulled a sentence out of the
// lesson and went back to it. So it joins its parent, whose cursor then advances
// over both, and one learn session distils once.
//
// An aside drawn on a page has a mark and a page, so it stays a unit, exactly
// like the mark thread it is drawn beside. "Is there a page" is the whole test.
// It used to be "is there an annotation", which said the same thing until a pen
// could mark an AI reply (docs/09): those marks are annotations too, and the
// aside one of them opens has no page either.
//
// `pageless` is the annotation ids that sit on no page, which only the caller
// can know — the rule is applied to the live store's records and to the sweep's
// on-disk ones and neither carries the annotations. It names the exception
// rather than the norm on purpose: an id that is not in it, including one that
// is in no list the caller had, is treated as a page mark and keeps its own
// unit, which is what every record written before chat marks existed is.
//
// An aside whose parent is not here is a unit of its own rather than nothing.
// Deleting a parent cascades, but sync can leave one behind
// (platform/app/threads.ts), and folding into a thread that does not exist is
// how the reader's best material would go quietly missing.
function foldsInto(
  t: UnitThread,
  present: ReadonlySet<string>,
  pageless?: ReadonlySet<string>,
): string | null {
  const onPage = t.annotationId !== "" && !pageless?.has(t.annotationId);
  if (onPage || !t.parentThreadId) return null;
  return present.has(t.parentThreadId) ? t.parentThreadId : null;
}

// Only the fields a transcript is made of, the same narrowing the hangup path
// has always done: a stored message also carries image filenames and the
// display row's parts, and neither is the retell.
//
// The thread id is stamped on here rather than worked out later, because this
// is the last place that still knows it. A unit's messages are merged across
// threads by timestamp below, and after that merge the only thread id in scope
// is the parent's — which is wrong for every line that came from a folded
// aside, and was 66 of the 76 unresolvable anchors on disk (transcript.ts).
function plain(messages: readonly DistillMessage[], threadId: string): DistillMessage[] {
  return messages.map(({ id, role, text, ts }) => ({ ...(id ? { id } : {}), role, text, ts, threadId }));
}

// Every thread of one book reduced to the passes that should run over it.
//
// A folded transcript is merged into its parent's by timestamp. An aside opens
// mid-lesson and the reader goes back to the lesson after, so a merge by ts is
// append-only in time — which is what lets one cursor, counted in messages,
// index the lot across restarts.
export function distillUnits(
  threads: readonly UnitThread[],
  pageless?: ReadonlySet<string>,
): DistillUnit[] {
  const present = new Set(threads.map((t) => t.id));
  const folded = new Map<string, DistillUnitPart[]>();
  for (const t of threads) {
    const into = foldsInto(t, present, pageless);
    if (into === null) continue;
    folded.set(into, [...(folded.get(into) ?? []), { threadId: t.id, messages: plain(t.messages, t.id) }]);
  }
  const units: DistillUnit[] = [];
  for (const t of threads) {
    if (foldsInto(t, present, pageless) !== null) continue;
    const own: DistillUnitPart = { threadId: t.id, messages: plain(t.messages, t.id) };
    const joined = folded.get(t.id);
    const parts = joined ? [own, ...joined] : [own];
    const messages = parts.flatMap((p) => p.messages);
    if (joined) messages.sort((a, b) => a.ts - b.ts);
    units.push({ threadId: t.id, annotationId: t.annotationId, messages, parts });
  }
  return units;
}

// The unit one thread belongs to — the parent's when it folds in, its own
// otherwise. Null when the thread is not among the ones given.
export function distillUnitOf(
  threads: readonly UnitThread[],
  threadId: string,
  pageless?: ReadonlySet<string>,
): DistillUnit | null {
  const self = threads.find((t) => t.id === threadId);
  if (!self) return null;
  const into = foldsInto(self, new Set(threads.map((t) => t.id)), pageless) ?? threadId;
  return distillUnits(threads, pageless).find((u) => u.threadId === into) ?? null;
}

export interface ThreadArrears {
  threadId: string;
  annotationId: string;
  page: number | null;
  markedText: string;
  // The whole thread, oldest first. A conversation about one passage is the
  // unit; the cursor only decides whether to run.
  messages: DistillMessage[];
  // The threads this unit is made of, when it is made of more than one. Absent
  // is the ordinary case and means the thread itself (distillUnits).
  parts?: DistillUnitPart[];
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

// The marks that sit on no page — the ones drawn on an AI reply — for the unit
// rule above. Built from the same DistillAnnotation list the sweep already has,
// so no caller needs the engine shapes to answer it.
export function pagelessMarkIds(marks: readonly DistillAnnotation[]): Set<string> {
  return new Set(marks.filter((m) => m.page === null).map((m) => m.id));
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

// The arrears of one unit, given how much of it is already folded in. A number
// is where this thread's own cursor stands; a unit made of more than one thread
// needs the lookup, because each of them carries a cursor of its own.
export function threadArrears(
  thread: Omit<ThreadArrears, "newMessages">,
  cursor: number | ((threadId: string) => number),
): ThreadArrears {
  const at = typeof cursor === "number" ? () => cursor : cursor;
  const parts = thread.parts ?? [{ threadId: thread.threadId, messages: thread.messages }];
  return { ...thread, newMessages: countNewUnitMessages(parts, at) };
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
