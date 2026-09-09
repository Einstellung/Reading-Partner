// Marks on an EPUB: painting them, finding the one under a finger, and turning
// a selection into a new one. The imperative half of stage 4 (docs/39 §5),
// separated from reader-view.ts because that file is already the whole of the
// renderer and this is the whole of the marks.
//
// Two facts from the layers below decide the shape of everything here.
//
// The book's frame dispatches no events (docs/pitfall/244), so nothing in this
// file is a listener: every gesture arrives as a call from the pane, in the
// parent page's coordinates, and is converted into the frame's here. The
// conversion is one subtraction — the frame is same-origin, so its own client
// rects and the parent's differ by the iframe's box and nothing else.
//
// The overlayer's SVG, on the other hand, is already in the parent page
// (foliate appends it beside the iframe, not inside it), and it is drawn from
// `range.getClientRects()` — frame coordinates. So the SVG's space is the
// frame's space, which is why a hit test takes frame coordinates too.

import type { Annotation, AnnotationPopupParams } from "../../platform/app/reader-contract";
import { MARKUP_OPACITY } from "../engine/convert";
import {
  DEFAULT_MARK_COLOR,
  epubPositionOf,
  epubSortOffset,
  findQuoteSpan,
  markStroke,
  newEpubMark,
  quoteSelectorAt,
  quoteSelectorOf,
  rangeAtSpan,
  sameWords,
} from "./annotation";
import type { Pagination } from "./paginate";
import { blockIndexAt, labelForBlock, offsetOfPoint } from "./reader-logic";
import type { DocumentText, TextRun } from "./text";

/** One loaded section, as foliate's renderer reports it. */
export interface EpubContents {
  index: number;
  doc: Document;
  overlayer?: EpubOverlayer;
}

type Rects = ArrayLike<DOMRect> & Iterable<DOMRect>;
type DrawFn = (rects: Rects, options?: { color?: string; width?: number }) => Element;

export interface EpubOverlayer {
  element: Element;
  add(key: string, range: Range, draw: DrawFn, options?: unknown): void;
  remove(key: string): void;
  hitTest(point: { x: number; y: number }): [string, Range] | [];
}

export interface OverlayerStatics {
  highlight: DrawFn;
  underline: DrawFn;
  outline: DrawFn;
}

/** The half of foliate's view this layer speaks to. */
export interface AnnotationHost {
  getCFI(index: number, range: Range): string;
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
  goTo(target: unknown): Promise<unknown>;
}

export interface AnnotationLayerDeps {
  host: AnnotationHost;
  overlayer: OverlayerStatics;
  pagination: Pagination;
  /** Every section the renderer currently holds. */
  contents(): EpubContents[];
  /** The extracted text of a frame document, cached by the reader. */
  textOf(doc: Document): { text: DocumentText; runs: Map<Node, TextRun> };
  authorName: string;
  onSaveAnnotations(anns: Annotation[]): void;
  onSelectAnnotations(ids: string[]): void;
  onAnnotationPopup(params?: AnnotationPopupParams): void;
}

export interface AnnotationLayer {
  set(anns: Annotation[]): void;
  unset(ids: string[]): void;
  select(ids: string[]): void;
  /** Redraw one section, after the renderer has just built its overlayer. */
  paintSection(index: number): void;
  /** Scroll to a mark. False when this book does not have it. */
  goToMark(id: string): boolean;

  /** A tap at parent-page coordinates that landed on a mark. */
  hit(x: number, y: number): boolean;
  /**
   * The reader's own selection, turned into a mark. Returns the mark, or null
   * when nothing was selected.
   */
  takeSelection(stroke: "highlight" | "underline", color: string): Annotation | null;

  /** A stylus or a drawing finger dragging a selection out of the text. */
  beginDrag(x: number, y: number): boolean;
  extendDrag(x: number, y: number): void;
  endDrag(stroke: "highlight" | "underline", color: string): Annotation | null;
  cancelDrag(): void;
}

/** The overlayer key a mark's own selected-state outline is drawn under. */
function selectionKey(id: string): string {
  return `${id}::selected`;
}

// The frame's client coordinates, from the parent page's. Null when the section
// has no frame on screen (it was unloaded between the event and this call).
function frameBoxOf(doc: Document): DOMRect | null {
  const frame = doc.defaultView?.frameElement as HTMLElement | null | undefined;
  return frame ? frame.getBoundingClientRect() : null;
}

function caretAt(doc: Document, x: number, y: number): { node: Node; offset: number } | null {
  const d = doc as Document & {
    caretRangeFromPoint?(x: number, y: number): Range | null;
    caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
  };
  const range = d.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  const position = d.caretPositionFromPoint?.(x, y);
  return position ? { node: position.offsetNode, offset: position.offset } : null;
}

function selectionIn(doc: Document): Selection | null {
  const get = (doc as Document & { getSelection?(): Selection | null }).getSelection;
  const sel = get ? get.call(doc) : (doc.defaultView?.getSelection() ?? null);
  return sel ?? null;
}

function liveRange(doc: Document): Range | null {
  const sel = selectionIn(doc);
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  return range && !range.collapsed ? range : null;
}

