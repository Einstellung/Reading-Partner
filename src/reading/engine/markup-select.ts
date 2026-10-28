// The highlight and underline a pen or a mouse draws by selecting text with the
// tool active. The annotation plugin turns the selection plugin's selection
// into the mark through the tool's `selectionHandler`; its own handler copies
// the selection's segment rects, which are loose glyph boxes and, in a CJK
// face, about two lines tall (docs/pitfall/embedpdf/678). This one writes the
// same mark with the line boxes a finger's selection is saved with
// (finger-select.ts lineRects), so both ways of marking draw one shape.

import type { PdfAnnotationObject, PdfPageGeometry, Rect } from "@embedpdf/models";

import { spanRects, type GlyphPos } from "./finger-select";

/** What the handler reads of the selection plugin's state for a document. */
export interface MarkupSelectionState {
  selection: { start: GlyphPos; end: GlyphPos } | null;
  geometry: Record<number, PdfPageGeometry | undefined>;
}

/** One page of the plugin's formatted selection. */
export interface MarkupSelection {
  pageIndex: number;
  rect: Rect;
  segmentRects: Rect[];
}

interface MarkupTool {
  defaults: Partial<PdfAnnotationObject>;
  behavior?: { selectAfterCreate?: boolean };
}

export interface MarkupHandlerContext {
  documentId: string;
  getTool: () => MarkupTool | null;
  createAnnotation: (pageIndex: number, annotation: PdfAnnotationObject) => void;
  selectAnnotation: (pageIndex: number, id: string) => void;
}

function union(rects: Rect[]): Rect {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const r of rects) {
    left = Math.min(left, r.origin.x);
    top = Math.min(top, r.origin.y);
    right = Math.max(right, r.origin.x + r.size.width);
    bottom = Math.max(bottom, r.origin.y + r.size.height);
  }
  return { origin: { x: left, y: top }, size: { width: right - left, height: bottom - top } };
}

/**
 * The plugin's formatted selection with each page's segments redone as line
 * boxes. A page the state cannot account for keeps the plugin's own rects.
 */
export function markupSegments(selections: MarkupSelection[], state: MarkupSelectionState | null): MarkupSelection[] {
  const sel = state?.selection;
  if (!state || !sel) return selections;
  const lines = spanRects({ start: sel.start, end: sel.end }, (page) => state.geometry[page]);
  return selections.map((s) => {
    const rects = lines.get(s.pageIndex);
    return rects && rects.length > 0 ? { pageIndex: s.pageIndex, rect: union(rects), segmentRects: rects } : s;
  });
}

/**
 * The tools' `selectionHandler`: the plugin's text-markup handler, field for
 * field, on line boxes. `stateOf` reads the selection plugin for a document;
 * the plugin clears its selection right after calling the handler, so the
 * boxes are worked out before anything is awaited.
 */
export function markupSelectionHandler(stateOf: (documentId: string) => MarkupSelectionState | null) {
  return {
    toolId: "__textMarkup__",
    handle(context: MarkupHandlerContext, selections: MarkupSelection[], getText: () => Promise<string | undefined>) {
      const tool = context.getTool();
      if (!tool) return;
      for (const selection of markupSegments(selections, stateOf(context.documentId))) {
        const id = crypto.randomUUID();
        void getText().then((text) => {
          context.createAnnotation(selection.pageIndex, {
            ...tool.defaults,
            rect: selection.rect,
            segmentRects: selection.segmentRects,
            pageIndex: selection.pageIndex,
            created: new Date(),
            id,
            ...(text != null && { custom: { text } }),
          } as PdfAnnotationObject);
          if (tool.behavior?.selectAfterCreate) context.selectAnnotation(selection.pageIndex, id);
        });
      }
    },
  };
}
