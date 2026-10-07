// The marks on the sheets: what is painted on every page card, what a pen
// leaves behind, and what a press on one opens. The desk (reader-view.ts) owns
// the pages and hands this layer the hooks page-card.ts left for it; nothing
// about scrolling, zooming or paginating is here.
//
// A text mark is stored as a range CFI and painted by resolving it against the
// card's own tree (annotation.ts, docs/39 §5). The CFI is the anchor and the
// quote is the repair, so a book whose layout drifted still shows its marks on
// the words they were drawn on. Ink is the exception: a free stroke is on no
// words, so it is stored as page coordinates and painted as it was drawn.
//
// A finger marks only by a hold (docs/82): the touch router times it and hands
// this layer the words (textSelect), which stay selected after the lift until
// the shell saves them as a mark or the next press puts them away.
//
// Every coordinate that leaves this file for the shell is a viewport
// coordinate, and every coordinate inside it is a page coordinate
// (mark-geometry.ts). The card converts between them.

import type {
  Annotation,
  AnnotationPopupParams,
  ReaderSelection,
  ScreenRect,
  SelectionMarkSpec,
  Tool,
} from "../../../platform/app/reader-contract";
import type { GestureTextSelect } from "../../engine/gesture/context";
import { pointerKindOf, routePointer, toolKindOf, type ToolKind } from "../../engine/gesture/touch-routing";
import {
  DEFAULT_MARK_COLOR,
  epubInkOf,
  markKind,
  newEpubInk,
  type MarkKind,
} from "../annotation";
import { caretAtPoint, rangeBetween, type CaretPoint } from "../caret";
import { colorOf, createMarkPainter, rangeForMark, type SpineText } from "../mark-draw";
import type { PageCard } from "./page-card";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../page-geometry";
import {
  HIT_PAD,
  INK_MIN_STEP,
  INK_WIDTH,
  clampPoint,
  clipRects,
  pathsBounds,
  pathsHit,
  pointsToPath,
  polylinePoints,
  popupRect,
  rectsHit,
  shouldAppendInkPoint,
  showsThroughBody,
  unionRect,
  type PagePoint,
  type PageRect,
} from "../mark-geometry";
import { textMarkOf } from "../mark-write";
import { movedEnd, spanTo, wordOf, type HeldWord } from "../word";
import type { Pagination } from "../paginate";
import { blockInfo, sheetMayShowMark, sheetsForMark } from "../reader-logic";

const SVG_NS = "http://www.w3.org/2000/svg";

export interface MarkHost {
  owner: Document;
  authorName: string;
  /** The sheet under a viewport point. */
  cardAt(clientX: number, clientY: number): PageCard | null;
  /** The page a mounted card is showing, or null when it shows none. */
  pageOfCard(card: PageCard): number | null;
  /** The mounted card showing a page, or null when the page has no sheet. */
  cardOfPage(pageIndex: number): PageCard | null;
  /** The book's pagination table: what each page is and where it starts. */
  pagination: Pagination;
  /** The ingestion side of a spine item, or null when there is none. */
  spineOf(index: number): SpineText | null;
  onSave(annotations: Annotation[]): void;
  onSelect(ids: string[]): void;
  onPopup(params?: AnnotationPopupParams): void;
  /** The finger's selection appeared, moved on screen, or went (null). */
  onSelection(selection: ReaderSelection | null): void;
}

/** The blue a finger's selection is drawn in, the phone's (flow-marks.ts). */
const SELECTION_COLOR = "#3f7ff0";

/** The words a hold selected, on the sheet it was held on. */
interface Selecting {
  card: PageCard;
  /** The page the sheet showed when the hold began. */
  pageIndex: number;
  /** The word the hold began on, which the drag grows from. */
  word: HeldWord;
  range: Range;
}

/** One mark as it was last painted on a page: what a press is tested against. */
interface PaintedMark {
  id: string;
  kind: MarkKind;
  rects: PageRect[];
  paths: readonly number[][];
  width: number;
}

type Drag =
  | {
      kind: "text";
      pointerId: number;
      card: PageCard;
      stroke: "highlight" | "underline";
      color: string;
      start: CaretPoint;
      range: Range | null;
    }
  | {
      kind: "ink";
      pointerId: number;
      card: PageCard;
      color: string;
      points: PagePoint[];
    };

