import type { BookChapter } from "../chapters";

// A retell (docs/31, "讲是一个对象，不是一个按钮"): one pass over what was read,
// living under a topic, spanning one or more materials, holding its own
// conversation and the decisions that conversation produced. What it tests is
// whether the reader can say the book back; the deck at the end is the product,
// not the point, which is why it is a retell and not a talk.
//
// It is not a mode and not a book: the conversation is anchored on the retell,
// so it survives the book being closed and it can cover several books at
// once. The decisions therefore say which book's chapter they are about — a
// chapter number alone stops meaning anything the moment a second material joins.
//
// A deck an older build made from this retell sits under slides/<retellId>/,
// named by this same id. Nothing reads it: the app does not make decks any more
// (docs/44), and what is already on disk is left where it is.

export const RETELL_VERSION = 1 as const;

// One material in a retell: a book id (the library content hash everything else is
// keyed by) plus the title at the time it was added, so a list can be drawn
// without opening the library.
export interface RetellMaterial {
  bookId: string;
  title: string;
}

// What the retell settled about one chapter of one material: the same shape the
// conversation records (PlanDecision, below), plus the book it belongs to.
export interface RetellDecision {
  bookId: string;
  // 1-based chapter index inside that material's own skeleton.
  chapter: number;
  // The chapter's title when the decision was made, kept so the entry still
  // reads as something if the skeleton later shifts.
  title: string;
  // Whether the chapter goes in the retell. A cut chapter stays in the list: it is
  // a settled question, and dropping it would make the AI ask it again.
  include: boolean;
  // What it contributes, in the reader's own framing. Empty for a cut chapter.
  points: string[];
  // The figure that carries it, as a [fig:N] id or a plain description.
  figure?: string;
  // One line of why, when the exchange produced one.
  note?: string;
  updatedAt: number;
}

// The retell file. `decisions` is the outline, in the order it will be given:
// recording appends, and the reader can move an entry or remove it (outline.ts).
// One array, not two — the outline the reader arranges and the record the AI
// reads are the same thing (docs/31).
export interface Retell {
  version: typeof RETELL_VERSION;
  id: string;
  name: string;
  topicId: string;
  materials: RetellMaterial[];
  createdAt: number;
  updatedAt: number;
  decisions: RetellDecision[];
}

// A new retell id: the creation timestamp.
export function newRetellId(now: number): string {
  return `${now}`;
}

// The default name for a retell started from one material: the material's title.
// The reader renames it from the list.
export function defaultRetellName(materials: readonly RetellMaterial[]): string {
  if (materials.length === 0) return "Untitled retell";
  if (materials.length === 1) return materials[0].title;
  return `${materials[0].title} +${materials.length - 1}`;
}

export interface NewRetellFields {
  id: string;
  topicId: string;
  materials: RetellMaterial[];
  name?: string;
  now: number;
}

// The retell file a start produces, before anything is on disk. Pure, so the
// shape a retell begins life in is testable without a filesystem; the write and
// the id collision handling are the store's (store.ts).
export function newRetell(input: NewRetellFields): Retell {
  return {
    version: RETELL_VERSION,
    id: input.id,
    name: (input.name ?? "").trim() || defaultRetellName(input.materials),
    topicId: input.topicId,
    materials: input.materials,
    createdAt: input.now,
    updatedAt: input.now,
    decisions: [],
  };
}

