// The retell's outline: the decisions, in the order they will be given, and the
// mapping between them and the chapter numbers the retell talks in.
//
// The retell walks one numbered list of chapters (reading/retell), and a
// retell can hold several books. So the books' skeletons are laid end to end into
// one numbered list — a slot per chapter, remembering which book and which of
// its chapters it is — and the decisions on disk stay in book+chapter terms,
// which is the only form that still means something when a material is added or
// dropped.
//
// Everything here is pure. The reader's edits (move an entry, remove it) and the
// AI's writes go through the same functions onto the same array, so the outline
// beside the conversation and the record the AI reads cannot drift apart.

import { bucketMarks } from "./marks";
import type {
  Mark,
  RetellChapter,
  PlanDecision,
  RetellPlan,
  Skeleton,
  SkeletonSource,
  Retell,
  RetellDecision,
} from "./types";
import { PLAN_VERSION } from "./types";

// One chapter of one material, as the retell numbers it.
export interface RetellSlot {
  // 1-based position in the combined chapter list.
  index: number;
  bookId: string;
  bookTitle: string;
  // 1-based chapter index inside that material's own skeleton.
  chapter: number;
  title: string;
}

// A material with its skeleton already built (material.ts assembles these).
export interface MaterialSkeleton {
  bookId: string;
  title: string;
  skeleton: Skeleton;
}

export interface CombinedChapters {
  chapters: RetellChapter[];
  slots: RetellSlot[];
}

// Lay every material's chapters end to end. With one material this is the
// book's own skeleton, renumbered by nothing; with several, each chapter's title
// carries its book so a numbered list of forty lines still says what it is.
export function combineChapters(materials: readonly MaterialSkeleton[]): CombinedChapters {
  const chapters: RetellChapter[] = [];
  const slots: RetellSlot[] = [];
  const many = materials.length > 1;
  let index = 0;
  for (const m of materials) {
    for (const c of m.skeleton.chapters) {
      index += 1;
      const title = many ? `${m.title} — ${c.title}` : c.title;
      chapters.push({ ...c, index, title });
      slots.push({
        index,
        bookId: m.bookId,
        bookTitle: m.title,
        chapter: c.index,
        title: c.title,
      });
    }
  }
  return { chapters, slots };
}

// Where the combined chapter list came from, for the one line the prompt prints
// about it. A retell whose materials disagree names the best source it has: the
// alternative is telling the model the whole list is guesswork when most of it
// is a real chapter plan.
const SOURCE_RANK: SkeletonSource[] = ["notes-plan", "outline", "whole-book"];

export function combinedSource(materials: readonly MaterialSkeleton[]): SkeletonSource {
  for (const source of SOURCE_RANK) {
    if (materials.some((m) => m.skeleton.source === source)) return source;
  }
  return "whole-book";
}

// The reader's marks under the combined chapter numbering. Bucketed per material
// first: page ranges from two books overlap, so one pass over the combined list
// would file a mark on page 10 of the second book under the first book's chapter.
export function bucketRetellMarks(
  materials: readonly (MaterialSkeleton & { annotations: readonly Mark[] })[],
  slots: readonly RetellSlot[],
): Map<number, Mark[]> {
  const out = new Map<number, Mark[]>();
  for (const slot of slots) out.set(slot.index, []);
  for (const m of materials) {
    const buckets = bucketMarks(m.skeleton.chapters, m.annotations);
    for (const [chapter, marks] of buckets) {
      const slot = slotFor(slots, m.bookId, chapter);
      if (slot) out.set(slot.index, marks);
    }
  }
  return out;
}

export function slotAt(slots: readonly RetellSlot[], index: number): RetellSlot | undefined {
  return slots.find((s) => s.index === index);
}

export function slotFor(
  slots: readonly RetellSlot[],
  bookId: string,
  chapter: number,
): RetellSlot | undefined {
  return slots.find((s) => s.bookId === bookId && s.chapter === chapter);
}

// The retell's decisions as the prompt reads them: chapter numbers in
// the combined list, in the order the reader has the outline. A decision whose
// material is no longer in the retell has no slot and is left out — it is still on
// disk, it just is not part of this retell's numbering any more.
export function toRetellPlan(
  retell: Retell,
  slots: readonly RetellSlot[],
  now = retell.updatedAt,
): RetellPlan {
  const decisions: PlanDecision[] = [];
  for (const d of retell.decisions) {
    const slot = slotFor(slots, d.bookId, d.chapter);
    if (!slot) continue;
    decisions.push({
      chapter: slot.index,
      title: d.title || slot.title,
      include: d.include,
      points: d.points,
      ...(d.figure ? { figure: d.figure } : {}),
      ...(d.note ? { note: d.note } : {}),
      updatedAt: d.updatedAt,
    });
  }
  return {
    version: PLAN_VERSION,
    createdAt: retell.createdAt,
    updatedAt: now,
    decisions,
  };
}

