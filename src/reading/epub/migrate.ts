// Moving a book's marks onto a new pagination table. A mark's CFI is its
// anchor and does not change; what changes when the table is recut is the page
// number beside it — position.pageIndex, pageLabel and the sort key — which the
// trace list, the [p.N] anchors and the distillation read (docs/39 §5). This
// runs once, when a version-1 table is replaced by a version-2 one (docs/64).

import type { Annotation } from "../../platform/app/reader-contract";
import { makeEpubSortIndex } from "./annotation";
import { parseCfiStart, resolvePoint } from "./cfi";
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
): RemappedAnnotations {
  let changed = false;
  const runsByDoc = new Map<number, ReturnType<typeof indexRuns>>();
  const out = annotations.map((ann) => {
    const cfi = cfiOf(ann);
    if (!cfi) return ann;
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
    const label = pagination.blocks[pageIndex]?.label ?? null;
    const pageLabel = label ?? String(pageIndex + 1);
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
