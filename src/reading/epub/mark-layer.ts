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
// Every coordinate that leaves this file for the shell is a viewport
// coordinate, and every coordinate inside it is a page coordinate
// (mark-geometry.ts). The card converts between them.

import type { Annotation, AnnotationPopupParams, Tool } from "../../platform/app/reader-contract";
import { MARKUP_OPACITY } from "../engine/convert";
import { pointerKindOf, routePointer, toolKindOf, type ToolKind } from "../engine/gesture/touch-routing";
import {
  DEFAULT_MARK_COLOR,
  epubInkOf,
  epubPositionOf,
  epubSortOffset,
  findQuoteSpan,
  markKind,
  newEpubInk,
  newEpubMark,
  quoteSelectorAt,
  quoteSelectorOf,
  sameWords,
  type MarkKind,
} from "./annotation";
import { caretAtPoint, rangeBetween, type CaretPoint } from "./caret";
import { epubRangeCfi, parseEpubRangeCfi, resolveSteps, textSteps } from "./cfi";
import type { PageCard } from "./page-card";
import { PAGE_HEIGHT, PAGE_WIDTH } from "./page-geometry";
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
  underlineBand,
  unionRect,
  type PagePoint,
  type PageRect,
} from "./mark-geometry";
import { runAt, offsetOfPoint, type DocumentText, type TextRun } from "./text";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The book's side of one spine item, as the layer needs it. */
export interface SpineText {
  index: number;
  idref: string;
  /** The ingestion tree: what the offsets and the pagination were taken on. */
  root: Element;
  text: DocumentText;
  runs: Map<Node, TextRun>;
}

export interface MarkHost {
  owner: Document;
  authorName: string;
  /** The sheet under a viewport point. */
  cardAt(clientX: number, clientY: number): PageCard | null;
  /** The page a mounted card is showing, or null when it shows none. */
  pageOfCard(card: PageCard): number | null;
  /** The mounted card showing a page, or null when the page has no sheet. */
  cardOfPage(pageIndex: number): PageCard | null;
  /** What the pagination table says about a page. */
  blockAt(pageIndex: number): { spine: number; charOffset: number; label: string | null } | undefined;
  /** The page a point in a spine document falls on. */
  pageOfPoint(spine: number, charOffset: number): number;
  /** The ingestion side of a spine item, or null when there is none. */
  spineOf(index: number): SpineText | null;
  onSave(annotations: Annotation[]): void;
  onSelect(ids: string[]): void;
  onPopup(params?: AnnotationPopupParams): void;
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
  setFingerDraw(on: boolean): void;
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
}

