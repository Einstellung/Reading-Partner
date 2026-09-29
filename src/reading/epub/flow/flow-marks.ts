// The marks in the reflow column (docs/70): what is painted over every mounted
// document, what a finger selects, and what a tap on one opens. The column
// (flow-view.ts) owns the documents and the pointer; this layer is handed the
// documents and told when a drag begins, moves and ends.
//
// A drag is a selection, not a mark (docs/82): it stays on the page after the
// finger lifts, its two ends can be moved by the shell's handles, and it
// becomes a mark only when the shell saves it — a highlight, or the underline
// an Ask leaves. Saving a highlight over highlights already there merges them.
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

import type { Annotation } from "../../../platform/app/reader-contract";
import { epubPositionOf, markKind } from "../annotation";
import { caretAtPoint, rangeBetween, type CaretPoint } from "../caret";
import { parseCfiStart, parseEpubRangeCfi, resolveRange } from "../file/cfi";
import type { FlowMarkPopup, FlowMarkSpec, FlowRect, FlowSelection, FlowTool } from "./flow-contract";
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
  onPopup(params?: FlowMarkPopup): void;
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

interface Selecting {
  doc: FlowDoc;
  /** The word the hold began on, which a drag grows from. */
  startWord: { start: CaretPoint; end: CaretPoint };
  range: Range | null;
}

/** The blue a selection is drawn in, under the marks' own opacity. */
const SELECTION_COLOR = "#3f7ff0";

