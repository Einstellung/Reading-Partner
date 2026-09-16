// The phone's reflow reading area (docs/69): the props the shell hands it and
// the handle it hands back. Declared apart from the pane so the shell can be
// written against it before the pane exists.

import type {
  Annotation,
  AnnotationPopupParams,
  ViewState,
  ViewStats,
} from "../../platform/app/reader-contract";

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
  destroy(): void;
}

export interface FlowReaderPaneProps {
  bookId: string;
  buffer: ArrayBuffer;
  annotations: Annotation[];
  authorName: string;
  viewState: ViewState | null;
  tool: FlowTool;
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
