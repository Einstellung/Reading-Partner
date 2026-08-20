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
import type { PdfAnnotationObject, PdfEngine } from "@embedpdf/models";
import { getPdfiumEngine } from "./engine-singleton";

import { DocumentManagerPluginPackage } from "@embedpdf/plugin-document-manager/react";
import { ViewportPluginPackage, Viewport, useViewportElement } from "@embedpdf/plugin-viewport/react";
import { ScrollPluginPackage, Scroller } from "@embedpdf/plugin-scroll/react";
import { ScrollStrategy } from "@embedpdf/plugin-scroll";
import { RenderPluginPackage, RenderLayer } from "@embedpdf/plugin-render/react";
import { TilingPluginPackage, TilingLayer } from "@embedpdf/plugin-tiling/react";
import {
  ZoomPluginPackage,
  ZoomMode,
  ZoomGestureWrapper,
  useZoomCapability,
} from "@embedpdf/plugin-zoom/react";
import { InteractionManagerPluginPackage, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react";
import { SelectionPluginPackage, SelectionLayer } from "@embedpdf/plugin-selection/react";
import { HistoryPluginPackage } from "@embedpdf/plugin-history/react";
import { AnnotationPluginPackage, AnnotationLayer } from "@embedpdf/plugin-annotation/react";

import { MARKUP_TOOL_OVERRIDES } from "./convert";
import { SELECT_AFTER_CREATE } from "./annotation-selection";
import { PAGE_FRAME } from "./page-frame";
import { PAGE_WASH_GROUP_STYLE, PAGE_WASH_STYLE } from "./page-wash";
import { TouchDebugOverlay } from "./gesture/touch-debug";
import { attachTouchRouter } from "./gesture/attach-touch";
import { attachWheelZoom } from "./gesture/wheel-zoom";
import { perfMark, wireEngine } from "./wire-engine";
import type {
  AnnotationAnchor,
  EmbedLayout,
  EmbedPdfViewProps,
  QuoteHighlight,
} from "./types";
import type { PagedGestureCtx } from "./gesture/context";

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

// The touch router's React side: the scroll container it drives is mounted by
// the Viewport and shared through context, and its .current fills a frame or two
// after this effect first runs, so poll for it. Everything the router then does
// is in attach-touch.ts.
function TouchInputRouter({
  documentId,
  ctx,
}: {
  documentId: string;
  ctx: React.MutableRefObject<PagedGestureCtx>;
}): ReactNode {
  const vpRef = useViewportElement();
  useEffect(() => {
    let raf = 0;
    let detach: (() => void) | null = null;
    const waitForViewport = () => {
      const el = vpRef?.current;
      if (el) {
        detach = attachTouchRouter(el, { documentId, ctx });
        return;
      }
      raf = requestAnimationFrame(waitForViewport);
    };

    waitForViewport();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      detach?.();
    };
  }, [documentId, ctx, vpRef]);
  return null;
}

// Ctrl/Cmd + wheel zoom, on the same container and behind the same wait-for-it
// as the touch router. The zoom plugin's own wheel path is off (see the
// ZoomGestureWrapper below); the step lives in gesture/wheel-zoom.ts.
function WheelZoomInput({ documentId }: { documentId: string }): ReactNode {
  const vpRef = useViewportElement();
  const { provides: zoom } = useZoomCapability();
  useEffect(() => {
    if (!zoom) return;
    const scope = zoom.forDocument(documentId);
    let raf = 0;
    let detach: (() => void) | null = null;
    const waitForViewport = () => {
      const el = vpRef?.current;
      if (el) {
        detach = attachWheelZoom(el, {
          currentZoom: () => scope.getState().currentZoomLevel,
          requestZoom: (level, center) => scope.requestZoom(level, center),
        });
        return;
      }
      raf = requestAnimationFrame(waitForViewport);
    };

    waitForViewport();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      detach?.();
    };
  }, [documentId, vpRef, zoom]);
  return null;
}

