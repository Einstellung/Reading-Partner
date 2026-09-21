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
