// EmbedPDF engine adapter. A self-contained React viewer that renders a PDF
// from an in-memory buffer through @embedpdf's headless core + PdfiumEngine,
// and exposes the shell's functional needs through an imperative handle. The
// pdfium.wasm is self-hosted (/pdfium/pdfium.wasm) and font fallback is disabled
// so the build stays offline (no CDN fetch).
//
// This follows EmbedPDF's native API shape; the shell keeps persisting its
// original annotation JSON schema (position.rects in PDF points, bottom-left
// origin), and this module converts at the boundary via convert.ts.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import type { PluginRegistry } from "@embedpdf/core";
import type { PdfAnnotationObject, PdfDocumentObject, PdfEngine, Rect } from "@embedpdf/models";
import { getPdfiumEngine } from "./engine-singleton";

import { DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react";
import { ViewportPluginPackage, Viewport, useViewportElement } from "@embedpdf/plugin-viewport/react";
import { ScrollPluginPackage, Scroller } from "@embedpdf/plugin-scroll/react";
import type { ScrollCapability, ScrollScope } from "@embedpdf/plugin-scroll";
import { ScrollStrategy } from "@embedpdf/plugin-scroll";
import { RenderPluginPackage, RenderLayer } from "@embedpdf/plugin-render/react";
import { TilingPluginPackage, TilingLayer } from "@embedpdf/plugin-tiling/react";
import { ZoomPluginPackage, ZoomMode, ZoomGestureWrapper } from "@embedpdf/plugin-zoom/react";
import type { ZoomCapability } from "@embedpdf/plugin-zoom";
import type { ViewportCapability, ViewportPlugin } from "@embedpdf/plugin-viewport";
import { InteractionManagerPluginPackage, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react";
import type { InteractionManagerCapability } from "@embedpdf/plugin-interaction-manager";
import { SelectionPluginPackage, SelectionLayer } from "@embedpdf/plugin-selection/react";
import type { SelectionCapability } from "@embedpdf/plugin-selection";
import { HistoryPluginPackage } from "@embedpdf/plugin-history/react";
import { AnnotationPluginPackage, AnnotationLayer } from "@embedpdf/plugin-annotation/react";
import type { AnnotationCapability } from "@embedpdf/plugin-annotation";

import { embedToZotero, zoteroToEmbed, type ZoteroAnnotation } from "./convert";
import { SELECT_AFTER_CREATE, selectionChanged } from "./annotation-selection";
import {
  initGestureState,
  pageCenterAlign,
  stepGesture,
  type GestureCommand,
  type GestureInput,
  type GestureState,
} from "./paged-gesture";
import { LAYOUT_SETTINGS, readingPosition, type VisiblePage, type ZoomLock } from "./layout-modes";
import {
  centeredScrollX,
  geometrySettled,
  landedAt,
  pageTopScrollY,
  settleGap,
  type LayoutGeometry,
} from "./layout-settle";
import {
  planFinger,
  planPointer,
  pointerKindOf,
  routesAsContact,
  toolKindOf,
  pagedGestureTool,
  touchGestureMode,
  multiTouchLatch,
  pinchHandsOff,
  fingerLockAfterPen,
  fingerVerdict,
  centroidOf,
  shouldClearGestureSelection,
  shouldHandEngineTheUp,
  type PointerPlan,
} from "./touch-routing";
import {
  initVerticalState,
  stepVertical,
  verticalNeedsFrames,
  type VerticalCommand,
  type VerticalInput,
  type VerticalState,
} from "./vertical-gesture";
import {
  BAND_REST,
  bandAtRest,
  bandTransform,
  stepBandSpring,
  type BandOffset,
} from "./rubber-band";
import { INDICATOR_FADE_AFTER_MS, thumbMetrics } from "./scroll-indicator";
import {
  TouchDebugOverlay,
  isTouchDebugEnabled,
  publishTouchDebug,
  type TouchDebugContact,
} from "./touch-debug";

const DOC_ID = "main";

// Lightweight first-occurrence phase timing (cheap perf.now marks) for the load
// analysis. Harmless in prod; read via window.__epdfPerf.
function perfMark(name: string): void {
  const w = window as unknown as { __epdfPerf?: Record<string, number> };
  w.__epdfPerf ??= {};
  if (w.__epdfPerf[name] === undefined) w.__epdfPerf[name] = Math.round(performance.now());
}

// Resolve the app-level engine singleton (built once, reused across book opens)
// instead of usePdfiumEngine, which re-created + destroyed the wasm engine per
// mount. Never destroyed here — it lives for the app's lifetime.
function useSharedEngine(): { engine: PdfEngine | null; isLoading: boolean; error: Error | null } {
  const [engine, setEngine] = useState<PdfEngine | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let cancelled = false;
    getPdfiumEngine().then(
      (e) => !cancelled && setEngine(e),
      (e) => !cancelled && setError(e as Error),
    );
    return () => {
      cancelled = true;
    };
  }, []);
  return { engine, isLoading: !engine && !error, error };
}

// "pointer" is the tool group's all-unselected state (no annotation tool);
// "navlock" is the palm toggle, which activates no annotation tool either but
// puts the touch router in charge of every pointer.
export type EmbedTool = "pointer" | "navlock" | "highlight" | "underline" | "ink";
// Reading layout: "vertical" = the classic continuous vertical scroll; "paged" =
// one fit-page screen at a time, flipped horizontally by touch swipe (iPad).
export type EmbedLayout = "vertical" | "paged";

// A transient, non-persistent overlay marking an AI-cited quote on a page. Two
// tiers: `rects` draws a violet highlight over the located text (Tier A);
// `banner` shows the quote text as a chip near the page top when the text could
// not be located geometrically (Tier B). Never becomes a saved annotation.
export type QuoteHighlight =
  | { pageIndex: number; kind: "rects"; rects: Rect[] }
  | { pageIndex: number; kind: "banner"; quote: string };

// What highlightQuote takes: `searchText` is fed to the engine's text search
// (ideally the exact on-page substring), `displayText` is the model's quote
// shown in the Tier-B banner fallback.
export interface QuoteRequest {
  searchText: string;
  displayText: string;
}

export interface EmbedViewState {
  pageIndex: number;
  zoom: number;
  // Top-left of the visible region within the current page, in unscaled page
  // coordinates (top-left origin) — enables exact in-page position restore.
  pageX?: number;
  pageY?: number;
  // Reading layout (per book). Absent restores to vertical.
  layout?: EmbedLayout;
}

