// Which of the AI's observations of this reader ride a lecture turn, and how
// they are printed (docs/09: what the observation layer recorded has to reach
// the teaching). Pure.
//
// Three things this gets right that the opening snapshot does not:
//
// 1. Which book an observation is about is decided by its evidence anchors, not
//    by page numbers in its text. One store spans every book the reader has:
//    measured, 20 entries whose bodies name pages 149-193
//    were all about Hands-On, and chapter 5 of the book the reader was actually
//    in is p.149-193. Anything that reads the page number out of the prose picks
//    the wrong book every time. Newer observations also carry `bookId`
//    outright, which is the same answer without the lookup.
// 2. The chapter in focus decides the order, not membership. The two most useful
//    citations in the measured lecture came from a different book entirely, so a
//    filter would have thrown away the best material in the prompt.
// 3. corrections get their own quota. In the shared snapshot they sort last
//    under a total cap that the types above them exhaust, so one topic's six
//    corrections had never once reached a prompt.
//
// A selected observation is printed as its body, not as its one-line summary:
// the prescription is in the body ("non-AI analogy plus a worked example with
// real numbers; leading with the formula does not work"), and the summary line
// is the part of it that says nothing a lecture can act on.

import {
  serializeIndexLine,
  stripToolResidue,
  trimObservations,
  type Observation,
  type ObservationType,
} from "../../memory";
import { annotationPage, type Annotation } from "../../platform/app/reader-contract";

// Every mark of the open book, by id, with the 1-based page it sits on. The one
// place the "which book is this observation about" lookup gets its evidence.
export function annotationPageMap(
  annotations: readonly Annotation[],
): Map<string, number | null> {
  const out = new Map<string, number | null>();
  for (const a of annotations) {
    if (typeof a.id === "string" && a.id) {
      out.set(a.id, annotationPage(a as { position?: { pageIndex?: number } }));
    }
  }
  return out;
}

// How many of each kind ride along. The chapter's own come first and get the
// most room; the rest is what keeps a reader whole across books.
export const CHAPTER_HIT_CAP = 6;
export const BOOK_HIT_CAP = 4;
// Independent of everything above it, which is the entire point.
export const CORRECTION_QUOTA = 3;
export const LECTURE_OBSERVATION_CAP = 14;
// What survives the ladder's observation-trim rung.
export const LECTURE_OBSERVATION_CAP_TIGHT = 4;

// The order the fill walks in. Led by what a lecture acts on: where they got
// stuck, and what they told us we got wrong.
const LECTURE_TYPE_ORDER: ObservationType[] = [
  "stuck-point",
  "correction",
  "cannot-explain",
  "understood-concept",
  "can-explain",
  "belief",
  "reading-position",
];

export interface LectureFocus {
  startPage: number;
  endPage: number;
}

export interface ObservationPick {
  observation: Observation;
  // Whether this observation's own evidence puts it in the open book. It decides
  // one thing: whether the body rides along or only the one-line index form.
  //
  // The three-band scope this replaces also had an "other" band, and printed it
  // as "another book in this topic" — a claim the judgement behind it could not
  // make. The band was "not this book", which is every other book the reader has
  // and every observation with no anchor at all, and the label was false 45% of
  // the time in a prompt (docs/48).
  thisBook: boolean;
}

export interface LectureObservationInput {
  observations: readonly Observation[];
  // The open book. An observation naming it in `bookId` belongs to it.
  bookId: string;
  // Every annotation id of the open book, mapped to its 1-based page (null when
  // the mark carries none). Built by the caller from annotations-<bookId>.json,
  // which is the only place the mapping exists.
  annotationPages: ReadonlyMap<string, number | null>;
  // The chapter in focus, or null. Only orders; never filters.
  focus?: LectureFocus | null;
  // The conversation about the book as a whole, and its asides (docs/09,
  // 2026-08-20). There, "this reader is on p.132" is close to false — they
  // opened the blackboard because they are not getting through the book — so it
  // is kept out of the two scope bands and can only arrive last, through the
  // type-ordered fill below. On a marked passage the position is real and rides
  // as it always has.
  bookLevel?: boolean;
  limit?: number;
}

