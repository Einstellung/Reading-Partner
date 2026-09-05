// The adapter's imperative side: everything that runs once the EmbedPDF plugin
// registry is up. It opens the document, builds the EmbedPdfHandle the shell
// drives the reader through, and subscribes the engine's events back to the
// host's callbacks. No hooks and no JSX — React appears only as the type of the
// refs it is handed.
//
// Kept apart from EmbedPdfView.tsx because it is the larger half of the adapter
// and none of it is rendering. The pure predicates it leans on live further out
// (layout-modes.ts, layout-settle.ts, page-frame.ts, convert.ts); what is here
// is the sequencing that only makes sense against a live registry.

import type * as React from "react";

import type { PluginRegistry } from "@embedpdf/core";
import type { PdfAnnotationObject, PdfDocumentObject, PdfEngine, Rect } from "@embedpdf/models";
import type { ScrollCapability } from "@embedpdf/plugin-scroll";
import { ScrollStrategy } from "@embedpdf/plugin-scroll";
import { ZoomMode } from "@embedpdf/plugin-zoom";
import type { ZoomCapability } from "@embedpdf/plugin-zoom";
import type { ViewportCapability, ViewportPlugin } from "@embedpdf/plugin-viewport";
import type { InteractionManagerCapability } from "@embedpdf/plugin-interaction-manager";
import type { SelectionCapability } from "@embedpdf/plugin-selection";
import type { AnnotationCapability } from "@embedpdf/plugin-annotation";

import {
  embedToZotero,
  markupColorPatch,
  zoteroToEmbed,
  type ZoteroAnnotation,
} from "./convert";
import { selectionChanged } from "./annotation-selection";
import { pageCenterAlign } from "./gesture/paged-gesture";
import {
  atResetZoom,
  LAYOUT_SETTINGS,
  openingZoom,
  readingPosition,
  resetZoom,
  type VisiblePage,
  type ZoomLock,
} from "./layout-modes";
import {
  centeredScrollX,
  geometrySettled,
  landedAt,
  markPlacement,
  pageTopScrollY,
  settleGap,
  type LayoutGeometry,
} from "./layout-settle";
import { planFinger, toolKindOf } from "./gesture/touch-routing";
import type {
  EmbedLayout,
  EmbedPdfHandle,
  EmbedPdfViewProps,
  EmbedViewState,
  EmbedViewStats,
  QuoteHighlight,
} from "./types";
import type { PagedGestureCtx } from "./gesture/context";

// The one document this adapter ever has open: a viewer instance is mounted per
// book and torn down with it.
const DOC_ID = "main";

// Lightweight first-occurrence phase timing (cheap perf.now marks) for the load
// analysis. Harmless in prod; read via window.__epdfPerf.
export function perfMark(name: string): void {
  const w = window as unknown as { __epdfPerf?: Record<string, number> };
  w.__epdfPerf ??= {};
  if (w.__epdfPerf[name] === undefined) w.__epdfPerf[name] = Math.round(performance.now());
}

function cap<T>(registry: PluginRegistry, id: string): T {
  const plugin = registry.getPlugin(id) as { provides?: () => T } | null;
  const provides = plugin?.provides?.();
  if (!provides) throw new Error(`EmbedPDF plugin "${id}" not ready`);
  return provides;
}

// Text search across the document, filtered to one page. Returns the first
// on-page hit's page-space rects, or null. Progressively shortens the keyword
// (a quote spanning a line break may not match whole) before giving up.
async function findQuoteRects(
  engine: PdfEngine,
  doc: PdfDocumentObject,
  pageIndex: number,
  text: string,
): Promise<Rect[] | null> {
  const keyword = text.replace(/\s+/g, " ").trim();
  if (keyword.length < 2) return null;
  const words = keyword.split(" ");
  const candidates = [keyword];
  for (const n of [8, 5, 3]) {
    if (words.length > n) candidates.push(words.slice(0, n).join(" "));
  }
  for (const kw of candidates) {
    try {
      const res = await engine.searchAllPages(doc, kw, { flags: [] }).toPromise();
      const hit = res.results.find((r) => r.pageIndex === pageIndex && r.rects.length > 0);
      if (hit) return hit.rects;
    } catch {
      // Search failed for this keyword; try the next shorter candidate.
    }
  }
  return null;
}