export function createMarkLayer(host: MarkHost): MarkLayer {
  const marks = new Map<string, Annotation>();
  const painted = new Map<number, PaintedMark[]>();
  const selected = new Set<string>();
  let toolId: string | null = null;
  let toolColor = DEFAULT_MARK_COLOR;
  let fingerDraw = false;
  let drag: Drag | null = null;

  const owner = host.owner;

  // --- the overlay's own layers ------------------------------------------

  // The overlay is shared with the AI-quote highlight, which owns a sublayer of
  // its own: each one clears only what it drew.
  function sublayer(card: PageCard, name: string): HTMLElement | null {
    const overlay = card.overlay;
    if (!overlay) return null;
    const existing = overlay.querySelector<HTMLElement>(`.${name}`);
    if (existing) return existing;
    const el = owner.createElement("div");
    el.className = name;
    el.style.cssText = "position:absolute;inset:0;pointer-events:none";
    overlay.append(el);
    return el;
  }

  // --- reading a mark -----------------------------------------------------

  function pageIndexOf(ann: Annotation): number | null {
    const raw = (ann.position as { pageIndex?: unknown } | undefined)?.pageIndex;
    return typeof raw === "number" && Number.isInteger(raw) && raw >= 0 ? raw : null;
  }

  function colorOf(ann: Annotation): string {
    const color = ann.color;
    return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : DEFAULT_MARK_COLOR;
  }

  /** A live Range on this card for a span of the ingestion text. */
  function rangeOfSpan(card: PageCard, spine: SpineText, span: { start: number; end: number }): Range | null {
    const from = runAt(spine.text.runs, span.start);
    const to = runAt(spine.text.runs, span.end);
    if (!from || !to) return null;
    const startLocal = textSteps(from.node, from.offset);
    const endLocal = textSteps(to.node, to.offset);
    if (startLocal === null || endLocal === null) return null;
    return card.rangeOf(epubRangeCfi(spine.index, spine.idref, startLocal, endLocal));
  }

  /**
   * Where a text mark is on this card. The CFI first; the quote when the CFI
   * resolves to nothing, or to words that are not the ones that were marked.
   */
  function rangeForMark(card: PageCard, ann: Annotation): Range | null {
    const position = epubPositionOf(ann);
    if (!position) return null;
    const quote = quoteSelectorOf(ann);
    const byCfi = card.rangeOf(position.value);
    if (byCfi && !byCfi.collapsed && (!quote || sameWords(byCfi.toString(), quote.exact))) return byCfi;
    if (!quote || card.spine === null) return byCfi && !byCfi.collapsed ? byCfi : null;
    const spine = host.spineOf(card.spine);
    if (!spine) return null;
    const near = epubSortOffset(ann.sortIndex) ?? undefined;
    const span = findQuoteSpan(spine.text.text, quote, near);
    if (!span) return null;
    return rangeOfSpan(card, spine, span);
  }

  // --- painting -----------------------------------------------------------

  function rectDiv(r: PageRect, css: string): HTMLElement {
    const el = owner.createElement("div");
    el.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;${css}`;
    return el;
  }

  function drawStroke(into: HTMLElement, kind: "highlight" | "underline", rects: PageRect[], color: string): void {
    for (const r of rects) {
      const box = kind === "underline" ? underlineBand(r) : r;
      into.append(rectDiv(box, `background:${color};opacity:${MARKUP_OPACITY};border-radius:1px`));
    }
  }

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

  /** The one selected mark's outline. The shell selects at most one at a time. */
  function drawSelection(into: HTMLElement, rects: PageRect[], color: string): void {
    const box = unionRect(rects);
    if (!box) return;
    const grown = { left: box.left - 3, top: box.top - 3, width: box.width + 6, height: box.height + 6 };
    into.append(
      rectDiv(grown, `border:1.5px solid ${color};border-radius:3px;box-sizing:border-box;opacity:0.9`),
    );
  }

  function marksOnPage(pageIndex: number): Annotation[] {
    const out: Annotation[] = [];
    for (const ann of marks.values()) {
      if (pageIndexOf(ann) === pageIndex) out.push(ann);
    }
    return out;
  }

  function paint(card: PageCard, pageIndex: number): void {
    const layer = sublayer(card, "rp-marks");
    if (!layer) return;
    layer.replaceChildren();
    const drawn: PaintedMark[] = [];
    for (const ann of marksOnPage(pageIndex)) {
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
        if (selected.has(ann.id)) drawSelection(layer, bounds, color);
        continue;
      }
      const range = rangeForMark(card, ann);
      if (!range) continue;
      const rects = clipRects(card.rectsOf(range));
      if (rects.length === 0) continue;
      drawStroke(layer, kind, rects, color);
      drawn.push({ id: ann.id, kind, rects, paths: [], width: 0 });
      if (selected.has(ann.id)) drawSelection(layer, rects, color);
    }
    painted.set(pageIndex, drawn);
  }

  function repaintPage(pageIndex: number): void {
    const card = host.cardOfPage(pageIndex);
    if (card) paint(card, pageIndex);
  }

  function repaintPagesOf(annotations: readonly Annotation[]): void {
    const pages = new Set<number>();
    for (const ann of annotations) {
      const page = pageIndexOf(ann);
      if (page !== null) pages.add(page);
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
    drawStroke(layer, drag.stroke, clipRects(drag.card.rectsOf(drag.range)), drag.color);
  }

  // --- writing a mark -----------------------------------------------------

  function commitText(d: Extract<Drag, { kind: "text" }>): boolean {
    const card = d.card;
    if (!d.range || d.range.collapsed || card.spine === null) return false;
    const cfi = card.cfiOf(d.range);
    if (!cfi) return false;
    const spine = host.spineOf(card.spine);
    const parsed = parseEpubRangeCfi(cfi);
    if (!spine || !parsed) return false;
    // Back to the ingestion tree before any offset is read off it: the card's
    // nodes are a clone's, and the offsets the pagination was cut on are the
    // ingestion tree's (docs/pitfall/267).
    const from = resolveSteps(spine.root, parsed.start.steps, parsed.start.offset);
    const to = resolveSteps(spine.root, parsed.end.steps, parsed.end.offset);
    if (!from || !to) return false;
    const start = offsetOfPoint(spine.text, spine.runs, from.node, from.offset);
    const end = offsetOfPoint(spine.text, spine.runs, to.node, to.offset);
    const span = { start: Math.min(start, end), end: Math.max(start, end) };
    const quote = quoteSelectorAt(spine.text.text, span);
    if (quote.exact.trim() === "") return false;
    const pageIndex = host.pageOfPoint(spine.index, span.start);
    const block = host.blockAt(pageIndex);
    const mark = newEpubMark({
      id: crypto.randomUUID(),
      stroke: d.stroke,
      color: d.color,
      cfi,
      spineIndex: spine.index,
      span,
      pageIndex,
      pageLabel: block?.label ?? String(pageIndex + 1),
      quote,
      authorName: host.authorName,
      now: new Date().toISOString(),
    }) as Annotation;
    marks.set(mark.id, mark);
    host.onSave([mark]);
    repaintPage(pageIndex);
    return true;
  }

  function commitInk(d: Extract<Drag, { kind: "ink" }>): boolean {
    if (d.points.length < 2) return false;
    const pageIndex = host.pageOfCard(d.card);
    if (pageIndex === null) return false;
    const block = host.blockAt(pageIndex);
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
    if (routePointer(tool, pointerKindOf(e.pointerType), fingerDraw) !== "draw") return false;
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

  // --- what the shell drives ----------------------------------------------

  return {
    reset(annotations) {
      marks.clear();
      for (const ann of annotations) marks.set(ann.id, ann);
      selected.clear();
    },

    setAnnotations(annotations) {
      const stale = new Set<number>();
      for (const ann of annotations) {
        const previous = marks.get(ann.id);
        const before = previous ? pageIndexOf(previous) : null;
        if (before !== null) stale.add(before);
        marks.set(ann.id, ann);
      }
      for (const page of stale) repaintPage(page);
      repaintPagesOf(annotations);
    },

    unsetAnnotations(ids) {
      const pages = new Set<number>();
      for (const id of ids) {
        const ann = marks.get(id);
        if (!ann) continue;
        const page = pageIndexOf(ann);
        if (page !== null) pages.add(page);
        marks.delete(id);
        selected.delete(id);
      }
      for (const page of pages) repaintPage(page);
    },

    selectAnnotations(ids) {
      const touched = new Set<string>([...selected, ...ids]);
      selected.clear();
      for (const id of ids) selected.add(id);
      const pages = new Set<number>();
      for (const id of touched) {
        const page = marks.has(id) ? pageIndexOf(marks.get(id) as Annotation) : null;
        if (page !== null) pages.add(page);
      }
      for (const page of pages) repaintPage(page);
    },

    setTool(tool) {
      toolId = tool?.type ?? null;
      if (tool?.color) toolColor = tool.color;
      if (activeToolKind() !== "annotate") pointerCancel();
    },

    setFingerDraw(on) {
      fingerDraw = on;
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
        const range = rangeForMark(card, ann);
        // The table put the mark on this page; this device's layout may have
        // put it a column over, exactly as it may a cited quote.
        if (range && clipRects(card.rectsOf(range)).length === 0) card.showColumnOf(range);
      }
      paint(card, pageIndex);
    },

    isDrawing: () => drag !== null,
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    tapAt,
  };
}
