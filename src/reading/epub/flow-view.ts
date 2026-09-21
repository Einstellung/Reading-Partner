// The column: the imperative half of the phone's reflow reading area, and the
// place the shell's FlowReaderView is implemented (flow-contract.ts, docs/70).
// One native scroll container, every spine document in it in order, each in
// its own shadow host (flow-mount.ts). Nothing here scrolls the page on the
// reader's behalf: the browser does, and the column only reads where it ended
// up and writes that down.
//
// The coordinates are the sheet's (docs/64): the pagination table cut off
// screen at the fixed geometry says which page a CFI is on, so the number in
// the top bar is the number the iPad shows for the same words, and a position
// saved here is restored there by its CFI, and the other way round.
//
// It is not a component because none of it is rendering. The pane owns one
// element; everything that happens to the book happens here.

import type {
  Annotation,
  AnnotationPopupParams,
  ViewState,
  ViewStats,
} from "../../platform/app/reader-contract";
import { openExternal } from "../../platform/app/external-link";
import { acquireEpub, ensurePagination, releaseEpub } from "./book-cache";
import { caretAtPoint } from "./caret";
import { epubCfi, parseCfiStart, resolvePoint, textSteps } from "./cfi";
import type { FlowReaderView, FlowTool } from "./flow-contract";
import {
  IDLE,
  LONG_PRESS_MS,
  claimsTouch,
  intrinsicHeightEstimate,
  pressStep,
  type PressEvent,
  type PressState,
} from "./flow-gesture";
import { FLOW_PAPERS, type FlowDisplay } from "./flow-display";
import { createFlowMarks, type FlowDoc, type PressPoint } from "./flow-marks";
import { flowBaselineCss, mountFlowDocument } from "./flow-mount";
import type { SpineText } from "./mark-draw";
import { createPageResources, readingFontsReady } from "./page-mount";
import type { Pagination } from "./paginate";
import type { EpubBook } from "./parse";
import { blockIndexAt, bookLinkTarget, labelForBlock, pageIndexOfCfi } from "./reader-logic";
import { indexRuns } from "./text";
import { hrefFragment, resolveZipPath } from "./zip";

export interface FlowReaderCallbacks {
  onChangeViewState(state: ViewState): void;
  onChangeViewStats(stats: ViewStats): void;
  /** Every mark of the book, after one was drawn here. */
  onSaveAnnotations(annotations: Annotation[]): void;
  onSelectAnnotations(ids: string[]): void;
  onAnnotationPopup(params?: AnnotationPopupParams): void;
}

export interface FlowReaderOptions {
  host: HTMLElement;
  bookId: string;
  buffer: ArrayBuffer;
  viewState: ViewState | null;
  annotations: Annotation[];
  authorName: string;
  tool: FlowTool;
  display: FlowDisplay;
  callbacks: FlowReaderCallbacks;
}

// How long after the last scroll event the position is read and written.
const SCROLL_SETTLE_MS = 120;

// How far below the viewport's top edge the first visible character is looked
// for, and in what steps: past the leading of one line, then the next.
const TOP_PROBE_PX = 57;
const TOP_PROBE_STEP = 8;

// Passes over a restored position: the first lands on the estimated height of
// every document above, the next ones on the real one once those documents have
// been laid out.
const SETTLE_FRAMES = 3;

interface Column extends FlowDoc {
  ready: Promise<void>;
  /** The one <style> the baseline is written into (flow-mount.ts). */
  base: HTMLStyleElement;
  /** How many characters the document holds, for the off-screen height guess. */
  chars: number;
}

/**
 * Open a book into `host` and hand back the handle the shell drives. Resolves
 * once the column is mounted and the saved position restored; a failure to
 * get that far rejects.
 */