export async function wireEngine(
  registry: PluginRegistry,
  propsRef: React.MutableRefObject<EmbedPdfViewProps>,
  engine: PdfEngine,
  setQuoteHlRef: React.MutableRefObject<(v: QuoteHighlight | null) => void>,
  pageSizesRef: React.MutableRefObject<{ width: number; height: number }[]>,
  pagedRef: React.MutableRefObject<PagedGestureCtx>,
): Promise<void> {
  const annotation = cap<AnnotationCapability>(registry, "annotation");
  const selection = cap<SelectionCapability>(registry, "selection");
  const scroll = cap<ScrollCapability>(registry, "scroll");
  const zoom = cap<ZoomCapability>(registry, "zoom");
  const interaction = cap<InteractionManagerCapability>(registry, "interaction-manager");
  const docManager = registry.getPlugin("document-manager") as {
    provides?: () => {
      getDocument(id: string): PdfDocumentObject | null;
      openDocumentBuffer(opts: {
        buffer: ArrayBuffer;
        documentId?: string;
        name: string;
        autoActivate?: boolean;
      }): { toPromise(): Promise<{ documentId: string; task: { toPromise(): Promise<unknown> } }> };
      onDocumentError(handler: (ev: { documentId: string; message: string }) => void): () => void;
    };
  } | null;
  const dm = docManager?.provides?.();

  // A file PDFium cannot parse does not throw. The open task below resolves
  // like any other, getDocument then answers null, and every plugin under it
  // simply has nothing to do — which on screen is an empty grey rectangle,
  // indistinguishable from a slow load. This event is the only report, so it is
  // subscribed before the open is issued.
  let openFailure: string | null = null;
  dm?.onDocumentError((ev) => {
    if (ev.documentId === DOC_ID) openFailure = ev.message;
  });

  // Open the document explicitly from the in-memory buffer (spike item 8:
  // openDocumentBuffer consumes the bytes directly, no temp file). A fresh copy
  // is passed so nothing downstream can detach the shell's original.
  const buf = propsRef.current.buffer;
  const copy = buf.slice(0);
  perfMark("docOpenStart");
  // Two tasks, not one. The doc-manager's own task resolves the moment the load
  // is issued and carries the engine's task inside it; the document only reaches
  // its store when that inner task settles. With PDFium on the main thread the
  // inner one finished in the same microtask, so awaiting the outer task alone
  // was indistinguishable from awaiting both — with the engine in a worker it is
  // a message round trip later, and the getDocument below read an empty store.
  // A failure is left to onDocumentError above, which carries the engine's own
  // message; the !doc() check below is what acts on it either way.
  const issued = await dm
    ?.openDocumentBuffer({ buffer: copy, documentId: DOC_ID, name: "document.pdf", autoActivate: true })
    .toPromise();
  await issued?.task.toPromise().catch(() => {});
  perfMark("docOpenEnd");

  const doc = () => dm?.getDocument(DOC_ID) ?? null;
  // Nothing was opened: hand the failure to the host and stop. The rest of this
  // function wires a document that does not exist, and onReady at the end of it
  // would tell the shell the reader is up — clearing the very status line that
  // has to keep saying it is not.
  if (!doc()) {
    propsRef.current.onError?.(new Error(openFailure ?? "the document did not open"));
    return;
  }
  const pageHeight = (pageIndex: number) => doc()?.pages[pageIndex]?.size.height ?? 0;
  // Cache page sizes for the quote-highlight overlay's rect scaling.
  pageSizesRef.current = doc()?.pages.map((p) => ({ width: p.size.width, height: p.size.height })) ?? [];

  const annScope = annotation.forDocument(DOC_ID);
  const selScope = selection.forDocument(DOC_ID);
  const scrollScope = scroll.forDocument(DOC_ID);
  const zoomScope = zoom.forDocument(DOC_ID);

  // Wire the paged-mode touch host to the live capabilities. `paged` was seeded
  // at mount from the restored layout; the plugin defaults already match it.
  pagedRef.current.scroll = scrollScope;
  pagedRef.current.interaction = interaction;
  pagedRef.current.selection = selection;
  // The numeric scale of the fit-page baseline, tracked so a pinch past it flips
  // the machine into pan mode and a pinch back down re-locks fit-page. Updated
  // whenever the zoom level is observed at fit-page.
  let fitPageScale = 0;
  const refreshZoomedIn = () => {
    const zs = zoomScope.getState();
    if (zs.zoomLevel === ZoomMode.FitPage) fitPageScale = zs.currentZoomLevel;
    if (!pagedRef.current.paged) {
      pagedRef.current.zoomedIn = false;
      return;
    }
    if (fitPageScale > 0 && zs.currentZoomLevel > fitPageScale * 1.02) {
      pagedRef.current.zoomedIn = true;
    } else {
      pagedRef.current.zoomedIn = false;
      // Pinched back to (or below) fit-page: re-lock the exact fit so swipe
      // turning resumes on a clean page-sized screen.
      if (typeof zs.zoomLevel === "number" && fitPageScale > 0 && zs.currentZoomLevel <= fitPageScale * 1.01) {
        zoomScope.requestZoom(ZoomMode.FitPage);
      }
    }
  };
  let layout: EmbedLayout = pagedRef.current.paged ? "paged" : "vertical";

  // --- paged mode: one whole page per screen --------------------------------
  // The horizontal strip packs pages side by side and scrollToPage puts the
  // page's left edge at the viewport's left edge, so a page narrower than the
  // viewport (fit-page in landscape) would sit off to one side with its
  // neighbour crowding in. Centre it explicitly instead.
  const viewportScope = cap<ViewportCapability>(registry, "viewport").forDocument(DOC_ID);
  const pageWidthPx = (pageNumber: number): number => {
    try {
      const item = scrollScope.getLayout().virtualItems.find((i) => i.pageNumbers.includes(pageNumber));
      return item ? item.width * zoomScope.getState().currentZoomLevel : 0;
    } catch {
      return 0;
    }
  };
  const centerAlignFor = (pageNumber: number): number =>
    pageCenterAlign(pageWidthPx(pageNumber), viewportScope.getMetrics().clientWidth);

  // --- settling a layout change ---------------------------------------------
  // A layout change is a request, not a completed operation: the scroll model,
  // the zoom and the DOM arrive on three different frames, and a centring
  // issued before all three are in place is clamped to something else and never
  // corrected (layout-settle.ts explains why nothing downstream notices). So
  // the host waits for a geometry that answers to the layout, centres against
  // it, and then confirms the page actually got there.
  const zoomLockOf = (level: unknown): ZoomLock | null =>
    level === ZoomMode.FitPage ? "fit-page" : level === ZoomMode.FitWidth ? "fit-width" : null;

  const readGeometry = (): LayoutGeometry | null => {
    const el = pagedRef.current.viewport;
    if (!el) return null;
    try {
      const model = scrollScope.getLayout();
      const zs = zoomScope.getState();
      const items = model.virtualItems;
      const pluginMetrics = viewportScope.getMetrics();
      return {
        firstItem: items[0] ? { x: items[0].x, y: items[0].y } : null,
        secondItem: items[1] ? { x: items[1].x, y: items[1].y } : null,
        contentWidth: model.totalContentSize.width,
        contentHeight: model.totalContentSize.height,
        scale: zs.currentZoomLevel,
        zoomLock: zoomLockOf(zs.zoomLevel),
        domScrollWidth: el.scrollWidth,
        domScrollHeight: el.scrollHeight,
        largestItem: items.length
          ? {
              width: Math.max(...items.map((i) => i.width)),
              height: Math.max(...items.map((i) => i.height)),
            }
          : null,
        domClientWidth: el.clientWidth,
        domClientHeight: el.clientHeight,
        pluginClientWidth: pluginMetrics.clientWidth,
        pluginClientHeight: pluginMetrics.clientHeight,
        viewportGap: cap<ViewportCapability>(registry, "viewport").getViewportGap(),
      };
    } catch {
      // The scroll state is gone (document closing): nothing to settle.
      return null;
    }
  };

  // Hand the viewport plugin the box the element actually has. Its own
  // measurements come from a ResizeObserver watching the container's content
  // box, which the padding the viewport gives itself never changes, so a
  // viewport that was measured before that padding landed stays wrong for the
  // session: every fit comes out 2*gap too small and every alignX is resolved
  // against a viewport narrower than the one on screen. This is the same call
  // the plugin's own React adapter makes from that observer.
  //
  // Only when the numbers actually differ. Every call counts as a resize, and
  // the zoom plugin answers a resize 150ms later by rewriting the scroll
  // position from the one it has cached (pitfall 57) — which during an open is
  // the position from before the page was placed. A refresh that changes
  // nothing would buy that for nothing.
  const viewportPlugin = registry.getPlugin("viewport") as unknown as ViewportPlugin | null;
  const refreshViewportMetrics = () => {
    const el = pagedRef.current.viewport;
    if (!el || !viewportPlugin) return;
    const known = viewportScope.getMetrics();
    if (known.clientWidth === el.clientWidth && known.clientHeight === el.clientHeight) return;
    viewportPlugin.setViewportResizeMetrics(DOC_ID, {
      width: el.offsetWidth,
      height: el.offsetHeight,
      clientWidth: el.clientWidth,
      clientHeight: el.clientHeight,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
      scrollWidth: el.scrollWidth,
      scrollHeight: el.scrollHeight,
      clientLeft: el.clientLeft,
      clientTop: el.clientTop,
    });
  };

  // Tell the viewport plugin where the scroll position actually is. It learns
  // that from a scroll event, which the browser dispatches on its own schedule —
  // and anything that recomputes a focus-preserving scroll in the meantime
  // (the zoom plugin, 150ms after any resize) does it from the position the
  // plugin last heard about. Measured on the open path: the page centred at
  // 5930 and was pulled back to 0 three milliseconds later, because as far as
  // the plugin knew the reader was still at 0. So a placement that has landed
  // says so, rather than waiting to be discovered.
  const syncScrollMetrics = () => {
    const el = pagedRef.current.viewport;
    if (!el || !viewportPlugin) return;
    viewportPlugin.setViewportScrollMetrics(DOC_ID, { scrollLeft: el.scrollLeft, scrollTop: el.scrollTop });
  };

  // Where the placement wants the scroll container to sit for this page, along
  // the layout's own axis and clamped the way the browser clamps it, so "did it
  // arrive" compares like with like.
  const placeTarget = (mode: EmbedLayout, pageNumber: number): number | null => {
    const el = pagedRef.current.viewport;
    if (!el) return null;
    try {
      const item = scrollScope.getLayout().virtualItems.find((i) => i.pageNumbers.includes(pageNumber));
      if (!item) return null;
      const scale = zoomScope.getState().currentZoomLevel;
      const viewportGap = cap<ViewportCapability>(registry, "viewport").getViewportGap();
      if (LAYOUT_SETTINGS[mode].placePage === "top") {
        return pageTopScrollY({
          pageY: item.y,
          scale,
          viewportGap,
          maxScrollY: el.scrollHeight - el.clientHeight,
        });
      }
      return centeredScrollX({
        pageX: item.x,
        pageWidth: item.width,
        scale,
        viewportGap,
        clientWidth: viewportScope.getMetrics().clientWidth,
        maxScrollX: el.scrollWidth - el.clientWidth,
      });
    } catch {
      return null;
    }
  };

  // Re-applying a scroll strategy the plugin already holds is a no-op inside
  // it — setScrollStrategyForDocument returns early on `strategy === newStrategy`
  // — so the layout refresh it silently skipped (document not "loaded" at that
  // instant, pitfall 42) can only be forced by going through the other strategy
  // first. Both calls are synchronous, so the intermediate layout never reaches
  // the screen. Used only as a repair, when the virtual items say the refresh
  // did not happen.
  const forceScrollStrategy = (strategy: ScrollStrategy) => {
    scrollScope.setScrollStrategy(
      strategy === ScrollStrategy.Horizontal ? ScrollStrategy.Vertical : ScrollStrategy.Horizontal,
    );
    scrollScope.setScrollStrategy(strategy);
  };

  // Frames a layout change may keep asking for. Bounded on purpose: a signal
  // that never arrives must not leave the reader waiting, so at the deadline it
  // places the page against whatever geometry exists — exactly what the old
  // single-frame version did unconditionally.
  const SETTLE_FRAME_BUDGET = 24;
  // How many times the placement may be re-issued once the geometry is ready.
  // More than one because the viewport plugin defers the scroll it is given by
  // a frame, and the browser clamps it to the extent that exists then.
  const MAX_PLACE_ATTEMPTS = 3;
  // Serial number of the live settle: a newer layout change, rotation or page
  // turn owns the scroll position, and the older one stops touching it.
  let settleSerial = 0;
  // The page the newest settle or turn is putting on screen. A viewport resize
  // asks for it rather than for the page the scroll position happens to be over:
  // during a restore or a turn the scroll position is mid-flight and means
  // nothing, and a resize that re-targets from it drags the reader to whatever
  // page the placement had reached.
  let settleTarget: { serial: number; page: number } | null = null;
  const targetedPage = (): number => {
    if (settleTarget && settleTarget.serial === settleSerial) return settleTarget.page;
    return scrollScope.getCurrentPage();
  };

  // --- holding the page area back --------------------------------------------
  // A placement cannot be issued before the geometry it measures exists, and
  // that geometry arrives several frames after the document does. Every one of
  // those frames paints, and it paints at the scroll container's origin — page
  // 1 — because that is where a fresh scroll container sits and nothing has
  // moved it yet. Shrinking the gap does not remove those frames; a scroll
  // issued after a frame has painted cannot un-paint it. So the page area does
  // not paint at all until the placement has been confirmed.
  //
  // The viewport plugin's own gate (`gate`/`releaseGate`) cannot do this: it
  // unmounts the Scroller, and with no Scroller there is no layout-ready, no
  // virtual items and no scrollWidth — the settle would be waiting for the
  // geometry that only exists once the gate is released. What this needs is a
  // page area that is laid out and not drawn, which is `visibility: hidden` on
  // the scroll container. Its box, its extents and its scroll offset all stay
  // live, the engine renders from the scroll model rather than from anything
  // the compositor sees, and behind it is the same background the reader was
  // already looking at while the document loaded.
  //
  // Whoever placed last owns it. A settle that holds the area back releases it
  // on the frame it confirms the placement and on any frame it stops running —
  // including the frame budget running out — and a newer placement takes
  // ownership from an older one. There is no path that stops the settle without
  // giving the reader the page area back.
  let heldBy = 0;
  const holdPageArea = (serial: number) => {
    heldBy = serial;
    const el = pagedRef.current.viewport;
    // Re-asserted rather than set once: the scroll container is handed over a
    // frame or two after the document opens, so the first ask can arrive before
    // there is an element to hide.
    if (el && el.style.visibility !== "hidden") el.style.visibility = "hidden";
  };
  const showPageArea = () => {
    heldBy = 0;
    const el = pagedRef.current.viewport;
    if (el && el.style.visibility) el.style.visibility = "";
  };

  const centerPage = (target: number, behavior: "smooth" | "instant") =>
    scrollScope.scrollToPage({ pageNumber: target, behavior, alignX: centerAlignFor(target) });

  // Put the page where the layout puts it: centred on the strip, or with its top
  // at the top of the column (no alignY — the plugin's default is the page top).
  const placePage = (mode: EmbedLayout, target: number, behavior: "smooth" | "instant") => {
    if (LAYOUT_SETTINGS[mode].placePage === "top") {
      scrollScope.scrollToPage({ pageNumber: target, behavior });
      return;
    }
    centerPage(target, behavior);
  };

  // Wait for the geometry the layout asked for, then put `page` on screen and
  // confirm it stayed there. Re-asserts only the half that is actually missing:
  // the zoom lock if the request never took, the virtual items if the plugin
  // dropped its refresh. The DOM catching up is nobody's to hurry — that one is
  // only waited on. A null page settles the geometry and places nothing, which
  // is what re-asserting vertical does: the reader is already inside the page
  // and putting its top back at the top of the viewport would eat the offset.
  const settleLayout = (
    mode: EmbedLayout,
    page: number | null,
    behavior: "smooth" | "instant",
    // Whether the page area stays dark until this placement is confirmed. For
    // the paths that have no page on screen to protect, or whose wait would
    // otherwise be painted at the wrong page.
    hold = false,
  ) => {
    const serial = ++settleSerial;
    if (page !== null) settleTarget = { serial, page };
    // The newest placement owns the page area, so an older settle can neither
    // keep it dark nor give it back. A placement that does not want it dark
    // takes it back from one that did.
    if (hold && page !== null) holdPageArea(serial);
    else if (heldBy !== 0) showPageArea();
    const settings = LAYOUT_SETTINGS[mode];
    const strategy = settings.axis === "horizontal" ? ScrollStrategy.Horizontal : ScrollStrategy.Vertical;
    const zoomMode = settings.zoom === "fit-page" ? ZoomMode.FitPage : ZoomMode.FitWidth;
    let frames = 0;
    let attempts = 0;
    let ready = false;
    let placed = false;
    // One frame of the settle: repair what is missing, place when the geometry
    // allows it, and say whether another frame is wanted. Every way this stops
    // returns false, which is what makes the hold bounded — the caller below
    // gives the page area back on the frame it stops, whatever stopped it.
    const step = (): boolean => {
      frames += 1;
      const expired = frames >= SETTLE_FRAME_BUDGET;
      const geometry = readGeometry();
      if (!ready) {
        // A null geometry means there is no element to consult yet — the touch
        // router grabs the scroll container a frame or two after it mounts, and
        // opening a book can reach here first. Waiting is the whole point: a
        // placement measured against nothing is the failure this exists to
        // prevent. The frame budget bounds the wait.
        if (!expired && (geometry === null || !geometrySettled(geometry, mode))) {
          const gap = geometry === null ? null : settleGap(geometry, mode);
          if (gap === "metrics") refreshViewportMetrics();
          if (gap === "zoom") zoomScope.requestZoom(zoomMode);
          if (gap === "model") forceScrollStrategy(strategy);
          // The element may only just have arrived, after the hold was asked
          // for and found nothing to hide.
          if (heldBy === serial) holdPageArea(serial);
          return true;
        }
        ready = true;
      }
      // Nothing to place: the settle was only asked to let the geometry land.
      if (page === null) return false;
      const el = pagedRef.current.viewport;
      const want = placeTarget(mode, page);
      const at = settings.axis === "horizontal" ? el?.scrollLeft : el?.scrollTop;
      if (el && want !== null && at !== undefined && landedAt(at, want)) {
        // Landed — but not necessarily last. The zoom plugin answers a viewport
        // resize on a 150ms debounce of its own and writes a focus-preserving
        // scroll offset when it does, which on a rotation arrives after the
        // placement has already landed (measured: centred at 4310, pulled back
        // to 4450 two frames later, and there it stayed). So the landing is
        // published to the plugin, so that a rewrite preserves this position
        // rather than the one it last cached, and then watched for the rest of
        // the budget instead of being trusted on sight.
        syncScrollMetrics();
        placed = true;
        return !expired && behavior === "instant";
      }
      // A smooth turn is an animation in progress, not a landing to confirm:
      // issue it once and leave it alone.
      if (attempts >= (behavior === "smooth" ? 1 : MAX_PLACE_ATTEMPTS)) return false;
      attempts += 1;
      placePage(mode, page, behavior);
      return !expired;
    };
    const release = () => {
      if (heldBy === serial) showPageArea();
    };
    const tick = () => {
      // A newer switch or turn has taken over the scroll position, and the page
      // area with it.
      if (serial !== settleSerial || layout !== mode) return;
      const again = step();
      // The page area comes back the moment the placement is confirmed: the
      // offset this frame is about to paint is the one that was asked for.
      if (placed) release();
      // And it comes back a frame after the settle stops for any other reason —
      // a geometry that never settles, a placement that will not land, the
      // frame budget. A frame later rather than on the spot because the scroll
      // the last attempt asked for is deferred by one (the viewport plugin
      // defers every scroll it is handed), so releasing here would show the one
      // frame all of this exists to hide. Nothing waits on more than that: this
      // is the settle's last frame either way.
      if (again) requestAnimationFrame(tick);
      else requestAnimationFrame(release);
    };
    requestAnimationFrame(tick);
  };

  // Paged mode's only page change: centre the target page, and come back to
  // fit-page if a temporary magnification was in play. Turning a page always
  // lands on one whole page.
  const turnToPage = (pageNumber: number, behavior: "smooth" | "instant" = "smooth") => {
    const target = Math.min(Math.max(pageNumber, 1), scrollScope.getTotalPages() || 1);
    if (zoomScope.getState().zoomLevel !== ZoomMode.FitPage) {
      // Dropping a temporary magnification re-scales the whole strip, so the
      // page it lands on has moved: centre once the strip is the new size.
      zoomScope.requestZoom(ZoomMode.FitPage);
      settleLayout("paged", target, behavior);
      return;
    }
    // A turn is the newest word on where the strip should sit: a settle still
    // confirming an older target stands down rather than pulling it back — and
    // hands back the page area with it, since a turn is issued against a page
    // the reader is already looking at.
    settleSerial += 1;
    settleTarget = { serial: settleSerial, page: target };
    if (heldBy !== 0) showPageArea();
    centerPage(target, behavior);
  };

  // Every host-driven jump — the outline, the trace list, an AI citation —
  // goes through here. Two rules, both about who owns the scroll position.
  //
  // One: the touch router owns it. The page divs are touch-action:none in every
  // mode, so nothing scrolls unless the router writes it (pitfall 37), and
  // whatever it has in flight keeps writing after the jump. An inertia fling
  // coasts for up to a second; a jump issued mid-coast is overwritten frame by
  // frame and lands nowhere near the page it asked for (measured in Chromium:
  // 613px instead of 2604px). So the jump silences the router first, the same
  // reset a layout switch does.
  //
  // Two: the jump must not hand the scroll position to a second animator
  // either. `behavior: "smooth"` runs the browser's own scroll animation, which
  // the reader can neither see nor stop — on iOS it is dispatched to the
  // scrolling thread, off the main thread entirely — and it writes the same
  // property the router writes every frame (pitfall 50).
  //
  // Three: the page it lands on is the newest word on where the layout should
  // sit, exactly as a turn is. A settle still confirming an older target stands
  // down rather than pulling it back, and the page area comes back with it; and
  // the next viewport resize re-places the page the jump asked for instead of
  // the one the reader was on before it (targetedPage says why it asks).
  const jumpToPage = (opts: Parameters<typeof scrollScope.scrollToPage>[0]) => {
    pagedRef.current.resetGestures?.();
    settleSerial += 1;
    settleTarget = { serial: settleSerial, page: opts.pageNumber };
    if (heldBy !== 0) showPageArea();
    scrollScope.scrollToPage({ ...opts, behavior: "instant" });
  };

  // A jump to a mark inside a page: the trace list, an AI citation. Where the
  // mark ends up is the layout's to say, not the caller's — markPlacement says
  // it, and the mark's own coordinates are only ever an input to that.
  const jumpToMark = (pageNumber: number, mark: Rect["origin"], alignY: number) =>
    jumpToPage({
      pageNumber,
      ...markPlacement(layout, {
        markX: mark.x,
        markY: mark.y,
        alignY,
        pageWidthPx: pageWidthPx(pageNumber),
        clientWidth: viewportScope.getMetrics().clientWidth,
      }),
    });

  pagedRef.current.turnToPage = (pageNumber) => turnToPage(pageNumber);

  // Rotating the iPad (or any viewport resize) must not leave paged mode
  // magnified or off-centre: the zoom plugin only recomputes a fit when the
  // level still IS a fit mode, and a pinch replaces it with a number.
  //
  // A rotation changes both viewport dimensions, so it re-scales and re-lays
  // out the strip exactly as a layout switch does — and re-centring one frame
  // later hits the same trap (pitfall 56), plus one the switch does not have:
  // the zoom plugin answers the resize on a 150ms debounce of its own and
  // writes a focus-preserving scroll offset when it does, after the host's
  // centring has already landed. So the re-centring goes through the settle,
  // asked about the layout that is live rather than one being switched to, and
  // the settle keeps confirming the landing for its whole budget. Its serial
  // does the rest: a rotation arriving mid-settle takes the scroll position off
  // the older one instead of fighting it for the frames they overlap.
  cap<ViewportCapability>(registry, "viewport").onViewportResize((ev) => {
    if (!pagedRef.current.paged || ev.documentId !== DOC_ID) return;
    zoomScope.requestZoom(ZoomMode.FitPage);
    settleLayout(layout, targetedPage(), "instant");
  });

  // Map annotation id -> pageIndex, so host-side ops can address the right page.
  const pageOf = new Map<string, number>();
  // Writes this adapter made itself — an import, a host edit, a host delete —
  // waiting for the engine to confirm them. The confirmation arrives as an
  // ordinary annotation event, and the host was already told about these writes
  // by the call that made them, so each confirmation is swallowed once.
  //
  // Ids and not a flag raised around the call, because the confirmation is
  // asynchronous: with PDFium in a worker the flag is long down by the time the
  // event arrives, and every one of these writes was echoed back to the host —
  // an open re-saved every annotation it had just imported. Counted rather than
  // a set so the same id written twice in one batch is swallowed twice.
  const selfWrites = new Map<string, number>();
  const expectEcho = (id: string) => selfWrites.set(id, (selfWrites.get(id) ?? 0) + 1);
  const takeEcho = (id: string): boolean => {
    const left = selfWrites.get(id);
    if (!left) return false;
    if (left === 1) selfWrites.delete(id);
    else selfWrites.set(id, left - 1);
    return true;
  };
  // Latest selected text, captured as the selection changes, so a highlight
  // create can attach the underlying text (EmbedPDF highlights store no text —
  // spike item 6).
  let lastSelectionText = "";

  // A click on blank page space dismisses the transient AI-quote overlay.
  selScope.onEmptySpaceClick(() => setQuoteHlRef.current(null));

  selection.onSelectionChange((range) => {
    if (!range) return;
    // Fire-and-forget: by create time this has usually resolved.
    selScope
      .getSelectedText()
      .toPromise()
      .then((t) => {
        lastSelectionText = t.join(" ").trim();
      })
      .catch(() => {});
  });

  // Import the host's saved annotations (converted to EmbedPDF objects).
  const importAll = (anns: ZoteroAnnotation[]) => {
    const items = anns
      .map((a) => {
        const h = pageHeight(a.position?.pageIndex ?? 0);
        const obj = zoteroToEmbed(a, h);
        if (obj) pageOf.set(obj.id, obj.pageIndex);
        return obj ? { annotation: obj } : null;
      })
      .filter((x): x is { annotation: PdfAnnotationObject } => x !== null);
    if (items.length === 0) return;
    for (const item of items) expectEcho(item.annotation.id);
    annScope.importAnnotations(items);
  };

  // Engine -> host: create / update / delete.
  annotation.onAnnotationEvent((ev) => {
    if (ev.type !== "create" && ev.type !== "update" && ev.type !== "delete") return;
    // Every write fires twice: an optimistic event, then the committed one once
    // the engine has it. Only the committed pass reaches the host, so it
    // persists once, and only the committed pass consumes a self-write — the
    // optimistic event is not the confirmation being waited for.
    if (ev.committed === false) return;
    if (ev.type === "delete") {
      if (takeEcho(ev.annotation.id)) return;
      pageOf.delete(ev.annotation.id);
      propsRef.current.onDeleteAnnotations?.([ev.annotation.id]);
      return;
    }
    if (ev.type === "create" || ev.type === "update") {
      const obj = ev.annotation as PdfAnnotationObject;
      if (takeEcho(obj.id)) return;
      pageOf.set(obj.id, ev.pageIndex);
      const zot = embedToZotero(obj, pageHeight(ev.pageIndex), propsRef.current.authorName);
      if (!zot) return;
      // Highlights/underlines carry no text; attach the just-selected text.
      if (ev.type === "create" && (zot.type === "highlight" || zot.type === "underline") && !zot.text) {
        zot.text = lastSelectionText;
      }
      propsRef.current.onSaveAnnotations?.([zot]);
    }
  });

  // Selection state -> host (trace-list highlight sync + the annotation editor).
  // onStateChange is the plugin's whole-document state stream, not a selection
  // event: a tool switch or an annotation write republishes the selection that
  // was already there, and the host used to read every one of those as a fresh
  // selection (annotation-selection.ts). Only a selection that moved is passed
  // on.
  let lastSelected: readonly string[] | null = null;
  annotation.onStateChange(() => {
    const ids = annScope.getSelectedAnnotationIds();
    if (!selectionChanged(lastSelected, ids)) return;
    lastSelected = ids;
    propsRef.current.onSelectAnnotation?.(ids[0] ?? null);
  });

  // Reading position + nav/zoom stats -> host. Which page counts as the reading
  // position, and whether an in-page offset is part of it, is the live layout's
  // to say (layout-modes.readingPosition, pitfall 62). Both of the inputs come
  // out of the one scroll state the plugin publishes, so the two answers cannot
  // describe different moments.
  //
  // Vertical's offset is the topmost visible page's visible-region origin: the
  // viewport top-left in that page's coordinates, in unscaled page units —
  // exactly what scrollToPage's pageCoordinates takes on restore.
  const currentState = (): EmbedViewState => {
    let currentPage = 1;
    let visible: VisiblePage[] = [];
    try {
      currentPage = scrollScope.getCurrentPage();
      visible = scrollScope.getMetrics().pageVisibilityMetrics.map((m) => ({
        pageNumber: m.pageNumber,
        pageX: m.original.pageX,
        pageY: m.original.pageY,
      }));
    } catch {
      // Scroll state unavailable (layout not ready): position falls back to the
      // first page's top.
    }
    return {
      ...readingPosition(layout, currentPage, visible),
      zoom: zoomScope.getState().currentZoomLevel,
      layout,
    };
  };
  const emitState = () => {
    propsRef.current.onViewState?.(currentState());
  };
  const emitStats = () => {
    const zs = zoomScope.getState();
    const z = zs.currentZoomLevel;
    const stats: EmbedViewStats = {
      pageIndex: scrollScope.getCurrentPage() - 1,
      pagesCount: scrollScope.getTotalPages(),
      zoom: z,
      canZoomIn: z < 6,
      canZoomOut: z > 0.15,
      // Nothing to reset to while the zoom already is this layout's lock. A
      // number — what a pinch leaves behind — is never a lock, so it is.
      canZoomReset: !atResetZoom(layout, zoomLockOf(zs.zoomLevel)),
      layout,
    };
    propsRef.current.onViewStats?.(stats);
  };
  scroll.onScroll(() => {
    emitState();
  });
  scroll.onPageChange(() => {
    emitState();
    emitStats();
  });
  zoom.onZoomChange(() => {
    refreshZoomedIn();
    emitState();
    emitStats();
  });

  // Restore position + import annotations once the layout is ready (page sizes
  // exist). onLayoutReady fires with isInitial on the first ready.
  scroll.onLayoutReady((ev) => {
    if (!ev.isInitial) return;
    perfMark("layoutReady");
    // The one measurement the viewport plugin takes of itself is the one it
    // takes before it has applied its own padding, and nothing re-takes it
    // (refreshViewportMetrics says why). By now the padding is long since on,
    // so this is where the plugin gets told what it is working with — before
    // any fit is resolved from it. Both layouts need it: paged reads it back
    // through the settle, vertical has no settle to catch it later.
    refreshViewportMetrics();
    importAll(propsRef.current.annotations ?? []);
    const iv = propsRef.current.initialViewState;
    // The scale, before either branch places a page: whatever it ends up being
    // is what the placement below is measured against. Null is the answer for a
    // book with nothing saved and for paged either way, and it means the plugin
    // keeps the fit it was registered with (layout-modes.openingZoom).
    const restoreZoom = iv ? openingZoom(layout, iv.zoom) : null;
    if (restoreZoom !== null) zoomScope.requestZoom(restoreZoom);
    if (iv && layout === "paged") {
      // Of a saved state, paged mode restores the page and nothing else. The
      // scale and the in-page offset are one window's presentation of it — the
      // desktop's, usually — and paged mode's contract is one whole page, which
      // is the fit for the screen in front of the reader and not the one that
      // last saved. Only the page index carries across, which is also all paged
      // mode writes (LayoutSettings.anchor); an offset in the state is either
      // vertical's or one an older build left behind.
      //
      // Placed through the settle for the same reason a switch is (pitfall 56):
      // the scroll model, the zoom and the DOM land on three different frames,
      // and a centring issued before all three agree is clamped to something
      // else that no plugin will ever call wrong. Opening is the harder case —
      // the viewport is measuring itself for the first time, and nothing has
      // ever been placed to correct.
      //
      // And held back until it is placed. This is the one path with nothing on
      // screen to lose: the reader is waiting for a book to open, the frames
      // between the strip appearing and the placement landing are the strip's
      // origin — page 1 — and the grey they are replaced with is the grey they
      // have been looking at since they tapped the book.
      const target = Math.min(Math.max(iv.pageIndex + 1, 1), scrollScope.getTotalPages() || 1);
      settleLayout("paged", target, "instant", true);
    } else if (iv) {
      // Restore the exact in-page position when the saved state carries one
      // (unscaled page coordinates; the plugin scales them at scroll time).
      // scrollToPage adds the viewport gap on top of the target point, while the
      // captured pageX/pageY (visibility metrics) measure the actual visible
      // offset — subtract the gap (unscaled) so the round trip is exact.
      //
      // The scale that converts the gap is the one in force, read back after the
      // request above rather than taken from the saved state: with nothing to
      // restore there is no saved number to divide by, and the fit the plugin
      // resolved is the scale the offset will actually be applied at.
      let pageCoordinates: { x: number; y: number } | undefined;
      if (typeof iv.pageY === "number") {
        const scale = zoomScope.getState().currentZoomLevel || 1;
        const gap = cap<ViewportCapability>(registry, "viewport").getViewportGap() / scale;
        pageCoordinates = {
          x: Math.max(0, (iv.pageX ?? 0) - gap),
          y: Math.max(0, iv.pageY - gap),
        };
      }
      scrollScope.scrollToPage({
        pageNumber: iv.pageIndex + 1,
        ...(pageCoordinates ? { pageCoordinates } : {}),
        behavior: "instant",
      });
    }
    refreshZoomedIn();
    emitStats();
    emitState();
  });

  const activeToolId = () => annotation.getActiveTool()?.id ?? "pointer";

  const handle: EmbedPdfHandle = {
    setTool(tool) {
      // Neither "pointer" (nothing selected) nor "navlock" (the navigation lock)
      // is an engine tool; both clear the active one. They differ only in what
      // the touch router does, which reads pagedRef.current.tool live.
      const drawing = tool !== "pointer" && tool !== "navlock";
      annScope.setActiveTool(drawing ? tool : null);
      pagedRef.current.tool = tool;
    },
    setFingerDraw(on) {
      pagedRef.current.fingerDraw = on;
    },
    setLayout(mode) {
      // Every field of LAYOUT_SETTINGS is applied, in both directions and on
      // every call — no early return when the mode looks unchanged. Entering and
      // leaving are the same operation with a different target, so nothing can
      // be set on the way in and left behind on the way out (layout-modes.ts
      // holds the settings and the round-trip proof), and a repeat call
      // re-asserts the layout instead of trusting a flag.
      const s = LAYOUT_SETTINGS[mode];
      const strategy = s.axis === "horizontal" ? ScrollStrategy.Horizontal : ScrollStrategy.Vertical;
      const zoomMode = s.zoom === "fit-page" ? ZoomMode.FitPage : ZoomMode.FitWidth;
      // Read before the strategy and zoom re-lay the document out.
      const page = scrollScope.getCurrentPage();
      // Whether this call moves the reader between the layouts or re-asserts the
      // one they are in. Only the axis flip has a position to carry across: a
      // re-assert leaves the reader exactly where they are, which for vertical
      // means not placing the page at all (LayoutSettings.placePage says why).
      const switched = layout !== mode;
      layout = mode;
      pagedRef.current.paged = mode === "paged";
      // Nothing the old layout had in flight survives the switch.
      pagedRef.current.resetGestures?.();
      pagedRef.current.setTouchLock?.(s.touchLock);
      scrollScope.setScrollStrategy(strategy);
      zoomScope.requestZoom(zoomMode);
      // The fit-page baseline belongs to paged mode; a stale one would misjudge
      // "zoomed in" if the viewport changed size while reading vertically.
      if (!s.tracksFitPage) fitPageScale = 0;
      // Neither call above is guaranteed to have done anything. The scroll
      // plugin drops its layout refresh without a word when the document is not
      // "loaded" at that instant, and re-issuing the same strategy is a no-op
      // inside it, so a second identical call cannot repair that; the zoom
      // request lands on the same scale whenever fit-page and fit-width
      // coincide, which is every portrait screen holding a portrait page, so no
      // scale change follows to recompute anything either. And when both do
      // take, the DOM is still a frame behind them. The settle checks all three
      // against the layout that was asked for, re-asserts whichever is missing,
      // and only then places the page — and confirms it arrived, because a
      // scroll the browser clamped is one nothing downstream will ever notice.
      //
      // A switch holds the page area back too, for the same reason the open
      // does: between the request and the geometry the scroll offset is 0 in a
      // layout that has just been rebuilt around it, so what paints is the top
      // of the new layout — page 1, on the way to the page the reader was on.
      // Unlike the open there is something on screen to lose, so it was
      // measured: one painted frame at page 1 (17ms) becomes two dark ones plus
      // the frame that confirms the landing — 33ms at full speed, 100ms under a
      // 6x CPU throttle. A slightly longer gap that stays on the background the
      // page sits on, instead of a shorter one that says the reader lost their
      // place. A re-assert of the layout already in effect moves nothing and so
      // holds nothing.
      settleLayout(mode, switched || s.placePage === "center" ? page : null, "instant", switched);
      refreshZoomedIn();
      emitStats();
      emitState();
    },
    setColor(color) {
      const id = activeToolId();
      if (id !== "pointer") annotation.setToolDefaults(id, markupColorPatch(color));
    },
    zoomIn: () => zoomScope.zoomIn(),
    zoomOut: () => zoomScope.zoomOut(),
    // The reset control asks for the layout's own lock back: fit-width in the
    // vertical column, fit-page in the paged strip. Resetting to fit-width in
    // paged mode is a magnification (a portrait page is taller than the screen
    // at page width), and a magnified strip pans instead of flipping — the
    // reader loses the swipe (pitfall 213).
    zoomReset: () => {
      const lock = resetZoom(layout);
      zoomScope.requestZoom(lock === "fit-page" ? ZoomMode.FitPage : ZoomMode.FitWidth);
      if (layout !== "paged") return;
      // Dropping a magnification re-scales the whole strip, so the page the
      // reader was on has moved: centre it once the strip is the new size, the
      // same way turning a page out of a magnification does. refreshZoomedIn
      // takes the machine out of pan mode against the fit just asked for
      // instead of waiting on the zoom event.
      refreshZoomedIn();
      settleLayout("paged", targetedPage(), "instant");
    },
    navigateToPage(pageIndex) {
      // An explicit page jump is navigating away — drop any quote overlay.
      setQuoteHlRef.current(null);
      if (layout === "paged") {
        // A host jump is not a finger flip: it lands on the page outright, and
        // it silences the router for the same reason jumpToPage does.
        pagedRef.current.resetGestures?.();
        turnToPage(pageIndex + 1, "instant");
        return;
      }
      jumpToPage({ pageNumber: pageIndex + 1 });
    },
    async highlightQuote(pageIndex, req) {
      const d = doc();
      const page = d?.pages[pageIndex];
      if (!d || !page) {
        setQuoteHlRef.current({ pageIndex, kind: "banner", quote: req.displayText });
        return false;
      }
      const rects = await findQuoteRects(engine, d, pageIndex, req.searchText);
      if (rects && rects.length > 0) {
        setQuoteHlRef.current({ pageIndex, kind: "rects", rects });
        jumpToMark(pageIndex + 1, rects[0].origin, 60);
        return true;
      }
      // Tier B: could not locate the quote geometrically — show it as a banner.
      setQuoteHlRef.current({ pageIndex, kind: "banner", quote: req.displayText });
      jumpToPage({ pageNumber: pageIndex + 1 });
      return false;
    },
    clearQuoteHighlight() {
      setQuoteHlRef.current(null);
    },
    navigateToAnnotation(id) {
      const ta = annScope.getAnnotationById(id);
      if (!ta) return;
      const obj = ta.object;
      const pageIndex = obj.pageIndex;
      annScope.selectAnnotation(pageIndex, id);
      // rect.origin is top-left page coordinates: scroll the mark near the top.
      jumpToMark(pageIndex + 1, obj.rect.origin, 20);
    },
    updateAnnotation(id, patch) {
      const pageIndex = pageOf.get(id);
      if (pageIndex === undefined) return;
      const p: Record<string, unknown> = {};
      if (patch.color !== undefined) Object.assign(p, markupColorPatch(patch.color));
      if (patch.comment !== undefined) p.contents = patch.comment;
      if (patch.starred !== undefined) {
        const cur = annScope.getAnnotationById(id)?.object.custom ?? {};
        p.custom = { ...cur, starred: patch.starred };
      }
      expectEcho(id);
      annScope.updateAnnotation(pageIndex, id, p);
      // Echo the host-side edit back so the trace list / persistence update.
      const ta = annScope.getAnnotationById(id);
      if (ta) {
        const zot = embedToZotero(ta.object, pageHeight(pageIndex), propsRef.current.authorName);
        if (zot) propsRef.current.onSaveAnnotations?.([zot]);
      }
    },
    upsertAnnotations(anns) {
      for (const a of anns) {
        const h = pageHeight(a.position?.pageIndex ?? 0);
        const obj = zoteroToEmbed(a, h);
        if (!obj) continue;
        expectEcho(obj.id);
        if (pageOf.has(obj.id)) {
          const patch: Record<string, unknown> = { custom: obj.custom };
          const c = (obj as { color?: string }).color;
          if (c !== undefined) Object.assign(patch, markupColorPatch(c));
          if (typeof obj.contents === "string") patch.contents = obj.contents;
          annScope.updateAnnotation(pageOf.get(obj.id)!, obj.id, patch);
        } else {
          pageOf.set(obj.id, obj.pageIndex);
          annScope.importAnnotations([{ annotation: obj }]);
        }
      }
    },
    deleteAnnotation(id) {
      const pageIndex = pageOf.get(id);
      if (pageIndex === undefined) return;
      expectEcho(id);
      annScope.deleteAnnotation(pageIndex, id);
      pageOf.delete(id);
      propsRef.current.onDeleteAnnotations?.([id]);
    },
    selectAnnotation(id) {
      const pageIndex = pageOf.get(id);
      if (pageIndex !== undefined) annScope.selectAnnotation(pageIndex, id);
    },
    getState: currentState,
    _debug: {
      dumpEmbed: () => annScope.getAnnotations().map((t) => t.object),
      pageHeight,
      doc,
      registry,
      // Touch-routing introspection for the harness/Playwright: the setting, the
      // tool, what a finger would do, and whether the engine's pointer pipeline
      // is paused.
      routing: () => ({
        fingerDraw: pagedRef.current.fingerDraw,
        tool: pagedRef.current.tool,
        fingerPlan: planFinger(toolKindOf(pagedRef.current.tool), pagedRef.current.fingerDraw).action,
        paused: interaction.isPaused(),
      }),
      // Everything the settle judges a layout on, and its verdict. The failure
      // it guards against is invisible from outside — a clamped scroll and a
      // stale fit both look like ordinary numbers — so the numbers themselves
      // are what a Playwright check has to read.
      geometry: () => {
        const g = readGeometry();
        return g && { ...g, layout, gap: settleGap(g, layout), settled: geometrySettled(g, layout) };
      },
    } as EmbedPdfHandle["_debug"] & { registry: PluginRegistry },
  };

  perfMark("handleReady");
  propsRef.current.onReady?.(handle);
}
