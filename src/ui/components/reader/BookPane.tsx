// The open book, rendered by whichever engine its format asks for: PDFium for a
// PDF, foliate-js for an EPUB. Lifted out of App, where the choice was two
// sibling branches passing the same ten handlers.
//
// The engines differ in one thing the shell can see — an EPUB's marks are never
// deleted through the engine, they are rewritten — so onDeleteAnnotations goes
// only to the PDF one. Everything else is the same book, said twice.
//
// The key is the book id on both, so switching books remounts the engine rather
// than handing a new file to a viewer still holding the old one.

import type { BookFormat } from "../../../platform/app/library";
import type { Annotation, ViewState } from "../../../platform/app/reader-contract";
import EmbedReaderPane, {
  type EmbedReaderPaneProps,
} from "../../../reading/engine/EmbedReaderPane";
import EpubReaderPane from "../../../reading/epub/EpubReaderPane";

// The author every mark this app writes is attributed to.
const AUTHOR_NAME = "Reading-Partner";

export interface OpenBook {
  docId: string;
  format: BookFormat;
  buffer: ArrayBuffer;
  annotations: Annotation[];
  viewState: ViewState | null;
}

export interface BookPaneProps
  extends Omit<
    EmbedReaderPaneProps,
    "buffer" | "annotations" | "authorName" | "viewState" | "className"
  > {
  book: OpenBook;
}

export default function BookPane({ book, ...on }: BookPaneProps) {
  const shared = {
    buffer: book.buffer,
    annotations: book.annotations,
    authorName: AUTHOR_NAME,
    viewState: book.viewState,
    onView: on.onView,
    onInitialized: on.onInitialized,
    onError: on.onError,
    onChangeViewState: on.onChangeViewState,
    onChangeViewStats: on.onChangeViewStats,
    onSaveAnnotations: on.onSaveAnnotations,
    // Native selection already happened — just reflect it (no echo, which would
    // loop through the engine's own selection state).
    onSelectAnnotations: on.onSelectAnnotations,
    onSetAnnotationPopup: on.onSetAnnotationPopup,
    onQuoteHighlightChange: on.onQuoteHighlightChange,
  };
  return book.format === "epub" ? (
    <EpubReaderPane key={book.docId} {...shared} bookId={book.docId} className="block" />
  ) : (
    <EmbedReaderPane
      key={book.docId}
      {...shared}
      className="h-full w-full block"
      onDeleteAnnotations={on.onDeleteAnnotations}
    />
  );
}
