// The desk: the imperative half of the EPUB reading area, and the place the
// shell's ViewInstance is implemented (platform/app/reader-contract). Pages
// are sheets on a scrolling desk, exactly as the PDF side lays them (docs/63):
// a vertical column at fit-width, or a paged flip at fit-page; zoom scales the
// sheets; the top bar's page number is the sheet under the viewport's top.
//
// It is not a component because none of it is rendering. The pane owns one
// element and the events landing on it; everything that happens to the book
// happens here. Every event is in the app's own DOM — the sheets are shadow
// roots, not frames — so nothing here works around a frame that hears nothing.
//
// Only the sheets near the viewport carry a document (a spine document is
// cloned into every card that shows one of its pages); the others are empty
// slots of the right size, which is what keeps a 1,000-page book at a handful
// of layouts at a time.

import type {
  Annotation,
  AnnotationPopupParams,
  Tool,
  ViewInstance,
  ViewState,
  ViewStats,
} from "../../platform/app/reader-contract";
import { openExternal } from "../../platform/app/external-link";
import { LAYOUT_SETTINGS, type ReadingLayout } from "../engine/layout-modes";
import { PAGE_FRAME } from "../engine/page-frame";
import { acquireEpub, ensurePagination, releaseEpub } from "./book-cache";
import {
  PAGE_GAP,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  columnPosition,
  columnScrollTop,
  flipPosition,
  mountRange,
  openingEpubZoom,
  stripMetrics,
  visibleColumnRange,
  zoomScale,
  zoomStepDown,
  zoomStepUp,
  type Zoom,
} from "./page-geometry";
import { createMarkLayer, type MarkLayer, type SpineText } from "./mark-layer";
import { createPageCard, type PageCard } from "./page-card";
import { createPageResources } from "./page-mount";
import type { Pagination } from "./paginate";
import type { EpubBook } from "./parse";
import {
  blockIndexAt,
  bookLinkTarget,
  findQuoteAt,
  restoreTarget,
  statsOf,
  viewStateOf,
} from "./reader-logic";
import { extractDocumentText, indexRuns, runAt } from "./text";
import { hrefFragment, resolveZipPath } from "./zip";

// The same violet the PDF side paints an AI-cited quote in
// (reading/engine/EmbedPdfView.tsx), at the same opacity.
const QUOTE_COLOR = "#4a3a9e";
const QUOTE_OPACITY = "0.24";

// Sheets kept mounted beyond the visible ones, each side.
const MOUNT_MARGIN = 1;

export interface EpubReaderCallbacks {
  onChangeViewState(state: ViewState): void;
  onChangeViewStats(stats: ViewStats): void;
  onQuoteHighlightChange(active: boolean): void;
  /** A mark the reader just drew, for the shell to persist (and to open on). */
  onSaveAnnotations(annotations: Annotation[]): void;
  onSelectAnnotations(ids: string[]): void;
  onAnnotationPopup(params?: AnnotationPopupParams): void;
}

export interface EpubReaderController extends ViewInstance {
  /** Follow the book's own link under this viewport point, if there is one. */
  followLinkAt(clientX: number, clientY: number): boolean;
  /** Turn one page (paged) or one screen (vertical). */
  turn(direction: "prev" | "next"): void;
  currentLayout(): ReadingLayout;
  /** The sheet under a viewport point. */
  cardAt(clientX: number, clientY: number): PageCard | null;
  /**
   * The marks' half of the pointer. The pane forwards every pointer here
   * first: a down the pens take is a down the page turn never sees, and a tap
   * that lands on a mark opens it instead of turning.
   */
  markPointerDown(e: PointerEvent): boolean;
  markPointerMove(e: PointerEvent): void;
  markPointerUp(e: PointerEvent): boolean;
  markPointerCancel(): void;
  markTapAt(clientX: number, clientY: number): boolean;
  /** Whether a stroke is being drawn, so the pane can claim the touch. */
  isDrawing(): boolean;
  destroy(): void;
}

export interface EpubReaderOptions {
  host: HTMLElement;
  bookId: string;
  buffer: ArrayBuffer;
  viewState: ViewState | null;
  annotations: Annotation[];
  /** Who a mark drawn here is by, the same string the PDF side is handed. */
  authorName: string;
  callbacks: EpubReaderCallbacks;
}

interface Slot {
  el: HTMLElement;
  card: PageCard | null;
  /** Resolves once the card shows its page: mounted, pictures settled, column in place. */
  shown: Promise<void> | null;
}

