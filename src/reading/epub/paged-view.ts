// The phone's paged reading area (docs/79): the same FlowReaderView as the
// scrolled column (flow-view.ts), with the book turned a screen at a time.
//
// One spine document is one shadow host, mounted the way the column mounts it
// (flow-mount.ts) and laid out as CSS columns one screen wide
// (paged-logic.ts), so screen page k of a document is its column k. The
// document being read and its two neighbours sit side by side on a strip
// inside a clipped scroller, and the iPad's touch router
// (reading/engine/gesture) drags that scroller exactly as it drags the
// iPad's paged sheets: the finger is followed, a release past the threshold
// turns, the ends of the book rubber-band. A neighbour is laid out off screen
// when nothing is happening, so a turn across a chapter never waits.
//
// A screen page is this device's at this type and is never stored. What is
// written down is a CFI and the pagination table's page (docs/64), the same
// ViewState the column and the iPad write, reached from the screen by
// measuring. The CFI is the anchor: the first character of the page the reader
// turned to, or the place they were sent to. It is taken again only when they
// turn or go somewhere, never when the type changes, so any number of Aa
// changes land on the page holding the same character.

import { openExternal } from "../../platform/app/external-link";
import { attachTouchRouter } from "../engine/gesture/attach-touch";
import type { PagedGestureCtx } from "../engine/gesture/context";
import { acquireEpub, ensurePagination, releaseEpub } from "./book-cache";
import { caretAtPoint } from "./caret";
import { epubCfi, parseCfiStart, pointSteps, resolvePointRange } from "./cfi";
import type { FlowReaderView, FlowTool } from "./flow-contract";
import { FLOW_PAPERS, flowPaperSwatch, type FlowDisplay } from "./flow-display";
import { IDLE, LONG_PRESS_MS, pressStep, type PressEvent, type PressState } from "./flow-gesture";
import { createFlowMarks, flowRangeSource, rectsIn, type FlowDoc, type PressPoint } from "./flow-marks";
import { flowBaselineCss, mountFlowDocument } from "./flow-mount";
import type { FlowReaderOptions } from "./flow-view";
import { createMarkPainter, rangeOfSpan } from "./mark-draw";
import { createSpineTexts } from "./mark-write";
import { createPageResources, readingFontsReady } from "./page-mount";
import {
  columnAt,
  columnCount,
  inBackEdge,
  isInkAt,
  layoutWindow,
  locateInWindow,
  neighbourSpines,
  pageProbePoints,
  pagedColumnCss,
  windowPageOf,
  type PagedWindow,
} from "./paged-logic";
import type { Pagination } from "./paginate";
import type { EpubBook } from "./parse";
import {
  bookLinkTarget,
  claimsTouch,
  labelForBlock,
  locateQuote,
  pageIndexOfCfi,
  spineStartsOf,
  tapZone,
} from "./reader-logic";
import { topEdgeSteps } from "./top-edge";
import { hrefFragment, resolveZipPath } from "./zip";

export interface PagedReaderOptions extends FlowReaderOptions {
  /**
   * The width of the left band the shell's back gesture starts in. A touch
   * that starts there is the shell's; everywhere else a swipe to the right is
   * the previous page.
   */
  backEdgePx: number;
}

// How long after a landing the neighbours are laid out, so the turn that got
// the reader here has painted first.
const PRELOAD_DELAY_MS = 120;

interface Leaf extends FlowDoc {
  ready: Promise<void>;
  /** The flow baseline (flow-mount.ts). */
  base: HTMLStyleElement;
  /** The column rules on top of it (paged-logic.ts). */
  cols: HTMLStyleElement;
  paper: HTMLElement;
  pages: number;
}

