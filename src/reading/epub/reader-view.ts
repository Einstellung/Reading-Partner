// Driving foliate-js: the imperative half of the EPUB reading area, and the
// place the shell's ViewInstance is implemented (platform/app/reader-contract).
//
// It is not a component because none of it is rendering. The pane below it owns
// one element and the events landing on it; everything that happens to the book
// happens here.
//
// Two facts shape the whole file. The book's frame is sandboxed without
// allow-scripts, so it dispatches no events at all (docs/pitfall/244) — every
// gesture is read by the pane on the element around the frame and arrives here
// as a call. And the renderer speaks CFIs, while the rest of the app speaks
// position block numbers, so both directions of that map are crossed here:
// going in, `pagination.blocks[i].cfi`; coming out, the visible range's offset
// into the same extracted text the blocks were cut from.

import type {
  Annotation,
  Tool,
  ViewInstance,
  ViewState,
  ViewStats,
} from "../../platform/app/reader-contract";
import { openExternal } from "../../platform/app/external-link";
import { acquireEpub, ensurePagination, releaseEpub } from "./book-cache";
import type { Pagination } from "./paginate";
import {
  DEFAULT_FONT_STEP,
  blockIndexAt,
  bookLinkTarget,
  cfiForBlock,
  clampFontStep,
  flowFor,
  indexRuns,
  offsetOfPoint,
  openingFontStep,
  quoteQueries,
  restoreTarget,
  statsOf,
  viewStateOf,
} from "./reader-logic";
import { RENDERER_GEOMETRY, readerCss, readerThemeOf } from "./reader-styles";
import { createRenderBook } from "./render-book";
import { extractDocumentText, type DocumentText, type TextRun } from "./text";

// The same violet the PDF side paints an AI-cited quote in
// (reading/engine/EmbedPdfView.tsx). One quote is on screen at a time, so it
// needs one key.
const QUOTE_COLOR = "#4a3a9e";
const QUOTE_KEY = "reading-partner:quote";

export interface EpubReaderCallbacks {
  onChangeViewState(state: ViewState): void;
  onChangeViewStats(stats: ViewStats): void;
  onQuoteHighlightChange(active: boolean): void;
}

export interface EpubReaderController extends ViewInstance {
  /**
   * Follow the book's own link under this point in the page, if there is one.
   * True when the tap was spent on a link and must not also turn the page.
   */
  followLinkAt(clientX: number, clientY: number): boolean;
  /** Turn one page (paged) or one screen (continuous). */
  turn(direction: "prev" | "next"): void;
  /** The layout in force, for the pane's event routing. */
  currentLayout(): "vertical" | "paged";
  /** Re-read the app's colours into the book's frame. */
  refreshTheme(): void;
  destroy(): void;
}

interface Contents {
  index: number;
  doc: Document;
  overlayer?: {
    add(key: string, range: Range, draw: unknown, options?: unknown): void;
    remove(key: string): void;
  };
}

interface FoliateView extends HTMLElement {
  open(book: unknown): Promise<void>;
  init(opts: { lastLocation?: unknown; showTextStart?: boolean }): Promise<void>;
  close(): void;
  goTo(target: unknown): Promise<unknown>;
  next(): Promise<void>;
  prev(): Promise<void>;
  lastLocation?: { cfi?: string; range?: Range };
  renderer: HTMLElement & {
    getContents(): Contents[];
    render(): void;
    setStyles(styles: string): void;
    scrollToAnchor(anchor: Range | Element, select?: boolean): Promise<void>;
  };
}

export interface EpubReaderOptions {
  host: HTMLElement;
  bookId: string;
  buffer: ArrayBuffer;
  viewState: ViewState | null;
  /** The element the app's custom properties are declared on (documentElement). */
  themeRoot: HTMLElement | null;
  callbacks: EpubReaderCallbacks;
}

/**
 * Open a book into `host` and hand back the handle the shell drives. Resolves
 * once the first screen has been laid out; a failure to get that far rejects,
 * and the shell says the book could not be opened rather than showing an empty
 * reading area.
 */
