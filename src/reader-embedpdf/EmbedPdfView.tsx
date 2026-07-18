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
import { ViewportPluginPackage, Viewport } from "@embedpdf/plugin-viewport/react";
import { ScrollPluginPackage, Scroller } from "@embedpdf/plugin-scroll/react";
import type { ScrollCapability } from "@embedpdf/plugin-scroll";
import { RenderPluginPackage, RenderLayer } from "@embedpdf/plugin-render/react";
import { TilingPluginPackage, TilingLayer } from "@embedpdf/plugin-tiling/react";
import { ZoomPluginPackage, ZoomMode } from "@embedpdf/plugin-zoom/react";
import type { ZoomCapability } from "@embedpdf/plugin-zoom";
import { SpreadPluginPackage, SpreadMode } from "@embedpdf/plugin-spread/react";
import type { SpreadCapability } from "@embedpdf/plugin-spread";
import type { ViewportCapability } from "@embedpdf/plugin-viewport";
import { InteractionManagerPluginPackage, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react";
import { SelectionPluginPackage, SelectionLayer } from "@embedpdf/plugin-selection/react";
import type { SelectionCapability } from "@embedpdf/plugin-selection";
import { HistoryPluginPackage } from "@embedpdf/plugin-history/react";
import { AnnotationPluginPackage, AnnotationLayer } from "@embedpdf/plugin-annotation/react";
import type { AnnotationCapability } from "@embedpdf/plugin-annotation";

import { embedToZotero, zoteroToEmbed, type ZoteroAnnotation } from "./convert";

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

export type EmbedTool = "pointer" | "highlight" | "underline" | "ink";
export type EmbedSpread = "none" | "odd" | "even";

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
  spreadMode: EmbedSpread;
}

export interface EmbedPdfHandle {
  setTool(tool: EmbedTool): void;
  setColor(color: string): void;
  zoomIn(): void;
  zoomOut(): void;
  fitWidth(): void;
  fitPage(): void;
  setSpread(mode: EmbedSpread): void;
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

const SPREAD_TO_ENUM: Record<EmbedSpread, SpreadMode> = {
  none: SpreadMode.None,
  odd: SpreadMode.Odd,
  even: SpreadMode.Even,
};
const ENUM_TO_SPREAD: Record<string, EmbedSpread> = {
  [SpreadMode.None]: "none",
  [SpreadMode.Odd]: "odd",
  [SpreadMode.Even]: "even",
};

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
      createPluginRegistration(ScrollPluginPackage, { defaultBufferSize: 1 }),
      createPluginRegistration(RenderPluginPackage),
      // Tiling: keeps zoom responsive. The base layer is a fixed low-res raster
      // that only gets CSS-scaled; only the visible high-res tiles re-render on
      // zoom, instead of re-rasterizing the whole page every zoom step.
      createPluginRegistration(TilingPluginPackage),
      createPluginRegistration(ZoomPluginPackage, { defaultZoomLevel: ZoomMode.FitWidth }),
      createPluginRegistration(SpreadPluginPackage),
      createPluginRegistration(InteractionManagerPluginPackage),
      createPluginRegistration(SelectionPluginPackage),
      createPluginRegistration(HistoryPluginPackage),
      createPluginRegistration(AnnotationPluginPackage, {
        annotationAuthor: props.authorName ?? "Reading-Partner",
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
      await wireEngine(registry, propsRef, engine, setQuoteHlRef, pageSizesRef);
    } catch (e) {
      propsRef.current.onError?.(e as Error);
    }
  };

