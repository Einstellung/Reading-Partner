// The phone's reflow reading area (docs/70): the props the shell hands it and
// the handle it hands back. Declared apart from the pane so the shell can be
// written against it before the pane exists.

import type {
  Annotation,
  AnnotationPopupParams,
  ViewState,
  ViewStats,
} from "../../platform/app/reader-contract";
import type { FlowDisplay } from "./flow-display";

export interface FlowTool {
  type: "none" | "highlight";
  color: string;
}

export interface FlowReaderView {
  goToCfi(cfi: string): void;
  goToHref(href: string): void;
  goToPage(pageIndex: number): void;
  /**
   * An outline row was tapped: the page its chapter starts on. The scrolled
   * column goes to the page, where the heading is on screen with it; the paged
   * view goes to the screen the heading is on, which can be the page's second.
   */
  goToChapter(pageIndex: number): void;
  /**
   * Scroll to a passage the AI cited on a page and band it in the violet the
   * sheets use (ViewInstance.highlightQuote): the words are looked for from
   * that page's start and land about a third down the viewport. Resolves true
   * once they are banded; false when they are not in the book, and the column
   * is then at the start of the page. The band goes on the next tap on the
   * page, the next citation, or any other going somewhere.
   */
  highlightQuote(pageIndex: number, req: { searchText: string; displayText: string }): Promise<boolean>;
  clearQuoteHighlight(): void;
  removeAnnotations(ids: string[]): void;
  setTool(tool: FlowTool): void;
  /**
   * Lay the column out again at this type and this paper. The reader stays on
   * the character that was at the top edge and the marks are measured again,
   * the same way a change of width is handled.
   */
  setDisplay(display: FlowDisplay): void;
  destroy(): void;
}

export interface FlowReaderPaneProps {
  bookId: string;
  buffer: ArrayBuffer;
  annotations: Annotation[];
  authorName: string;
  viewState: ViewState | null;
  tool: FlowTool;
  /** The type and paper the column mounts at, so it never starts at a default
   *  the reader has already moved off. */
  display: FlowDisplay;
  /**
   * The width of the left band the shell's back gesture owns. In the paged
   * view a touch starting there is left to the shell; elsewhere a swipe to the
   * right turns back a page.
   */
  backEdgePx?: number;
  onView: (view: FlowReaderView) => void;
  onInitialized: () => void;
  onError: (e: Error) => void;
  onChangeViewState: (s: ViewState) => void;
  onChangeViewStats: (s: ViewStats) => void;
  onSaveAnnotations: (anns: Annotation[]) => void;
  onSelectAnnotations: (ids: string[]) => void;
  onSetAnnotationPopup: (params?: AnnotationPopupParams) => void;
  className?: string;
}
