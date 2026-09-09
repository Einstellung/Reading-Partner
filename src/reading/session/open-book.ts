// Opening a book, in order. Three things happen here and the order between them
// is the whole content of this file: what the book being left is owed, what the
// next one must have before it can be drawn, and what is started in the
// background and joined when it lands.
//
// It runs against ReaderShell rather than against App's state, so the sequence
// can be read and tested on its own — a book switch that abandons a stale
// extraction is a fact about this function, not about a component.

import { getViewState } from "../../platform/app/storage";
import { loadAnnotations } from "../../platform/app/annotations";
import { loadThreads } from "../../platform/app/threads";
import { pageMarks, type Annotation, type ViewState } from "../../platform/app/reader-contract";
import { formatOfBytes, type BookFormat } from "../../platform/app/library";
import { ensureFulltext, type Fulltext } from "../../fulltext";
import { sweepDistillation } from "../../memory";
import { acquireEpub, ensurePagination, extractEpubFulltext } from "../epub";
import { epubFigures } from "../figures/epub";
import { clearFigureCache, ensureFigures, type FiguresIndex } from "../figures";
import { seedReadingPosition } from "../reading-position";
import type { ReaderShell } from "./shell";

// What opening a book reads and starts. An argument, so the sequence can be run
// on a fake filesystem; App passes nothing and gets the real one.
export interface BookOpenIo {
  getViewState(bookId: string): Promise<ViewState | null>;
  loadAnnotations(bookId: string): Promise<Annotation[]>;
  loadThreads(bookId: string): Promise<unknown>;
  ensureFulltext(bookId: string, buffer: ArrayBuffer, format: BookFormat): Promise<Fulltext>;
  ensureFigures(bookId: string, buffer: ArrayBuffer, format: BookFormat): Promise<FiguresIndex>;
  clearFigureCache(): void;
  seedReadingPosition(bookId: string, state: ViewState | null): void;
  // What the book being left still owes (docs/02).
  sweepDistillation(trigger: "book-switch"): void;
}

export const bookOpenIo: BookOpenIo = {
  getViewState,
  loadAnnotations,
  loadThreads,
  // The two extractions are one dispatch on the format and nothing else: an
  // EPUB produces the same Fulltext and the same figure index a PDF does, so
  // everything downstream of these two calls is shared (docs/39 §1).
  ensureFulltext: (bookId, buffer, format) =>
    format === "epub"
      ? ensureFulltext(bookId, buffer, (b) => extractEpubFulltext(bookId, b))
      : ensureFulltext(bookId, buffer),
  ensureFigures: (bookId, buffer, format) =>
    format === "epub"
      ? ensureFigures(bookId, buffer, Date.now, async (b) => {
          // The same parsed book the full text and the reading pane read: an
          // EPUB is unzipped once per open, not once per consumer (book-cache.ts).
          const book = acquireEpub(bookId, b);
          return epubFigures(book, await ensurePagination(bookId, book));
        })
      : ensureFigures(bookId, buffer),
  clearFigureCache,
  seedReadingPosition,
  sweepDistillation: (trigger) => void sweepDistillation(trigger),
};

// Reading layout for a book that has never chosen one: vertical continuous
// scroll on every surface (the correct PDF-reading default; a finger swipe
// scrolls, like Notability / PDF Expert). Paged horizontal flip stays available
// as an opt-in in the reader's More menu, off by default.
export const DEFAULT_LAYOUT = "vertical" as const;

// The state the reader is mounted with: what was saved, with a layout for a
// book that never chose one, so it opens in the right mode on the first paint.
export function openingViewState(saved: ViewState | null): ViewState {
  return saved
    ? { ...saved, layout: saved.layout ?? DEFAULT_LAYOUT }
    : ({ pageIndex: 0, scale: "auto", scrollMode: 0, layout: DEFAULT_LAYOUT } as ViewState);
}

