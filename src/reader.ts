// Typed bridge to the embedded zotero/reader `view-web` engine running inside
// the /reader iframe. Contract and callback shapes are from docs/04.

export interface ViewState {
  pageIndex: number;
  scale: number | string;
  top?: number;
  left?: number;
  scrollMode: number;
  spreadMode: number;
}

export interface ViewStats {
  pageIndex: number;
  pageLabel: string | null;
  pagesCount: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  // False once the scale is already page-width, since zoomReset() *is* fit-width
  // on a PDF view (pdf-view.js: zoomReset -> zoomPageWidth).
  canZoomReset: boolean;
  spreadMode: SpreadMode;
}

// pdf.js SpreadMode (pdfjs/web/ui_utils.js); the engine passes it through
// untyped as a number.
export const SpreadMode = {
  None: 0,
  Odd: 1,
  Even: 2,
} as const;
export type SpreadMode = (typeof SpreadMode)[keyof typeof SpreadMode];

// Minimal annotation shape; the engine round-trips unknown fields untouched.
export interface Annotation {
  id: string;
  type: string;
  [key: string]: unknown;
}

// Engine tool types (src/common/types.ts). M2 uses pointer/highlight/underline/image.
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

export interface CreateViewOptions {
  type: "pdf" | "epub" | "snapshot";
  annotations?: Annotation[];
  authorName?: string;
  viewState?: ViewState | null;
  onInitialized?: () => void;
  onSaveAnnotations?: (annotations: Annotation[]) => void;
  onDeleteAnnotations?: (ids: string[]) => void;
  onSelectAnnotations?: (ids: string[]) => void;
  onSetSelectionPopup?: (params: unknown) => void;
  onSetAnnotationPopup?: (params?: AnnotationPopupParams) => void;
  onChangeViewState?: (state: ViewState) => void;
  onChangeViewStats?: (stats: ViewStats) => void;
  onSetOutline?: (outline: unknown) => void;
  onSetPageLabels?: (labels: unknown) => void;
  onSetThumbnails?: (thumbs: unknown) => void;
  onRequestPassword?: () => void;
  onOpenLink?: (url: string) => void;
  onFindResult?: (result: unknown) => void;
}

// The engine `view` instance (subset used through M2).
export interface ViewInstance {
  zoomIn: () => void;
  zoomOut: () => void;
  // Fit-width, not 100%. The engine's View wrapper exposes no other zoom target:
  // zoomPageHeight/zoomAuto and setScrollMode exist on PDFView but are not
  // forwarded, and there is no setScale.
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

// reader-host.html (owned by the reader pipeline) loads view.js, which defines
// window.createView on the iframe window. The shell reaches in directly; there
// is no host bridge object.
interface ReaderWindow extends Window {
  createView?: (options: CreateViewOptions & { data: { buf: Uint8Array } }) => ViewInstance;
  Uint8Array: typeof Uint8Array;
}

async function waitForCreateView(iframe: HTMLIFrameElement): Promise<ReaderWindow> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const win = iframe.contentWindow as ReaderWindow | null;
    if (win && typeof win.createView === "function") return win;
    if (Date.now() > deadline) throw new Error("reader engine not ready");
    await new Promise((r) => setTimeout(r, 50));
  }
}

const noop = () => undefined;

// The engine invokes several callbacks unconditionally (e.g. onSetOutline);
// missing ones throw. Default every optional callback to a no-op.
const CALLBACK_DEFAULTS: Partial<CreateViewOptions> = {
  onInitialized: noop,
  onSaveAnnotations: noop,
  onDeleteAnnotations: noop,
  onSelectAnnotations: noop,
  onSetSelectionPopup: noop,
  onSetAnnotationPopup: noop,
  onChangeViewState: noop,
  onChangeViewStats: noop,
  onSetOutline: noop,
  onSetPageLabels: noop,
  onSetThumbnails: noop,
  onRequestPassword: noop,
  onOpenLink: noop,
  onFindResult: noop,
};

// Create a PDF view inside the iframe. The buffer is re-wrapped with the
// iframe realm's Uint8Array so the engine's cross-realm instanceof checks pass.
export async function createPdfView(
  iframe: HTMLIFrameElement,
  buffer: ArrayBuffer,
  options: CreateViewOptions,
): Promise<ViewInstance> {
  const win = await waitForCreateView(iframe);
  const buf = new win.Uint8Array(buffer);
  return win.createView!({ ...CALLBACK_DEFAULTS, ...options, data: { buf } });
}
