// Bridges the EmbedPDF adapter (EmbedPdfView) to the shell's engine contract
// (src/reader-contract.ts): it renders the viewer and hands App a ViewInstance
// plus the callbacks App wires for annotations, threads and storage.

import { memo, useCallback, useEffect, useRef } from "react";
import EmbedPdfView, {
  type AnnotationAnchor,
  type EmbedPdfHandle,
  type EmbedSpread,
  type EmbedViewState,
  type EmbedViewStats,
} from "./EmbedPdfView";
import type { ZoteroAnnotation } from "./convert";
import {
  SpreadMode,
  type Annotation,
  type AnnotationPopupParams,
  type Tool,
  type ViewInstance,
  type ViewState,
  type ViewStats,
} from "../app/reader-contract";

const SPREAD_NUM_TO_EMBED: Record<number, EmbedSpread> = { 0: "none", 1: "odd", 2: "even" };
const EMBED_TO_SPREAD_NUM: Record<EmbedSpread, SpreadMode> = {
  none: SpreadMode.None,
  odd: SpreadMode.Odd,
  even: SpreadMode.Even,
};

export interface EmbedReaderPaneProps {
  buffer: ArrayBuffer;
  annotations: Annotation[];
  authorName: string;
  viewState: ViewState | null;
  onView: (view: ViewInstance) => void;
  onInitialized: () => void;
  onChangeViewState: (s: ViewState) => void;
  onChangeViewStats: (s: ViewStats) => void;
  onSaveAnnotations: (anns: Annotation[]) => void;
  onDeleteAnnotations: (ids: string[]) => void;
  onSelectAnnotations: (ids: string[]) => void;
  onSetAnnotationPopup: (params?: AnnotationPopupParams) => void;
  onQuoteHighlightChange?: (active: boolean) => void;
  className?: string;
}