export async function createFlowReader(opts: FlowReaderOptions): Promise<FlowReaderView> {
  const { host, bookId, buffer, viewState, callbacks } = opts;
  const owner = host.ownerDocument;

  const book: EpubBook = acquireEpub(bookId, buffer);
  const pagination: Pagination = await ensurePagination(bookId, book, host);
  const pagesCount = pagination.blocks.length;
  await readingFontsReady();
  const resources = createPageResources(book.zip);

  // --- the column -----------------------------------------------------------
  const scroller = owner.createElement("div");
  scroller.className = "rp-flow";
  scroller.setAttribute("data-reader-surface", "");
  scroller.style.cssText = [
    "position:relative",
    "width:100%",
    "height:100%",
    "overflow-x:hidden",
    "overflow-y:auto",
    `background:${FLOW_PAPERS[opts.display.paper].surface}`,
    "overscroll-behavior:contain",
    // The scroll is the browser's, and only the vertical one.
    "touch-action:pan-y",
    "-webkit-overflow-scrolling:touch",
    // The book's text is never the system's to select (docs/pitfall/49, 262).
    "user-select:none",
    "-webkit-user-select:none",
    "-webkit-touch-callout:none",
  ].join(";");
  host.replaceChildren(scroller);
  const columnWidth = scroller.clientWidth || host.clientWidth || 393;

  const docs: Column[] = book.docs.map((doc) => {
    const el = owner.createElement("div");
    el.className = "rp-flow-doc";
    el.dataset.spine = String(doc.index);
    // Off screen, a document is not laid out at all; its height is a guess
    // until it has been, and the browser keeps the real one after that.
    el.style.cssText = [
      "position:relative",
      "content-visibility:auto",
      `contain-intrinsic-size:auto ${intrinsicHeightEstimate(doc.text.text.length, columnWidth, opts.display)}px`,
    ].join(";");
    const shadow = el.attachShadow({ mode: "open" });
    const mounted = mountFlowDocument(shadow, doc, resources, opts.display);
    scroller.append(el);
    return {
      spine: doc.index,
      idref: doc.idref,
      entry: doc.entry,
      host: el,
      shadow,
      root: mounted.root,
      overlay: mounted.overlay,
      ready: mounted.ready,
      base: mounted.base,
      chars: doc.text.text.length,
    };
  });

  const spineStarts = new Map<number, number>();
  for (let i = 0; i < pagination.blocks.length; i++) {
    const s = pagination.blocks[i].spine;
    if (!spineStarts.has(s)) spineStarts.set(s, i);
  }
  const firstPageOfSpine = (spine: number) => spineStarts.get(spine) ?? 0;

  // --- state ----------------------------------------------------------------
  let destroyed = false;
  let pageIndex = 0;
  let cfi: string | null = null;
  let tool: FlowTool = opts.tool;
  let display: FlowDisplay = opts.display;
  let scrollTimer: number | null = null;
  // Where the column was sent, while it is still there: a page whose first
  // character sits mid-line is reported as that page, not as the page the
  // line began on.
  let pinned: { cfi: string; pageIndex: number; scrollTop: number } | null = null;

  // --- the marks ------------------------------------------------------------
  // One index of a spine item's text per book. It is the ingestion tree's,
  // never the column's clone's (docs/pitfall/267).
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

  function viewportBox(): DOMRect {
    return scroller.getBoundingClientRect();
  }

  function isShown(doc: FlowDoc): boolean {
    const box = viewportBox();
    const r = doc.host.getBoundingClientRect();
    return r.bottom > box.top - box.height && r.top < box.bottom + box.height;
  }

  function docAt(clientX: number, clientY: number): FlowDoc | null {
    const hit = owner.elementFromPoint(clientX, clientY);
    if (!hit) return null;
    for (const doc of docs) {
      if (doc.host === hit || doc.host.contains(hit)) return doc;
    }
    return null;
  }

  const marks = createFlowMarks({
    owner,
    authorName: opts.authorName,
    docAt,
    docOf: (spine) => docs[spine] ?? null,
    isShown,
    blockAt: (i) => {
      const block = pagination.blocks[i];
      return block ? { spine: block.spine, charOffset: block.charOffset, label: block.label ?? null } : undefined;
    },
    pageOfPoint: (spine, charOffset) => blockIndexAt(pagination, spine, charOffset),
    spineOf,
    onSave: (anns) => callbacks.onSaveAnnotations(anns),
    onSelect: (ids) => callbacks.onSelectAnnotations(ids),
    onPopup: (params) => callbacks.onAnnotationPopup(params),
  });
  marks.reset(opts.annotations);
  marks.setTool(tool);

  function paintShown(): void {
    for (const doc of docs) {
      if (marks.needsPaint(doc.spine) && isShown(doc)) marks.paint(doc);
    }
  }

  // A picture that arrives after the marks were measured moves the words under
  // them: the document is painted again.
  for (const doc of docs) {
    void doc.ready.then(() => {
      if (!destroyed) marks.invalidate(doc.spine);
    });
  }

  // --- position ---------------------------------------------------------------
  function docAtTop(): Column | null {
    const top = viewportBox().top;
    for (const doc of docs) {
      if (doc.host.getBoundingClientRect().bottom > top + 1) return doc;
    }
    return null;
  }

  // The first character under the viewport's top edge: probed just below the
  // edge, at the column's left and at its middle, stepping down a line or so
  // until a point lands on the words rather than between them.
  function firstCaretCfi(doc: Column): string | null {
    const box = viewportBox();
    const xs = [box.left + display.padX + 2, box.left + box.width / 2];
    for (let dy = 1; dy <= TOP_PROBE_PX; dy += TOP_PROBE_STEP) {
      const y = box.top + dy;
      for (const x of xs) {
        const el = doc.shadow.elementFromPoint(x, y);
        if (!el || el === doc.root || el.localName === "body" || !doc.root.contains(el)) continue;
        const caret = caretAtPoint(doc.shadow, doc.root, x, y);
        if (!caret) continue;
        const local = textSteps(caret.node, caret.offset);
        if (local === null) continue;
        return epubCfi(doc.spine, doc.idref, local);
      }
    }
    return null;
  }

  function readPosition(): void {
    if (pinned && Math.abs(scroller.scrollTop - pinned.scrollTop) <= 1) {
      cfi = pinned.cfi;
      pageIndex = pinned.pageIndex;
      return;
    }
    pinned = null;
    const doc = docAtTop();
    if (!doc) return;
    const start = firstPageOfSpine(doc.spine);
    cfi = firstCaretCfi(doc) ?? pagination.blocks[start]?.cfi ?? null;
    pageIndex = (cfi ? pageIndexOfCfi(pagination, cfi) : null) ?? start;
  }

  function emit(): void {
    if (destroyed) return;
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
    callbacks.onChangeViewState({
      pageIndex,
      scale: "auto",
      scrollMode: 0,
      layout: "vertical",
      ...(cfi ? { cfi } : {}),
    });
  }

  function onScroll(): void {
    if (destroyed) return;
    paintShown();
    if (scrollTimer !== null) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      readPosition();
      paintShown();
      emit();
    }, SCROLL_SETTLE_MS) as unknown as number;
  }
  scroller.addEventListener("scroll", onScroll, { passive: true });

  // --- going somewhere ------------------------------------------------------------
  function rangeOfCfi(target: string): { doc: Column; range: Range } | null {
    const parsed = parseCfiStart(target);
    if (!parsed) return null;
    const doc = docs[parsed.spineIndex];
    if (!doc) return null;
    const at = resolvePoint(doc.root, parsed);
    if (!at) return null;
    const range = owner.createRange();
    if (at.node.nodeType === 3) {
      const text = at.node as Text;
      range.setStart(text, at.offset);
      range.setEnd(text, Math.min(text.data.length, at.offset + 1));
    } else {
      range.selectNode(at.node);
    }
    return { doc, range };
  }

  function scrollTo(doc: Column, rect: DOMRect): void {
    const r = rect.width === 0 && rect.height === 0 ? doc.host.getBoundingClientRect() : rect;
    scroller.scrollTop += r.top - viewportBox().top;
  }

  // Land a CFI at the top edge. Every document above it is a guess tall until
  // it has been laid out, so the landing is repeated over a few frames as the
  // guesses turn into heights, and once more when the pictures of the document
  // itself have arrived.
  function settle(target: string, frames = SETTLE_FRAMES): void {
    if (destroyed) return;
    const hit = rangeOfCfi(target);
    if (!hit) return;
    scrollTo(hit.doc, hit.range.getBoundingClientRect());
    if (frames > 0) {
      requestAnimationFrame(() => settle(target, frames - 1));
      return;
    }
    void hit.doc.ready.then(() => {
      if (destroyed) return;
      const again = rangeOfCfi(target);
      if (again) scrollTo(again.doc, again.range.getBoundingClientRect());
      const page = pageIndexOfCfi(pagination, target);
      if (page !== null) pinned = { cfi: target, pageIndex: page, scrollTop: scroller.scrollTop };
      readPosition();
      paintShown();
      emit();
    });
  }

  function goToCfi(target: string): void {
    settle(target);
  }

  function goToPage(i: number): void {
    const block = pagination.blocks[Math.min(Math.max(0, i), pagesCount - 1)];
    if (block) goToCfi(block.cfi);
  }

  function goToEntry(entry: string, fragment: string | null): boolean {
    const doc = docs.find((d) => d.entry === entry);
    if (!doc) return false;
    const el = fragment ? doc.shadow.getElementById(fragment) : null;
    scrollTo(doc, el ? el.getBoundingClientRect() : doc.host.getBoundingClientRect());
    requestAnimationFrame(() => {
      if (destroyed) return;
      const again = fragment ? doc.shadow.getElementById(fragment) : null;
      scrollTo(doc, again ? again.getBoundingClientRect() : doc.host.getBoundingClientRect());
    });
    return true;
  }

  /** Follow the book's own link under a viewport point, if there is one. */
  function followLinkAt(clientX: number, clientY: number): boolean {
    const doc = docAt(clientX, clientY);
    if (!doc) return false;
    const inner = doc.shadow.elementFromPoint(clientX, clientY);
    const anchor = inner?.closest?.("a[href]");
    if (!anchor) return false;
    const link = bookLinkTarget(anchor.getAttribute("href"));
    if (!link) return false;
    if (link.kind === "external") {
      openExternal(link.url);
      return true;
    }
    const entry = link.href.startsWith("#") ? doc.entry : resolveZipPath(doc.entry, link.href);
    return goToEntry(entry, hrefFragment(link.href));
  }

  // --- the finger -------------------------------------------------------------------
  // The reducer (flow-gesture.ts) says what a pointer sequence is; the column
  // supplies what it cannot see — the caret under the press — and does what it
  // answers with.
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
        // Captured to the column so a stroke that leaves it still finishes.
        try {
          scroller.setPointerCapture(event.pointerId);
        } catch {
          // The pointer may already be gone; the stroke still ends on its up.
        }
        break;
      case "extend-mark":
        if (at) marks.extendDrag(at.x, at.y);
        break;
      case "commit-mark":
        // A hold that never moved is a press on the word under it: the mark
        // there opens, exactly as a tap would.
        if (!marks.commitDrag() && at) marks.tapAt(at.x, at.y);
        break;
      case "abandon-mark":
        marks.cancelDrag();
        break;
      case "tap":
        if (at && !marks.tapAt(at.x, at.y)) followLinkAt(at.x, at.y);
        break;
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
  // Taking the touch off the browser once a mark is being drawn, on the moves
  // the pointer events cannot speak for (docs/pitfall/117, 261).
  const onTouchMove = (e: TouchEvent) => {
    if (claimsTouch(press)) e.preventDefault();
  };
  scroller.addEventListener("pointerdown", onPointerDown);
  scroller.addEventListener("pointermove", onPointerMove);
  scroller.addEventListener("pointerup", onPointerUp);
  scroller.addEventListener("pointercancel", onPointerCancel);
  scroller.addEventListener("touchmove", onTouchMove, { passive: false });

  // Every document laid out again: the reader stays on the words they were on,
  // and the marks, which are measured off those words, are measured again. A
  // narrower or wider column goes through here, and so does a change of type.
  function relayout(): void {
    if (destroyed) return;
    for (const doc of docs) marks.invalidate(doc.spine);
    if (cfi) settle(cfi);
  }

  let lastWidth = columnWidth;
  const observer = new ResizeObserver(() => {
    if (destroyed) return;
    const width = scroller.clientWidth;
    if (width === lastWidth || width === 0) return;
    lastWidth = width;
    relayout();
  });
  observer.observe(scroller);

  // --- first paint --------------------------------------------------------------------
  // A saved CFI is the exact place; a saved page number is the start of that
  // page. Neither opens at the start of the book.
  const saved = viewState?.cfi && rangeOfCfi(viewState.cfi) ? viewState.cfi : null;
  if (saved) settle(saved);
  else if (typeof viewState?.pageIndex === "number" && viewState.pageIndex > 0) goToPage(viewState.pageIndex);
  else {
    readPosition();
    paintShown();
    emit();
  }

  return {
    goToCfi,
    goToHref: (href) => {
      const hash = href.indexOf("#");
      const entry = hash >= 0 ? href.slice(0, hash) : href;
      goToEntry(entry, hrefFragment(href));
    },
    goToPage,
    removeAnnotations: (ids) => marks.unsetAnnotations(ids),
    setDisplay: (next) => {
      if (destroyed) return;
      display = next;
      scroller.style.background = FLOW_PAPERS[next.paper].surface;
      const css = flowBaselineCss(next);
      const width = scroller.clientWidth || lastWidth;
      for (const doc of docs) {
        doc.base.textContent = css;
        doc.host.style.setProperty(
          "contain-intrinsic-size",
          `auto ${intrinsicHeightEstimate(doc.chars, width, next)}px`,
        );
      }
      relayout();
    },
    setTool: (next) => {
      tool = next;
      marks.setTool(next);
      if (next.type === "none" && press.phase === "marking") {
        feed({ kind: "cancel", pointerId: press.pointerId });
      }
    },
    destroy: () => {
      destroyed = true;
      marks.cancelDrag();
      if (holdTimer !== null) clearTimeout(holdTimer);
      if (scrollTimer !== null) clearTimeout(scrollTimer);
      observer.disconnect();
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("pointerdown", onPointerDown);
      scroller.removeEventListener("pointermove", onPointerMove);
      scroller.removeEventListener("pointerup", onPointerUp);
      scroller.removeEventListener("pointercancel", onPointerCancel);
      scroller.removeEventListener("touchmove", onTouchMove);
      resources.revoke();
      scroller.remove();
      releaseEpub(bookId);
    },
  };
}
