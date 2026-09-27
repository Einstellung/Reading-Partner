// The status line above a book-level conversation (docs/09). Two things share
// it, because they are the same question — what does the AI have right now:
// which chapter the conversation has settled on, and how far this book's
// preparation has got. Pure, so the wording is testable without a renderer.

export interface ChapterFocus {
  // The chapter as the book itself names it, numbering and all ("Chapter 3
  // Coding Attention Mechanisms"). Composed by whoever owns the focus state,
  // because the numbering comes out of the book's own outline text and must not
  // be re-rendered in another language here. Null/absent = no focus.
  chapter?: string | null;
  // First and last printed page of that chapter, 1-based.
  firstPage?: number | null;
  lastPage?: number | null;
}

// "p.64-107", "p.64" for a one-page chapter, null when either end is unknown.
function pageRange(first: number | null | undefined, last: number | null | undefined): string | null {
  if (typeof first !== "number" || !Number.isFinite(first)) return null;
  if (typeof last !== "number" || !Number.isFinite(last)) return null;
  return last > first ? `p.${first}-${last}` : `p.${first}`;
}

// The whole line, or null when there is no chapter to name — which is also what
// tells the row not to render at all.
export function chapterFocusLabel(focus: ChapterFocus): string | null {
  const chapter = focus.chapter?.trim();
  if (!chapter) return null;
  const pages = pageRange(focus.firstPage, focus.lastPage);
  return pages ? `${chapter} · ${pages}` : chapter;
}

// How far preparation has got, as the line says it. The caller passes this only
// while a run is going, so there is no "finished" wording to write: a line that
// says nothing about preparation means nothing is being prepared.
//
// "Preparing…" with no numbers is the first phase, before the run knows how many
// chapters (or papers) there are. Saying nothing at all there would make the
// line appear a minute after the reader triggered it, which reads as the trigger
// having missed.
export function prepProgressLabel(
  prep: { done: number; total: number } | null | undefined,
): string | null {
  if (!prep) return null;
  if (prep.total <= 0) return "Preparing…";
  return `Preparing ${prep.done}/${prep.total}`;
}
