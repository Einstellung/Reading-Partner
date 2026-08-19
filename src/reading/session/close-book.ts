// Closing the book. The mirror of open-book.ts, and the order matters for the
// same reason: everything the book still owes has to be collected while the refs
// still point at it.

import { sweepDistillation } from "../../observation";
import type { ReaderShell } from "./shell";

export function closeBook(
  shell: ReaderShell,
  bookId: string | null,
  sweep: (trigger: "book-switch") => void = (trigger) => void sweepDistillation(trigger),
): void {
  // Leaving the book ends every turn it has running, each keeping what it wrote.
  // A background reply is tied to the book being read, not to the app; this is
  // where it stops. Turns on other books are left alone. Before the hangup, so
  // the distillation reads the partials too.
  if (bookId) shell.endBookTurns(bookId);
  // Closing the book with a call open ends that conversation too.
  shell.captureHangup();
  sweep("book-switch");
  // Fire before the refs are torn down below.
  shell.finalPassPrep();
  shell.closeCall();
  shell.discardStagedImages();
  shell.showTitle(null);
  shell.closeAnnotationPopup();
  shell.showFulltext(null, false);
  shell.unmountReader();
  // Detach the prep UI; the pipeline keeps prepping in the background.
  shell.resetPrep();
  shell.releaseBook();
}
