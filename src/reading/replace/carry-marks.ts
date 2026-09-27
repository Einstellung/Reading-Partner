// Carrying the reader's marks from one document onto the one that replaces it:
// an article onto its translation, or a book onto a new version of itself.
//
// The successor is a new file on the shelf, so every mark's CFI points into a
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
// A book has more than one spine document. A mark is looked for in the one it
// was in first (the spine index its sort key starts with), then in the others
// in spine order: a new version may have split or merged a chapter file.
//
// The page index is not carried. It is a position block of a pagination that
// was measured against the old file, and the new file has to be paginated
// anyway; it is left at 0 and the first cut of the new file's table sets it
// (reading/epub/book-cache.ts).

import {
  CFI_CONFORMS_TO,
  epubSortOffset,
  findQuoteSpan,
  makeEpubSortIndex,
  quoteSelectorAt,
  quoteSelectorOf,
  rangeAtSpan,
  type TextQuoteSelector,
  type TextSpan,
} from "../epub/annotation";
import { epubCfi, parseCfiStart, pointSteps, rangeToCfi, resolvePoint } from "../epub/file/cfi";
import type { EpubBook } from "../epub/file/parse";
import { indexRuns, offsetOfPoint, runAt, type DocumentText } from "../epub/file/text";
import type { ViewState } from "../../platform/app/reader-contract";
import { locateQuote } from "../prep/quote-locate";

/** A mark as it is stored: the annotation record, fields and all. */
export type MarkRecord = Record<string, unknown>;

export interface CarryTarget {
  /** One of the new file's spine documents, as parse.ts handed it back. */
  doc: Document;
  /** Its extracted text, the same object the tree was measured with. */
  text: DocumentText;
  /** The spine item the document is, for the CFI. An article has one: 0. */
  spineIndex: number;
  idref: string;
}

/** Every spine document of a parsed EPUB, as places a mark can be carried to. */
export function carryTargetsOf(book: EpubBook): CarryTarget[] {
  return book.docs.map((d) => ({ doc: d.doc, text: d.text, spineIndex: d.index, idref: d.idref }));
}

export interface CarryResult {
  /** The marks that found their words again, rewritten for the new document. */
  moved: MarkRecord[];
  /** The marks whose words are not in the new document, untouched. */
  unmatched: MarkRecord[];
}

/** The spine index an EPUB sort key was built from, or null. */
function sortSpine(sortIndex: unknown): number | null {
  if (typeof sortIndex !== "string") return null;
  const spine = Number(sortIndex.split("|")[0]);
  return Number.isInteger(spine) && sortIndex.includes("|") ? spine : null;
}

function spanIn(text: string, quote: TextQuoteSelector, near: number | undefined): TextSpan | null {
  const exact = findQuoteSpan(text, quote, near);
  if (exact) return exact;
  const folded = locateQuote(text, quote.exact);
  if (!folded) return null;
  return { start: folded.start, end: folded.end };
}

/**
 * Where a quote is in the new file: the document it was in first, with its old
 * offset to tell repeats apart, then every other document in spine order.
 */
function locate(
  targets: readonly CarryTarget[],
  quote: TextQuoteSelector,
  spine: number | null,
  near: number | null,
): { target: CarryTarget; span: TextSpan } | null {
  const home = targets.find((t) => t.spineIndex === spine);
  if (home) {
    const span = spanIn(home.text.text, quote, near ?? undefined);
    if (span) return { target: home, span };
  }
  for (const target of targets) {
    if (target === home) continue;
    const span = spanIn(target.text.text, quote, undefined);
    if (span) return { target, span };
  }
  return null;
}

/**
 * Every mark, relocated onto the new document or reported as lost. Pure apart
 * from reading the trees it is given; it writes nothing and stores nothing, so
 * the caller decides what to do with a mark that did not come across.
 */
export function carryMarks(
  marks: readonly MarkRecord[],
  into: CarryTarget | readonly CarryTarget[],
): CarryResult {
  const targets: readonly CarryTarget[] = Array.isArray(into) ? into : [into as CarryTarget];
  const result: CarryResult = { moved: [], unmatched: [] };
  for (const mark of marks) {
    const quote = quoteSelectorOf(mark);
    const found = quote
      ? locate(targets, quote, sortSpine(mark.sortIndex), epubSortOffset(mark.sortIndex))
      : null;
    const range = found ? rangeAtSpan(found.target.doc, found.target.text, found.span) : null;
    const cfi = found && range ? rangeToCfi(range, found.target.spineIndex, found.target.idref) : null;
    if (!found || !cfi) {
      result.unmatched.push(mark);
      continue;
    }
    const { target, span } = found;
    const moved = quoteSelectorAt(target.text.text, span);
    result.moved.push({
      ...mark,
      text: moved.exact,
      quote: moved,
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

// --- the reading position ----------------------------------------------------

// How many characters after the saved point are looked for in the new file. Long
// enough that a sentence repeated elsewhere is rarely the one found, short enough
// to stay inside the paragraph the reader was in.
const POSITION_QUOTE = 48;

/**
 * Where the reader was, moved onto the new file by the words at that place.
 *
 * The saved CFI counts steps through the old tree, and restoring prefers it over
 * the page number (reading/epub/reader-logic.ts: restoreTarget), so an old CFI
 * left in place would open the new file wherever those steps happen to land.
 * When the words are found the CFI is rewritten to them; when they are not, it
 * is dropped and the page number stands. A state with no CFI (every PDF) is
 * handed back as it is.
 */
export function carryPosition(
  state: ViewState,
  from: EpubBook,
  into: readonly CarryTarget[],
): ViewState {
  if (typeof state.cfi !== "string" || state.cfi === "") return state;
  const { cfi: _old, ...rest } = state;
  const parsed = parseCfiStart(state.cfi);
  const doc = parsed ? from.docs[parsed.spineIndex] : undefined;
  const at = parsed && doc ? resolvePoint(doc.doc.documentElement, parsed) : null;
  if (!doc || !at) return rest;
  const offset = offsetOfPoint(doc.text, indexRuns(doc.text), at.node, at.offset);
  const words = doc.text.text.slice(offset, offset + POSITION_QUOTE);
  if (words.trim().length < 8) return rest;
  const quote = quoteSelectorAt(doc.text.text, { start: offset, end: offset + words.length });
  const found = locate(into, quote, doc.index, offset);
  const point = found ? runAt(found.target.text.runs, found.span.start) : null;
  const local = point ? pointSteps(point.node, point.offset) : null;
  if (!found || local === null) return rest;
  return { ...rest, cfi: epubCfi(found.target.spineIndex, found.target.idref, local) };
}
