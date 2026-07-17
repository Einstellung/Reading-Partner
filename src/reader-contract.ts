// Engine-neutral contract between the shell and the reading engine: the view
// handle the shell drives, the callbacks it receives, and the persisted shapes
// (ViewState, Annotation). The EmbedPDF adapter in src/reader-embedpdf/
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
  spreadMode: number;
  // In-page reading position in unscaled page coordinates, top-left origin
  // (EmbedPDF page space). Distinct from the legacy `top`/`left` (which used the
  // old engine's coordinate convention), so an old file restores to the page top
  // instead of a mirrored offset.
  pageX?: number;
  pageY?: number;
}

export interface ViewStats {
  pageIndex: number;
  pageLabel: string | null;
  pagesCount: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  // False once the scale is already page-width (zoomReset is fit-width).
  canZoomReset: boolean;
  spreadMode: SpreadMode;
}

export const SpreadMode = {
  None: 0,
  Odd: 1,
  Even: 2,
} as const;
export type SpreadMode = (typeof SpreadMode)[keyof typeof SpreadMode];

// Minimal annotation shape; unknown fields round-trip untouched.
export interface Annotation {
  id: string;
  type: string;
  [key: string]: unknown;
}

export type ToolType =
  | "pointer"
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
  setSpreadMode: (mode: SpreadMode) => void;
  navigate: (target: { pageIndex?: number; annotationID?: string }) => void;
  // undefined deactivates the active tool (reverts to pointer).
  setTool: (tool?: Tool) => void;
  // Upsert by id and re-render; does not fire onSaveAnnotations (host is source
  // of truth), so use it to reflect host-side color/comment edits.
  setAnnotations: (annotations: Annotation[]) => void;
  // Remove by id and re-render.
  unsetAnnotations: (ids: string[]) => void;
  selectAnnotations: (ids: string[]) => void;
}