/** How long a mark reached from the Marks list stays ringed. */
const FLASH_MS = 1500;

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
  /** The finger lifted: the selection stays. False when it covered no words. */
  commitDrag(): boolean;
  cancelDrag(): void;
  isDragging(): boolean;
  /** A press that was not a drag: open the mark under it, if there is one. */
  tapAt(clientX: number, clientY: number): boolean;
  /** The selection left by the last drag, where it is on screen now. */
  selection(): FlowSelection | null;
  hasSelection(): boolean;
  moveSelectionEnd(end: "start" | "end", clientX: number, clientY: number): void;
  saveSelection(spec: FlowMarkSpec): Annotation | null;
  clearSelection(): void;
  /** Select a mark's words, as a hold would have. False when they are not laid out. */
  selectMark(id: string): boolean;
  /** Ring a mark for a moment. */
  flash(id: string): void;
  /** Where a mark is, as the range CFI it was written with. */
  cfiOf(id: string): string | null;
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
  let sel: Selecting | null = null;
  let dragging = false;
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
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
    if (sel?.doc === doc) paintSelection();
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

  // --- the selection ----------------------------------------------------

  function paintSelection(): void {
    if (!sel) return;
    const layer = painter.sublayer(sel.doc.overlay, "rp-select");
    layer.replaceChildren();
    if (!sel.range) return;
    painter.drawStroke(layer, "highlight", rectsIn(sel.doc, sel.range), SELECTION_COLOR);
  }

  function clearSelection(): void {
    if (!sel) return;
    sel.doc.overlay.querySelector<HTMLElement>(".rp-select")?.replaceChildren();
    sel = null;
    dragging = false;
  }

  function selection(): FlowSelection | null {
    if (!sel?.range || dragging) return null;
    const rects: FlowRect[] = [];
    for (const r of Array.from(sel.range.getClientRects())) {
      if (r.width < 0.5 || r.height < 0.5) continue;
      rects.push({ left: r.left, top: r.top, width: r.width, height: r.height });
    }
    if (rects.length === 0) return null;
    return { rects, text: sel.range.toString() };
  }

  function caretIn(doc: FlowDoc, clientX: number, clientY: number): CaretPoint | null {
    return host.strokeCaret
      ? host.strokeCaret(doc, clientX, clientY)
      : caretAtPoint(doc.shadow, doc.root, clientX, clientY);
  }

  function wordOf(caret: CaretPoint): { start: CaretPoint; end: CaretPoint } {
    const w = wordBoundsAt(caret.node.data, caret.offset);
    return { start: { node: caret.node, offset: w.start }, end: { node: caret.node, offset: w.end } };
  }

  // The selection from the word a hold began on to the word under a point, in
  // whichever direction the point is: the far edge of each word, so a drag
  // never cuts one.
  function spanTo(from: { start: CaretPoint; end: CaretPoint }, to: CaretPoint): Range | null {
    const target = wordOf(to);
    const probe = owner.createRange();
    try {
      probe.setStart(from.start.node, from.start.offset);
      probe.collapse(true);
      if (probe.comparePoint(to.node, to.offset) < 0) return rangeBetween(owner, target.start, from.end);
    } catch {
      return null;
    }
    return rangeBetween(owner, from.start, target.end);
  }

  function moveSelectionEnd(end: "start" | "end", clientX: number, clientY: number): void {
    if (!sel?.range) return;
    const caret = caretIn(sel.doc, clientX, clientY);
    if (!caret) return;
    const r = sel.range;
    // The end that stays, as a point: the moving one grows from it the way a
    // drag grows from the held word.
    const node = end === "start" ? r.endContainer : r.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const at: CaretPoint = { node: node as Text, offset: end === "start" ? r.endOffset : r.startOffset };
    const next = spanTo({ start: at, end: at }, caret);
    if (!next) return;
    sel.range = next;
    paintSelection();
  }

  // Highlights the new one touches: their words join it and they go, so two
  // marks never sit on the same words.
  function mergeInto(doc: FlowDoc, range: Range): { range: Range; gone: string[] } {
    const merged = range.cloneRange();
    const gone: string[] = [];
    for (const ann of marks.values()) {
      if (spineOfMark(ann) !== doc.spine || markKind(ann) !== "highlight") continue;
      const other = rangeForMark(rangesOf(doc), ann);
      if (!other) continue;
      let overlaps = false;
      try {
        overlaps =
          other.compareBoundaryPoints(Range.END_TO_START, merged) <= 0 &&
          other.compareBoundaryPoints(Range.START_TO_END, merged) >= 0;
      } catch {
        continue;
      }
      if (!overlaps) continue;
      if (other.compareBoundaryPoints(Range.START_TO_START, merged) < 0) {
        merged.setStart(other.startContainer, other.startOffset);
      }
      if (other.compareBoundaryPoints(Range.END_TO_END, merged) > 0) {
        merged.setEnd(other.endContainer, other.endOffset);
      }
      gone.push(ann.id);
    }
    return { range: merged, gone };
  }

  function saveSelection(spec: FlowMarkSpec): Annotation | null {
    const s = sel;
    if (!s?.range) return null;
    const { range, gone } = spec.stroke === "highlight" ? mergeInto(s.doc, s.range) : { range: s.range, gone: [] };
    const mark = textMarkOf(range, {
      spine: s.doc.spine,
      stroke: spec.stroke,
      color: spec.color,
      spineOf: host.spineOf,
      pagination: host.pagination,
      authorName: host.authorName,
      now: new Date().toISOString(),
      id: crypto.randomUUID(),
    });
    clearSelection();
    if (!mark) return null;
    const saved = spec.aiThreadId ? ({ ...mark, aiThreadId: spec.aiThreadId } as Annotation) : mark;
    for (const id of gone) {
      marks.delete(id);
      selected.delete(id);
    }
    marks.set(saved.id, saved);
    invalidate(s.doc.spine);
    host.onSave(Array.from(marks.values()));
    return saved;
  }

  // --- pressing a mark ----------------------------------------------------

  function tapAt(clientX: number, clientY: number): boolean {
    const doc = host.docAt(clientX, clientY);
    const drawn = doc ? painted.get(doc.spine) : undefined;
    if (!doc || !drawn) return false;
    const box = doc.host.getBoundingClientRect();
    const at = { x: clientX - box.left, y: clientY - box.top };
    // Every mark under the finger, newest first. An underline wins: it is a
    // door into a conversation, and the highlight it runs through rides along.
    const hits = drawn
      .filter((m) => rectsHit(m.rects, at))
      .reverse()
      .flatMap((m) => {
        const ann = marks.get(m.id);
        return ann ? [{ painted: m, ann }] : [];
      });
    const first = hits.find((h) => markKind(h.ann) === "underline") ?? hits[0];
    if (!first) return false;
    const under = hits.find((h) => h !== first && markKind(h.ann) === "highlight");
    const union = unionRect(first.painted.rects);
    if (!union) return false;
    host.onSelect([first.ann.id]);
    host.onPopup({
      rect: popupRect(union, (p) => ({ x: box.left + p.x, y: box.top + p.y })),
      annotation: first.ann,
      ...(under && markKind(first.ann) === "underline" ? { under: under.ann } : {}),
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

  // The word under the finger is selected first, so a hold shows what it began
  // before the finger has moved.
  function beginDrag(at: PressPoint): void {
    clearSelection();
    const word = wordOf(at.caret);
    sel = { doc: at.doc, startWord: word, range: rangeBetween(owner, word.start, word.end) };
    dragging = true;
    paintSelection();
  }

  function extendDrag(clientX: number, clientY: number): void {
    if (!sel || !dragging) return;
    const end = caretIn(sel.doc, clientX, clientY);
    if (!end) return;
    const next = spanTo(sel.startWord, end);
    if (!next) return;
    sel.range = next;
    paintSelection();
  }

  // The finger lifted: the selection stays. False when it covered no words.
  function commitDrag(): boolean {
    if (!sel || !dragging) return false;
    dragging = false;
    if (!sel.range || sel.range.toString().trim() === "") {
      clearSelection();
      return false;
    }
    return true;
  }

  function selectMark(id: string): boolean {
    const ann = marks.get(id);
    const spine = ann ? spineOfMark(ann) : null;
    const doc = spine === null ? null : host.docOf(spine);
    const range = ann && doc ? rangeForMark(rangesOf(doc), ann) : null;
    if (!doc || !range || range.collapsed) return false;
    clearSelection();
    const start = { node: range.startContainer as Text, offset: range.startOffset };
    sel = { doc, startWord: { start, end: start }, range };
    paintSelection();
    return true;
  }

  function flash(id: string): void {
    const ann = marks.get(id);
    if (!ann) return;
    if (flashTimer) clearTimeout(flashTimer);
    selected.clear();
    selected.add(id);
    invalidateMarks([ann]);
    flashTimer = setTimeout(() => {
      flashTimer = null;
      if (!selected.delete(id)) return;
      const still = marks.get(id);
      if (still) invalidateMarks([still]);
    }, FLASH_MS);
  }

  return {
    reset(annotations) {
      marks.clear();
      for (const ann of annotations) marks.set(ann.id, ann);
      selected.clear();
      painted.clear();
      dirty.clear();
      clearSelection();
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

    // The phone has no pen: a drag is always a selection, and the colour of
    // a mark is decided when the selection is saved.
    setTool() {},

    all: () => Array.from(marks.values()),
    needsPaint: (spine) => dirty.has(spine) || !painted.has(spine),
    paint,
    invalidate,
    caretAt,
    beginDrag,
    extendDrag,
    commitDrag,
    cancelDrag: clearSelection,
    isDragging: () => dragging,
    tapAt,
    selection,
    hasSelection: () => sel !== null,
    moveSelectionEnd,
    saveSelection,
    clearSelection,
    selectMark,
    flash,
    cfiOf: (id) => epubPositionOf(marks.get(id))?.value ?? null,
  };
}