  const onAnchor = useCallback((id: string, rect: AnnotationAnchor) => {
    propsRef.current.onAnnotationAnchor?.(id, rect);
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

  return (
    <div style={{ height: "100%", width: "100%", ...props.style }} className={props.className}>
      <EmbedPDF engine={engine} plugins={plugins} onInitialized={onInitialized}>
        {({ activeDocumentId }) =>
          activeDocumentId && (
            <Viewport documentId={activeDocumentId} style={{ height: "100%", width: "100%", backgroundColor: "#f1f3f5" }}>
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
            </Viewport>
          )
        }
      </EmbedPDF>
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
): Promise<void> {
  const annotation = cap<AnnotationCapability>(registry, "annotation");
  const selection = cap<SelectionCapability>(registry, "selection");
  const scroll = cap<ScrollCapability>(registry, "scroll");
  const zoom = cap<ZoomCapability>(registry, "zoom");
  const spread = cap<SpreadCapability>(registry, "spread");
  const docManager = registry.getPlugin("document-manager") as {
    provides?: () => {
      getDocument(id: string): PdfDocumentObject | null;
      openDocumentBuffer(opts: {
        buffer: ArrayBuffer;
        documentId?: string;
        name: string;
        autoActivate?: boolean;
      }): { toPromise(): Promise<unknown> };
    };
  } | null;
  const dm = docManager?.provides?.();

  // Open the document explicitly from the in-memory buffer (spike item 8:
  // openDocumentBuffer consumes the bytes directly, no temp file). A fresh copy
  // is passed so nothing downstream can detach the shell's original.
  const buf = propsRef.current.buffer;
  const copy = buf.slice(0);
  perfMark("docOpenStart");
  await dm?.openDocumentBuffer({ buffer: copy, documentId: DOC_ID, name: "document.pdf", autoActivate: true }).toPromise();
  perfMark("docOpenEnd");

  const doc = () => dm?.getDocument(DOC_ID) ?? null;
  const pageHeight = (pageIndex: number) => doc()?.pages[pageIndex]?.size.height ?? 0;
  // Cache page sizes for the quote-highlight overlay's rect scaling.
  pageSizesRef.current = doc()?.pages.map((p) => ({ width: p.size.width, height: p.size.height })) ?? [];

  const annScope = annotation.forDocument(DOC_ID);
  const selScope = selection.forDocument(DOC_ID);
  const scrollScope = scroll.forDocument(DOC_ID);
  const zoomScope = zoom.forDocument(DOC_ID);

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

  // Selection state -> host (trace-list highlight sync).
  annotation.onStateChange(() => {
    const ids = annScope.getSelectedAnnotationIds();
    propsRef.current.onSelectAnnotation?.(ids[0] ?? null);
  });

  // Reading position + nav/zoom stats -> host. The in-page offset comes from
  // the scroll metrics: the visible region's top-left within the current page,
  // in unscaled page coordinates — exactly what scrollToPage's pageCoordinates
  // takes on restore.
  const currentState = (): EmbedViewState => {
    const st: EmbedViewState = {
      pageIndex: scrollScope.getCurrentPage() - 1,
      zoom: zoomScope.getState().currentZoomLevel,
    };
    try {
      // Anchor on the topmost visible page, not the "current" (most visible)
      // page: the topmost page's visible-region origin IS the viewport
      // top-left in its page coordinates, so restoring it reproduces the exact
      // scroll position. The current page can start mid-viewport, where its
      // visible-region origin is 0/0 and the offset would be lost.
      const vis = scrollScope.getMetrics().pageVisibilityMetrics;
      if (vis.length > 0) {
        const top = vis.reduce((a, b) => (b.pageNumber < a.pageNumber ? b : a));
        st.pageIndex = top.pageNumber - 1;
        st.pageX = top.original.pageX;
        st.pageY = top.original.pageY;
      }
    } catch {
      // Metrics unavailable (layout not ready): position falls back to page top.
    }
    return st;
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
      spreadMode: ENUM_TO_SPREAD[spread.getSpreadMode()] ?? "none",
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
    emitState();
    emitStats();
  });

  // Restore position + import annotations once the layout is ready (page sizes
  // exist). onLayoutReady fires with isInitial on the first ready.
  scroll.onLayoutReady((ev) => {
    if (!ev.isInitial) return;
    perfMark("layoutReady");
    importAll(propsRef.current.annotations ?? []);
    const iv = propsRef.current.initialViewState;
    if (iv) {
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
    emitStats();
    emitState();
  });

  const activeToolId = () => annotation.getActiveTool()?.id ?? "pointer";

  const handle: EmbedPdfHandle = {
    setTool(tool) {
      annScope.setActiveTool(tool === "pointer" ? null : tool);
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
    setSpread(mode) {
      spread.setSpreadMode(SPREAD_TO_ENUM[mode]);
      emitStats();
    },
    navigateToPage(pageIndex) {
      // An explicit page jump is navigating away — drop any quote overlay.
      setQuoteHlRef.current(null);
      scrollScope.scrollToPage({ pageNumber: pageIndex + 1, behavior: "smooth" });
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
        scrollScope.scrollToPage({
          pageNumber: pageIndex + 1,
          pageCoordinates: { x: rects[0].origin.x, y: rects[0].origin.y },
          alignY: 60,
          behavior: "smooth",
        });
        return true;
      }
      // Tier B: could not locate the quote geometrically — show it as a banner.
      setQuoteHlRef.current({ pageIndex, kind: "banner", quote: req.displayText });
      scrollScope.scrollToPage({ pageNumber: pageIndex + 1, behavior: "smooth" });
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
      scrollScope.scrollToPage({
        pageNumber: pageIndex + 1,
        pageCoordinates: { x: obj.rect.origin.x, y: obj.rect.origin.y },
        alignY: 20,
        behavior: "smooth",
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
    } as EmbedPdfHandle["_debug"] & { registry: PluginRegistry },
  };

  perfMark("handleReady");
  propsRef.current.onReady?.(handle);
}