export interface MarkLayer {
  /** Every mark of the book that was just opened. */
  reset(annotations: readonly Annotation[]): void;
  setAnnotations(annotations: readonly Annotation[]): void;
  unsetAnnotations(ids: readonly string[]): void;
  selectAnnotations(ids: readonly string[]): void;
  setTool(tool?: Tool): void;
  /** Paint one card, which is showing this page. */
  paint(card: PageCard, pageIndex: number): void;
  /** The page a mark sits on, or null when this book has no such mark. */
  pageOf(id: string): number | null;
  /** After a jump: put the mark's column on the sheet when the layout drifted. */
  reveal(pageIndex: number, id: string): void;
  isDrawing(): boolean;
  pointerDown(e: PointerEvent): boolean;
  pointerMove(e: PointerEvent): void;
  pointerUp(e: PointerEvent): boolean;
  pointerCancel(): void;
  /** A press that was not a drag: open the mark under it, if there is one. */
  tapAt(clientX: number, clientY: number): boolean;
  /** The finger's half of a hold, for the touch router. */
  textSelect: GestureTextSelect;
  moveSelectionEnd(end: "start" | "end", clientX: number, clientY: number): void;
  saveSelection(spec: SelectionMarkSpec): Annotation[];
  clearSelection(): void;
}

