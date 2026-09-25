// What the Outline sidebar draws (docs/67 「辅助资料」).
//
// The list is always the *book's* table of contents, even while a supplement is
// on screen: the supplement is something the reader brought in beside the book,
// and the way back to the book is the chapter they want to be at. Under the
// chapters, one row per supplement, separated by a rule and nothing else — a
// heading over three links would be more furniture than list.
//
// A scanned book has no chapters at all. With supplements under it the rule
// would then be a line with nothing above it, so the book's own title stands in
// as the row that goes back to it.

import type { SupplementRef } from "../../../platform/app/supplements";
import type { OutlineItem } from "../../../fulltext/types";

export type OutlineRow =
  | { kind: "chapter"; title: string; level: number; page: number; current: boolean }
  | { kind: "book"; title: string; current: boolean }
  | { kind: "supplement"; hash: string; title: string; source: string; current: boolean };

export interface OutlineInput {
  /** The book's own table of contents, whichever document is on screen. */
  bookOutline: readonly OutlineItem[];
  bookTitle: string;
  supplements: readonly SupplementRef[];
  /** The document on screen: the book's id, or a supplement's. */
  docId: string | null;
  bookId: string | null;
  /** The domain a supplement came from, for the small text on its row. */
  displaySource(sourceUrl: string | undefined): string;
}

/**
 * The rows, in order. Empty when there is nothing to draw — no outline and no
 * supplements — which is what makes the sidebar say the document has none.
 */
export function outlineRows(input: OutlineInput): OutlineRow[] {
  const { bookOutline, bookTitle, supplements, docId, bookId, displaySource } = input;
  const onBook = docId !== null && docId === bookId;
  const rows: OutlineRow[] = bookOutline.map((item) => ({
    kind: "chapter" as const,
    title: item.title,
    level: item.level,
    page: item.page,
    current: onBook,
  }));
  if (supplements.length === 0) return rows;
  if (rows.length === 0) {
    rows.push({ kind: "book", title: bookTitle, current: onBook });
  }
  for (const s of supplements) {
    rows.push({
      kind: "supplement",
      hash: s.hash,
      title: s.title,
      source: displaySource(s.sourceUrl),
      current: s.hash === docId,
    });
  }
  return rows;
}

/** Where the rule goes: before the first row that is not a chapter. */
export function ruleAt(rows: readonly OutlineRow[]): number {
  const i = rows.findIndex((r) => r.kind !== "chapter");
  return i;
}