// A load-time repair. A file this build cannot use at all reads as null in the
// store; anything merely odd inside a usable file is dropped rather than
// crashing the retell — a lost decision is re-made in one exchange, an unopenable
// retell is not.
export function normalizeRetell(retell: Retell): Retell | null {
  if (!retell || retell.version !== RETELL_VERSION) return null;
  if (typeof retell.id !== "string" || !retell.id) return null;
  if (typeof retell.topicId !== "string" || !retell.topicId) return null;
  const materials: RetellMaterial[] = [];
  const seenBooks = new Set<string>();
  for (const m of retell.materials ?? []) {
    const bookId = typeof m?.bookId === "string" ? m.bookId : "";
    if (!bookId || seenBooks.has(bookId)) continue;
    seenBooks.add(bookId);
    materials.push({ bookId, title: typeof m.title === "string" ? m.title : bookId });
  }
  const decisions: RetellDecision[] = [];
  const seen = new Set<string>();
  for (const d of retell.decisions ?? []) {
    const bookId = typeof d?.bookId === "string" ? d.bookId : "";
    const chapter = Math.round(Number(d?.chapter));
    if (!bookId || !Number.isFinite(chapter) || chapter < 1) continue;
    const key = `${bookId}#${chapter}`;
    if (seen.has(key)) continue;
    seen.add(key);
    decisions.push({
      bookId,
      chapter,
      title: typeof d.title === "string" ? d.title : "",
      include: !!d.include,
      points: Array.isArray(d.points) ? d.points.filter((p) => typeof p === "string") : [],
      ...(typeof d.figure === "string" && d.figure ? { figure: d.figure } : {}),
      ...(typeof d.note === "string" && d.note ? { note: d.note } : {}),
      updatedAt: Number.isFinite(d.updatedAt) ? d.updatedAt : retell.updatedAt,
    });
  }
  return {
    version: RETELL_VERSION,
    id: retell.id,
    name: typeof retell.name === "string" && retell.name.trim() ? retell.name : defaultRetellName(materials),
    topicId: retell.topicId,
    materials,
    createdAt: Number.isFinite(retell.createdAt) ? retell.createdAt : 0,
    updatedAt: Number.isFinite(retell.updatedAt) ? retell.updatedAt : 0,
    decisions,
  };
}

// The conversation's own two shapes (docs/31): the skeleton the retell walks
// (a chapter list with page ranges, assembled from whatever structure the book
// already has) and the decisions the retell produces (one per chapter: does
// it go in the retell, what does it contribute, which figure carries it).
//
// Both are derived here and neither is stored here. The skeleton is rebuilt from
// the notes plan or the PDF outline each turn. The decisions are the one thing
// nothing can rebuild, and they belong to the retell rather than to any one book
// (the Retell above): this section only says what one looks like and how a set
// of them reads back to the model.

export const PLAN_VERSION = 1 as const;

// Where the skeleton came from, in descending order of how much it knows.
//   "notes-plan"  the chapter plan the notes pipeline already wrote (docs/14),
//                 which has real titles and real ranges.
//   "outline"     the PDF's own top-level table of contents.
//   "whole-book"  neither existed, so the book is one chapter.
export type SkeletonSource = "notes-plan" | "outline" | "whole-book";

// A chapter of the book as the retell walks it: the book's own division
// (reading/chapters BookChapter) plus the one thing a retell asks of it.
export interface RetellChapter extends BookChapter {
  // A chapter note exists on disk for this chapter (notes status "done").
  hasNote: boolean;
}

export interface Skeleton {
  source: SkeletonSource;
  chapters: RetellChapter[];
}

// One of the reader's marks, flattened for bucketing and for the prompt.
export interface Mark {
  page: number | null;
  text: string;
  comment?: string;
}

// What the retell decided about one chapter. Written by the model through
// record_chapter_decision after that chapter's exchange, never before it.
export interface PlanDecision {
  // 1-based index into the skeleton this decision was made against.
  chapter: number;
  // The chapter's title when the decision was made. Kept so the decision still
  // reads as something if the skeleton later shifts (a notes plan replacing an
  // outline renumbers chapters).
  title: string;
  // Whether the chapter goes in the retell.
  include: boolean;
  // What it contributes, in the reader's own framing. Empty for a cut chapter.
  points: string[];
  // The figure that carries it, as a [fig:N] id or a plain description. Absent
  // when the chapter needs no picture.
  figure?: string;
  // One line of why, when the exchange produced one (usually why it is cut).
  note?: string;
  updatedAt: number;
}

// The record of a retell so far, as the prompt reads it: one entry per
// chapter at most, in the order the retell will be given. It carries no id of its
// own — it is a projection of the retell that owns it (reading/retell/outline.ts).
export interface RetellPlan {
  version: typeof PLAN_VERSION;
  createdAt: number;
  updatedAt: number;
  decisions: PlanDecision[];
}
