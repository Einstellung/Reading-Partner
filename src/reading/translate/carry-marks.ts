// Carrying the reader's marks from the article onto its translation.
//
// The translation is a new file on the shelf, so every mark's CFI points into a
// document that no longer exists: the tree it counted its steps through has a
// new element after most of its blocks. What survives the rebuild is the words,
// and the words are what a mark carries beside its CFI (annotation.ts: the
// quote selector is the repair). So a mark is relocated the way docs/60 says a
// mark moves to a new version — by its verbatim quote — and one whose words are
// not in the new document is reported rather than guessed at.
//
// Two searches, in this order. The exact one first, with the mark's
// neighbouring characters, because that is the one that tells two copies of a
// repeated sentence apart. Then the normalized one (prep/quote-locate.ts),
// which folds case, ligatures and whitespace; it is what catches a mark whose
// neighbours now have a Chinese paragraph between them.
//
// The page index is not carried. It is a position block of a pagination that
// was measured against the old file, and the new file has to be paginated
// anyway; it is left at 0 and the reader's first open fixes it.

import {
  CFI_CONFORMS_TO,
  epubSortOffset,
  findQuoteSpan,
  makeEpubSortIndex,
  quoteSelectorAt,
  quoteSelectorOf,
  rangeAtSpan,
  type TextSpan,
} from "../epub/annotation";
import { rangeToCfi } from "../epub/file/cfi";
import type { DocumentText } from "../epub/file/text";
import { locateQuote } from "../prep/quote-locate";

/** A mark as it is stored: the annotation record, fields and all. */
export type MarkRecord = Record<string, unknown>;

export interface CarryTarget {
  /** The translated document's tree, as parse.ts handed it back. */
  doc: Document;
  /** Its extracted text, the same object the tree was measured with. */
  text: DocumentText;
  /** The spine item the document is, for the CFI. An article has one: 0. */
  spineIndex: number;
  idref: string;
}

export interface CarryResult {
  /** The marks that found their words again, rewritten for the new document. */
  moved: MarkRecord[];
  /** The marks whose words are not in the new document, untouched. */
  unmatched: MarkRecord[];
}

function spanOf(text: string, mark: MarkRecord): TextSpan | null {
  const quote = quoteSelectorOf(mark);
  if (!quote) return null;
  const near = epubSortOffset(mark.sortIndex);
  const exact = findQuoteSpan(text, quote, near ?? undefined);
  if (exact) return exact;
  const folded = locateQuote(text, quote.exact);
  if (!folded) return null;
  return { start: folded.start, end: folded.end };
}

/**
 * Every mark, relocated onto the new document or reported as lost. Pure apart
 * from reading the tree it is given; it writes nothing and stores nothing, so
 * the caller decides what to do with a mark that did not come across.
 */
export function carryMarks(marks: readonly MarkRecord[], target: CarryTarget): CarryResult {
  const result: CarryResult = { moved: [], unmatched: [] };
  for (const mark of marks) {
    const span = spanOf(target.text.text, mark);
    const range = span ? rangeAtSpan(target.doc, target.text, span) : null;
    const cfi = range ? rangeToCfi(range, target.spineIndex, target.idref) : null;
    if (!span || !cfi) {
      result.unmatched.push(mark);
      continue;
    }
    const quote = quoteSelectorAt(target.text.text, span);
    result.moved.push({
      ...mark,
      text: quote.exact,
      quote,
      sortIndex: makeEpubSortIndex(target.spineIndex, span.start),
      position: {
        type: "FragmentSelector",
        conformsTo: CFI_CONFORMS_TO,
        value: cfi,
        pageIndex: 0,
      },
    });
  }
  return result;
}