// A decision the retell just recorded, in combined-chapter terms, translated
// back to the book it is about. Null when the number is not a chapter of this
// retell (the tool has already rejected those, so this is the belt).
export function toRetellDecision(
  slots: readonly RetellSlot[],
  decision: PlanDecision,
): RetellDecision | null {
  const slot = slotAt(slots, decision.chapter);
  if (!slot) return null;
  return {
    bookId: slot.bookId,
    chapter: slot.chapter,
    // The combined title carries the book name when there are several; the entry
    // is already filed under its book, so it keeps the chapter's own title.
    title: slot.title || decision.title,
    include: decision.include,
    points: decision.points,
    ...(decision.figure ? { figure: decision.figure } : {}),
    ...(decision.note ? { note: decision.note } : {}),
    updatedAt: decision.updatedAt,
  };
}

function sameEntry(a: RetellDecision, b: { bookId: string; chapter: number }): boolean {
  return a.bookId === b.bookId && a.chapter === b.chapter;
}

// Merge one decision in. A chapter that already has an entry is replaced *in
// place*: the reader may have moved it, and re-recording it must not throw that
// away. A new one goes on the end, which is the order the retell walks in.
export function upsertDecision(
  decisions: readonly RetellDecision[],
  decision: RetellDecision,
): RetellDecision[] {
  const at = decisions.findIndex((d) => sameEntry(d, decision));
  if (at < 0) return [...decisions, decision];
  const next = decisions.slice();
  next[at] = decision;
  return next;
}

// Move the entry at `from` by `delta` places, clamped. Returns the same array
// (by value) when the move would go off either end, so a disabled-looking button
// that is pressed anyway changes nothing.
export function moveDecision(
  decisions: readonly RetellDecision[],
  from: number,
  delta: number,
): RetellDecision[] {
  const to = from + delta;
  if (from < 0 || from >= decisions.length || to < 0 || to >= decisions.length) {
    return [...decisions];
  }
  const next = decisions.slice();
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}

// Drop an entry entirely. Different from cutting it: a cut chapter is a settled
// question that stays in the record, a removed one goes back to being a chapter
// the retell has not reached, and it will be asked about again.
export function removeDecision(
  decisions: readonly RetellDecision[],
  bookId: string,
  chapter: number,
): RetellDecision[] {
  return decisions.filter((d) => !sameEntry(d, { bookId, chapter }));
}

// Cut an entry from the retell, or put it back, without losing what was said about
// it. No-op when there is no such entry.
export function setIncluded(
  decisions: readonly RetellDecision[],
  bookId: string,
  chapter: number,
  include: boolean,
  now: number,
): RetellDecision[] {
  return decisions.map((d) =>
    sameEntry(d, { bookId, chapter }) && d.include !== include
      ? { ...d, include, updatedAt: now }
      : d,
  );
}

// One row of the outline pane. The book label is only worth showing when the
// retell has more than one material.
export interface OutlineRow {
  key: string;
  bookId: string;
  chapter: number;
  title: string;
  bookLabel: string | null;
  include: boolean;
  points: string[];
  figure?: string;
  note?: string;
  // 1-based position among the entries that are actually in the retell, or null
  // for a cut one — a cut chapter has no number in the running order.
  position: number | null;
}

export function outlineRows(retell: Retell, slots: readonly RetellSlot[] = []): OutlineRow[] {
  const many = retell.materials.length > 1;
  const titleOf = (bookId: string) =>
    retell.materials.find((m) => m.bookId === bookId)?.title ?? bookId;
  let position = 0;
  return retell.decisions.map((d) => {
    if (d.include) position += 1;
    const slot = slotFor(slots, d.bookId, d.chapter);
    return {
      key: `${d.bookId}#${d.chapter}`,
      bookId: d.bookId,
      chapter: d.chapter,
      title: d.title || slot?.title || `Chapter ${d.chapter}`,
      bookLabel: many ? titleOf(d.bookId) : null,
      include: d.include,
      points: d.points,
      ...(d.figure ? { figure: d.figure } : {}),
      ...(d.note ? { note: d.note } : {}),
      position: d.include ? position : null,
    };
  });
}