// Viewport-space rect of an annotation, reported when it gets selected — the
// precise anchor for the shell's popup/bubble.
export interface AnnotationAnchor {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface EmbedViewStats {
  pageIndex: number;
  pagesCount: number;
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  layout: EmbedLayout;
}

export interface EmbedPdfHandle {
  setTool(tool: EmbedTool): void;
  // The "draw with your finger" setting. Off (the default) means a finger only
  // ever moves the page and the stylus does the marking.
  setFingerDraw(on: boolean): void;
  setColor(color: string): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  // Switch between vertical continuous scroll and paged horizontal flip.
  setLayout(mode: EmbedLayout): void;
  navigateToPage(pageIndex: number): void;
  navigateToAnnotation(id: string): void;
  // Scroll to the page and show a transient violet overlay on the cited quote.
  // Resolves true when the quote was located and highlighted (Tier A), false
  // when it fell back to the quote banner (Tier B).
  highlightQuote(pageIndex: number, req: QuoteRequest): Promise<boolean>;
  clearQuoteHighlight(): void;
  updateAnnotation(id: string, patch: { color?: string; comment?: string; starred?: boolean }): void;
  // Host-driven upsert of full zotero annotations (reflect host edits / import
  // new). Does not re-emit onSaveAnnotations (host is the source of truth).
  upsertAnnotations(anns: ZoteroAnnotation[]): void;
  deleteAnnotation(id: string): void;
  selectAnnotation(id: string): void;
  getState(): EmbedViewState;
  // Spike/introspection surface: closes items 3 (coords) and 7 (custom) live.
  _debug: {
    dumpEmbed(): PdfAnnotationObject[];
    pageHeight(pageIndex: number): number;
    doc(): PdfDocumentObject | null;
  };
}

export interface EmbedPdfViewProps {
  buffer: ArrayBuffer;
  annotations?: ZoteroAnnotation[];
  authorName?: string;
  initialViewState?: EmbedViewState | null;
  onReady?: (handle: EmbedPdfHandle) => void;
  onError?: (e: Error) => void;
  onSaveAnnotations?: (anns: ZoteroAnnotation[]) => void;
  onDeleteAnnotations?: (ids: string[]) => void;
  onSelectAnnotation?: (id: string | null) => void;
  // Fired (after onSelectAnnotation) with the selected annotation's measured
  // viewport rect, via the AnnotationLayer selectionMenu slot. Once per
  // selection — re-renders while selected do not re-fire.
  onAnnotationAnchor?: (id: string, rect: AnnotationAnchor) => void;
  onViewState?: (s: EmbedViewState) => void;
  onViewStats?: (s: EmbedViewStats) => void;
  // Fired when the transient AI-quote overlay appears (true) or is dismissed
  // (false), so the shell can route Escape to dismiss it.
  onQuoteHighlight?: (active: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
}

// Non-interactive overlay for the transient AI-cited-quote highlight. Rendered
// inside each page box; only paints on the cited page. pointerEvents:none so a
// click on it still reaches the selection layer's empty-space handler (dismiss).
function QuoteHighlightLayer(props: {
  pageIndex: number;
  pageWidthPx: number;
  pageSize: { width: number; height: number } | undefined;
  hl: QuoteHighlight | null;
}): ReactNode {
  const { pageIndex, pageWidthPx, pageSize, hl } = props;
  if (!hl || hl.pageIndex !== pageIndex) return null;
  if (hl.kind === "rects") {
    if (!pageSize || pageSize.width <= 0) return null;
    const scale = pageWidthPx / pageSize.width;
    return (
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", zIndex: 5 }}>
        {hl.rects.map((r, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${r.origin.x * scale}px`,
              top: `${r.origin.y * scale}px`,
              width: `${r.size.width * scale}px`,
              height: `${r.size.height * scale}px`,
              backgroundColor: "#4a3a9e",
              opacity: 0.24,
              borderRadius: "2px",
            }}
          />
        ))}
      </div>
    );
  }
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        pointerEvents: "none",
        zIndex: 5,
      }}
    >
      <div
        style={{
          margin: "10px 16px",
          maxWidth: "80%",
          padding: "6px 10px",
          borderRadius: "8px",
          backgroundColor: "#efecfb",
          color: "#4a3a9e",
          fontSize: "13px",
          lineHeight: 1.4,
          boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            opacity: 0.7,
            marginRight: "6px",
          }}
        >
          cited by AI
        </span>
        “{hl.quote}”
      </div>
    </div>
  );
}

// Rendered into the AnnotationLayer's selectionMenu slot: measures the menu
// wrapper (absolutely positioned over the selected annotation) and reports the
// annotation's viewport rect. Mount-only by design — a re-render while the same
// annotation stays selected must not re-open a popup the user dismissed.
function AnchorProbe(props: { id: string; onAnchor: (id: string, rect: AnnotationAnchor) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const r = el.getBoundingClientRect();
    props.onAnchor(props.id, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.id]);
  return <div ref={ref} style={{ display: "none" }} />;
}

// Long press (ms) before a stationary finger in paged mode is handed to native
// text selection instead of being watched for a page swipe.
const PAGED_LONG_PRESS_MS = 450;

// Live gesture context, shared by a ref between the imperative engine wiring
// (which fills in the engine handles) and the PagedGestures touch component
// (which reads the current mode each event). A ref so mode changes never
// re-render the memoized engine subtree.
interface PagedGestureCtx {
  paged: boolean;
  tool: EmbedTool;
  zoomedIn: boolean;
  // The "draw with your finger" setting, mirrored here so the touch router can
  // read it synchronously on every event. Off by default: the finger only moves
  // the page and the stylus marks it.
  fingerDraw: boolean;
  scroll: ScrollScope | null;
  interaction: InteractionManagerCapability | null;
  // Used by the touch router to drop a text selection its own gesture caused.
  selection: SelectionCapability | null;
  // Set by the touch router so setLayout can toggle the viewport's touch-action
  // (paged locks native pan/zoom; vertical restores it).
  setTouchLock: ((locked: boolean) => void) | null;
  // The scroll container itself, shared out by the touch router that grabbed
  // it. A layout switch has to read the element's own scrollWidth/scrollHeight:
  // the viewport plugin's cached metrics come from a ResizeObserver on the
  // container, which never fires when only the content inside it changes size,
  // so they say nothing about whether the re-layout has reached the DOM.
  viewport: HTMLElement | null;
  // The scroll indicator's thumb, which lives outside the scroll container so
  // the rubber band does not carry it off the edge. Painted by the router on
  // every scroll — including the engine's own programmatic ones.
  indicator: HTMLElement | null;
  // Set by the touch router so setLayout can drop everything the old layout had
  // in flight (drag, rubber band, inertia, captured pointer, paused engine)
  // before the new layout's geometry lands.
  resetGestures: (() => void) | null;
  // Paged mode's only way to change page: centres the target page and re-locks
  // fit-page, so a turn always lands on one whole page (the geometry needs the
  // zoom scope, which lives in the imperative wiring).
  turnToPage: ((pageNumber: number) => void) | null;
}

// Touch input router: a zero-size child inside the Viewport that grabs the
// scroll container (via the viewport-element context) and routes pointer events
// by device type and finger count — decisions CSS touch-action cannot make (it
// cannot tell pen from finger, or one finger from two).
//
// Which pointers this router drives as its own contacts is routesAsContact's call:
// fingers always, the stylus only while the navigation lock is on (there it is
// a finger in every respect), the mouse never — so the desktop is untouched.
// Everything else falls straight through to the engine's drawing / selection
// paths.
//
// Contact count decides the gesture (touch-routing.ts holds the table):
//   1  the single-pointer machines below (scroll / draw / page flip);
//   2  pinch — zoom is the engine's own ZoomGestureWrapper, which drives itself
//      off raw touch events and never consults the interaction manager, so it
//      keeps working while every finger pointer event is eaten here; the pan
//      that goes with it follows the two-finger centroid;
//   3+ swallowed whole, reserved for a future gesture.
// A gesture that ever had two fingers stays locked until the last finger lifts,
// so 2 -> 3 -> 2 is one gesture and the leftover finger never becomes a scroll.
//
// Blocking is per pointer (stopPropagation in the capture phase), not the
// interaction manager's global pause: pause would also stop a pen mid-stroke,
// and the resting hand has to go dead while the pen keeps drawing (the pen lock
// above does that). Invariant: a finger whose pointerdown reached the engine
// always gets its pointerup too, or the engine's per-page selection handler
// keeps a stale text anchor.
//
// There is no palm rejection: iPadOS withholds touch from the page while the
// Pencil is down and reports no usable contact geometry, so palm suppression is
// neither possible nor needed here (docs/pitfall/39).
//
// Both layouts get the single pointer's job from the same planPointer call, so
// the two branches cannot drift apart on the routing policy or on when the
// engine is shut off (an annotation tool pauses it at pointerdown, before the
// stroke's lead-in can leave ink; with no drawing tool active the pause waits
// for the commit so a stationary tap still reaches the engine).
//
// Vertical (continuous) mode — the main path: a finger planned as "scroll" runs
// the pure vertical machine (vertical-gesture.ts), which captures the pointer,
// follows the finger by setting scrollTop/scrollLeft and coasts on release.
// Because the page divs carry touch-action:none in every mode, native scroll is
// impossible over a page, so the scroll is driven in JS. A finger planned as
// "draw" (annotation tool, no stylus seen) is left alone and reaches the
// annotation layer.
//
// Paged (horizontal flip) mode: runs the pure gesture machine (paged-gesture.ts)
// on finger pointers — follow-finger drags set scrollLeft, a committed turn goes
// through turnToPage (centre the page, re-lock fit-page), a magnified page pans,
// and a swipe with nowhere to go rubber-bands instead of freezing.
function TouchInputRouter({
  documentId,
  ctx,
}: {
  documentId: string;
  ctx: React.MutableRefObject<PagedGestureCtx>;
}): ReactNode {
  // The scroll container the Viewport mounted (shared through context). Its
  // .current fills a frame or two after this effect first runs, so poll for it.
  const vpRef = useViewportElement();
  useEffect(() => {
    let raf = 0;
    let detach: (() => void) | null = null;
    const waitForViewport = () => {
      const el = vpRef?.current;
      if (el) {
        detach = attach(el);
        return;
      }
      raf = requestAnimationFrame(waitForViewport);
    };

    const attach = (el: HTMLDivElement): (() => void) => {
      // --- contact bookkeeping (shared by both layout machines) -----------
      // Live contacts this router drives, in arrival order (fingers always, and
      // the stylus under the navigation lock). Its size is the finger count the
      // gesture rules run on. Each carries the plan it landed with, so a tool
      // change mid-gesture can never split one pointer's lifetime across two
      // policies.
      const fingers = new Map<number, { x: number; y: number; plan: PointerPlan }>();
      // Fingers whose pointerdown the engine saw, so their pointerup is let
      // through even if the gesture has since been taken over — and, when the
      // router takes the gesture over instead, so the engine can be handed that
      // up itself. The element is the one the down was dispatched on, which is
      // where the synthetic up has to go.
      const engineSaw = new Map<
        number,
        { target: EventTarget; type: string; x: number; y: number }
      >();
      // True only while the synthetic pointerup below is being dispatched: it
      // travels through this router's own listeners on the way to the page.
      let synthesizing = false;
      // Every live contact (pen included), for the on-device probe only.
      const contacts = new Map<number, TouchDebugContact>();
      // Latched once a second finger lands, cleared when the glass is empty.
      let multiTouch = false;
      // Latched when a pen lands on top of resting fingers: they are dead until
      // they all lift.
      let penLock = false;
      // Whether a text selection was already on screen when this gesture began
      // (a pen selection with its AI menu open must survive a finger scroll).
      let hadSelectionAtStart = false;
      // Centroid the two-finger pan measures from.
      let panBase: { x: number; y: number } | null = null;

      // --- paged (horizontal flip) gesture machine state ------------------
      let state: GestureState = initGestureState();
      let captured = false;
      let capturedId: number | null = null;
      let enginePaused = false;
      let dragStartScrollLeft = 0;
      let dragStartPage = 1;
      let lpTimer = 0;
      // Rubber band: a CSS translate on the scroll content, sprung back by rAF.
      let band: BandOffset = BAND_REST;
      let bandRaf = 0;

      // --- vertical follow-finger scroll state ----------------------------
      // The machine holds the phase, the follow origin, the velocity, the
      // inertia and the overscroll; this side owns only the rAF that drives
      // them forward and the two elements they are painted on.
      let vState: VerticalState = initVerticalState();
      let flingRaf = 0;
      let flingLast = 0;
      // Fingers whose gesture this router took over mid-flight (the survivor of
      // a pinch): the engine never saw their pointerdown, so it must not see
      // their pointerup either.
      const orphaned = new Set<number>();

      const clearLp = () => {
        if (lpTimer) {
          window.clearTimeout(lpTimer);
          lpTimer = 0;
        }
      };
      // The engine's pointer pipeline is paused only for the single-finger
      // paths that need it (an annotation tool must not start a stroke under a
      // scrolling finger). Everything multi-touch blocks per pointer instead.
      const pauseEngine = () => {
        if (!enginePaused) {
          ctx.current.interaction?.pause();
          enginePaused = true;
        }
      };
      const resumeEngine = () => {
        if (enginePaused) {
          ctx.current.interaction?.resume();
          enginePaused = false;
        }
      };
      const releaseCapture = () => {
        captured = false;
        if (capturedId !== null) {
          try {
            el.releasePointerCapture(capturedId);
          } catch {
            // The pointer may already be gone; ignore.
          }
          capturedId = null;
        }
      };
      // --- paged rubber band ------------------------------------------------
      // Offset and spring physics live in rubber-band.ts; this side owns the
      // element and the rAF.
      const bandTarget = (): HTMLElement | null => el.firstElementChild as HTMLElement | null;
      const paintBand = () => {
        const t = bandTarget();
        if (!t) return;
        t.style.transform = bandTransform(band);
      };
      const cancelBandSpring = () => {
        if (bandRaf) {
          cancelAnimationFrame(bandRaf);
          bandRaf = 0;
        }
      };
      const setBand = (x: number, y: number) => {
        cancelBandSpring();
        band = { x, y };
        paintBand();
      };
      const clearBand = () => {
        cancelBandSpring();
        if (bandAtRest(band)) return;
        band = BAND_REST;
        paintBand();
      };
      const springBand = () => {
        cancelBandSpring();
        let last = performance.now();
        const step = (now: number) => {
          const dt = now - last;
          last = now;
          band = stepBandSpring(band, dt);
          paintBand();
          if (bandAtRest(band)) {
            bandRaf = 0;
            return;
          }
          bandRaf = requestAnimationFrame(step);
        };
        bandRaf = requestAnimationFrame(step);
      };

      // --- vertical rubber band --------------------------------------------
      // Paged bands the scroll CONTENT; vertical cannot (docs/pitfall/45): a
      // translate on the content changes the container's scrollable overflow,
      // and at the end of a scrollable document the browser's own re-clamp of
      // scrollTop cancels the offset exactly. The scroll container itself is
      // moved instead — its geometry is unaffected by its own transform — and
      // the wrapper around it clips the gap that opens up.
      let vBandY = 0;
      let vBandX = 0;
      const setViewportBand = (x: number, y: number) => {
        if (x === vBandX && y === vBandY) return;
        vBandX = x;
        vBandY = y;
        // Same rule as the paged band: a plain style write, never a CSS
        // transition (docs/pitfall/41), and cleared to "" at rest.
        el.style.transform = bandTransform({ x, y });
      };
      const clearViewportBand = () => setViewportBand(0, 0);

      // --- scroll indicator -------------------------------------------------
      // Fades in on movement and out again when it stops. Driven off the
      // container's own scroll event, so it follows a page jump and the
      // engine's smooth scrolls as well as a finger.
      let indicatorTimer = 0;
      const hideIndicator = () => {
        indicatorTimer = 0;
        const bar = ctx.current.indicator;
        if (bar) bar.style.opacity = "0";
      };
      const paintIndicator = () => {
        const bar = ctx.current.indicator;
        if (!bar) return;
        const m = thumbMetrics(el.scrollTop, el.clientHeight, el.scrollHeight);
        if (!m) {
          bar.style.opacity = "0";
          return;
        }
        bar.style.height = `${m.size}px`;
        bar.style.transform = `translateY(${m.offset}px)`;
        bar.style.opacity = "1";
        if (indicatorTimer) window.clearTimeout(indicatorTimer);
        indicatorTimer = window.setTimeout(hideIndicator, INDICATOR_FADE_AFTER_MS);
      };

      const setTouchLock = (locked: boolean) => {
        el.style.touchAction = locked ? "none" : "";
        // Switching layout mid-gesture must not leave a band offset behind.
        clearBand();
        clearViewportBand();
      };
      ctx.current.setTouchLock = setTouchLock;
      ctx.current.viewport = el;
      setTouchLock(ctx.current.paged);

      // --- selection hygiene ----------------------------------------------
      const hasSelection = (): boolean => {
        try {
          return (ctx.current.selection?.getBoundingRects(documentId).length ?? 0) > 0;
        } catch {
          return false;
        }
      };
      // Drop a selection this finger gesture caused on its way in: the engine
      // can start a text drag inside the few px before the gesture is taken
      // over. A selection that was already there is left alone.
      const dropGestureSelection = () => {
        if (shouldClearGestureSelection(hadSelectionAtStart, hasSelection())) {
          ctx.current.selection?.clear(documentId);
        }
      };
      // Hand the engine the pointerup it is owed for a pointer this router is
      // taking over. Without it the engine's per-page text handler keeps the
      // anchor it armed at pointerdown — the capture retargets every later event
      // to the viewport, so its own up never comes — and the next move it does
      // see selects everything between that stale anchor and the pointer
      // (docs/pitfall/38). Dropping the selection does not do this: that clears
      // the plugin, not the handler holding the anchor.
      const handEngineTheUp = (id: number) => {
        const seen = engineSaw.get(id);
        if (!seen || !shouldHandEngineTheUp(seen !== undefined, enginePaused)) return;
        engineSaw.delete(id);
        synthesizing = true;
        try {
          seen.target.dispatchEvent(
            new PointerEvent("pointerup", {
              pointerId: id,
              pointerType: seen.type,
              bubbles: true,
              cancelable: true,
              clientX: seen.x,
              clientY: seen.y,
            }),
          );
        } finally {
          synthesizing = false;
        }
      };

      // --- paged apply / feed ---------------------------------------------
      const apply = (cmds: GestureCommand[]) => {
        const scroll = ctx.current.scroll;
        for (const c of cmds) {
          if (c.type === "capture") {
            captured = true;
            capturedId = c.id;
            // Before the pause and the capture, both of which cut the engine off
            // from this pointer for good.
            handEngineTheUp(c.id);
            try {
              el.setPointerCapture(c.id);
            } catch {
              // Best effort — the pause below is the real selection guard.
            }
            pauseEngine();
            dropGestureSelection();
            dragStartScrollLeft = el.scrollLeft;
            dragStartPage = scroll?.getCurrentPage() ?? 1;
          } else if (c.type === "dragMove") {
            el.scrollLeft = dragStartScrollLeft - c.dx;
          } else if (c.type === "panMove") {
            el.scrollLeft -= c.dx;
            el.scrollTop -= c.dy;
          } else if (c.type === "bandMove") {
            setBand(c.dx, c.dy);
          } else if (c.type === "bandEnd") {
            springBand();
          } else if (c.type === "dragEnd") {
            const total = scroll?.getTotalPages() ?? 1;
            const target = Math.min(Math.max(dragStartPage + c.turn, 1), total);
            // Always through turnToPage: it centres the page and re-locks
            // fit-page, so a turn out of a temporary magnification lands on one
            // whole page again.
            ctx.current.turnToPage?.(target);
            captured = false;
          }
        }
      };

      const feed = (input: GestureInput, e?: Event) => {
        const scroll = ctx.current.scroll;
        const page = scroll?.getCurrentPage() ?? 1;
        const total = scroll?.getTotalPages() ?? 1;
        const r = stepGesture(state, input, {
          tool: pagedGestureTool(toolKindOf(ctx.current.tool), ctx.current.fingerDraw),
          zoomedIn: ctx.current.zoomedIn,
          width: el.clientWidth || window.innerWidth,
          canTurnPrev: page > 1,
          canTurnNext: page < total,
          canPanLeft: el.scrollLeft > 1,
          canPanRight: el.scrollLeft < maxScrollLeft() - 1,
        });
        state = r.state;
        if (r.commands.some((c) => c.type === "capture")) clearLp();
        apply(r.commands);
        if (captured && e && e.cancelable) e.preventDefault();
        if (state.phase === "idle" || state.phase === "off") {
          resumeEngine();
          releaseCapture();
        }
      };

      // --- vertical scroll helpers ----------------------------------------
      const maxScrollTop = () => Math.max(0, el.scrollHeight - el.clientHeight);
      const clampTop = (v: number) => Math.min(Math.max(v, 0), maxScrollTop());
      const maxScrollLeft = () => Math.max(0, el.scrollWidth - el.clientWidth);
      const clampLeft = (v: number) => Math.min(Math.max(v, 0), maxScrollLeft());
      const cancelFlingRaf = () => {
        if (flingRaf) {
          cancelAnimationFrame(flingRaf);
          flingRaf = 0;
        }
      };

      // --- vertical apply / feed -------------------------------------------
      // The live scroll geometry the machine measures the follow against and
      // clamps both the follow and the coast to.
      const verticalGeometry = () => ({
        scrollTop: el.scrollTop,
        scrollLeft: el.scrollLeft,
        maxScrollTop: maxScrollTop(),
        maxScrollLeft: maxScrollLeft(),
      });
      const applyVertical = (cmds: VerticalCommand[], e?: PointerEvent) => {
        for (const c of cmds) {
          if (c.type === "pause") {
            pauseEngine();
          } else if (c.type === "resume") {
            resumeEngine();
          } else if (c.type === "releaseEnginePointer") {
            handEngineTheUp(c.id);
          } else if (c.type === "dropSelection") {
            dropGestureSelection();
          } else if (c.type === "capture") {
            try {
              el.setPointerCapture(c.id);
            } catch {
              // Best effort — the pause is the real draw guard.
            }
          } else if (c.type === "releaseCapture") {
            if (c.id !== null) {
              try {
                el.releasePointerCapture(c.id);
              } catch {
                // The pointer may already be gone; ignore.
              }
            }
          } else if (c.type === "scrollTo") {
            el.scrollTop = c.top;
            el.scrollLeft = c.left;
          } else if (c.type === "band") {
            setViewportBand(c.x, c.y);
          } else if (c.type === "preventDefault") {
            if (e?.cancelable) e.preventDefault();
          } else if (c.type === "startFling") {
            cancelFlingRaf();
            flingLast = performance.now();
            flingRaf = requestAnimationFrame(flingFrame);
          } else if (c.type === "stopFling") {
            cancelFlingRaf();
          }
        }
      };
      const feedVertical = (input: VerticalInput, e?: PointerEvent) => {
        const r = stepVertical(vState, input, verticalGeometry());
        vState = r.state;
        applyVertical(r.commands, e);
      };
      // One frame of whatever outlives the finger — the inertia, the rubber
      // band springing home, or the inertia being absorbed by it. The machine
      // decides when there is nothing left to do; this side only keeps asking
      // for frames while there is (hoisted so applyVertical can schedule it).
      function flingFrame(now: number): void {
        flingRaf = 0;
        const dt = now - flingLast;
        flingLast = now;
        feedVertical({ type: "flingFrame", dt });
        if (verticalNeedsFrames(vState)) flingRaf = requestAnimationFrame(flingFrame);
      }
      // Everything the two one-finger machines hold: inertia, the long-press
      // timer, the paged machine's phase, the rubber band, the pointer capture
      // and the engine pause. Dropped as one unit, unconditionally — a caller
      // that reset half of it (or reset the paged machine only while paged was
      // still the live layout) would leave a phase behind that the next gesture
      // inherits.
      const resetGestures = () => {
        clearLp();
        state = initGestureState();
        captured = false;
        // A band in flight is dropped outright: leaving a transform on the
        // element the pinch preview also writes would offset the zoom anchor.
        clearBand();
        releaseCapture();
        orphaned.clear();
        feedVertical({ type: "reset" });
        clearViewportBand();
      };
      ctx.current.resetGestures = resetGestures;

      // The one-finger gesture loses the glass (a second finger, a pen). Both
      // machines go idle and the engine gets its pipeline back
      // — from here on the fingers are blocked one pointer at a time, which
      // leaves a pen free to keep drawing.
      const suspendFingerGesture = () => {
        clearLp();
        if (
          ctx.current.paged &&
          state.primary !== null &&
          (state.phase === "drag" || state.phase === "pan" || state.phase === "band")
        ) {
          // Spring the drag back before dropping it, so the page does not stay
          // parked half-turned.
          feed({ type: "pointercancel", id: state.primary });
        }
        resetGestures();
      };
      // The pinch is down to its last finger. That finger keeps moving the page
      // as a one-finger pan, from where it is — no jump, and no waiting for the
      // glass to empty. The gesture is synthesized, not replayed: the machine
      // gets a pointerdown at the finger's live position with `takeover`, which
      // skips the slop and starts following on the next move.
      const handOffToOneFinger = () => {
        const id = [...fingers.keys()][0];
        const f = fingers.get(id);
        if (f === undefined) return;
        const plan = f.plan;
        // With "draw with your finger" on, a lone finger marks the page; it has
        // no page-moving gesture to inherit, and the engine never saw its down,
        // so it stays out of the way until it lifts.
        if (plan.action !== "scroll") return;
        // The pinch already dropped whatever the fingers selected on the way in;
        // whatever is on screen now predates this gesture and must survive it.
        hadSelectionAtStart = hasSelection();
        // The engine never saw this pointer's down (the pinch swallowed it), so
        // it must not see its up either.
        orphaned.add(id);
        const t = performance.now();
        if (ctx.current.paged) {
          feed({ type: "pointerdown", id, x: f.x, y: f.y, t, takeover: true });
        } else {
          feedVertical({
            type: "pointerdown",
            id,
            x: f.x,
            y: f.y,
            t,
            plan,
            takeover: true,
          });
        }
      };
      // Two-finger pan: the content follows the centroid of the two fingers.
      // Zoom is the engine's wrapper; this only moves the scroll container, and
      // the wrapper resolves its zoom anchor against the live scroll position
      // when the pinch commits, so the two compose.
      const resetPanBase = () => {
        panBase = null;
      };
      const panStep = () => {
        const c = centroidOf([...fingers.values()]);
        if (!c) return;
        if (panBase) {
          el.scrollTop = clampTop(el.scrollTop - (c.y - panBase.y));
          el.scrollLeft = clampLeft(el.scrollLeft - (c.x - panBase.x));
        }
        panBase = c;
      };
      // --- probe -----------------------------------------------------------
      const publishDebug = () => {
        if (!isTouchDebugEnabled()) return;
        publishTouchDebug({
          contacts: [...contacts.values()],
          fingers: fingers.size,
          mode: touchGestureMode(fingers.size),
          multi: multiTouch,
          penLock,
          fingerDraw: ctx.current.fingerDraw,
          // What the next finger to land will do, from the same routing table
          // the router itself uses — the one number that says whether a dead
          // swipe is a routing verdict or something further down.
          fingerPlan: planFinger(toolKindOf(ctx.current.tool), ctx.current.fingerDraw).action,
          navLock: toolKindOf(ctx.current.tool) === "navlock",
        });
      };
      const trackContact = (e: PointerEvent) => {
        contacts.set(e.pointerId, {
          id: e.pointerId,
          type: e.pointerType,
          width: e.width,
          height: e.height,
        });
      };

      // --- shared dispatch ------------------------------------------------
      // Eat the event here: the engine's page providers sit below this capture
      // listener, so stopping propagation is a per-contact block (unlike the
      // interaction manager's pause, which is global and would freeze the pen).
      const swallow = (e: PointerEvent) => {
        e.stopPropagation();
      };

      // A stylus the router does not drive outranks every finger on the glass:
      // the finger scroll and its fling stop dead, and the fingers already down
      // go inert until they lift, so the hand a user writes with cannot
      // interrupt the stroke. Under the navigation lock the stylus is a contact
      // like any other and never gets here.
      const onPenDown = (e: PointerEvent) => {
        trackContact(e);
        feedVertical({ type: "cancelFling" });
        if (fingers.size > 0) suspendFingerGesture();
        penLock = fingerLockAfterPen(penLock, true, fingers.size);
        resetPanBase();
        publishDebug();
      };

      const onDown = (e: PointerEvent) => {
        if (synthesizing) return;
        const kind = pointerKindOf(e.pointerType);
        const tool = toolKindOf(ctx.current.tool);
        // Whether this pointer becomes one of our contacts is latched here, by
        // the `fingers` map: toggling the navigation lock mid-gesture can never
        // split one pointer's lifetime across the two code paths.
        // One plan for both layouts and both devices: what this pointer is for,
        // whether the engine has to be shut off before it can mark the page, and
        // whether the engine may watch it move at all.
        const plan = planPointer(tool, kind, ctx.current.fingerDraw);
        if (!routesAsContact(tool, kind)) {
          if (kind === "pen") onPenDown(e);
          return;
        }
        fingers.set(e.pointerId, { x: e.clientX, y: e.clientY, plan });
        trackContact(e);
        const wasMulti = multiTouch;
        multiTouch = multiTouchLatch(multiTouch, fingers.size);
        publishDebug();
        if (fingerVerdict(touchGestureMode(fingers.size), multiTouch, penLock) === "swallow") {
          swallow(e);
          if (!wasMulti) {
            // The one-finger machine hands the gesture over. Entering a pinch
            // also drops whatever that finger selected on the way in; a finger
            // landing under a working pen must not touch the selection.
            suspendFingerGesture();
            if (multiTouch) dropGestureSelection();
          }
          resetPanBase();
          return;
        }
        hadSelectionAtStart = hasSelection();
        if (ctx.current.paged) {
          if (plan.pauseAtDown) pauseEngine();
          feed({ type: "pointerdown", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp });
          clearLp();
          // The long press hands off to native text selection: only with no tool
          // selected, at fit-page (an annotation tool's engine pipeline is
          // already shut off, the navigation lock selects nothing, a zoomed page
          // is panning).
          if (plan.longPressSelect && !ctx.current.zoomedIn) {
            const id = e.pointerId;
            lpTimer = window.setTimeout(() => feed({ type: "longpress", id }), PAGED_LONG_PRESS_MS);
          }
        } else {
          // The vertical machine takes the plan with the pointer: a "draw" plan
          // never enters it, an annotation tool's plan pauses the engine there.
          feedVertical({
            type: "pointerdown",
            id: e.pointerId,
            x: e.clientX,
            y: e.clientY,
            t: e.timeStamp,
            plan,
          });
        }
        // Only a down the engine actually received owes it an up.
        if (!enginePaused && e.target) {
          engineSaw.set(e.pointerId, {
            target: e.target,
            type: e.pointerType,
            x: e.clientX,
            y: e.clientY,
          });
        }
      };

      const onMove = (e: PointerEvent) => {
        if (synthesizing) return;
        const f = fingers.get(e.pointerId);
        // Not a contact this router drives: a mouse, a stylus outside the
        // navigation lock, or a finger that landed before this listener existed.
        if (!f) return;
        f.x = e.clientX;
        f.y = e.clientY;
        trackContact(e);
        publishDebug();
        const mode = touchGestureMode(fingers.size);
        if (fingerVerdict(mode, multiTouch, penLock) === "swallow") {
          swallow(e);
          if (mode === "pinch" && !penLock) panStep();
          return;
        }
        // Under the navigation lock the engine never sees the drag, so it cannot
        // pull a text selection along behind the scroll. Its pointerdown and
        // pointerup still go through, so a tap under the lock still works.
        if (!f.plan.engineMayDrag) swallow(e);
        if (ctx.current.paged) {
          feed({ type: "pointermove", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp }, e);
        } else {
          feedVertical(
            { type: "pointermove", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp },
            e,
          );
        }
      };

      const onEnd = (e: PointerEvent, cancelled: boolean) => {
        if (synthesizing) return;
        const wasContact = contacts.delete(e.pointerId);
        const leaving = fingers.get(e.pointerId);
        const known = fingers.delete(e.pointerId);
        if (!known && pointerKindOf(e.pointerType) !== "touch") {
          // A pointer this router never drove (a mouse, or a stylus outside the
          // navigation lock): the engine owns its whole lifetime.
          if (wasContact) publishDebug();
          return;
        }
        resetPanBase();
        const owedToEngine = engineSaw.delete(e.pointerId);
        // A pinch coming down to one finger hands that finger the gesture right
        // here: from the next event on it is an ordinary one-finger contact.
        // The finger that just lifted is still judged as part of the pinch
        // (wasMulti), so the engine does not get its bare pointerup.
        const wasMulti = multiTouch;
        if (pinchHandsOff(multiTouch, fingers.size, penLock)) {
          multiTouch = false;
          handOffToOneFinger();
        }
        // A pointer this router took over mid-gesture: the engine has no
        // matching down for it, so it must not see the up either.
        if (orphaned.delete(e.pointerId)) swallow(e);
        if (!known) {
          swallow(e);
        } else if (penLock) {
          // A pen is working: nothing from the resting hand reaches the engine.
          // Its handlers track no pointerId, so even a bare pointerup would end
          // the stroke the pen is in the middle of.
          swallow(e);
        } else if (wasMulti) {
          // Taken over mid-gesture: the engine only gets this up if it saw the
          // matching down, so its selection handler cannot keep a stale anchor.
          if (!owedToEngine) swallow(e);
        } else if (ctx.current.paged) {
          clearLp();
          feed(
            cancelled
              ? { type: "pointercancel", id: e.pointerId }
              : { type: "pointerup", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp },
            e,
          );
        } else {
          feedVertical(
            cancelled
              ? { type: "pointercancel", id: e.pointerId }
              : // The release position matters: the last few px between the
                // final pointermove and the lift are part of the throw.
                { type: "pointerup", id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp },
          );
        }
        // Belt to the navigation lock's braces: the engine saw this pointer's
        // down even though it never saw it move, and a bare down can still leave
        // a caret behind. A selection that predates the gesture is kept.
        if (leaving && !leaving.plan.engineMayDrag) dropGestureSelection();
        multiTouch = multiTouchLatch(multiTouch, fingers.size);
        penLock = fingerLockAfterPen(penLock, false, fingers.size);
        if (fingers.size === 0) engineSaw.clear();
        publishDebug();
      };
      const onUp = (e: PointerEvent) => onEnd(e, false);
      const onCancel = (e: PointerEvent) => onEnd(e, true);
      // The synthetic up is meant for the page below and is stopped here on its
      // way back out, so nothing outside the viewport takes it for a real lift
      // while the finger is still down.
      const containSynthetic = (e: PointerEvent) => {
        if (synthesizing) e.stopPropagation();
      };

      // Capture phase: see the pointer before the page's PagePointerProvider, and
      // keep receiving moves after it (the container is an ancestor of the page,
      // so events still travel through it even once a page captures the pointer).
      el.addEventListener("pointerdown", onDown, { capture: true });
      el.addEventListener("pointermove", onMove, { capture: true, passive: false });
      el.addEventListener("pointerup", onUp, { capture: true });
      el.addEventListener("pointercancel", onCancel, { capture: true });
      el.addEventListener("pointerup", containSynthetic);
      el.addEventListener("scroll", paintIndicator, { passive: true });
      return () => {
        clearLp();
        if (indicatorTimer) window.clearTimeout(indicatorTimer);
        hideIndicator();
        el.removeEventListener("scroll", paintIndicator);
        clearBand();
        releaseCapture();
        feedVertical({ type: "reset" });
        clearViewportBand();
        ctx.current.setTouchLock = null;
        ctx.current.resetGestures = null;
        ctx.current.viewport = null;
        el.style.touchAction = "";
        el.style.transform = "";
        // A settle may have been holding the page area back when the router let
        // go of the element (docs/pitfall/63). Nothing else would clear it.
        el.style.visibility = "";
        el.removeEventListener("pointerdown", onDown, { capture: true });
        el.removeEventListener("pointermove", onMove, { capture: true });
        el.removeEventListener("pointerup", onUp, { capture: true });
        el.removeEventListener("pointercancel", onCancel, { capture: true });
        el.removeEventListener("pointerup", containSynthetic);
      };
    };

    waitForViewport();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      detach?.();
    };
  }, [documentId, ctx, vpRef]);
  return null;
}

export default function EmbedPdfView(props: EmbedPdfViewProps): ReactNode {
  // The direct engine runs PDFium on the main thread; the worker engine hangs
  // on openDocument (pitfall 21). iOS/WKWebView will need its own engine-mode
  // decision when that platform lands.
  perfMark("mount");
  const { engine, isLoading, error } = useSharedEngine();
  if (engine) perfMark("engineReady");
  const propsRef = useRef(props);
  propsRef.current = props;

  // Transient AI-cited-quote overlay state. Held here (not in the annotation
  // store) so it never persists. The setter is exposed to the imperative
  // wiring through a ref.
  const [quoteHl, setQuoteHl] = useState<QuoteHighlight | null>(null);
  const setQuoteHlRef = useRef(setQuoteHl);
  setQuoteHlRef.current = setQuoteHl;
  // Page sizes (unscaled PDF points) so the overlay can scale page-space rects
  // to the current page box. Filled once the document opens.
  const pageSizesRef = useRef<{ width: number; height: number }[]>([]);

  // Initial reading layout (paged vs vertical), decided by the shell and carried
  // in the restored view state. Captured once at mount to seed the scroll/zoom
  // plugin defaults so the first paint is already in the right mode.
  const initialLayout: EmbedLayout = props.initialViewState?.layout ?? "vertical";
  const initialLayoutRef = useRef(initialLayout);
  // Shared touch-gesture context (see PagedGestureCtx). Seeded from the initial
  // layout; the imperative wiring fills scroll/interaction on init.
  const pagedRef = useRef<PagedGestureCtx>({
    paged: initialLayoutRef.current === "paged",
    tool: "pointer",
    zoomedIn: false,
    // Off until the shell applies the setting, which it does in the same effect
    // that applies the tool.
    fingerDraw: false,
    scroll: null,
    interaction: null,
    selection: null,
    setTouchLock: null,
    viewport: null,
    indicator: null,
    resetGestures: null,
    turnToPage: null,
  });

  useEffect(() => {
    propsRef.current.onQuoteHighlight?.(quoteHl !== null);
  }, [quoteHl]);

  useEffect(() => {
    if (error) props.onError?.(error);
  }, [error]);

  const plugins = useMemo(
    () => [
      // The document is opened explicitly in wireEngine (initialDocuments can
      // hang at progress 0 when the load races the engine coming up).
      createPluginRegistration(DocumentManagerPluginPackage, {}),
      createPluginRegistration(ViewportPluginPackage),
      // No spread plugin: the reader is one page per row, always. Scroll and
      // zoom both take it as optional and fall back to a page per row, which is
      // exactly the layout paged mode is locked to.
      createPluginRegistration(ScrollPluginPackage, {
        defaultBufferSize: 1,
        // Paged mode lays pages out in a horizontal strip so the neighbour page
        // is already rendered adjacent for the follow-finger flip.
        defaultStrategy:
          initialLayoutRef.current === "paged" ? ScrollStrategy.Horizontal : ScrollStrategy.Vertical,
      }),
      createPluginRegistration(RenderPluginPackage),
      // Tiling: keeps zoom responsive. The base layer is a fixed low-res raster
      // that only gets CSS-scaled; only the visible high-res tiles re-render on
      // zoom, instead of re-rasterizing the whole page every zoom step.
      createPluginRegistration(TilingPluginPackage),
      createPluginRegistration(ZoomPluginPackage, {
        defaultZoomLevel: initialLayoutRef.current === "paged" ? ZoomMode.FitPage : ZoomMode.FitWidth,
      }),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage),
      createPluginRegistration(HistoryPluginPackage),
      createPluginRegistration(AnnotationPluginPackage, {
        annotationAuthor: props.authorName ?? "Reading-Partner",
        // Finishing a stroke leaves nothing selected (annotation-selection.ts).
        selectAfterCreate: SELECT_AFTER_CREATE,
      }),
    ],
    // The buffer identifies the document; other props are read live via propsRef.
    [props.buffer],
  );

  const onInitialized = async (registry: PluginRegistry) => {
    perfMark("providerInit");
    // The EmbedPDF provider only mounts (and fires onInitialized) below the
    // `!engine` guard, so engine is non-null here.
    if (!engine) return;
    try {
      await wireEngine(registry, propsRef, engine, setQuoteHlRef, pageSizesRef, pagedRef);
    } catch (e) {
      propsRef.current.onError?.(e as Error);
    }
  };

  const onAnchor = useCallback((id: string, rect: AnnotationAnchor) => {
    propsRef.current.onAnnotationAnchor?.(id, rect);
  }, []);

  // Handed to the touch router through the ref so painting it never re-renders
  // the memoized engine subtree.
  const indicatorRef = useCallback((el: HTMLDivElement | null) => {
    pagedRef.current.indicator = el;
  }, []);

  // Selection menu slot on the native AnnotationLayer: instead of a menu, it
  // hosts the probe that measures the selected annotation's viewport rect (the
  // wrapper div is absolutely positioned over the annotation by the layer).
  const selectionMenu = useCallback(
    ({
      selected,
      context,
      menuWrapperProps,
    }: {
      selected: boolean;
      context: { type: string; annotation: { object: PdfAnnotationObject } };
      menuWrapperProps: { style: React.CSSProperties; ref: (el: HTMLDivElement | null) => void };
    }) => {
      if (!selected || context.type !== "annotation") return null;
      const id = context.annotation.object.id;
      return (
        <div ref={menuWrapperProps.ref} style={menuWrapperProps.style}>
          <AnchorProbe key={id} id={id} onAnchor={onAnchor} />
        </div>
      );
    },
    [onAnchor],
  );

  if (isLoading || !engine) {
    return <div style={props.style} className={props.className} />;
  }

  // overflow:hidden and the matching background on the wrapper are what make
  // the vertical rubber band possible: the band translates the scroll container
  // itself (docs/pitfall/45), so the wrapper both clips the edge that leaves the
  // frame and fills the gap that opens on the other side.
  // data-reader-surface turns off WebKit's own text selection and touch callout
  // for everything below (styles.css). The engine's selection does not use them:
  // it hit-tests PDFium glyph geometry and paints its own divs, so tap-drag
  // highlighting, double-tap word select and copy are untouched, while a finger
  // the touch router is driving can no longer start a native selection over the
  // page (docs/pitfall/49).
  return (
    <div
      data-reader-surface=""
      style={{
        height: "100%",
        width: "100%",
        position: "relative",
        overflow: "hidden",
        backgroundColor: "#f1f3f5",
        ...props.style,
      }}
      className={props.className}
    >
      <EmbedPDF engine={engine} plugins={plugins} onInitialized={onInitialized}>
        {({ activeDocumentId }) =>
          activeDocumentId && (
            <Viewport documentId={activeDocumentId} style={{ height: "100%", width: "100%", backgroundColor: "#f1f3f5" }}>
              {/* enableWheel:false keeps the desktop scroll-wheel scrolling (not
                  zooming); pinch only fires on a two-finger touch, so mouse and
                  keyboard paths are untouched. */}
              <ZoomGestureWrapper documentId={activeDocumentId} enableWheel={false}>
              <Scroller
                documentId={activeDocumentId}
                renderPage={({ pageIndex, width, height }) => (
                  <PagePointerProvider documentId={activeDocumentId} pageIndex={pageIndex}>
                    {/* Base raster fixed at scale 1 (CSS-scaled by the page box);
                        tiles carry the crisp high-res for the visible area only.
                        Both are non-interactive so pointer events reach selection. */}
                    <div style={{ position: "absolute", inset: 0, width, height, pointerEvents: "none" }}>
                      <RenderLayer documentId={activeDocumentId} pageIndex={pageIndex} scale={1} />
                      <TilingLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                    </div>
                    <SelectionLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                    <AnnotationLayer
                      documentId={activeDocumentId}
                      pageIndex={pageIndex}
                      selectionMenu={selectionMenu}
                    />
                    <QuoteHighlightLayer
                      pageIndex={pageIndex}
                      pageWidthPx={width}
                      pageSize={pageSizesRef.current[pageIndex]}
                      hl={quoteHl}
                    />
                  </PagePointerProvider>
                )}
              />
              </ZoomGestureWrapper>
              <TouchInputRouter documentId={activeDocumentId} ctx={pagedRef} />
              <TouchDebugOverlay />
            </Viewport>
          )
        }
      </EmbedPDF>
      {/* The scroll indicator. Outside the scroll container on purpose: it
          belongs to the frame, so the rubber band does not carry it off the
          screen. Non-interactive and invisible until something scrolls. */}
      <div
        ref={indicatorRef}
        aria-hidden
        style={{
          position: "absolute",
          top: 0,
          right: "2px",
          width: "3px",
          height: 0,
          borderRadius: "2px",
          backgroundColor: "rgba(0, 0, 0, 0.28)",
          opacity: 0,
          transition: "opacity 200ms ease",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// --- imperative wiring ----------------------------------------------------

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

async function wireEngine(
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
      }): { toPromise(): Promise<unknown> };
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
  await dm?.openDocumentBuffer({ buffer: copy, documentId: DOC_ID, name: "document.pdf", autoActivate: true }).toPromise();
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
  // reset a layout switch does (layout-modes.applyJump).
  //
  // Two: the jump must not hand the scroll position to a second animator
  // either. `behavior: "smooth"` runs the browser's own scroll animation, which
  // the reader can neither see nor stop — on iOS it is dispatched to the
  // scrolling thread, off the main thread entirely — and it writes the same
  // property the router writes every frame (pitfall 50).
  const jumpToPage = (opts: Parameters<typeof scrollScope.scrollToPage>[0]) => {
    pagedRef.current.resetGestures?.();
    scrollScope.scrollToPage({ ...opts, behavior: "instant" });
  };
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
  // When we mutate the engine ourselves (import / host edit), don't echo the
  // resulting events back to the host as if the user did it.
  let suppress = false;
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
    suppress = true;
    try {
      annScope.importAnnotations(items);
    } finally {
      suppress = false;
    }
  };

  // Engine -> host: create / update / delete.
  annotation.onAnnotationEvent((ev) => {
    if (suppress) return;
    if (ev.type === "delete") {
      pageOf.delete(ev.annotation.id);
      propsRef.current.onDeleteAnnotations?.([ev.annotation.id]);
      return;
    }
    if (ev.type === "create" || ev.type === "update") {
      // Each edit fires twice: an optimistic event then the committed one. Emit
      // only the committed pass so the host persists once.
      if (ev.committed === false) return;
      const obj = ev.annotation as PdfAnnotationObject;
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
    const z = zoomScope.getState().currentZoomLevel;
    const stats: EmbedViewStats = {
      pageIndex: scrollScope.getCurrentPage() - 1,
      pagesCount: scrollScope.getTotalPages(),
      zoom: z,
      canZoomIn: z < 6,
      canZoomOut: z > 0.15,
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
      zoomScope.requestZoom(iv.zoom);
      // Restore the exact in-page position when the saved state carries one
      // (unscaled page coordinates; the plugin scales them at scroll time).
      // scrollToPage adds the viewport gap on top of the target point, while the
      // captured pageX/pageY (visibility metrics) measure the actual visible
      // offset — subtract the gap (unscaled) so the round trip is exact.
      let pageCoordinates: { x: number; y: number } | undefined;
      if (typeof iv.pageY === "number") {
        const gap = cap<ViewportCapability>(registry, "viewport").getViewportGap() / iv.zoom;
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
      if (id === "ink") annotation.setToolDefaults("ink", { strokeColor: color, color });
      else if (id !== "pointer") annotation.setToolDefaults(id, { color });
    },
    zoomIn: () => zoomScope.zoomIn(),
    zoomOut: () => zoomScope.zoomOut(),
    fitWidth: () => zoomScope.requestZoom(ZoomMode.FitWidth),
    fitPage: () => zoomScope.requestZoom(ZoomMode.FitPage),
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
        jumpToPage({
          pageNumber: pageIndex + 1,
          pageCoordinates: { x: rects[0].origin.x, y: rects[0].origin.y },
          alignY: 60,
        });
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
      jumpToPage({
        pageNumber: pageIndex + 1,
        pageCoordinates: { x: obj.rect.origin.x, y: obj.rect.origin.y },
        alignY: 20,
      });
    },
    updateAnnotation(id, patch) {
      const pageIndex = pageOf.get(id);
      if (pageIndex === undefined) return;
      const p: Record<string, unknown> = {};
      if (patch.color !== undefined) p.color = patch.color;
      if (patch.comment !== undefined) p.contents = patch.comment;
      if (patch.starred !== undefined) {
        const cur = annScope.getAnnotationById(id)?.object.custom ?? {};
        p.custom = { ...cur, starred: patch.starred };
      }
      suppress = true;
      try {
        annScope.updateAnnotation(pageIndex, id, p);
      } finally {
        suppress = false;
      }
      // Echo the host-side edit back so the trace list / persistence update.
      const ta = annScope.getAnnotationById(id);
      if (ta) {
        const zot = embedToZotero(ta.object, pageHeight(pageIndex), propsRef.current.authorName);
        if (zot) propsRef.current.onSaveAnnotations?.([zot]);
      }
    },
    upsertAnnotations(anns) {
      suppress = true;
      try {
        for (const a of anns) {
          const h = pageHeight(a.position?.pageIndex ?? 0);
          const obj = zoteroToEmbed(a, h);
          if (!obj) continue;
          if (pageOf.has(obj.id)) {
            const patch: Record<string, unknown> = { custom: obj.custom };
            if ("color" in obj) patch.color = (obj as { color?: string }).color;
            if (typeof obj.contents === "string") patch.contents = obj.contents;
            annScope.updateAnnotation(pageOf.get(obj.id)!, obj.id, patch);
          } else {
            pageOf.set(obj.id, obj.pageIndex);
            annScope.importAnnotations([{ annotation: obj }]);
          }
        }
      } finally {
        suppress = false;
      }
    },
    deleteAnnotation(id) {
      const pageIndex = pageOf.get(id);
      if (pageIndex === undefined) return;
      suppress = true;
      try {
        annScope.deleteAnnotation(pageIndex, id);
      } finally {
        suppress = false;
      }
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
