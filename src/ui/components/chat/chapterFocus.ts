// The chapter-focus status line (docs/09). A book-level conversation that has
// settled on one chapter says which one above the messages, so the reader can
// see what the AI is holding and drop it. Pure, so the wording is testable
// without a renderer.

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