/**
 * Open a book into `host` and hand back the handle the shell drives. Resolves
 * once the first sheets are on the desk; a failure to get that far rejects.
 */
export async function createEpubReader(opts: EpubReaderOptions): Promise<EpubReaderController> {
  const { host, bookId, buffer, viewState, callbacks } = opts;
  const owner = host.ownerDocument;

  const book: EpubBook = acquireEpub(bookId, buffer);
  const pagination: Pagination = await ensurePagination(bookId, book, host);
  const pagesCount = pagination.blocks.length;
  const resources = createPageResources(book.zip);

  // --- the desk ------------------------------------------------------------
  const scroller = owner.createElement("div");
  scroller.className = "rp-desk";
  scroller.setAttribute("data-reader-surface", "");
  scroller.style.cssText = [
    "position:relative",
    "width:100%",
    "height:100%",
    "overflow:auto",
    `background:${PAGE_FRAME.background}`,
    "overscroll-behavior:contain",
  ].join(";");
  const strip = owner.createElement("div");
  strip.className = "rp-strip";
  strip.style.position = "relative";
  scroller.append(strip);
  host.replaceChildren(scroller);

  const slots: Slot[] = [];
  for (let i = 0; i < pagesCount; i++) {
    const el = owner.createElement("div");
    el.className = "rp-slot";
    el.style.position = "absolute";
    el.dataset.page = String(i);
    strip.append(el);
    slots.push({ el, card: null, shown: null });
  }

  // --- state --------------------------------------------------------------
  let layout: ReadingLayout = viewState?.layout ?? "vertical";
  let zoom: Zoom = openingEpubZoom(layout, viewState?.scale);
  let scale = 1;
  let pageIndex = 0;
  let pageY = 0;
  let destroyed = false;
  let quote: { pageIndex: number } | null = null;
  let mountedFrom = 0;
  let mountedTo = -1;
  let scrollTimer: number | null = null;

  const viewport = () => ({ clientWidth: scroller.clientWidth, clientHeight: scroller.clientHeight });

  // Slot geometry for the layout in force. Vertical: sheets stacked with a
  // gap, centred when narrower than the desk. Paged: one viewport-sized slot
  // per page, side by side, the sheet centred in it.
  function slotSize(): { w: number; h: number; pitchX: number; pitchY: number } {
    const { pageWidth, pageHeight, pitch } = stripMetrics(scale);
    if (layout === "vertical") {
      const w = Math.max(scroller.clientWidth, pageWidth);
      return { w, h: pageHeight, pitchX: 0, pitchY: pitch };
    }
    const w = Math.max(scroller.clientWidth, pageWidth);
    const h = Math.max(scroller.clientHeight, pageHeight);
    return { w, h, pitchX: w, pitchY: 0 };
  }

  function applyGeometry(): void {
    scale = zoomScale(zoom, layout, viewport());
    const { pageWidth, pageHeight } = stripMetrics(scale);
    const s = slotSize();
    if (layout === "vertical") {
      strip.style.width = `${s.w}px`;
      strip.style.height = `${pagesCount * s.pitchY + PAGE_GAP}px`;
      scroller.style.scrollSnapType = "none";
    } else {
      strip.style.width = `${pagesCount * s.pitchX}px`;
      strip.style.height = `${s.h}px`;
      scroller.style.scrollSnapType = "x mandatory";
    }
    const left = Math.max(0, (s.w - pageWidth) / 2);
    const top = layout === "vertical" ? 0 : Math.max(0, (s.h - pageHeight) / 2);
    for (let i = 0; i < slots.length; i++) {
      const el = slots[i].el;
      el.style.width = `${s.w}px`;
      el.style.height = `${s.h}px`;
      el.style.left = `${i * s.pitchX}px`;
      el.style.top = `${layout === "vertical" ? i * s.pitchY + PAGE_GAP / 2 : 0}px`;
      el.style.scrollSnapAlign = layout === "paged" ? "start" : "none";
      const card = slots[i].card;
      if (card) {
        card.setScale(scale);
        card.el.style.left = `${left}px`;
        card.el.style.top = `${top}px`;
      }
    }
  }

  // --- mounting ---------------------------------------------------------------
  const cardPool: PageCard[] = [];

  function mountSlot(i: number): PageCard {
    const slot = slots[i];
    if (slot.card) return slot.card;
    const card = cardPool.pop() ?? createPageCard(owner, resources);
    slot.card = card;
    const { pageWidth, pageHeight } = stripMetrics(scale);
    const s = slotSize();
    card.setScale(scale);
    card.el.style.left = `${Math.max(0, (s.w - pageWidth) / 2)}px`;
    card.el.style.top = `${layout === "vertical" ? 0 : Math.max(0, (s.h - pageHeight) / 2)}px`;
    slot.el.append(card.el);
    const block = pagination.blocks[i];
    const doc = book.docs[block.spine];
    const ordinal = i - firstPageOfSpine(block.spine);
    slot.shown = card.show(doc, block.cfi, ordinal).then(() => {
      // The sheet is only now showing this page's column, which is the only
      // state the marks' rects can be measured against.
      if (!destroyed && slots[i].card === card) marks.paint(card, i);
    });
    return card;
  }

  function unmountSlot(i: number): void {
    const slot = slots[i];
    if (!slot.card) return;
    slot.card.el.remove();
    slot.card.clear();
    cardPool.push(slot.card);
    slot.card = null;
    slot.shown = null;
  }

  const spineStarts = new Map<number, number>();
  for (let i = 0; i < pagination.blocks.length; i++) {
    const s = pagination.blocks[i].spine;
    if (!spineStarts.has(s)) spineStarts.set(s, i);
  }
  function firstPageOfSpine(spine: number): number {
    return spineStarts.get(spine) ?? 0;
  }

  // --- the marks ----------------------------------------------------------
  // One index of a spine item's text per book, built when a mark on it is first
  // written or repaired. It is the ingestion tree's, never a card's clone's
  // (docs/pitfall/267).
  const spineTexts = new Map<number, SpineText>();
  function spineOf(index: number): SpineText | null {
    const hit = spineTexts.get(index);
    if (hit) return hit;
    const doc = book.docs[index];
    const root = doc?.doc.documentElement;
    if (!doc || !root) return null;
    const entry: SpineText = { index, idref: doc.idref, root, text: doc.text, runs: indexRuns(doc.text) };
    spineTexts.set(index, entry);
    return entry;
  }

  const marks: MarkLayer = createMarkLayer({
    owner,
    authorName: opts.authorName,
    cardAt: (x, y) => cardAt(x, y),
    pageOfCard: (card) => {
      for (let i = 0; i < slots.length; i++) if (slots[i].card === card) return i;
      return null;
    },
    cardOfPage: (i) => slots[i]?.card ?? null,
    blockAt: (i) => {
      const block = pagination.blocks[i];
      return block ? { spine: block.spine, charOffset: block.charOffset, label: block.label ?? null } : undefined;
    },
    pageOfPoint: (spine, charOffset) => blockIndexAt(pagination, spine, charOffset),
    spineOf,
    onSave: (annotations) => callbacks.onSaveAnnotations(annotations),
    onSelect: (ids) => callbacks.onSelectAnnotations(ids),
    onPopup: (params) => callbacks.onAnnotationPopup(params),
  });
  marks.reset(opts.annotations);

  function visibleRange(): { first: number; last: number } {
    if (layout === "vertical") {
      return visibleColumnRange(scroller.scrollTop, scroller.clientHeight, scale, pagesCount);
    }
    const s = slotSize();
    const first = Math.max(0, Math.floor(scroller.scrollLeft / s.pitchX));
    const last = Math.min(pagesCount - 1, Math.floor((scroller.scrollLeft + scroller.clientWidth - 1) / s.pitchX));
    return { first, last: Math.max(first, last) };
  }

  function syncMounted(): void {
    const { first, last } = visibleRange();
    const { from, to } = mountRange(first, last, pagesCount, MOUNT_MARGIN);
    for (let i = mountedFrom; i <= mountedTo; i++) if (i < from || i > to) unmountSlot(i);
    for (let i = from; i <= to; i++) mountSlot(i);
    mountedFrom = from;
    mountedTo = to;
  }

  // --- position -----------------------------------------------------------------
  function readPosition(): void {
    if (layout === "vertical") {
      const at = columnPosition(scroller.scrollTop, scale, pagesCount);
      pageIndex = at.pageIndex;
      pageY = at.pageY;
    } else {
      pageIndex = flipPosition(scroller.scrollLeft, slotSize().pitchX, pagesCount);
      pageY = 0;
    }
  }

  function emit(): void {
    if (destroyed) return;
    callbacks.onChangeViewStats(statsOf({ pageIndex, pagination, layout, zoom, scale }));
    callbacks.onChangeViewState(
      viewStateOf({
        pageIndex,
        cfi: pagination.blocks[pageIndex]?.cfi ?? null,
        scale,
        layout,
        pageX: 0,
        pageY: layout === "vertical" ? Math.round(pageY) : 0,
      }),
    );
  }

  function placePage(index: number, y = 0): void {
    const i = Math.min(Math.max(0, index), pagesCount - 1);
    if (layout === "vertical") {
      scroller.scrollTop = columnScrollTop(i, y, scale);
    } else {
      scroller.scrollLeft = i * slotSize().pitchX;
    }
    readPosition();
    syncMounted();
    emit();
  }

  function onScroll(): void {
    if (destroyed) return;
    readPosition();
    syncMounted();
    if (scrollTimer !== null) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      emit();
    }, 120) as unknown as number;
  }
  scroller.addEventListener("scroll", onScroll, { passive: true });

  // A fit follows the viewport: the sheet is re-scaled and the reader stays on
  // the page they were on.
  const observer = new ResizeObserver(() => {
    if (destroyed) return;
    const keep = { pageIndex, pageY };
    applyGeometry();
    placePage(keep.pageIndex, keep.pageY);
  });
  observer.observe(scroller);

  // --- the quote ------------------------------------------------------------------
  // The overlay carries two sublayers: the marks' and the quote's. Each clears
  // only its own, or a cited quote would wipe the page's marks off the sheet.
  function quoteLayer(card: PageCard): HTMLElement | null {
    const overlay = card.overlay;
    if (!overlay) return null;
    const existing = overlay.querySelector<HTMLElement>(".rp-quote");
    if (existing) return existing;
    const el = owner.createElement("div");
    el.className = "rp-quote";
    el.style.cssText = "position:absolute;inset:0;pointer-events:none";
    overlay.append(el);
    return el;
  }

  function clearQuote(): void {
    if (!quote) return;
    const card = slots[quote.pageIndex]?.card;
    quote = null;
    if (card) quoteLayer(card)?.replaceChildren();
    callbacks.onQuoteHighlightChange(false);
  }

  async function cardReady(i: number): Promise<PageCard | null> {
    const card = mountSlot(i);
    await slots[i].shown;
    return destroyed ? null : card;
  }

  async function paintQuote(i: number, searchText: string): Promise<boolean> {
    const block = pagination.blocks[i];
    const doc = book.docs[block.spine];
    if (!doc) return false;
    const span = findQuoteAt(doc.text.text, searchText, block.charOffset);
    if (!span) return false;
    const target = blockIndexAt(pagination, block.spine, span.start);
    if (target !== i) placePage(target);
    const card = await cardReady(target);
    if (!card?.mounted || !card.overlay) return false;
    const text = extractDocumentText(card.mounted.root);
    const start = runAt(text.runs, span.start);
    const end = runAt(text.runs, span.end);
    if (!start || !end) return false;
    const range = owner.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    let rects = card.rectsOf(range);
    const onSheet = (r: DOMRect) => r.right >= 0 && r.left <= PAGE_WIDTH && r.bottom >= 0 && r.top <= PAGE_HEIGHT;
    // The table put the quote on this page; this device's layout may have put
    // it a column over. The sheet follows the words.
    if (rects.length > 0 && !rects.some(onSheet) && card.showColumnOf(range)) rects = card.rectsOf(range);
    if (rects.length === 0) return false;
    const layer = quoteLayer(card);
    if (!layer) return false;
    layer.replaceChildren();
    for (const r of rects) {
      if (!onSheet(r)) continue;
      const d = owner.createElement("div");
      d.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;background:${QUOTE_COLOR};opacity:${QUOTE_OPACITY};border-radius:2px;`;
      layer.append(d);
    }
    quote = { pageIndex: target };
    callbacks.onQuoteHighlightChange(true);
    return true;
  }

  // --- links --------------------------------------------------------------------------
  function cardAt(clientX: number, clientY: number): PageCard | null {
    const hit = owner.elementFromPoint(clientX, clientY);
    if (!hit) return null;
    for (const slot of slots) {
      if (slot.card && (slot.card.el === hit || slot.card.el.contains(hit))) return slot.card;
    }
    return null;
  }

  function pageOfHref(fromEntry: string, href: string): number | null {
    const entry = resolveZipPath(fromEntry, href);
    const fragment = hrefFragment(href);
    const doc = book.docs.find((d) => d.entry === entry) ?? (href.startsWith("#") ? book.docs.find((d) => d.entry === fromEntry) : undefined);
    if (!doc) return null;
    let offset = 0;
    if (fragment) {
      const el = doc.text.ids.get(fragment);
      if (el) offset = doc.text.offsets.get(el) ?? 0;
    }
    return blockIndexAt(pagination, doc.index, offset);
  }

  // --- first paint --------------------------------------------------------------------
  applyGeometry();
  const target = restoreTarget(pagination, viewState);
  placePage(target.pageIndex, target.pageY);

  const controller: EpubReaderController = {
    zoomIn: () => {
      const keep = { pageIndex, pageY };
      zoom = { kind: "scale", scale: zoomStepUp(scale) };
      applyGeometry();
      placePage(keep.pageIndex, keep.pageY);
    },
    zoomOut: () => {
      const keep = { pageIndex, pageY };
      zoom = { kind: "scale", scale: zoomStepDown(scale) };
      applyGeometry();
      placePage(keep.pageIndex, keep.pageY);
    },
    zoomReset: () => {
      const keep = { pageIndex, pageY };
      zoom = { kind: "lock", lock: LAYOUT_SETTINGS[layout].zoom };
      applyGeometry();
      placePage(keep.pageIndex, keep.pageY);
    },

    setLayout: (mode) => {
      if (mode === layout) return;
      const keep = pageIndex;
      layout = mode;
      zoom = { kind: "lock", lock: LAYOUT_SETTINGS[layout].zoom };
      applyGeometry();
      placePage(keep, 0);
    },

    navigate: (target) => {
      clearQuote();
      if (target.annotationID) {
        const page = marks.pageOf(target.annotationID);
        if (page === null) return;
        placePage(page, 0);
        const id = target.annotationID;
        // The sheet has to be mounted and its pictures settled before the mark
        // has rects to be brought onto it.
        void cardReady(page).then((card) => {
          if (card) marks.reveal(page, id);
        });
        return;
      }
      if (typeof target.pageIndex === "number") placePage(target.pageIndex, 0);
    },

    highlightQuote: async (page, req) => {
      clearQuote();
      placePage(page, 0);
      return paintQuote(Math.min(Math.max(0, page), pagesCount - 1), req.searchText);
    },

    clearQuoteHighlight: clearQuote,

    // The marks are the layer's (mark-layer.ts); the desk only says which sheet
    // is which page and hands the pointers on.
    setTool: (tool?: Tool) => marks.setTool(tool),
    setFingerDraw: (on: boolean) => marks.setFingerDraw(on),
    setAnnotations: (anns: Annotation[]) => marks.setAnnotations(anns),
    unsetAnnotations: (ids: string[]) => marks.unsetAnnotations(ids),
    selectAnnotations: (ids: string[]) => marks.selectAnnotations(ids),

    markPointerDown: (e) => marks.pointerDown(e),
    markPointerMove: (e) => marks.pointerMove(e),
    markPointerUp: (e) => marks.pointerUp(e),
    markPointerCancel: () => marks.pointerCancel(),
    markTapAt: (x, y) => marks.tapAt(x, y),
    isDrawing: () => marks.isDrawing(),

    followLinkAt: (clientX, clientY) => {
      const card = cardAt(clientX, clientY);
      if (!card || card.spine === null) return false;
      const inner = card.shadow.elementFromPoint(clientX, clientY);
      const anchor = inner?.closest?.("a[href]");
      if (!anchor) return false;
      const link = bookLinkTarget(anchor.getAttribute("href"));
      if (!link) return false;
      if (link.kind === "external") {
        openExternal(link.url);
        return true;
      }
      const page = pageOfHref(book.docs[card.spine].entry, link.href);
      if (page === null) return false;
      clearQuote();
      placePage(page, 0);
      return true;
    },

    turn: (direction) => {
      clearQuote();
      if (layout === "paged") {
        placePage(pageIndex + (direction === "next" ? 1 : -1), 0);
        return;
      }
      const step = scroller.clientHeight * 0.9;
      scroller.scrollTop += direction === "next" ? step : -step;
    },
    currentLayout: () => layout,
    cardAt,
    destroy: () => {
      destroyed = true;
      marks.pointerCancel();
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      if (scrollTimer !== null) clearTimeout(scrollTimer);
      for (let i = 0; i < slots.length; i++) unmountSlot(i);
      resources.revoke();
      scroller.remove();
      releaseEpub(bookId);
    },
  };

  emit();
  return controller;
}
