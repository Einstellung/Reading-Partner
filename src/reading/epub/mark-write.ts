// Writing a text mark down, the half both mark views share. The sheets
// (mark-layer.ts) and the reflow column (flow-marks.ts) each find the Range a
// finger or pen left on their own clone of a spine document; from that Range
// on, what is written to disk is decided here and nowhere else.
//
// The CFI is taken off the view's clone, and every offset off the ingestion
// tree: the clone's node identities are not the ones the pagination was cut on
// (docs/pitfall/267).

import type { Annotation } from "../../platform/app/reader-contract";
import { newEpubMark, quoteSelectorAt } from "./annotation";
import { parseEpubRangeCfi, rangeToCfi, resolveSteps } from "./cfi";
import type { SpineText } from "./mark-draw";
import type { Pagination } from "./paginate";
import type { EpubBook } from "./parse";
import { blockIndexAt, blockInfo } from "./reader-logic";
import { indexRuns, offsetOfPoint } from "./text";

export interface TextMarkContext {
  /** The spine item the Range is in. */
  spine: number;
  stroke: "highlight" | "underline";
  color: string;
  spineOf(index: number): SpineText | null;
  pagination: Pagination;
  authorName: string;
  now: string;
  id: string;
}

/**
 * The mark a Range on a view's clone of a spine document becomes, or null when
 * it covers no words or does not resolve back onto the ingestion tree.
 */
export function textMarkOf(range: Range, ctx: TextMarkContext): Annotation | null {
  if (range.collapsed) return null;
  const spine = ctx.spineOf(ctx.spine);
  if (!spine) return null;
  const cfi = rangeToCfi(range, spine.index, spine.idref);
  const parsed = cfi ? parseEpubRangeCfi(cfi) : null;
  if (!cfi || !parsed) return null;
  const from = resolveSteps(spine.root, parsed.start.steps, parsed.start.offset);
  const to = resolveSteps(spine.root, parsed.end.steps, parsed.end.offset);
  if (!from || !to) return null;
  const start = offsetOfPoint(spine.text, spine.runs, from.node, from.offset);
  const end = offsetOfPoint(spine.text, spine.runs, to.node, to.offset);
  const span = { start: Math.min(start, end), end: Math.max(start, end) };
  const quote = quoteSelectorAt(spine.text.text, span);
  if (quote.exact.trim() === "") return null;
  const pageIndex = blockIndexAt(ctx.pagination, spine.index, span.start);
  const block = blockInfo(ctx.pagination, pageIndex);
  return newEpubMark({
    id: ctx.id,
    stroke: ctx.stroke,
    color: ctx.color,
    cfi,
    spineIndex: spine.index,
    span,
    pageIndex,
    pageLabel: block?.label ?? String(pageIndex + 1),
    quote,
    authorName: ctx.authorName,
    now: ctx.now,
  }) as Annotation;
}

/**
 * The ingestion side of a book's spine items, indexed once per item on first
 * use. It is the ingestion tree's, never a view's clone's (docs/pitfall/267).
 */
export function createSpineTexts(book: EpubBook): (index: number) => SpineText | null {
  const cache = new Map<number, SpineText>();
  return (index) => {
    const hit = cache.get(index);
    if (hit) return hit;
    const doc = book.docs[index];
    const root = doc?.doc.documentElement;
    if (!doc || !root) return null;
    const entry: SpineText = { index, idref: doc.idref, root, text: doc.text, runs: indexRuns(doc.text) };
    cache.set(index, entry);
    return entry;
  };
}
