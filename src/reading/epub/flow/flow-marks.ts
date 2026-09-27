// The marks in the reflow column (docs/70): what is painted over every mounted
// document, what a finger leaves behind, and what a tap on one opens. The
// column (flow-view.ts) owns the documents and the pointer; this layer is
// handed the documents and told when a drag begins, moves and ends.
//
// A text mark is the same mark the sheets draw (mark-layer.ts, docs/64): a
// range CFI as the anchor, the quote as the repair, and the pagination table's
// page number beside them. The column has no page under a mark, so ink — a
// stroke on no words — is not painted here at all.
//
// Every rect inside this file is in a document host's own coordinates: the
// overlay is laid out over the host, so a rect measured against the host's box
// is a rect the overlay draws unchanged. Only the popup's rect leaves as a
// viewport rect.

import type { Annotation, AnnotationPopupParams } from "../../../platform/app/reader-contract";
import { DEFAULT_MARK_COLOR, epubPositionOf, markKind } from "../annotation";
import { caretAtPoint, rangeBetween, type CaretPoint } from "../caret";
import { parseCfiStart, parseEpubRangeCfi, resolveRange } from "../file/cfi";
import type { FlowTool } from "./flow-contract";
import { wordBoundsAt } from "./flow-gesture";
import { colorOf, createMarkPainter, rangeForMark, type MarkRangeSource, type SpineText } from "../mark-draw";
import { popupRect, rectsHit, unionRect, type PageRect } from "../mark-geometry";
import { textMarkOf } from "../mark-write";
import type { Pagination } from "../paginate";

/** One spine document as it stands in the column. */
export interface FlowDoc {
  spine: number;
  idref: string;
  /** The archive entry, for resolving the book's own links. */
  entry: string;
  host: HTMLElement;
  shadow: ShadowRoot;
  /** The cloned <html>: the content root every CFI is resolved against. */
  root: Element;
  overlay: HTMLElement;
}

export interface FlowMarkHost {
  owner: Document;
  authorName: string;
  /** The document under a viewport point. */
  docAt(clientX: number, clientY: number): FlowDoc | null;
  docOf(spine: number): FlowDoc | null;
  /** Whether a document is laid out where the reader can see it now. */
  isShown(doc: FlowDoc): boolean;
  pagination: Pagination;
  spineOf(index: number): SpineText | null;
  /** Every mark of the book, after one was added. */
  onSave(annotations: Annotation[]): void;
  onSelect(ids: string[]): void;
  onPopup(params?: AnnotationPopupParams): void;
  /**
   * Where a drag's end is in a document, for a view whose margins are not the
   * book's: the paged view (docs/79) looks for the nearest words on the screen
   * shown. The caret under the point when absent.
   */
  strokeCaret?(doc: FlowDoc, clientX: number, clientY: number): CaretPoint | null;
}

/** Where a press landed: the document and the caret under the finger. */
export interface PressPoint {
  doc: FlowDoc;
  caret: CaretPoint;
}

interface PaintedMark {
  id: string;
  rects: PageRect[];
}

interface Drag {
  doc: FlowDoc;
  color: string;
  start: CaretPoint;
  range: Range | null;
}

export interface FlowMarks {
  reset(annotations: readonly Annotation[]): void;
  setAnnotations(annotations: readonly Annotation[]): void;
  unsetAnnotations(ids: readonly string[]): void;
  selectAnnotations(ids: readonly string[]): void;
  setTool(tool: FlowTool): void;
  all(): Annotation[];
  /** Whether a document's overlay is stale: never painted, or painted before its marks changed. */
  needsPaint(spine: number): boolean;
  paint(doc: FlowDoc): void;
  /** The document's layout moved under its marks: paint again when it is shown. */
  invalidate(spine: number): void;
  /** The caret under a viewport point, or null off the words. */
  caretAt(clientX: number, clientY: number): PressPoint | null;
  beginDrag(at: PressPoint): void;
  extendDrag(clientX: number, clientY: number): void;
  /** Write the mark. False when the drag covered no words. */
  commitDrag(): boolean;
  cancelDrag(): void;
  isDragging(): boolean;
  /** A press that was not a drag: open the mark under it, if there is one. */
  tapAt(clientX: number, clientY: number): boolean;
}