export async function openBook(
  shell: ReaderShell,
  book: { bookId: string; name: string; bytes: Uint8Array },
  io: BookOpenIo = bookOpenIo,
): Promise<void> {
  const { bookId, name, bytes } = book;
  // The bytes say what the book is; nothing has to carry the format down here
  // alongside them, and a copy that arrived over sync before its registry entry
  // did is read the same way as one this device imported.
  const format = formatOfBytes(bytes);
  shell.showStatus("Rendering…");
  shell.closeAnnotationPopup();
  // Leaving a book with a call open ends that conversation, same as closing the
  // reader. First thing in, while the refs the hangup reads still point at the
  // book being left.
  shell.captureHangup();
  // And a look at what the book being left still owes: a stretch of reading with
  // nothing said in it never reaches the hangup path at all.
  io.sweepDistillation("book-switch");
  shell.closeCall();
  shell.discardStagedImages();
  shell.clearSelectedMark();
  shell.resetTool();

  // Every read here is optional: the book opens either way, and being told which
  // part of it could not be loaded beats being told the book could not be.
  let state: ViewState | null = null;
  try {
    state = await io.getViewState(bookId);
  } catch (e) {
    console.error("failed to load the reading position", e);
    shell.pushToast("warn", "Saved reading position could not be loaded");
  }
  let saved: Annotation[] = [];
  try {
    saved = await io.loadAnnotations(bookId);
  } catch (e) {
    console.error("failed to load annotations", e);
    shell.pushToast("warn", "Saved annotations could not be loaded");
  }
  try {
    await io.loadThreads(bookId);
  } catch (e) {
    console.error("failed to load threads", e);
    shell.pushToast("warn", "Saved AI conversations could not be loaded");
  }
  shell.showMarks(saved);

  shell.readerNotReady();
  // One copy of the book, shared by everything that reads it. pdf.js does detach
  // the buffer it is handed, but every consumer here already slices its own
  // before handing it over (fulltext/extract.ts, figures/store.ts,
  // figures/render.ts, EmbedPdfView's wireEngine), so a copy per consumer was
  // five 26 MB allocations at book-open where one does.
  const buffer = bytes.slice().buffer as ArrayBuffer;
  shell.takeBook(bookId, name, buffer);
  // Seed the persist base with the loaded state so the first write for this book
  // lands on the position it opened at.
  io.seedReadingPosition(bookId, state);
  shell.restartDwell();

  // Detach the previous book's prep panel (the pipeline itself keeps running in
  // the background as a module singleton). The spine is per book too. Prep for this
  // book re-attaches below only if it has been prepped before; starting a fresh
  // run is the trigger's (reading/session/use-prep-trigger.ts), not the open's.
  shell.resetPrep();
  shell.resetChapterSpine();

  // Extract the full text and the figure index in the background so the AI can
  // see the book (M6, M9). Fire-and-forget: neither blocks rendering, and a book
  // switch while one is running throws its result away.
  shell.showFulltext(null, true);
  shell.showFigures([]);
  io.clearFigureCache();

  const figures = io.ensureFigures(bookId, buffer, format).catch((e) => {
    console.warn("failed to extract figures", e);
    return null;
  });
  shell.trackFigures(figures);
  void figures.then((idx) => {
    if (shell.currentBookId() !== bookId) return; // stale: the user switched books
    shell.showFigures(idx?.figures ?? []);
  });

  const fulltext = io.ensureFulltext(bookId, buffer, format).catch((e) => {
    console.warn("failed to extract fulltext", e);
    return null;
  });
  shell.trackFulltext(fulltext);
  void fulltext.then(async (ft) => {
    if (shell.currentBookId() !== bookId) return; // stale: the user switched books
    shell.showFulltext(ft, false);
    if (ft && ft.status === "ok") {
      await shell.resumePrep(bookId, name, ft);
      await shell.resumeChapterSpine(bookId, name, ft);
    }
  });

  // Mount the reader pane with the bytes. It calls back onView and onInitialized
  // once ready. It slices its own copy for PDFium and never detaches this one, so
  // it reads the shared buffer.
  // The engine gets the page-anchored half only. The other half was drawn on
  // the classroom's replies and has no page for EmbedPDF to put it on; the shell
  // keeps the whole set (showMarks above), which is what is written back.
  shell.mountReader({
    bookId,
    name,
    format,
    buffer,
    annotations: pageMarks(saved),
    viewState: openingViewState(state),
  });
  shell.showTitle(name);
}
