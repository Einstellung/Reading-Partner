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
  canZoomReset: boolean;
}

// Minimal annotation shape; the engine round-trips unknown fields untouched.
export interface Annotation {
  id: string;
  type: string;
  [key: string]: unknown;
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
  onSetAnnotationPopup?: (params: unknown) => void;
  onChangeViewState?: (state: ViewState) => void;
  onChangeViewStats?: (stats: ViewStats) => void;
  onSetOutline?: (outline: unknown) => void;
  onSetPageLabels?: (labels: unknown) => void;
  onSetThumbnails?: (thumbs: unknown) => void;
  onRequestPassword?: () => void;
  onOpenLink?: (url: string) => void;
  onFindResult?: (result: unknown) => void;
}

// The engine `view` instance (subset used in M1).
export interface ViewInstance {
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  navigate: (target: { pageIndex?: number; annotationID?: string }) => void;
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