/** A document's tree and spine item, for the shared lookups in mark-draw.ts. */
export function flowRangeSource(doc: FlowDoc, spineOf: (index: number) => SpineText | null): MarkRangeSource {
  return {
    rangeOfCfi: (cfi: string) => {
      const parsed = parseEpubRangeCfi(cfi);
      return parsed ? resolveRange(doc.root, parsed) : null;
    },
    spine: () => spineOf(doc.spine),
  };
}

/** A range's boxes in its document host's coordinates, the overlay's. */
export function rectsIn(doc: FlowDoc, range: Range): PageRect[] {
  const box = doc.host.getBoundingClientRect();
  const out: PageRect[] = [];
  for (const r of Array.from(range.getClientRects())) {
    if (r.width < 0.5 || r.height < 0.5) continue;
    out.push({ left: r.left - box.left, top: r.top - box.top, width: r.width, height: r.height });
  }
  return out;
}

export function createFlowMarks(host: FlowMarkHost): FlowMarks {
  const marks = new Map<string, Annotation>();
  const painted = new Map<number, PaintedMark[]>();
  const dirty = new Set<number>();
  const selected = new Set<string>();
  let toolColor = DEFAULT_MARK_COLOR;
  let drag: Drag | null = null;
  const owner = host.owner;
  const painter = createMarkPainter(owner);

  // --- reading a mark -----------------------------------------------------

  function spineOfMark(ann: Annotation): number | null {
    const position = epubPositionOf(ann);
    if (!position) return null;
    return parseCfiStart(position.value)?.spineIndex ?? null;
  }

  const rangesOf = (doc: FlowDoc) => flowRangeSource(doc, host.spineOf);

  // --- painting -----------------------------------------------------------

  function paint(doc: FlowDoc): void {
    const layer = painter.sublayer(doc.overlay, "rp-marks");
    layer.replaceChildren();
    const drawn: PaintedMark[] = [];
    for (const ann of marks.values()) {
      if (spineOfMark(ann) !== doc.spine) continue;
      const kind = markKind(ann);
      if (!kind || kind === "ink") continue;
      const range = rangeForMark(rangesOf(doc), ann);
      if (!range) continue;
      const rects = rectsIn(doc, range);
      if (rects.length === 0) continue;
      const color = colorOf(ann);
      painter.drawStroke(layer, kind, rects, color);
      drawn.push({ id: ann.id, rects });
      if (selected.has(ann.id)) painter.drawSelection(layer, rects, color);
    }
    painted.set(doc.spine, drawn);
    dirty.delete(doc.spine);
  }

  function invalidate(spine: number): void {
    dirty.add(spine);
    const doc = host.docOf(spine);
    if (doc && host.isShown(doc)) paint(doc);
  }

  function invalidateMarks(annotations: Iterable<Annotation>): void {
    const spines = new Set<number>();
    for (const ann of annotations) {
      const spine = spineOfMark(ann);
      if (spine !== null) spines.add(spine);
    }
    for (const spine of spines) invalidate(spine);
  }

  // --- the draft ----------------------------------------------------------

  function paintDraft(): void {
    if (!drag) return;
    const layer = painter.sublayer(drag.doc.overlay, "rp-draft");
    layer.replaceChildren();
    if (!drag.range) return;
    painter.drawStroke(layer, "highlight", rectsIn(drag.doc, drag.range), drag.color);
  }

  function clearDraft(doc: FlowDoc): void {
    doc.overlay.querySelector<HTMLElement>(".rp-draft")?.replaceChildren();
  }

  // --- writing a mark -----------------------------------------------------

  function commit(d: Drag): boolean {
    if (!d.range) return false;
    const mark = textMarkOf(d.range, {
      spine: d.doc.spine,
      stroke: "highlight",
      color: d.color,
      spineOf: host.spineOf,
      pagination: host.pagination,
      authorName: host.authorName,
      now: new Date().toISOString(),
      id: crypto.randomUUID(),
    });
    if (!mark) return false;
    marks.set(mark.id, mark);
    invalidate(d.doc.spine);
    host.onSave(Array.from(marks.values()));
    return true;
  }

  // --- pressing a mark ----------------------------------------------------

  function markAt(clientX: number, clientY: number): { doc: FlowDoc; mark: PaintedMark } | null {
    const doc = host.docAt(clientX, clientY);
    if (!doc) return null;
    const drawn = painted.get(doc.spine);
    if (!drawn) return null;
    const box = doc.host.getBoundingClientRect();
    const at = { x: clientX - box.left, y: clientY - box.top };
    // Last painted first: the newest mark is the one on top.
    for (let i = drawn.length - 1; i >= 0; i--) {
      if (rectsHit(drawn[i].rects, at)) return { doc, mark: drawn[i] };
    }
    return null;
  }

  function tapAt(clientX: number, clientY: number): boolean {
    const hit = markAt(clientX, clientY);
    if (!hit) return false;
    const ann = marks.get(hit.mark.id);
    if (!ann) return false;
    const box = unionRect(hit.mark.rects);
    if (!box) return false;
    const origin = hit.doc.host.getBoundingClientRect();
    host.onSelect([ann.id]);
    host.onPopup({
      rect: popupRect(box, (p) => ({ x: origin.left + p.x, y: origin.top + p.y })),
      annotation: ann,
    });
    return true;
  }

  // --- the drag -----------------------------------------------------------

  function caretAt(clientX: number, clientY: number): PressPoint | null {
    const doc = host.docAt(clientX, clientY);
    if (!doc) return null;
    const caret = caretAtPoint(doc.shadow, doc.root, clientX, clientY);
    return caret ? { doc, caret } : null;
  }

  // The word under the finger is the first thing highlighted, so a hold shows
  // what it began before the finger has moved.
  function beginDrag(at: PressPoint): void {
    const word = wordBoundsAt(at.caret.node.data, at.caret.offset);
    const start: CaretPoint = { node: at.caret.node, offset: word.start };
    const end: CaretPoint = { node: at.caret.node, offset: word.end };
    drag = { doc: at.doc, color: toolColor, start, range: rangeBetween(owner, start, end) };
    paintDraft();
  }

  function extendDrag(clientX: number, clientY: number): void {
    if (!drag) return;
    const end = host.strokeCaret
      ? host.strokeCaret(drag.doc, clientX, clientY)
      : caretAtPoint(drag.doc.shadow, drag.doc.root, clientX, clientY);
    if (!end) return;
    drag.range = rangeBetween(owner, drag.start, end);
    paintDraft();
  }

  function commitDrag(): boolean {
    const d = drag;
    if (!d) return false;
    drag = null;
    clearDraft(d.doc);
    return commit(d);
  }

  function cancelDrag(): void {
    if (!drag) return;
    clearDraft(drag.doc);
    drag = null;
  }

  return {
    reset(annotations) {
      marks.clear();
      for (const ann of annotations) marks.set(ann.id, ann);
      selected.clear();
      painted.clear();
      dirty.clear();
    },

    setAnnotations(annotations) {
      const touched: Annotation[] = [];
      for (const ann of annotations) {
        const previous = marks.get(ann.id);
        if (previous) touched.push(previous);
        marks.set(ann.id, ann);
        touched.push(ann);
      }
      invalidateMarks(touched);
    },

    unsetAnnotations(ids) {
      const gone: Annotation[] = [];
      for (const id of ids) {
        const ann = marks.get(id);
        if (!ann) continue;
        gone.push(ann);
        marks.delete(id);
        selected.delete(id);
      }
      invalidateMarks(gone);
    },

    selectAnnotations(ids) {
      const touched = new Set<string>([...selected, ...ids]);
      selected.clear();
      for (const id of ids) selected.add(id);
      const anns: Annotation[] = [];
      for (const id of touched) {
        const ann = marks.get(id);
        if (ann) anns.push(ann);
      }
      invalidateMarks(anns);
    },

    setTool(tool) {
      if (tool.color) toolColor = tool.color;
    },

    all: () => Array.from(marks.values()),
    needsPaint: (spine) => dirty.has(spine) || !painted.has(spine),
    paint,
    invalidate,
    caretAt,
    beginDrag,
    extendDrag,
    commitDrag,
    cancelDrag,
    isDragging: () => drag !== null,
    tapAt,
  };
}
