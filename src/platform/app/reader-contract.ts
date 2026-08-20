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
  // Legacy: the book-level chat's classroom mode, back when classroom was a mode
  // rather than the top-bar entry itself (docs/09). Files written by older builds
  // carry it; nothing writes it and nothing reads it. Declared for one release so
  // a sync round-trip does not look like a schema change, then gone — along with
  // the `rehearsal` key some builds wrote beside it (a rehearsal is a talk now,
  // docs/31).
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

// Which pen drew a mark. The AI pen draws the same underline the underline pen
// does and is told apart by the thread it opens, so it is recorded rather than
// read back off the stroke.
export type MarkPen = "highlight" | "underline" | "ai";

// Where a mark drawn on an AI reply sits (docs/09). The classroom's answers are
// the book continued, so both pens work on them — but there is no page under
// the words, so such a mark carries this instead of position.pageIndex + rects
// and never reaches the engine (pageMarks).
//
// The words, never a character offset. linkifyCitations rewrites a message's
// source before react-markdown parses it, so an offset taken off the rendering
// indexes different characters of message.text — or runs past its end.
export interface ChatAnchor {
  threadId: string;
  // The ts of the assistant message that was marked, which is its id inside
  // that thread.
  messageTs: number;
  // The rendered words the reader drew over, verbatim — not collapsed, not
  // clipped, or reading/chat-marks.ts cannot find them again.
  text: string;
  // Which occurrence of those words in that message this is, 0-based, so a
  // phrase the reply uses twice marks the copy that was drawn over.
  occurrence: number;
  pen: MarkPen;
}

// Minimal annotation shape; unknown fields round-trip untouched.
//
// A mark is anchored one of two ways and never both: on a page, by
// position.pageIndex + rects, which is what the engine reads; or on an AI
// reply, by `chatAnchor`. Files written before chat marks existed carry no
// `chatAnchor` at all, which reads as a page mark, which is what they are.
export interface Annotation {
  id: string;
  type: string;
  chatAnchor?: ChatAnchor;
  [key: string]: unknown;
}

const MARK_PENS: readonly string[] = ["highlight", "underline", "ai"];

// A mark's chat anchor, or null when it is a page mark. Tolerant of a partial
// record — the file syncs between devices on different builds — but the three
// fields that locate the words are required: without them there is nothing to
// point at and the entry is read as a page mark, which is where it came from.
export function chatAnchorOf(
  ann: { chatAnchor?: unknown } | null | undefined,
): ChatAnchor | null {
  const raw = ann?.chatAnchor as Partial<ChatAnchor> | undefined;
  if (!raw || typeof raw !== "object") return null;
  const { threadId, messageTs, text } = raw;
  if (typeof threadId !== "string" || threadId === "") return null;
  if (typeof messageTs !== "number" || !Number.isFinite(messageTs)) return null;
  if (typeof text !== "string" || text === "") return null;
  const occurrence =
    typeof raw.occurrence === "number" && Number.isInteger(raw.occurrence) && raw.occurrence >= 0
      ? raw.occurrence
      : 0;
  // A mark whose pen does not read is still a mark: it is drawn as an underline
  // rather than dropped.
  const pen =
    typeof raw.pen === "string" && MARK_PENS.includes(raw.pen) ? (raw.pen as MarkPen) : "underline";
  return { threadId, messageTs, text, occurrence, pen };
}

export function isChatMark(ann: { chatAnchor?: unknown } | null | undefined): boolean {
  return chatAnchorOf(ann) !== null;
}

export function isPageMark(ann: { chatAnchor?: unknown } | null | undefined): boolean {
  return chatAnchorOf(ann) === null;
}

// The half of a book's marks the engine may be handed. Every path that gives
// EmbedPDF a set goes through this: a chat mark has no page anchor, and the
// engine draws what it is given wherever it can or throws.
export function pageMarks(annotations: readonly Annotation[]): Annotation[] {
  return annotations.filter(isPageMark);
}

// The other half. Same file, same trace list, drawn by the chat instead.
export function chatMarks(annotations: readonly Annotation[]): Annotation[] {
  return annotations.filter(isChatMark);
}

// Engine annotation page (0-based position.pageIndex) -> 1-based page for the
// full-text helpers. Null when the annotation has no page, which every chat
// mark is: it was drawn on a reply, and every caller already had to take null
// for an answer. It sits with the
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
