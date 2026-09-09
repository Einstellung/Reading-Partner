// Moving a book's marks onto a new pagination table. A mark's CFI is its
// anchor and does not change; what changes when the table is recut is the page
// number beside it — position.pageIndex, pageLabel and the sort key — which the
// trace list, the [p.N] anchors and the distillation read (docs/39 §5). This
// runs when a table this build cannot lay pages by is replaced: a version-1
// table, or one cut on the sheet an older build set pages on (docs/64).
//
// Ink is the mark that cannot be found again by anchor. It is stored as page
// coordinates, and a stroke is on no words, so moving it takes the old table:
// the page it was on began somewhere in the book, and that place is on some
// page of the new table. The strokes go there, scaled between the two text
// blocks (mark-geometry.ts). Without the old table there is nothing to move it
// by, and it is left alone.

import type { Annotation } from "../../platform/app/reader-contract";
import { epubInkOf, makeEpubSortIndex } from "./annotation";
import { parseCfiStart, resolvePoint } from "./cfi";
import { scaleInkPath } from "./mark-geometry";
import { blockNumberAt, type Pagination } from "./paginate";
import type { EpubBook } from "./parse";
import { indexRuns, offsetOfPoint } from "./text";

export interface RemappedAnnotations {
  annotations: Annotation[];
  changed: boolean;
}

function cfiOf(ann: Annotation): string | null {
  const position = ann.position as { value?: unknown } | undefined;
  return typeof position?.value === "string" ? position.value : null;
}

/**
 * Every EPUB mark's page fields recomputed against `pagination`. A mark whose
 * CFI does not resolve is left as it is; a mark that is not an EPUB mark (no
 * CFI in its position) is left as it is.
 */
export function remapEpubAnnotations(
  annotations: readonly Annotation[],
  book: EpubBook,
  pagination: Pagination,
  // The table being replaced, when there is one. Only ink needs it.
  previous?: Pagination,
): RemappedAnnotations {
  let changed = false;
  const runsByDoc = new Map<number, ReturnType<typeof indexRuns>>();
  const out = annotations.map((ann) => {
    const cfi = cfiOf(ann);
    if (!cfi) {
      const moved = previous ? movedInk(ann, pagination, previous) : null;
      if (moved) changed = true;
      return moved ?? ann;
    }
    const parsed = parseCfiStart(cfi);
    const doc = parsed ? book.docs[parsed.spineIndex] : undefined;
    if (!parsed || !doc) return ann;
    const at = resolvePoint(doc.doc.documentElement, parsed);
    if (!at) return ann;
    let runs = runsByDoc.get(doc.index);
    if (!runs) {
      runs = indexRuns(doc.text);
      runsByDoc.set(doc.index, runs);
    }
    const offset = offsetOfPoint(doc.text, runs, at.node, at.offset);
    const pageIndex = blockNumberAt(pagination, doc.index, offset) - 1;
    const pageLabel = labelAt(pagination, pageIndex);
    const sortIndex = makeEpubSortIndex(doc.index, offset);
    const position = { ...(ann.position as Record<string, unknown>), pageIndex };
    if (
      (ann.position as { pageIndex?: unknown }).pageIndex === pageIndex &&
      ann.pageLabel === pageLabel &&
      ann.sortIndex === sortIndex
    ) {
      return ann;
    }
    changed = true;
    return { ...ann, position, pageLabel, sortIndex };
  });
  return { annotations: out, changed };
}

function labelAt(pagination: Pagination, pageIndex: number): string {
  return pagination.blocks[pageIndex]?.label ?? String(pageIndex + 1);
}

/**
 * An ink mark on the page of the new table that holds where its old page began,
 * its strokes scaled from the old sheet to the new one. Null when the mark is
 * not ink, or when the old table has no such page.
 *
 * The sort key keeps the old page's own start offset rather than the new page's.
 * A stroke sorts at the place in the book it was drawn at; several old pages
 * can fall on one new page, and their starts are what keeps those strokes in
 * the order they were drawn in rather than tied together.
 */
function movedInk(ann: Annotation, pagination: Pagination, previous: Pagination): Annotation | null {
  const ink = epubInkOf(ann as { position?: unknown });
  if (!ink) return null;
  const was = previous.blocks[ink.pageIndex];
  if (!was) return null;
  const pageIndex = blockNumberAt(pagination, was.spine, was.charOffset) - 1;
  const paths = ink.paths.map((path) => scaleInkPath(previous.geometry, pagination.geometry, path));
  const pageLabel = labelAt(pagination, pageIndex);
  const sortIndex = makeEpubSortIndex(was.spine, was.charOffset);
  const position = { ...(ann.position as Record<string, unknown>), pageIndex, paths };
  return { ...ann, position, pageLabel, sortIndex };
}
