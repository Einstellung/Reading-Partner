// Bridges the EmbedPDF adapter (EmbedPdfView) to the shell's existing engine
// contract (src/reader.ts): it renders the viewer and hands App a ViewInstance
// plus the same callbacks it already wires for the zotero engine. This is what
// lets App switch engines without rewriting its annotation / thread / storage
// handlers. Used only when USE_EMBEDPDF is set.

import { useCallback, useRef } from "react";
import EmbedPdfView, {
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
} from "../reader";

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
  className?: string;
}

export default function EmbedReaderPane(props: EmbedReaderPaneProps) {
  const handleRef = useRef<EmbedPdfHandle | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const annById = useRef<Map<string, Annotation>>(new Map());
  const initialViewState: EmbedViewState | null =
    props.viewState && typeof props.viewState.scale === "number"
      ? { pageIndex: props.viewState.pageIndex, zoom: props.viewState.scale }
      : props.viewState
        ? { pageIndex: props.viewState.pageIndex, zoom: 1 }
        : null;

  // Seed the id->annotation map from the initial set so click selection can
  // resolve the full object for the popup.
  for (const a of props.annotations) annById.current.set(a.id, a as Annotation);

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
        onSelectAnnotation={(id) => {
          props.onSelectAnnotations(id ? [id] : []);
          if (!id) {
            props.onSetAnnotationPopup(undefined);
            return;
          }
          const ann = annById.current.get(id);
          if (!ann) return;
          // Best-effort anchor: the shell popup/bubble opens near the viewport
          // center (EmbedPDF selection does not hand us a viewport rect here;
          // the native selectionMenu would be the exact-anchor path).
          const box = containerRef.current?.getBoundingClientRect();
          const cx = (box?.left ?? 0) + (box?.width ?? window.innerWidth) / 2;
          const cy = (box?.top ?? 0) + (box?.height ?? window.innerHeight) / 3;
          props.onSetAnnotationPopup({ rect: [cx - 1, cy - 1, cx + 1, cy + 2], annotation: ann });
        }}
        onViewState={(s: EmbedViewState) =>
          props.onChangeViewState({
            pageIndex: s.pageIndex,
            scale: s.zoom,
            top: 0,
            left: 0,
            scrollMode: 0,
            spreadMode: 0,
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