export function createMarkLayer(host: MarkHost): MarkLayer {
  const marks = new Map<string, Annotation>();
  const painted = new Map<number, PaintedMark[]>();
  const selected = new Set<string>();
  let toolId: string | null = null;
  let toolColor = DEFAULT_MARK_COLOR;
  let drag: Drag | null = null;
  let sel: Selecting | null = null;
  // Between the hold and the lift.
  let selecting = false;
  // The last press asked about, so the hold does not look for the words twice.
  let probe: { x: number; y: number; card: PageCard; caret: CaretPoint } | null = null;

  const owner = host.owner;
  const painter = createMarkPainter(owner);

  // --- the overlay's own layers ------------------------------------------

  // The overlay is shared with the AI-quote highlight, which owns a sublayer of
  // its own: each one clears only what it drew.
  function sublayer(card: PageCard, name: string): HTMLElement | null {
    return card.overlay ? painter.sublayer(card.overlay, name) : null;
  }

  // --- reading a mark -----------------------------------------------------

  function pageIndexOf(ann: Annotation): number | null {
    const raw = (ann.position as { pageIndex?: unknown } | undefined)?.pageIndex;
    return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
  }

  /** The card's tree and spine item, for the shared mark lookup. */
  function rangesOf(card: PageCard) {
    return {
      rangeOfCfi: (cfi: string) => card.rangeOf(cfi),
      spine: (): SpineText | null => (card.spine === null ? null : host.spineOf(card.spine)),
    };
  }

  // --- painting -----------------------------------------------------------

  function drawInk(into: HTMLElement, paths: readonly number[][], color: string, width: number): void {
    const svg = owner.createElementNS(SVG_NS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}`);
    svg.style.cssText = "position:absolute;inset:0;overflow:visible;pointer-events:none";
    for (const flat of paths) {
      if (flat.length < 4) {
        if (flat.length < 2) continue;
        const dot = owner.createElementNS(SVG_NS, "circle");
        dot.setAttribute("cx", String(flat[0]));
        dot.setAttribute("cy", String(flat[1]));
        dot.setAttribute("r", String(width / 2));
        dot.setAttribute("fill", color);
        svg.append(dot);
        continue;
      }
      const line = owner.createElementNS(SVG_NS, "polyline");
      line.setAttribute("points", polylinePoints(flat));
      line.setAttribute("fill", "none");
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", String(width));
      line.setAttribute("stroke-linecap", "round");
      line.setAttribute("stroke-linejoin", "round");
      svg.append(line);
    }
    into.append(svg);
  }

  // The marks a sheet tries: its own page's, and the text marks of the rest
  // of its spine document, whose words this device's layout may have put on
  // it (reader-logic.ts, docs/pitfall/485). The clip decides what shows.
  function marksForSheet(pageIndex: number): Annotation[] {
    const out: Annotation[] = [];
    for (const ann of marks.values()) {
      const page = pageIndexOf(ann);
      if (page === null) continue;
      if (sheetMayShowMark(host.pagination, page, markKind(ann) === "ink", pageIndex)) out.push(ann);
    }
    return out;
  }

  function paint(card: PageCard, pageIndex: number): void {
    const layer = sublayer(card, "rp-marks");
    if (!layer) return;
    layer.replaceChildren();
    const drawn: PaintedMark[] = [];
    for (const ann of marksForSheet(pageIndex)) {
      const kind = markKind(ann);
      if (!kind) continue;
      const color = colorOf(ann);
      if (kind === "ink") {
        const ink = epubInkOf(ann);
        if (!ink) continue;
        drawInk(layer, ink.paths, color, ink.width);
        const box = pathsBounds(ink.paths);
        const bounds = box ? [box] : [];
        drawn.push({ id: ann.id, kind, rects: bounds, paths: ink.paths, width: ink.width });
        if (selected.has(ann.id)) painter.drawSelection(layer, bounds, color);
        continue;
      }
      const range = rangeForMark(rangesOf(card), ann);
      if (!range) continue;
      const rects = clipRects(card.rectsOf(range));
      if (rects.length === 0) continue;
      painter.drawStroke(layer, kind, rects, color);
      drawn.push({ id: ann.id, kind, rects, paths: [], width: 0 });
      if (selected.has(ann.id)) painter.drawSelection(layer, rects, color);
    }
    painted.set(pageIndex, drawn);
  }

  function repaintPage(pageIndex: number): void {
    const card = host.cardOfPage(pageIndex);
    if (card) paint(card, pageIndex);
  }

  function repaintSheetsOf(annotations: readonly Annotation[]): void {
    const pages = new Set<number>();
    for (const ann of annotations) {
      const page = pageIndexOf(ann);
      if (page === null) continue;
      for (const sheet of sheetsForMark(host.pagination, page, markKind(ann) === "ink")) pages.add(sheet);
    }
    for (const page of pages) repaintPage(page);
  }

  // --- the draft ----------------------------------------------------------

  function draftLayer(card: PageCard): HTMLElement | null {
    return sublayer(card, "rp-draft");
  }

  function clearDraft(card: PageCard): void {
    card.overlay?.querySelector<HTMLElement>(".rp-draft")?.replaceChildren();
  }

  function paintDraft(): void {
    if (!drag) return;
    const layer = draftLayer(drag.card);
    if (!layer) return;
    layer.replaceChildren();
    if (drag.kind === "ink") {
      drawInk(layer, [pointsToPath(drag.points)], drag.color, INK_WIDTH);
      return;
    }
    if (!drag.range) return;
    painter.drawStroke(layer, drag.stroke, clipRects(drag.card.rectsOf(drag.range)), drag.color);
  }

  // --- writing a mark -----------------------------------------------------

  function commitText(d: Extract<Drag, { kind: "text" }>): boolean {
    const card = d.card;
    if (!d.range || card.spine === null) return false;
    const mark = textMarkOf(d.range, {
      spine: card.spine,
      stroke: d.stroke,
      color: d.color,
      spineOf: host.spineOf,
      pagination: host.pagination,
      authorName: host.authorName,
      now: new Date().toISOString(),
      id: crypto.randomUUID(),
    });
    if (!mark) return false;
    marks.set(mark.id, mark);
    host.onSave([mark]);
    repaintSheetsOf([mark]);
    return true;
  }

  function commitInk(d: Extract<Drag, { kind: "ink" }>): boolean {
    if (d.points.length < 2) return false;
    const pageIndex = host.pageOfCard(d.card);
    if (pageIndex === null) return false;
    const block = blockInfo(host.pagination, pageIndex);
    if (!block) return false;
    const mark = newEpubInk({
      id: crypto.randomUUID(),
      color: d.color,
      paths: [pointsToPath(d.points)],
      width: INK_WIDTH,
      pageIndex,
      pageLabel: block.label ?? String(pageIndex + 1),
      spineIndex: block.spine,
      charOffset: block.charOffset,
      authorName: host.authorName,
      now: new Date().toISOString(),
    }) as Annotation;
    marks.set(mark.id, mark);
    host.onSave([mark]);
    repaintPage(pageIndex);
    return true;
  }

  // --- pressing a mark ----------------------------------------------------

  function markAt(clientX: number, clientY: number): { card: PageCard; mark: PaintedMark } | null {
    const card = host.cardAt(clientX, clientY);
    if (!card) return null;
    const pageIndex = host.pageOfCard(card);
    if (pageIndex === null) return null;
    const at = card.fromViewport({ x: clientX, y: clientY });
    const drawn = painted.get(pageIndex);
    if (!drawn) return null;
    // Last painted first: the newest mark is the one on top.
    for (let i = drawn.length - 1; i >= 0; i--) {
      const mark = drawn[i];
      const hit =
        mark.kind === "ink"
          ? pathsHit(mark.paths, at, Math.max(HIT_PAD, mark.width))
          : rectsHit(mark.rects, at);
      if (hit) return { card, mark };
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
    host.onSelect([ann.id]);
    host.onPopup({ rect: popupRect(box, (p) => hit.card.toViewport(p)), annotation: ann });
    return true;
  }

  // --- the pointer --------------------------------------------------------

  function activeToolKind(): ToolKind {
    return toolKindOf(toolId);
  }

  function pointerDown(e: PointerEvent): boolean {
    if (drag) return false;
    const tool = activeToolKind();
    if (tool !== "annotate") return false;
    if (routePointer(tool, pointerKindOf(e.pointerType)) !== "draw") return false;
    const card = host.cardAt(e.clientX, e.clientY);
    if (!card || card.spine === null || !card.mounted) return false;
    if (host.pageOfCard(card) === null) return false;
    if (toolId === "ink") {
      drag = {
        kind: "ink",
        pointerId: e.pointerId,
        card,
        color: toolColor,
        points: [clampPoint(card.fromViewport({ x: e.clientX, y: e.clientY }))],
      };
      return true;
    }
    if (toolId !== "highlight" && toolId !== "underline") return false;
    const start = caretAtPoint(card.shadow, card.mounted.root, e.clientX, e.clientY);
    // Off the words: the page keeps the pointer, so a stroke started in the
    // margin scrolls instead of marking nothing.
    if (!start) return false;
    drag = { kind: "text", pointerId: e.pointerId, card, stroke: toolId, color: toolColor, start, range: null };
    return true;
  }

  function pointerMove(e: PointerEvent): void {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.kind === "ink") {
      const p = clampPoint(drag.card.fromViewport({ x: e.clientX, y: e.clientY }));
      if (!shouldAppendInkPoint(drag.points[drag.points.length - 1], p, INK_MIN_STEP)) return;
      drag.points.push(p);
      paintDraft();
      return;
    }
    const root = drag.card.mounted?.root;
    if (!root) return;
    const end = caretAtPoint(drag.card.shadow, root, e.clientX, e.clientY);
    if (!end) return;
    drag.range = rangeBetween(owner, drag.start, end);
    paintDraft();
  }

  function pointerUp(e: PointerEvent): boolean {
    const d = drag;
    if (!d || d.pointerId !== e.pointerId) return false;
    drag = null;
    clearDraft(d.card);
    const wrote = d.kind === "ink" ? commitInk(d) : commitText(d);
    // A pen that drew nothing is a press: the mark under it opens, exactly as
    // it does with no pen in hand.
    if (!wrote) tapAt(e.clientX, e.clientY);
    return true;
  }

  function pointerCancel(): void {
    if (!drag) return;
    clearDraft(drag.card);
    drag = null;
  }

  // --- the finger's selection ----------------------------------------------

  function paintSelection(): void {
    if (!sel) return;
    const layer = sublayer(sel.card, "rp-select");
    if (!layer) return;
    layer.replaceChildren();
    painter.drawStroke(layer, "highlight", clipRects(sel.card.rectsOf(sel.range)), SELECTION_COLOR);
  }

  function dropSelection(): void {
    if (!sel) return;
    sel.card.overlay?.querySelector<HTMLElement>(".rp-select")?.replaceChildren();
    sel = null;
    selecting = false;
  }

  // Where the selection is on screen: its line boxes cut to the text block,
  // in viewport coordinates. Null while the finger is still growing it.
  function report(): ReaderSelection | null {
    if (!sel || selecting) return null;
    const card = sel.card;
    const rects: ScreenRect[] = [];
    for (const r of clipRects(card.rectsOf(sel.range))) {
      const a = card.toViewport({ x: r.left, y: r.top });
      const b = card.toViewport({ x: r.left + r.width, y: r.top + r.height });
      if (b.x - a.x < 0.5 || b.y - a.y < 0.5) continue;
      rects.push({ left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y });
    }
    return rects.length > 0 ? { rects, text: sel.range.toString() } : null;
  }

  function caretOn(card: PageCard, clientX: number, clientY: number): CaretPoint | null {
    const root = card.mounted?.root;
    return root ? caretAtPoint(card.shadow, root, clientX, clientY) : null;
  }

  function wordsAt(clientX: number, clientY: number): boolean {
    probe = null;
    const card = host.cardAt(clientX, clientY);
    if (!card || card.spine === null || host.pageOfCard(card) === null) return false;
    const caret = caretOn(card, clientX, clientY);
    if (caret) probe = { x: clientX, y: clientY, card, caret };
    return caret !== null;
  }

  const textSelect: GestureTextSelect = {
    wordsAt,
    begin(clientX, clientY) {
      const same = probe !== null && probe.x === clientX && probe.y === clientY;
      const hit = same || wordsAt(clientX, clientY) ? probe : null;
      const pageIndex = hit ? host.pageOfCard(hit.card) : null;
      if (!hit || pageIndex === null) return false;
      dropSelection();
      const word = wordOf(hit.caret);
      const range = rangeBetween(owner, word.start, word.end);
      if (!range) return false;
      sel = { card: hit.card, pageIndex, word, range };
      selecting = true;
      paintSelection();
      host.onSelection(null);
      return true;
    },
    extend(clientX, clientY) {
      if (!sel || !selecting) return;
      const caret = caretOn(sel.card, clientX, clientY);
      if (!caret) return;
      const next = spanTo(owner, sel.word, caret);
      if (!next) return;
      sel.range = next;
      paintSelection();
    },
    commit() {
      if (!sel) return;
      selecting = false;
      if (sel.range.toString().trim() === "") {
        dropSelection();
        host.onSelection(null);
        return;
      }
      host.onSelection(report());
    },
    cancel() {
      dropSelection();
      host.onSelection(null);
    },
    active: () => sel !== null,
    clear() {
      if (!sel) return;
      dropSelection();
      host.onSelection(null);
    },
    moved: () => selectionMoved(),
  };

  function selectionMoved(): void {
    if (!sel) return;
    // The sheet went back to the pool, or now shows another page: the words
    // it held are gone from the screen with it.
    if (host.pageOfCard(sel.card) !== sel.pageIndex || !sel.card.mounted) {
      textSelect.clear();
      return;
    }
    if (!selecting) host.onSelection(report());
  }

  function moveSelectionEnd(end: "start" | "end", clientX: number, clientY: number): void {
    if (!sel || selecting) return;
    const caret = caretOn(sel.card, clientX, clientY);
    if (!caret) return;
    const next = movedEnd(owner, sel.range, end, caret);
    if (!next) return;
    sel.range = next;
    paintSelection();
    host.onSelection(report());
  }

  // The selection becomes a mark the way a pen stroke does (commitText), with
  // the thread an Ask opens already on it.
  function saveSelection(spec: SelectionMarkSpec): Annotation[] {
    const s = sel;
    if (!s || selecting || s.card.spine === null) return [];
    const mark = textMarkOf(s.range, {
      spine: s.card.spine,
      stroke: spec.stroke,
      color: spec.color,
      spineOf: host.spineOf,
      pagination: host.pagination,
      authorName: host.authorName,
      now: new Date().toISOString(),
      id: crypto.randomUUID(),
    });
    textSelect.clear();
    if (!mark) return [];
    const saved = spec.aiThreadId ? ({ ...mark, aiThreadId: spec.aiThreadId } as Annotation) : mark;
    marks.set(saved.id, saved);
    host.onSave([saved]);
    repaintSheetsOf([saved]);
    return [saved];
  }

  // --- what the shell drives ----------------------------------------------

  return {
    reset(annotations) {
      marks.clear();
      for (const ann of annotations) marks.set(ann.id, ann);
      selected.clear();
    },

    setAnnotations(annotations) {
      const changed: Annotation[] = [];
      for (const ann of annotations) {
        const previous = marks.get(ann.id);
        if (previous) changed.push(previous);
        marks.set(ann.id, ann);
        changed.push(ann);
      }
      repaintSheetsOf(changed);
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
      repaintSheetsOf(gone);
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
      repaintSheetsOf(anns);
    },

    setTool(tool) {
      toolId = tool?.type ?? null;
      if (tool?.color) toolColor = tool.color;
      if (activeToolKind() !== "annotate") pointerCancel();
      // Nothing selects under the navigation lock.
      if (activeToolKind() === "navlock") textSelect.clear();
    },

    paint,

    pageOf(id) {
      const ann = marks.get(id);
      return ann ? pageIndexOf(ann) : null;
    },

    reveal(pageIndex, id) {
      const card = host.cardOfPage(pageIndex);
      const ann = marks.get(id);
      if (!card || !ann) return;
      if (markKind(ann) !== "ink") {
        const range = rangeForMark(rangesOf(card), ann);
        // The table put the mark on this page; this device's layout may have
        // put it a column over, exactly as it may a cited quote.
        if (range && !showsThroughBody(card.rectsOf(range))) card.showColumnOf(range);
      }
      paint(card, pageIndex);
    },

    isDrawing: () => drag !== null || selecting,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    tapAt,
    textSelect,
    moveSelectionEnd,
    saveSelection,
    clearSelection: () => textSelect.clear(),
  };
}
