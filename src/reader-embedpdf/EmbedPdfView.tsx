// EmbedPDF engine adapter (spike). A self-contained React viewer that renders a
// PDF from an in-memory buffer through @embedpdf's headless core + PdfiumEngine,
// and exposes the shell's functional needs through an imperative handle. The
// pdfium.wasm is self-hosted (/pdfium/pdfium.wasm) and font fallback is disabled
// so the build stays offline (no CDN fetch).
//
// This intentionally follows EmbedPDF's native API shape rather than replicating
// zotero/reader's createView contract verbatim (see the scope note in the spike
// report): the shell keeps persisting zotero-schema annotations, and this module
// converts at the boundary via src/reader-embedpdf/convert.ts.

import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPluginRegistration } from "@embedpdf/core";
import { EmbedPDF } from "@embedpdf/core/react";
import { usePdfiumEngine } from "@embedpdf/engines/react";
import type { PluginRegistry } from "@embedpdf/core";
import type { PdfAnnotationObject, PdfDocumentObject } from "@embedpdf/models";

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
import { InteractionManagerPluginPackage, PagePointerProvider } from "@embedpdf/plugin-interaction-manager/react";
import { SelectionPluginPackage, SelectionLayer } from "@embedpdf/plugin-selection/react";
import type { SelectionCapability } from "@embedpdf/plugin-selection";
import { HistoryPluginPackage } from "@embedpdf/plugin-history/react";
import { AnnotationPluginPackage, AnnotationLayer } from "@embedpdf/plugin-annotation/react";
import type { AnnotationCapability } from "@embedpdf/plugin-annotation";

import { embedToZotero, zoteroToEmbed, type ZoteroAnnotation } from "./convert";

const DOC_ID = "main";
const WASM_URL = "/pdfium/pdfium.wasm";

export type EmbedTool = "pointer" | "highlight" | "underline" | "ink";
export type EmbedSpread = "none" | "odd" | "even";

export interface EmbedViewState {
  pageIndex: number;
  zoom: number;
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
  onViewState?: (s: EmbedViewState) => void;
  onViewStats?: (s: EmbedViewStats) => void;
  className?: string;
  style?: React.CSSProperties;
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
  // worker:false runs PDFium on the main thread. The worker engine hangs in this
  // spike's dev setup (worker asset blocked under COEP); direct works. iOS/WKWebView
  // will need its own engine-mode call — flagged in the report.
  const { engine, isLoading, error } = usePdfiumEngine({ wasmUrl: WASM_URL, worker: false, fontFallback: null });
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    if (error) props.onError?.(error);
  }, [error]);

  const plugins = useMemo(
    () => [
      // The document is opened explicitly in wireEngine (initialDocuments can
      // hang at progress 0 when the load races the engine coming up).
      createPluginRegistration(DocumentManagerPluginPackage, {}),
      createPluginRegistration(ViewportPluginPackage),
      createPluginRegistration(ScrollPluginPackage),
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
    try {
      await wireEngine(registry, propsRef);
    } catch (e) {
      propsRef.current.onError?.(e as Error);
    }
  };

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
                    <AnnotationLayer documentId={activeDocumentId} pageIndex={pageIndex} />
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

async function wireEngine(
  registry: PluginRegistry,
  propsRef: React.MutableRefObject<EmbedPdfViewProps>,
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
  await dm?.openDocumentBuffer({ buffer: copy, documentId: DOC_ID, name: "document.pdf", autoActivate: true }).toPromise();

  const doc = () => dm?.getDocument(DOC_ID) ?? null;
  const pageHeight = (pageIndex: number) => doc()?.pages[pageIndex]?.size.height ?? 0;

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

  // Reading position + nav/zoom stats -> host.
  const emitState = () => {
    const st: EmbedViewState = {
      pageIndex: scrollScope.getCurrentPage() - 1,
      zoom: zoomScope.getState().currentZoomLevel,
    };
    propsRef.current.onViewState?.(st);
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
    importAll(propsRef.current.annotations ?? []);
    const iv = propsRef.current.initialViewState;
    if (iv) {
      zoomScope.requestZoom(iv.zoom);
      scrollScope.scrollToPage({ pageNumber: iv.pageIndex + 1, behavior: "instant" });
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
      scrollScope.scrollToPage({ pageNumber: pageIndex + 1, behavior: "smooth" });
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
    getState: () => ({
      pageIndex: scrollScope.getCurrentPage() - 1,
      zoom: zoomScope.getState().currentZoomLevel,
    }),
    _debug: {
      dumpEmbed: () => annScope.getAnnotations().map((t) => t.object),
      pageHeight,
      doc,
      registry,
    } as EmbedPdfHandle["_debug"] & { registry: PluginRegistry },
  };

  propsRef.current.onReady?.(handle);
}
