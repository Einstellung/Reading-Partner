// What opening and closing a book need from the shell around them. Everything
// here is a thing App.tsx does to the screen or to one of its refs; the order
// they happen in, and what is skipped when, is the session's (open-book.ts,
// close-book.ts) and is testable without React because of this interface.
//
// The methods are named for what happens, not for the setter behind them: a
// reader of the sequence should be able to follow it without knowing which of
// them is a useState and which is a ref assignment.

import type { Annotation, ViewState } from "../../platform/app/reader-contract";
import type { Fulltext } from "../../fulltext/types";
import type { FiguresIndex } from "../figures";
import type { Figure } from "../figures";

export interface ReaderShell {
  // Transient reader progress beside the title ("Rendering…"), and the failure
  // sentences, which are toasts and never this.
  showStatus(text: string): void;
  pushToast(kind: "warn" | "error", message: string): void;
  closeAnnotationPopup(): void;

  // The conversation open on the book being left. The hangup is bookkeeping
  // (docs/02): it logs the end and hands the transcript to distillation, and it
  // has to run while the refs still point at the book being left.
  captureHangup(): void;
  closeCall(): void;
  // Staged images only ever lived in memory and every thread they belong to is
  // about to be out of reach.
  discardStagedImages(): void;
  // Turns still running on the book being closed, each keeping what it wrote.
  endBookTurns(bookId: string): void;

  clearSelectedMark(): void;
  // Every book opens with no tool held: the previous book's annotation tool
  // would otherwise mark the page the moment a finger lands.
  resetTool(): void;
  // The marks every callback reads, and the list the drawer draws.
  showMarks(marks: Annotation[]): void;

  // The engine is between documents: nothing may be told to draw yet.
  readerNotReady(): void;
  // The open book's id, name and bytes, as the stable callbacks read them.
  takeBook(bookId: string, name: string, buffer: ArrayBuffer): void;
  // Re-read after every await: a book switch mid-extraction abandons the run.
  currentBookId(): string | null;
  // Dwell tracking is per book, so there is never a cross-book page-nav event.
  restartDwell(): void;
  // The refs the reader hung on, once nothing is open.
  releaseBook(): void;

  // The two panels attached to the open book (docs/09, docs/14).
  resetPrep(): void;
  resumePrep(bookId: string, name: string, ft: Fulltext): Promise<void>;
  resetNotes(): void;
  resumeNotes(bookId: string, name: string, ft: Fulltext): Promise<void>;
  // Closing is the last moment this session's marks are all in, and the mark
  // trigger is debounced, so preparation gets one more chance on the way out
  // (reading/session/use-prep-trigger.ts).
  finalPassPrep(): void;

  // The background extractions, handed over as promises so a turn being
  // assembled can await whichever is still running.
  trackFulltext(extraction: Promise<Fulltext | null>): void;
  trackFigures(extraction: Promise<FiguresIndex | null>): void;
  showFulltext(fulltext: Fulltext | null, pending: boolean): void;
  showFigures(figures: Figure[]): void;

  // The reader pane itself.
  mountReader(doc: {
    bookId: string;
    name: string;
    buffer: ArrayBuffer;
    annotations: Annotation[];
    viewState: ViewState;
  }): void;
  unmountReader(): void;
  showTitle(name: string | null): void;
}