// Two caret positions as one range, whichever way round the drag went.
function rangeBetween(
  doc: Document,
  a: { node: Node; offset: number },
  b: { node: Node; offset: number },
): Range | null {
  const range = doc.createRange();
  const other = doc.createRange();
  try {
    range.setStart(a.node, a.offset);
    range.setEnd(a.node, a.offset);
    other.setStart(b.node, b.offset);
    // START_TO_START is 0; the named constant lives on the parent's Range,
    // which is not the constructor this document's ranges came from.
    if (range.compareBoundaryPoints(0, other) <= 0) range.setEnd(b.node, b.offset);
    else {
      range.setStart(b.node, b.offset);
      range.setEnd(a.node, a.offset);
    }
  } catch {
    // A caret in a node the range cannot span to (the drag left the document).
    return null;
  }
  return range.collapsed ? null : range;
}

export function createAnnotationLayer(deps: AnnotationLayerDeps): AnnotationLayer {
  const { host, overlayer: draw, pagination, contents, textOf } = deps;

  const marks = new Map<string, Annotation>();
  let selected: string[] = [];
  let drag: { doc: Document; index: number; anchor: { node: Node; offset: number } } | null = null;

  // An underline is drawn at the same opacity as a highlight (convert.ts:
  // MARKUP_OPACITY), and the highlight's own opacity is a custom property
  // foliate reads off the SVG, so the two are set in two different places for
  // one number.
  const drawUnderline: DrawFn = (rects, options) => {
    const g = draw.underline(rects, options) as SVGElement;
    g.style.opacity = String(MARKUP_OPACITY);
    return g;
  };

  function sectionsOf(index?: number): EpubContents[] {
    const all = contents().filter((c): c is EpubContents => !!c?.doc);
    return index === undefined ? all : all.filter((c) => c.index === index);
  }

  function contentAt(x: number, y: number): { c: EpubContents; box: DOMRect } | null {
    for (const c of sectionsOf()) {
      const box = frameBoxOf(c.doc);
      if (!box) continue;
      if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) return { c, box };
    }
    return null;
  }

  /**
   * Where a mark is in a loaded section, or null when it is not in this one.
   *
   * The CFI answers first and the quote repairs it. A CFI stops resolving when
   * the tree it was computed against changed — the sanitizer, or a re-issued
   * book — and it fails loudly enough to catch: it throws, or it lands in
   * another section, or it collapses. What it will not do is land on the wrong
   * words silently, which is why the resolved range is read back and compared
   * against the quote before it is trusted.
   */
  function rangeForMark(ann: Annotation, c: EpubContents): Range | null {
    const position = epubPositionOf(ann);
    const quote = quoteSelectorOf(ann);
    if (position) {
      try {
        const resolved = host.resolveCFI(position.value);
        if (resolved && resolved.index === c.index) {
          const range = resolved.anchor(c.doc);
          if (range && !range.collapsed && (!quote || sameWords(range.toString(), quote.exact))) {
            return range;
          }
        } else if (resolved && resolved.index !== c.index) {
          return null;
        }
      } catch {
        // Not a CFI this book can resolve any more: the words are the repair.
      }
    }
    if (!quote) return null;
    const { text } = textOf(c.doc);
    const span = findQuoteSpan(text.text, quote, epubSortOffset(ann.sortIndex) ?? undefined);
    return span ? rangeAtSpan(c.doc, text, span) : null;
  }

  function colorOf(ann: Annotation): string {
    return typeof ann.color === "string" && ann.color !== "" ? ann.color : DEFAULT_MARK_COLOR;
  }

  function paintMark(ann: Annotation, c: EpubContents): void {
    const stroke = markStroke(ann);
    if (!stroke || !c.overlayer) return;
    const range = rangeForMark(ann, c);
    if (!range) return;
    const color = colorOf(ann);
    c.overlayer.add(
      ann.id,
      range,
      stroke === "highlight" ? draw.highlight : drawUnderline,
      { color },
    );
    if (selected.includes(ann.id)) {
      c.overlayer.add(selectionKey(ann.id), range, draw.outline, { color, width: 2 });
    }
  }

  function erase(id: string): void {
    for (const c of sectionsOf()) {
      c.overlayer?.remove(id);
      c.overlayer?.remove(selectionKey(id));
    }
  }

  function paintAll(index?: number): void {
    for (const c of sectionsOf(index)) {
      if (!c.overlayer) continue;
      // The one opacity a markup is ever drawn at, on the element foliate reads
      // it from. Set per section, because each one gets its own overlayer.
      (c.overlayer.element as HTMLElement).style.setProperty(
        "--overlayer-highlight-opacity",
        String(MARKUP_OPACITY),
      );
      for (const ann of marks.values()) {
        c.overlayer.remove(ann.id);
        c.overlayer.remove(selectionKey(ann.id));
        paintMark(ann, c);
      }
    }
  }

  function createMark(
    range: Range,
    c: EpubContents,
    stroke: "highlight" | "underline",
    color: string,
  ): Annotation | null {
    const { text, runs } = textOf(c.doc);
    const start = offsetOfPoint(text, runs, range.startContainer, range.startOffset);
    const end = offsetOfPoint(text, runs, range.endContainer, range.endOffset);
    if (end <= start) return null;
    const pageIndex = blockIndexAt(pagination, c.index, start);
    const ann = newEpubMark({
      id: crypto.randomUUID(),
      stroke,
      color,
      cfi: host.getCFI(c.index, range),
      spineIndex: c.index,
      span: { start, end },
      pageIndex,
      pageLabel: labelForBlock(pagination, pageIndex) ?? String(pageIndex + 1),
      quote: quoteSelectorAt(text.text, { start, end }),
      authorName: deps.authorName,
      now: new Date().toISOString(),
    }) as Annotation;
    marks.set(ann.id, ann);
    paintMark(ann, c);
    deps.onSaveAnnotations([ann]);
    return ann;
  }

  function clearSelection(doc: Document): void {
    selectionIn(doc)?.removeAllRanges();
  }

  return {
    set(anns) {
      for (const ann of anns) marks.set(ann.id, ann);
      for (const c of sectionsOf()) {
        for (const ann of anns) {
          c.overlayer?.remove(ann.id);
          c.overlayer?.remove(selectionKey(ann.id));
          paintMark(ann, c);
        }
      }
    },

    unset(ids) {
      for (const id of ids) {
        marks.delete(id);
        erase(id);
      }
      selected = selected.filter((id) => !ids.includes(id));
    },

    select(ids) {
      // Nothing here is re-published on a tool change, so there is no emission
      // to tell apart from a real one (engine/annotation-selection.ts, pitfall
      // 59): the shell says what is selected and this draws it.
      const was = selected;
      selected = [...ids];
      for (const c of sectionsOf()) {
        for (const id of was) c.overlayer?.remove(selectionKey(id));
        for (const id of selected) {
          const ann = marks.get(id);
          if (!ann) continue;
          const range = rangeForMark(ann, c);
          if (range) c.overlayer?.add(selectionKey(id), range, draw.outline, { color: colorOf(ann), width: 2 });
        }
      }
    },

    paintSection(index) {
      paintAll(index);
    },

    goToMark(id) {
      const ann = marks.get(id);
      if (!ann) return false;
      const position = epubPositionOf(ann);
      if (!position) return false;
      void Promise.resolve(host.goTo(position.value)).catch(() => {
        // A CFI the book cannot resolve: the block it was recorded on is still
        // a place, and it is the one the trace list's page number names.
        const cfi = pagination.blocks[position.pageIndex]?.cfi;
        if (cfi) void host.goTo(cfi);
      });
      return true;
    },

    hit(x, y) {
      const at = contentAt(x, y);
      if (!at?.c.overlayer) return false;
      const point = { x: x - at.box.left, y: y - at.box.top };
      const [key, range] = at.c.overlayer.hitTest(point);
      if (!key) return false;
      const id = key.endsWith("::selected") ? key.slice(0, -"::selected".length) : key;
      const ann = marks.get(id);
      if (!ann) return false;
      const box = range ? range.getBoundingClientRect() : null;
      const rect: [number, number, number, number] = box
        ? [box.left + at.box.left, box.top + at.box.top, box.right + at.box.left, box.bottom + at.box.top]
        : [x - 1, y - 1, x + 1, y + 2];
      deps.onSelectAnnotations([id]);
      deps.onAnnotationPopup({ rect, annotation: ann });
      return true;
    },

    takeSelection(stroke, color) {
      for (const c of sectionsOf()) {
        const range = liveRange(c.doc);
        if (!range) continue;
        const ann = createMark(range, c, stroke, color);
        clearSelection(c.doc);
        return ann;
      }
      return null;
    },

    beginDrag(x, y) {
      const at = contentAt(x, y);
      if (!at) return false;
      const anchor = caretAt(at.c.doc, x - at.box.left, y - at.box.top);
      if (!anchor) return false;
      drag = { doc: at.c.doc, index: at.c.index, anchor };
      clearSelection(at.c.doc);
      return true;
    },

    extendDrag(x, y) {
      if (!drag) return;
      const box = frameBoxOf(drag.doc);
      if (!box) return;
      const focus = caretAt(drag.doc, x - box.left, y - box.top);
      if (!focus) return;
      const range = rangeBetween(drag.doc, drag.anchor, focus);
      if (!range) return;
      // Painted by the system's own selection, so the reader sees the words
      // being taken before the pen lifts.
      const sel = selectionIn(drag.doc);
      sel?.removeAllRanges();
      sel?.addRange(range);
    },

    endDrag(stroke, color) {
      const current = drag;
      drag = null;
      if (!current) return null;
      const range = liveRange(current.doc);
      if (!range) return null;
      const c = sectionsOf(current.index)[0];
      const ann = c ? createMark(range, c, stroke, color) : null;
      clearSelection(current.doc);
      return ann;
    },

    cancelDrag() {
      const current = drag;
      drag = null;
      if (current) clearSelection(current.doc);
    },
  };
}