export async function createPagedReader(opts: PagedReaderOptions): Promise<FlowReaderView> {
  const { host, bookId, buffer, viewState, callbacks } = opts;
  const owner = host.ownerDocument;

  const book: EpubBook = acquireEpub(bookId, buffer);
  const pagination: Pagination = await ensurePagination(bookId, book, host);
  const pagesCount = pagination.blocks.length;
  await readingFontsReady();
  const resources = createPageResources(book.zip);
  const spineStarts = spineStartsOf(pagination);
  const firstPageOfSpine = (spine: number) => spineStarts.get(spine) ?? 0;

  let display: FlowDisplay = opts.display;
  let tool: FlowTool = opts.tool;
  let destroyed = false;

  // --- the frame ------------------------------------------------------------
  // frame: taps, marks and the back band are read here, outside the router's
  // element, so the pointerup the router hands on when it takes a drag over
  // (attach-touch.ts) never reads as a tap. scroller: what the router drags.
  // strip: its first child, which the rubber band moves.
  const frame = owner.createElement("div");
  frame.className = "rp-paged";
  frame.setAttribute("data-reader-surface", "");
  frame.style.cssText = [
    "position:relative",
    "width:100%",
    "height:100%",
    "overflow:hidden",
    // The book's text is never the system's to select (docs/pitfall/49, 262).
    "user-select:none",
    "-webkit-user-select:none",
    "-webkit-touch-callout:none",
  ].join(";");
  const scroller = owner.createElement("div");
  scroller.style.cssText = "position:absolute;inset:0;overflow:hidden";
  const strip = owner.createElement("div");
  strip.style.cssText = "position:relative;height:100%;isolation:isolate";
  // The paper's wash over every column at once: inside the multi-column box
  // it would cover the first column only.
  const wash = owner.createElement("div");
  wash.setAttribute("aria-hidden", "true");
  wash.style.cssText =
    "position:absolute;top:0;left:0;height:100%;z-index:1;pointer-events:none;mix-blend-mode:multiply";
  strip.append(wash);
  scroller.append(strip);
  frame.append(scroller);
  host.replaceChildren(frame);

  let W = scroller.clientWidth || host.clientWidth || 393;
  let H = scroller.clientHeight || host.clientHeight || 700;

  function paintPaper(): void {
    const paper = FLOW_PAPERS[display.paper];
    // The frame shows where the rubber band pulls the strip away.
    frame.style.background = flowPaperSwatch(paper);
    strip.style.background = paper.surface;
    wash.style.display = paper.wash ? "block" : "none";
    wash.style.background = paper.wash ?? "transparent";
  }
  paintPaper();

  // --- the documents ----------------------------------------------------------
  const leaves = new Map<number, Leaf>();
  let win: PagedWindow = { slots: [], total: 0 };
  // The document being read and its column in it.
  let cur = 0;
  let column = 0;
  // The CFI a relayout lands on (see the head of the file).
  let anchor: string | null = null;
  let pageIndex = 0;
  // Fingers on the glass: nothing moves the strip under a drag.
  let touching = 0;
  let deferred = false;
  let preloadTimer: number | null = null;

  const spineOf = createSpineTexts(book);

  function mountLeaf(spine: number): Leaf | null {
    const had = leaves.get(spine);
    if (had) return had;
    const doc = book.docs[spine];
    if (!doc) return null;
    const el = owner.createElement("div");
    el.className = "rp-paged-doc";
    el.dataset.spine = String(spine);
    el.style.cssText = `position:absolute;top:0;left:0;width:${W}px;height:${H}px`;
    const shadow = el.attachShadow({ mode: "open" });
    const mounted = mountFlowDocument(shadow, doc, resources, display);
    const cols = owner.createElement("style");
    cols.textContent = pagedColumnCss(W, H, display);
    shadow.append(cols);
    strip.insertBefore(el, wash);
    const paper = shadow.querySelector<HTMLElement>(".rp-paper") as HTMLElement;
    const leaf: Leaf = {
      spine,
      idref: doc.idref,
      entry: doc.entry,
      host: el,
      shadow,
      root: mounted.root,
      overlay: mounted.overlay,
      ready: mounted.ready,
      base: mounted.base,
      cols,
      paper,
      pages: columnCount(paper.scrollWidth, W),
    };
    leaves.set(spine, leaf);
    marks.invalidate(spine);
    // A picture that arrives changes how many columns the words need.
    void mounted.ready.then(() => {
      if (!destroyed && leaves.get(spine) === leaf) reflow();
    });
    return leaf;
  }

  function relayoutWindow(): void {
    win = layoutWindow([...leaves.values()].map((l) => ({ spine: l.spine, pages: l.pages })));
    for (const s of win.slots) {
      const leaf = leaves.get(s.spine);
      if (leaf) leaf.host.style.left = `${s.first * W}px`;
    }
    const width = `${Math.max(1, win.total) * W}px`;
    strip.style.width = width;
    wash.style.width = width;
  }

  function place(): void {
    scroller.scrollLeft = (windowPageOf(win, cur, column) ?? 0) * W;
  }

  // Make `spine` the document being read: it and its neighbours stay, the
  // rest go, and the missing neighbours are laid out shortly.
  function focus(spine: number): Leaf | null {
    const leaf = mountLeaf(spine);
    if (!leaf) return null;
    cur = spine;
    const keep = new Set(neighbourSpines(cur, book.docs.length));
    for (const [s, l] of leaves) {
      if (keep.has(s)) continue;
      l.host.remove();
      leaves.delete(s);
    }
    relayoutWindow();
    schedulePreload();
    return leaf;
  }

  function schedulePreload(): void {
    if (preloadTimer !== null) return;
    preloadTimer = setTimeout(() => {
      preloadTimer = null;
      if (destroyed) return;
      if (touching > 0) {
        schedulePreload();
        return;
      }
      let added = false;
      for (const s of neighbourSpines(cur, book.docs.length)) {
        if (!leaves.has(s) && mountLeaf(s)) added = true;
      }
      if (!added) return;
      relayoutWindow();
      place();
      paintShown();
    }, PRELOAD_DELAY_MS) as unknown as number;
  }

  // --- measuring --------------------------------------------------------------
  // The first box of a range, widened to one character when it is a caret: a
  // collapsed range has no box of its own in WebKit.
  function firstBox(range: Range): DOMRect | null {
    let r = range;
    const node = r.startContainer;
    if (r.collapsed) {
      if (node.nodeType === Node.TEXT_NODE && r.startOffset < (node as Text).length) {
        r = r.cloneRange();
        r.setEnd(node, r.startOffset + 1);
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        const child = node.childNodes[r.startOffset];
        if (child instanceof Element) return child.getBoundingClientRect();
      }
    }
    const rects = Array.from(r.getClientRects()).filter((b) => b.width > 0 || b.height > 0);
    if (rects[0]) return rects[0];
    const b = r.getBoundingClientRect();
    if (b.width > 0 || b.height > 0) return b;
    const el = node instanceof Element ? node : node.parentElement;
    return el ? el.getBoundingClientRect() : null;
  }

  function columnOfRange(leaf: Leaf, range: Range): number {
    const box = firstBox(range);
    if (!box) return 0;
    return columnAt(box.left, leaf.host.getBoundingClientRect().left, W, leaf.pages);
  }

  // The first ink on the page shown (probe points in paged-logic.ts), as a CFI;
  // failing any, the first picture or box of the book the probes landed on.
  function anchorOfShown(): string | null {
    const leaf = leaves.get(cur);
    if (!leaf) return null;
    const box = scroller.getBoundingClientRect();
    const local = topEdgeSteps(
      leaf.root,
      pageProbePoints({ left: box.left, top: box.top, height: box.height }, display.padX),
      {
        hit: (x, y) => leaf.shadow.elementFromPoint(x, y),
        caret: (x, y) => {
          const c = caretAtPoint(leaf.shadow, leaf.root, x, y);
          return c && isInkAt(c.node.data, c.offset) ? c : null;
        },
      },
    );
    return local === null ? (pagination.blocks[firstPageOfSpine(cur)]?.cfi ?? null) : epubCfi(leaf.spine, leaf.idref, local);
  }

  // --- the marks ------------------------------------------------------------------
  // The column's marks module as is: a mark is drawn over the rects of its
  // range in the document's overlay, and the overlay spans every column
  // because the host does not clip. Marks across two pages are docs/79's
  // second slice.
  function docAt(clientX: number, clientY: number): FlowDoc | null {
    const hit = owner.elementFromPoint(clientX, clientY);
    if (!hit) return null;
    for (const leaf of leaves.values()) {
      if (leaf.host === hit || leaf.host.contains(hit)) return leaf;
    }
    return null;
  }

  const marks = createFlowMarks({
    owner,
    authorName: opts.authorName,
    docAt,
    docOf: (spine) => leaves.get(spine) ?? null,
    isShown: (doc) => leaves.get(doc.spine) === doc,
    pagination,
    spineOf,
    onSave: (anns) => callbacks.onSaveAnnotations(anns),
    onSelect: (ids) => callbacks.onSelectAnnotations(ids),
    onPopup: (params) => callbacks.onAnnotationPopup(params),
  });
  marks.reset(opts.annotations);
  marks.setTool(tool);

  function paintShown(): void {
    for (const leaf of leaves.values()) {
      if (marks.needsPaint(leaf.spine)) marks.paint(leaf);
    }
  }

  // --- position ---------------------------------------------------------------
  function emit(): void {
    if (destroyed) return;
    const start = firstPageOfSpine(cur);
    pageIndex = (anchor ? pageIndexOfCfi(pagination, anchor) : null) ?? start;
    callbacks.onChangeViewStats({
      pageIndex,
      pageLabel: labelForBlock(pagination, pageIndex) ?? String(pageIndex + 1),
      printedLabel: labelForBlock(pagination, pageIndex),
      pagesCount,
      canZoomIn: false,
      canZoomOut: false,
      canZoomReset: false,
      layout: "vertical",
    });
    // The layout written is the column's, not "paged": whether this phone
    // turns pages is its own preference, and the iPad reads the same state.
    callbacks.onChangeViewState({
      pageIndex,
      scale: "auto",
      scrollMode: 0,
      layout: "vertical",
      ...(anchor ? { cfi: anchor } : {}),
    });
  }

  // Everything laid out again at the current size and type: the reader stays
  // on the page holding the anchor.
  function reflow(): void {
    if (destroyed) return;
    if (touching > 0) {
      deferred = true;
      return;
    }
    deferred = false;
    for (const leaf of leaves.values()) {
      leaf.pages = columnCount(leaf.paper.scrollWidth, W);
      marks.invalidate(leaf.spine);
    }
    relayoutWindow();
    const at = anchor ? parseCfiStart(anchor) : null;
    const leaf = leaves.get(cur);
    const range = leaf && anchor && at?.spineIndex === cur ? resolvePointRange(leaf.root, anchor) : null;
    column = leaf && range ? columnOfRange(leaf, range) : Math.min(column, (leaf?.pages ?? 1) - 1);
    place();
    paintShown();
    paintQuote();
    emit();
  }

  // Land on the page holding a CFI; it becomes the anchor.
  function landCfi(target: string): boolean {
    const parsed = parseCfiStart(target);
    if (!parsed || !book.docs[parsed.spineIndex]) return false;
    const leaf = focus(parsed.spineIndex);
    if (!leaf) return false;
    const range = resolvePointRange(leaf.root, target);
    column = range ? columnOfRange(leaf, range) : 0;
    anchor = target;
    place();
    paintShown();
    emit();
    return true;
  }

  function goToPage(i: number): void {
    const block = pagination.blocks[Math.min(Math.max(0, i), pagesCount - 1)];
    if (block) landCfi(block.cfi);
  }

  // A window page the reader turned to. Springing back to the page already
  // shown is not a turn and keeps the anchor.
  function showWindowPage(p: number): void {
    const at = locateInWindow(win, p);
    if (!at) return;
    if (at.spine === cur && at.column === column) {
      place();
      return;
    }
    column = at.column;
    if (at.spine !== cur) focus(at.spine);
    place();
    anchor = anchorOfShown();
    paintShown();
    emit();
  }

  function turn(dir: -1 | 1): void {
    let p = windowPageOf(win, cur, column);
    if (p === null) return;
    if (p + dir < 0 || p + dir >= win.total) {
      // The neighbour has not been laid out yet: now, rather than a dead tap.
      if (!mountLeaf(cur + dir)) return;
      relayoutWindow();
      p = windowPageOf(win, cur, column);
      if (p === null) return;
    }
    showWindowPage(p + dir);
  }

  function goToEntry(entry: string, fragment: string | null): boolean {
    const spine = book.docs.findIndex((d) => d.entry === entry);
    if (spine < 0) return false;
    const leaf = focus(spine);
    if (!leaf) return false;
    const el = fragment ? leaf.shadow.getElementById(fragment) : null;
    column = el ? columnAt(el.getBoundingClientRect().left, leaf.host.getBoundingClientRect().left, W, leaf.pages) : 0;
    place();
    const local = el ? pointSteps(el, null) : null;
    anchor = local !== null ? epubCfi(spine, leaf.idref, local) : anchorOfShown();
    paintShown();
    emit();
    return true;
  }

  function followLinkAt(clientX: number, clientY: number): boolean {
    const leaf = docAt(clientX, clientY);
    if (!leaf) return false;
    const inner = leaf.shadow.elementFromPoint(clientX, clientY);
    const a = inner?.closest?.("a[href]");
    if (!a) return false;
    const link = bookLinkTarget(a.getAttribute("href"));
    if (!link) return false;
    if (link.kind === "external") {
      openExternal(link.url);
      return true;
    }
    const entry = link.href.startsWith("#") ? leaf.entry : resolveZipPath(leaf.entry, link.href);
    return goToEntry(entry, hrefFragment(link.href));
  }

  // --- the cited quote ------------------------------------------------------------
  const painter = createMarkPainter(owner);
  let quote: { leaf: Leaf; range: Range } | null = null;

  function paintQuote(): void {
    if (!quote || leaves.get(quote.leaf.spine) !== quote.leaf) return;
    const layer = painter.sublayer(quote.leaf.overlay, "rp-quote");
    layer.replaceChildren();
    painter.drawQuote(layer, rectsIn(quote.leaf, quote.range));
  }

  function clearQuote(): void {
    if (!quote) return;
    quote.leaf.overlay.querySelector<HTMLElement>(".rp-quote")?.replaceChildren();
    quote = null;
  }

  // Turned to the page the words start on and banded there. Where the words
  // run onto the next page, and how the lesson brings the reader back, is the
  // second slice (docs/79).
  function highlightQuote(page: number, searchText: string): boolean {
    clearQuote();
    const i = Math.min(Math.max(0, page), pagesCount - 1);
    const spot = locateQuote(pagination, (spine) => book.docs[spine]?.text.text, i, searchText);
    const leaf = spot ? focus(spot.spine) : null;
    const text = leaf ? spineOf(leaf.spine) : null;
    const range = spot && leaf && text ? rangeOfSpan(flowRangeSource(leaf, spineOf), text, spot) : null;
    if (!leaf || !range || range.collapsed) {
      goToPage(i);
      return false;
    }
    column = columnOfRange(leaf, range);
    place();
    anchor = anchorOfShown();
    quote = { leaf, range };
    paintQuote();
    paintShown();
    emit();
    return true;
  }

  // --- the finger -------------------------------------------------------------------
  // Two readers of one finger. The touch router, on the scroller, follows a
  // horizontal drag and turns (the iPad's paged gesture). The column's press
  // reducer (flow-gesture.ts), on the frame, reads what is not a drag: a tap,
  // which opens a mark, follows a link, or turns by the side it landed on
  // (tapZone, the iPad's), and a long press, which starts a mark.
  const gestures: PagedGestureCtx = {
    paged: true,
    tool: "pointer",
    zoomedIn: false,
    fingerDraw: false,
    scroll: {
      getCurrentPage: () => (windowPageOf(win, cur, column) ?? 0) + 1,
      getTotalPages: () => Math.max(1, win.total),
    },
    interaction: null,
    selection: null,
    setTouchLock: null,
    viewport: null,
    indicator: null,
    resetGestures: null,
    turnToPage: null,
  };
  function syncGestureTool(): void {
    // With the pen in hand the finger marks, and a turn starts from the
    // screen's edge, as on the iPad.
    gestures.tool = tool.type === "highlight" ? "highlight" : "pointer";
    gestures.fingerDraw = tool.type === "highlight";
  }
  syncGestureTool();
  gestures.turnToPage = (n: number) => showWindowPage(n - 1);

  const countDown = () => {
    touching++;
  };
  const countUp = () => {
    touching = Math.max(0, touching - 1);
    if (touching === 0 && deferred) setTimeout(reflow, 0);
  };
  scroller.addEventListener("pointerdown", countDown, { capture: true });
  scroller.addEventListener("pointerup", countUp, { capture: true });
  scroller.addEventListener("pointercancel", countUp, { capture: true });
  const detachTouch = attachTouchRouter(scroller as HTMLDivElement, {
    documentId: bookId,
    ctx: { current: gestures },
  });

  // The back band: a touch that starts in it is the shell's (its listeners
  // run in the capture phase above this frame) and reaches neither the router
  // nor the press reducer.
  const shellOwns = new Set<number>();
  const guardDown = (e: PointerEvent) => {
    if (e.pointerType !== "touch") return;
    if (!inBackEdge(e.clientX, frame.getBoundingClientRect().left, opts.backEdgePx)) return;
    shellOwns.add(e.pointerId);
    e.stopPropagation();
  };
  const guardRest = (e: PointerEvent) => {
    if (!shellOwns.has(e.pointerId)) return;
    if (e.type === "pointerup" || e.type === "pointercancel") shellOwns.delete(e.pointerId);
    e.stopPropagation();
  };
  frame.addEventListener("pointerdown", guardDown, { capture: true });
  frame.addEventListener("pointermove", guardRest, { capture: true });
  frame.addEventListener("pointerup", guardRest, { capture: true });
  frame.addEventListener("pointercancel", guardRest, { capture: true });

  let press: PressState = IDLE;
  let pressedAt: PressPoint | null = null;
  let holdTimer: number | null = null;

  function feed(event: PressEvent, at?: { x: number; y: number }): void {
    const next = pressStep(press, event);
    press = next.state;
    if (press.phase !== "pressed" && holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    switch (next.effect) {
      case "arm":
        holdTimer = setTimeout(() => {
          holdTimer = null;
          feed({ kind: "hold", pointerId: event.pointerId, t: performance.now() });
        }, LONG_PRESS_MS) as unknown as number;
        break;
      case "start-mark":
        if (!pressedAt) break;
        marks.beginDrag(pressedAt);
        try {
          frame.setPointerCapture(event.pointerId);
        } catch {
          // The pointer may already be gone; the stroke still ends on its up.
        }
        break;
      case "extend-mark":
        if (at) marks.extendDrag(at.x, at.y);
        break;
      case "commit-mark":
        if (!marks.commitDrag() && at) marks.tapAt(at.x, at.y);
        break;
      case "abandon-mark":
        marks.cancelDrag();
        break;
      case "tap": {
        clearQuote();
        if (!at || marks.tapAt(at.x, at.y) || followLinkAt(at.x, at.y)) break;
        const box = frame.getBoundingClientRect();
        const zone = tapZone("paged", at.x - box.left, box.width);
        if (zone === "next") turn(1);
        else if (zone === "prev") turn(-1);
        break;
      }
      case "none":
        break;
    }
    if (press.phase === "idle") pressedAt = null;
  }

  const onPointerDown = (e: PointerEvent) => {
    pressedAt = marks.caretAt(e.clientX, e.clientY);
    feed(
      {
        kind: "down",
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        onWords: pressedAt !== null,
        tool: tool.type,
        primary: e.isPrimary,
      },
      { x: e.clientX, y: e.clientY },
    );
  };
  const onPointerMove = (e: PointerEvent) => {
    if (press.phase === "idle") return;
    feed(
      { kind: "move", pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() },
      { x: e.clientX, y: e.clientY },
    );
  };
  const onPointerUp = (e: PointerEvent) => {
    if (press.phase === "idle") return;
    feed(
      { kind: "up", pointerId: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() },
      { x: e.clientX, y: e.clientY },
    );
  };
  const onPointerCancel = (e: PointerEvent) => {
    if (press.phase === "idle") return;
    feed({ kind: "cancel", pointerId: e.pointerId });
  };
  // Every move is the reader's in a paged book, as on the iPad
  // (docs/pitfall/117): nothing under it scrolls natively.
  const onTouchMove = (e: TouchEvent) => {
    if (claimsTouch("paged", false)) e.preventDefault();
  };
  frame.addEventListener("pointerdown", onPointerDown);
  frame.addEventListener("pointermove", onPointerMove);
  frame.addEventListener("pointerup", onPointerUp);
  frame.addEventListener("pointercancel", onPointerCancel);
  frame.addEventListener("touchmove", onTouchMove, { passive: false });

  // --- size ---------------------------------------------------------------------------
  function applyDisplay(): void {
    const base = flowBaselineCss(display);
    const cols = pagedColumnCss(W, H, display);
    for (const leaf of leaves.values()) {
      leaf.host.style.width = `${W}px`;
      leaf.host.style.height = `${H}px`;
      leaf.base.textContent = base;
      leaf.cols.textContent = cols;
    }
  }

  const observer = new ResizeObserver(() => {
    if (destroyed) return;
    const w = scroller.clientWidth;
    const h = scroller.clientHeight;
    if (w === 0 || h === 0 || (w === W && h === H)) return;
    W = w;
    H = h;
    applyDisplay();
    reflow();
  });
  observer.observe(scroller);

  // --- first paint --------------------------------------------------------------------
  const saved = viewState?.cfi ?? null;
  if (!(saved && landCfi(saved))) {
    if (typeof viewState?.pageIndex === "number" && viewState.pageIndex > 0) goToPage(viewState.pageIndex);
    else {
      focus(0);
      column = 0;
      place();
      anchor = anchorOfShown();
      paintShown();
      emit();
    }
  }

  return {
    goToCfi: (target) => {
      clearQuote();
      landCfi(target);
    },
    goToHref: (href) => {
      clearQuote();
      const hash = href.indexOf("#");
      goToEntry(hash >= 0 ? href.slice(0, hash) : href, hrefFragment(href));
    },
    goToPage: (i) => {
      clearQuote();
      goToPage(i);
    },
    highlightQuote: async (page, req) => highlightQuote(page, req.searchText),
    clearQuoteHighlight: clearQuote,
    removeAnnotations: (ids) => marks.unsetAnnotations(ids),
    setDisplay: (next) => {
      if (destroyed) return;
      display = next;
      paintPaper();
      applyDisplay();
      reflow();
    },
    setTool: (next) => {
      tool = next;
      marks.setTool(next);
      syncGestureTool();
      if (next.type === "none" && press.phase === "marking") {
        feed({ kind: "cancel", pointerId: press.pointerId });
      }
    },
    destroy: () => {
      destroyed = true;
      marks.cancelDrag();
      if (holdTimer !== null) clearTimeout(holdTimer);
      if (preloadTimer !== null) clearTimeout(preloadTimer);
      observer.disconnect();
      detachTouch();
      scroller.removeEventListener("pointerdown", countDown, { capture: true });
      scroller.removeEventListener("pointerup", countUp, { capture: true });
      scroller.removeEventListener("pointercancel", countUp, { capture: true });
      frame.removeEventListener("pointerdown", guardDown, { capture: true });
      frame.removeEventListener("pointermove", guardRest, { capture: true });
      frame.removeEventListener("pointerup", guardRest, { capture: true });
      frame.removeEventListener("pointercancel", guardRest, { capture: true });
      frame.removeEventListener("pointerdown", onPointerDown);
      frame.removeEventListener("pointermove", onPointerMove);
      frame.removeEventListener("pointerup", onPointerUp);
      frame.removeEventListener("pointercancel", onPointerCancel);
      frame.removeEventListener("touchmove", onTouchMove);
      resources.revoke();
      frame.remove();
      releaseEpub(bookId);
    },
  };
}