function newestFirst(a: Observation, b: Observation): number {
  return b.updated.localeCompare(a.updated) || a.id.localeCompare(b.id);
}

// The marks of the open book this observation is anchored to.
function openBookAnchors(
  observation: Observation,
  annotationPages: ReadonlyMap<string, number | null>,
): string[] {
  return observation.anchors.annotationIds.filter((id) => annotationPages.has(id));
}

// Whether the open book is what this observation is about: it names the book
// outright, or its evidence is a mark made in it.
export function isAboutOpenBook(
  observation: Observation,
  bookId: string,
  annotationPages: ReadonlyMap<string, number | null>,
): boolean {
  return observation.bookId === bookId || openBookAnchors(observation, annotationPages).length > 0;
}

// Whether one of those marks falls inside the chapter in focus. Orders, never
// filters — the two most useful citations in the measured lecture came from
// outside it.
export function isInFocusChapter(
  observation: Observation,
  annotationPages: ReadonlyMap<string, number | null>,
  focus: LectureFocus | null,
): boolean {
  if (!focus) return false;
  return openBookAnchors(observation, annotationPages).some((id) => {
    const page = annotationPages.get(id);
    return page !== null && page !== undefined && page >= focus.startPage && page <= focus.endPage;
  });
}

// The observations this turn carries, in print order.
export function selectLectureObservations(input: LectureObservationInput): ObservationPick[] {
  const focus = input.focus ?? null;
  const limit = input.limit ?? LECTURE_OBSERVATION_CAP;
  const scoped = [...input.observations].sort(newestFirst).map((observation) => ({
    observation,
    thisBook: isAboutOpenBook(observation, input.bookId, input.annotationPages),
    inChapter: isInFocusChapter(observation, input.annotationPages, focus),
  }));

  const picked: ObservationPick[] = [];
  const taken = new Set<string>();
  const take = (pick: ObservationPick): void => {
    if (taken.has(pick.observation.id) || picked.length >= limit) return;
    taken.add(pick.observation.id);
    picked.push(pick);
  };

  type Scoped = (typeof scoped)[number];
  const banded = (p: Scoped): boolean =>
    p.thisBook && !(input.bookLevel === true && p.observation.type === "reading-position");
  for (const p of scoped.filter((p) => banded(p) && p.inChapter).slice(0, CHAPTER_HIT_CAP)) take(p);
  for (const p of scoped.filter((p) => banded(p) && !p.inChapter).slice(0, BOOK_HIT_CAP)) take(p);
  for (const p of scoped
    .filter((p) => p.observation.type === "correction" && !taken.has(p.observation.id))
    .slice(0, CORRECTION_QUOTA)) {
    take(p);
  }

  const rest = scoped.filter((p) => !taken.has(p.observation.id));
  const byId = new Map(rest.map((p) => [p.observation.id, p]));
  for (const entry of trimObservations(
    rest.map((p) => p.observation),
    Math.max(0, limit - picked.length),
    LECTURE_TYPE_ORDER,
  )) {
    const pick = byId.get(entry.id);
    if (pick) take(pick);
  }
  return picked;
}

// The snapshot a lecture turn carries, handed to observationPromptSection in
// place of the opening snapshot. Entries about the open book print their bodies —
// the prescription is in the body; the rest keep the one-line index form they
// have everywhere else, which is what keeps the section inside its budget.
//
// Nothing is labelled with where it came from. The one label the data supports
// is "this book", and that is already what the two forms say.
export function lectureObservationSnapshot(picks: readonly ObservationPick[]): string {
  if (picks.length === 0) return "";
  const blocks: string[] = [];
  for (const { observation, thisBook } of picks) {
    const head = serializeIndexLine(observation);
    if (!thisBook) {
      blocks.push(head);
      continue;
    }
    const body = stripToolResidue(observation.body);
    blocks.push(body ? `${head}\n${body}` : head);
  }
  return blocks.join("\n\n");
}