export async function createEpubReader(
  opts: EpubReaderOptions,
): Promise<EpubReaderController> {
  const { host, bookId, buffer, viewState, themeRoot, callbacks } = opts;

  const book = acquireEpub(bookId, buffer);
  const pagination: Pagination = await ensurePagination(bookId, book);
  const rendition = await createRenderBook(book);

  // Registering <foliate-view> is a side effect of importing view.js.
  await import("foliate-js/view.js");
  const { Overlayer } = await import("foliate-js/overlayer.js");

  const view = document.createElement("foliate-view") as FoliateView;
  view.style.display = "block";
  view.style.width = "100%";
  view.style.height = "100%";
  // The measure, and the margin, both on the element — because the renderer
  // sizes its two flows against two different containers, and anything left to
  // it comes out at two widths (docs/pitfall/251). Capping the element caps the
  // line: paginated flow gives its container's whole width to one column, and
  // `max-inline-size` only decides how many columns fit, not how wide one is
  // (docs/pitfall/247). The padding is the white space beside the text, which
  // is the same on both sides of the frame in both flows. The surface around
  // the element stays full width, so the tap zones still reach the screen edge.
  view.style.maxWidth = "48rem";
  view.style.margin = "0 auto";
  view.style.paddingInline = "1.5rem";
  host.replaceChildren(view);

  let layout: "vertical" | "paged" = viewState?.layout ?? "vertical";
  let fontStep = openingFontStep(viewState);
  let pageIndex = viewState?.pageIndex ?? 0;
  let quoteActive = false;
  let destroyed = false;

  // The extracted text of each frame document, so a visible range becomes an
  // offset. Keyed on the document itself: the renderer builds a new one for
  // every section it loads and drops the old one, and this map goes with it.
  const texts = new WeakMap<Document, { text: DocumentText; runs: Map<Node, TextRun> }>();
  function textOf(doc: Document): { text: DocumentText; runs: Map<Node, TextRun> } {
    const cached = texts.get(doc);
    if (cached) return cached;
    const text = extractDocumentText(doc);
    const entry = { text, runs: indexRuns(text) };
    texts.set(doc, entry);
    return entry;
  }

  function contents(): Contents | null {
    return view.renderer?.getContents?.()[0] ?? null;
  }

  function applyStyles(): void {
    view.renderer?.setStyles?.(readerCss(fontStep, readerThemeOf(themeRoot)));
  }

  function emit(cfi: string | null): void {
    callbacks.onChangeViewStats(statsOf({ pageIndex, pagination, fontStep, layout }));
    callbacks.onChangeViewState(viewStateOf({ pageIndex, cfi, fontStep, layout }));
  }

  // Where the renderer says it is, in the numbers the app speaks. The visible
  // range's start is the point: it is the first thing on the screen, which is
  // what "the page you are on" means in both layouts.
  function onRelocate(): void {
    if (destroyed) return;
    const c = contents();
    if (!c?.doc) return;
    const loc = view.lastLocation;
    const { text, runs } = textOf(c.doc);
    const range = loc?.range;
    const offset = range
      ? offsetOfPoint(text, runs, range.startContainer, range.startOffset)
      : 0;
    pageIndex = blockIndexAt(pagination, c.index, offset);
    emit(loc?.cfi ?? null);
  }

  view.addEventListener("relocate", onRelocate);

  await view.open(rendition);
  const renderer = view.renderer;
  renderer.setAttribute("flow", flowFor(layout));
  for (const [name, value] of Object.entries(RENDERER_GEOMETRY)) {
    renderer.setAttribute(name, value);
  }
  applyStyles();
  // open() hands the book over and lays nothing out; without init() the
  // renderer sits on an empty frame and `relocate` never fires, which reads
  // exactly like a hang (docs/62 §3).
  await view.init({ lastLocation: restoreTarget(pagination, viewState), showTextStart: false });

  function setFontStep(next: number): void {
    const step = clampFontStep(next);
    if (step === fontStep) return;
    fontStep = step;
    applyStyles();
    emit(view.lastLocation?.cfi ?? null);
  }

  function clearQuote(): void {
    if (!quoteActive) return;
    quoteActive = false;
    contents()?.overlayer?.remove(QUOTE_KEY);
    callbacks.onQuoteHighlightChange(false);
  }

  async function findQuote(doc: Document, searchText: string): Promise<Range | null> {
    const [{ searchMatcher }, { textWalker }] = await Promise.all([
      import("foliate-js/search.js"),
      import("foliate-js/text-walker.js"),
    ]);
    const matcher = searchMatcher(textWalker, {
      defaultLocale: doc.documentElement.lang || "en",
    }) as (d: Document, q: string) => Iterable<{ range: Range }>;
    for (const query of quoteQueries(searchText)) {
      for (const hit of matcher(doc, query)) {
        if (hit?.range) return hit.range;
      }
    }
    return null;
  }

  async function goToBlock(index: number): Promise<void> {
    const cfi = cfiForBlock(pagination, index);
    if (cfi) await view.goTo(cfi);
  }

  // The anchor at a point on the page, hit-tested inside the frame. The frame
  // is same-origin, so its document answers elementFromPoint; the coordinates
  // are the page's, and the frame's own box is what puts them in its space.
  function anchorAt(clientX: number, clientY: number): Element | null {
    const c = contents();
    const frame = c?.doc?.defaultView?.frameElement;
    if (!c?.doc || !frame) return null;
    const box = frame.getBoundingClientRect();
    const el = c.doc.elementFromPoint(clientX - box.left, clientY - box.top);
    return el?.closest?.("a[href]") ?? null;
  }

  const controller: EpubReaderController = {
    zoomIn: () => setFontStep(fontStep + 1),
    zoomOut: () => setFontStep(fontStep - 1),
    zoomReset: () => setFontStep(DEFAULT_FONT_STEP),

    setLayout: (mode) => {
      if (mode === layout) return;
      layout = mode;
      renderer.setAttribute("flow", flowFor(mode));
      // Changing `flow` at runtime does not recompute the column width: the
      // spike measured the text keeping about 55% of the screen after a switch
      // (docs/62 §6). The attribute change is answered synchronously, against
      // the container the layout being left had sized. A second render, once
      // layout has run, is what makes the switch land.
      requestAnimationFrame(() => {
        if (destroyed) return;
        renderer.render();
        emit(view.lastLocation?.cfi ?? null);
      });
      emit(view.lastLocation?.cfi ?? null);
    },

    navigate: (target) => {
      clearQuote();
      if (typeof target.pageIndex === "number") void goToBlock(target.pageIndex);
      // target.annotationID is stage 4: an EPUB has no marks yet (docs/39 §5).
    },

    highlightQuote: async (page, req) => {
      clearQuote();
      await goToBlock(page);
      const c = contents();
      if (!c?.doc || !c.overlayer) return false;
      const range = await findQuote(c.doc, req.searchText);
      if (!range) return false;
      await renderer.scrollToAnchor(range);
      // Re-read the contents: scrolling to the anchor may have moved to another
      // section, which is a different document and a different overlayer.
      const after = contents();
      if (!after?.overlayer) return false;
      after.overlayer.add(QUOTE_KEY, range, Overlayer.highlight, { color: QUOTE_COLOR });
      quoteActive = true;
      callbacks.onQuoteHighlightChange(true);
      return true;
    },

    clearQuoteHighlight: clearQuote,

    // Marks on an EPUB are stage 4 (docs/39 §5): the selection-to-CFI path, the
    // overlayer's hit testing and the pen routing all still have to be built on
    // the parent page. Until then these are answered rather than thrown, so the
    // shell can drive one reader without asking which format it is.
    setTool: (_tool?: Tool) => {},
    setFingerDraw: (_on: boolean) => {},
    setAnnotations: (_anns: Annotation[]) => {},
    unsetAnnotations: (_ids: string[]) => {},
    selectAnnotations: (_ids: string[]) => {},

    followLinkAt: (clientX, clientY) => {
      const c = contents();
      const anchor = anchorAt(clientX, clientY);
      if (!c || !anchor) return false;
      const target = bookLinkTarget(anchor.getAttribute("href"));
      if (!target) return false;
      if (target.kind === "external") {
        openExternal(target.url);
        return true;
      }
      // Against the section the anchor is in, so a relative path is resolved
      // the same way foliate resolves the ones it loads.
      const section = rendition.sections[c.index];
      const href = section?.resolveHref?.(target.href) ?? target.href;
      clearQuote();
      void view.goTo(href);
      return true;
    },

    turn: (direction) => {
      clearQuote();
      void (direction === "prev" ? view.prev() : view.next());
    },
    currentLayout: () => layout,
    refreshTheme: applyStyles,
    destroy: () => {
      destroyed = true;
      view.removeEventListener("relocate", onRelocate);
      try {
        view.close();
      } catch {
        // A view that never finished opening has nothing to close.
      }
      view.remove();
      (rendition as { destroy?: () => void }).destroy?.();
      releaseEpub(bookId);
    },
  };

  // The first screen: init() has laid it out, and relocate has already fired
  // with it, but a book restored to a saved CFI reports its position before the
  // shell has the handle. One more emit, so the top bar is right on arrival.
  onRelocate();
  return controller;
}
