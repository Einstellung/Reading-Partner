// Engine-neutral contract between the shell and the reading engine: the view
// handle the shell drives, the callbacks it receives, and the persisted shapes
// (ViewState, Annotation). The EmbedPDF adapter in src/reading/engine/
// implements this contract; annotations keep their original on-disk JSON schema
// (position.rects in PDF points, bottom-left origin) so existing files stay
// readable without migration.

export interface ViewState {
  pageIndex: number;
  scale: number | string;
  // Legacy fields from the previous engine's persisted state; kept so old files
  // parse, never written with meaningful values anymore.
  top?: number;
  left?: number;
  scrollMode: number;
  // Legacy: the two-page spread this reader no longer has. Old files carry it,
  // nothing writes it, nothing reads it.
  spreadMode?: number;
  // In-page reading position in unscaled page coordinates, top-left origin
  // (EmbedPDF page space). Distinct from the legacy `top`/`left` (which used the
  // old engine's coordinate convention), so an old file restores to the page top
  // instead of a mirrored offset.
  pageX?: number;
  pageY?: number;
  // Classroom mode (docs/09) is per book and sticky: persisted here so reopening
  // the same book restores it. Absent means off. Not a reader-engine field — the
  // shell merges it in when persisting (see storage.withClassroom).
  classroom?: boolean;
  // Reading layout, per book: "vertical" continuous scroll (default) or "paged"
  // horizontal fit-page flip (touch devices). Absent restores to vertical.
  layout?: "vertical" | "paged";
}

export interface ViewStats {
  pageIndex: number;
  pageLabel: string | null;
  pagesCount: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  // False once the scale is already page-width (zoomReset is fit-width).
  canZoomReset: boolean;
  layout: "vertical" | "paged";
}

// Minimal annotation shape; unknown fields round-trip untouched.
export interface Annotation {
  id: string;
  type: string;
  [key: string]: unknown;
}

// Engine annotation page (0-based position.pageIndex) -> 1-based page for the
// full-text helpers. Null when the annotation has no page. It sits with the
// shape it reads so any layer may use it; reading/context re-exports it, which
// is where its callers have always imported it from.
export function annotationPage(
  ann: { position?: { pageIndex?: number } } | null | undefined,
): number | null {
  const idx = ann?.position?.pageIndex;
  return typeof idx === "number" ? idx + 1 : null;
}

export type ToolType =
  | "pointer"
  // The navigation lock (palm toggle): no annotation tool, and every pointer —
  // stylus included — only moves the page.
  | "navlock"
  | "highlight"
  | "underline"
  | "image"
  | "note"
  | "text"
  | "ink"
  | "eraser";

export interface Tool {
  type: ToolType;
  color?: string;
}

// Viewport-space rect [left, top, right, bottom] plus the annotation it belongs
// to. Emitted on annotation click; called with no argument on close.
export interface AnnotationPopupParams {
  rect: [number, number, number, number];
  annotation: Annotation;
}

// The view handle the shell drives.
export interface ViewInstance {
  zoomIn: () => void;
  zoomOut: () => void;
  // Fit-width, not 100%.
  zoomReset: () => void;
  // Switch reading layout (vertical continuous vs paged horizontal flip).
  setLayout: (mode: "vertical" | "paged") => void;
  navigate: (target: { pageIndex?: number; annotationID?: string }) => void;
  // Scroll to a page and paint a transient violet overlay on an AI-cited quote
  // (not a saved annotation). searchText is located in the page's text layer;
  // displayText is shown as a fallback banner when it can't be. Resolves true
  // when the quote was highlighted (Tier A), false on the banner fallback.
  highlightQuote: (pageIndex: number, req: { searchText: string; displayText: string }) => Promise<boolean>;
  // Dismiss the transient quote overlay, if any.
  clearQuoteHighlight: () => void;
  // undefined deactivates the active tool (reverts to pointer).
  setTool: (tool?: Tool) => void;
  // Whether a finger may mark the page (the "draw with your finger" setting).
  // Off — the default — means the finger only ever moves the page, whatever
  // tool is selected, and the stylus does the marking.
  setFingerDraw: (on: boolean) => void;
  // Upsert by id and re-render; does not fire onSaveAnnotations (host is source
  // of truth), so use it to reflect host-side color/comment edits.
  setAnnotations: (annotations: Annotation[]) => void;
  // Remove by id and re-render.
  unsetAnnotations: (ids: string[]) => void;
  selectAnnotations: (ids: string[]) => void;
}