export default function EmbedPdfView(props: EmbedPdfViewProps): ReactNode {
  // PDFium rasterises in a worker, with the main-thread engine as the fallback
  // when the worker cannot start. Which one this is, and why, is engine-singleton.ts.
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
      // The gap is the padding the viewport puts around the whole document, and
      // the number every fit is resolved against (page-frame.ts). Zero: the
      // sheet reaches the edges of the screen.
      createPluginRegistration(ViewportPluginPackage, { viewportGap: PAGE_FRAME.viewportGap }),
      // No spread plugin: the reader is one page per row, always. Scroll and
      // zoom both take it as optional and fall back to a page per row, which is
      // exactly the layout paged mode is locked to.
      createPluginRegistration(ScrollPluginPackage, {
        defaultBufferSize: 1,
        // Unscaled page units; the plugin multiplies by the current scale. The
        // separator between two sheets, and in paged mode the only thing that
        // keeps the next page off a screen its neighbour exactly fills.
        defaultPageGap: PAGE_FRAME.pageGap,
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
        // A markup is drawn at the same opacity whether it was just made or
        // just re-imported (convert.ts owns the number).
        tools: MARKUP_TOOL_OVERRIDES,
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
        backgroundColor: PAGE_FRAME.background,
        ...props.style,
      }}
      className={props.className}
    >
      <EmbedPDF engine={engine} plugins={plugins} onInitialized={onInitialized}>
        {({ activeDocumentId }) =>
          activeDocumentId && (
            <Viewport
              documentId={activeDocumentId}
              style={{ height: "100%", width: "100%", backgroundColor: PAGE_FRAME.background }}
            >
              {/* enableWheel is the ctrl/meta+wheel path only (a bare wheel
                  returns on that handler's first line and scrolls as always),
                  and its step is a whole doubling per mouse notch with no knob
                  for it — so that path stays off and WheelZoomInput above owns
                  it instead (docs/pitfall/137). enablePinch, the touch path,
                  stays on: the two never see the same event. */}
              <ZoomGestureWrapper documentId={activeDocumentId} enableWheel={false}>
              <Scroller
                documentId={activeDocumentId}
                renderPage={({ pageIndex, width, height }) => (
                  <PagePointerProvider documentId={activeDocumentId} pageIndex={pageIndex}>
                    {/* The paper: the sheet, the raster on it, and the tint over
                        both, blended as one group and finished before anything
                        the reader put on the page is drawn. Ordering the layers
                        this way is what keeps a selection yellow, an annotation
                        purple and a quote band the colours they were picked as —
                        they sit outside the group, so the tint never multiplies
                        them (page-wash.ts). */}
                    <div style={PAGE_WASH_GROUP_STYLE}>
                      {/* The sheet: the paper under the raster and the edge that
                          separates it from the next one. Its box is the page box
                          (inset:0), so it cannot move a tile, a selection rect or
                          an annotation relative to the page; the edge is a
                          box-shadow, which paints outside that box and does not
                          enter the scrollable area. */}
                      <div
                        aria-hidden
                        style={{
                          position: "absolute",
                          inset: 0,
                          backgroundColor: PAGE_FRAME.pageBackground,
                          boxShadow: PAGE_FRAME.pageEdge,
                          pointerEvents: "none",
                        }}
                      />
                      {/* Base raster fixed at scale 1 (CSS-scaled by the page box);
                          tiles carry the crisp high-res for the visible area only.
                          Both are non-interactive so pointer events reach selection. */}
                      <div style={{ position: "absolute", inset: 0, width, height, pointerEvents: "none" }}>
                        <RenderLayer documentId={activeDocumentId} pageIndex={pageIndex} scale={1} />
                        <TilingLayer documentId={activeDocumentId} pageIndex={pageIndex} />
                      </div>
                      <div aria-hidden style={PAGE_WASH_STYLE} />
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
              <WheelZoomInput documentId={activeDocumentId} />
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