// Memoized so the shell's frequent re-renders (AI streaming updates App state
// many times a second) never reach the EmbedPDF provider subtree — the same
// isolation the old iframe engine had for free. All props from App must be
// stable (App passes useCallback'd handlers + the stable embedDoc object).
function EmbedReaderPaneImpl(props: EmbedReaderPaneProps) {
  const handleRef = useRef<EmbedPdfHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const annById = useRef<Map<string, Annotation>>(new Map());
  // Selection whose precise anchor (AnchorProbe) hasn't arrived yet; the timer
  // opens the popup at a viewport-center fallback if it never does.
  const pendingAnchor = useRef<{ id: string; timer: number } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(
    () => () => {
      if (pendingAnchor.current) window.clearTimeout(pendingAnchor.current.timer);
    },
    [],
  );
  const initialViewState: EmbedViewState | null = props.viewState
    ? {
        pageIndex: props.viewState.pageIndex,
        zoom: typeof props.viewState.scale === "number" ? props.viewState.scale : 1,
        // In-page offset (only present in states saved by this engine; legacy
        // files restore to the page top).
        ...(typeof props.viewState.pageY === "number"
          ? { pageX: props.viewState.pageX, pageY: props.viewState.pageY }
          : {}),
      }
    : null;

  // Seed the id->annotation map from the initial set so click selection can
  // resolve the full object for the popup.
  for (const a of props.annotations) annById.current.set(a.id, a as Annotation);

  // Viewport-center fallback anchor, used only when the precise anchor never
  // arrives (an annotation shape the layer renders without a container).
  const openPopupFallback = useCallback((id: string) => {
    const ann = annById.current.get(id);
    if (!ann) return;
    const box = containerRef.current?.getBoundingClientRect();
    const cx = (box?.left ?? 0) + (box?.width ?? window.innerWidth) / 2;
    const cy = (box?.top ?? 0) + (box?.height ?? window.innerHeight) / 3;
    propsRef.current.onSetAnnotationPopup({ rect: [cx - 1, cy - 1, cx + 1, cy + 2], annotation: ann });
  }, []);

  const onSelectAnnotation = useCallback(
    (id: string | null) => {
      propsRef.current.onSelectAnnotations(id ? [id] : []);
      if (pendingAnchor.current) {
        window.clearTimeout(pendingAnchor.current.timer);
        pendingAnchor.current = null;
      }
      if (!id) {
        propsRef.current.onSetAnnotationPopup(undefined);
        return;
      }
      // Wait briefly for the precise anchor (AnchorProbe reports right after
      // the selection renders), then fall back.
      pendingAnchor.current = {
        id,
        timer: window.setTimeout(() => {
          pendingAnchor.current = null;
          openPopupFallback(id);
        }, 150),
      };
    },
    [openPopupFallback],
  );

  // Precise path: the selected annotation's measured viewport rect.
  const onAnnotationAnchor = useCallback((id: string, r: AnnotationAnchor) => {
    if (pendingAnchor.current?.id === id) {
      window.clearTimeout(pendingAnchor.current.timer);
      pendingAnchor.current = null;
    }
    const ann = annById.current.get(id);
    if (!ann) return;
    propsRef.current.onSetAnnotationPopup({
      rect: [r.left, r.top, r.right, r.bottom],
      annotation: ann,
    });
  }, []);

  const buildViewInstance = useCallback(
    (h: EmbedPdfHandle): ViewInstance => ({
      zoomIn: () => h.zoomIn(),
      zoomOut: () => h.zoomOut(),
      zoomReset: () => h.fitWidth(),
      setSpreadMode: (mode) => h.setSpread(SPREAD_NUM_TO_EMBED[mode] ?? "none"),
      navigate: (target) => {
        if (target.annotationID) h.navigateToAnnotation(target.annotationID);
        else if (typeof target.pageIndex === "number") h.navigateToPage(target.pageIndex);
      },
      highlightQuote: (pageIndex, req) => h.highlightQuote(pageIndex, req),
      clearQuoteHighlight: () => h.clearQuoteHighlight(),
      setTool: (tool?: Tool) => {
        if (!tool || tool.type === "pointer") {
          h.setTool("pointer");
          return;
        }
        if (tool.type === "highlight" || tool.type === "underline" || tool.type === "ink") {
          h.setTool(tool.type);
          if (tool.color) h.setColor(tool.color);
        } else {
          // note/text/image/eraser have no EmbedPDF spike equivalent → pointer.
          h.setTool("pointer");
        }
      },
      setAnnotations: (anns: Annotation[]) => {
        for (const a of anns) annById.current.set(a.id, a);
        h.upsertAnnotations(anns as unknown as ZoteroAnnotation[]);
      },
      unsetAnnotations: (ids: string[]) => {
        for (const id of ids) {
          annById.current.delete(id);
          h.deleteAnnotation(id);
        }
      },
      selectAnnotations: (ids: string[]) => {
        if (ids[0]) h.selectAnnotation(ids[0]);
      },
    }),
    [],
  );

  return (
    <div ref={containerRef} className={props.className} style={{ flex: 1, minWidth: 0, height: "100%" }}>
      <EmbedPdfView
        buffer={props.buffer}
        annotations={props.annotations as unknown as ZoteroAnnotation[]}
        authorName={props.authorName}
        initialViewState={initialViewState}
        onReady={(h) => {
          handleRef.current = h;
          props.onView(buildViewInstance(h));
          props.onInitialized();
        }}
        onSaveAnnotations={(anns) => {
          for (const a of anns) annById.current.set(a.id, a as unknown as Annotation);
          props.onSaveAnnotations(anns as unknown as Annotation[]);
        }}
        onDeleteAnnotations={(ids) => {
          for (const id of ids) annById.current.delete(id);
          props.onDeleteAnnotations(ids);
        }}
        onSelectAnnotation={onSelectAnnotation}
        onAnnotationAnchor={onAnnotationAnchor}
        onQuoteHighlight={(active) => propsRef.current.onQuoteHighlightChange?.(active)}
        onViewState={(s: EmbedViewState) =>
          props.onChangeViewState({
            pageIndex: s.pageIndex,
            scale: s.zoom,
            scrollMode: 0,
            spreadMode: 0,
            ...(typeof s.pageY === "number" ? { pageX: s.pageX, pageY: s.pageY } : {}),
          })
        }
        onViewStats={(s: EmbedViewStats) =>
          props.onChangeViewStats({
            pageIndex: s.pageIndex,
            pageLabel: String(s.pageIndex + 1),
            pagesCount: s.pagesCount,
            canZoomIn: s.canZoomIn,
            canZoomOut: s.canZoomOut,
            canZoomReset: true,
            spreadMode: EMBED_TO_SPREAD_NUM[s.spreadMode] ?? SpreadMode.None,
          })
        }
      />
    </div>
  );
}

const EmbedReaderPane = memo(EmbedReaderPaneImpl);
export default EmbedReaderPane;
