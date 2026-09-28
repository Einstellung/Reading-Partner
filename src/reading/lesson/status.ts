// The one line a lesson screen shows while a PDF is being made readable, and
// the one it shows instead when it could not be. Pure, so the sequence in
// open-pdf.ts can be read, tested and reordered without a screen.
//
// Two steps and not more: the phone either has the file or is fetching it, and
// then pdf.js is reading it. Page-by-page progress is deliberately not offered
// — extraction reports none, and a bar that does not move is worse than a line
// that does not claim to.

import { t } from "../../i18n";

export type LessonOpenFailure =
  // The bytes could not be got: no copy here, and the account would not give
  // one (no network, signed out, no such blob).
  | "download"
  // pdf.js threw on the bytes. A damaged file, or one that is not a PDF.
  | "unreadable"
  // It parsed, and there is nothing to read: a scan with no text layer, or one
  // whose font maps produce garbage (fulltext status "no-text-layer").
  | "no-text";

export type LessonOpenStep =
  | { kind: "downloading" }
  | { kind: "reading" }
  | { kind: "failed"; why: LessonOpenFailure };

// Read at call time rather than hoisted into a table, so a status said after
// the reader switches languages is in the language they switched to.
function failureLine(why: LessonOpenFailure): string {
  switch (why) {
    case "download":
      return t("phone.lessonStatus.failedDownload");
    case "unreadable":
      return t("phone.lessonStatus.failedUnreadable");
    // Named as a property of the file rather than as a fault, because it is
    // one: a scanned paper is a real paper, and nothing the reader does here
    // fixes it.
    case "no-text":
      return t("phone.lessonStatus.failedNoText");
  }
}

/** The line for one step of opening a lesson. */
export function lessonStatus(step: LessonOpenStep): string {
  switch (step.kind) {
    case "downloading":
      return t("phone.lessonStatus.downloading");
    case "reading":
      return t("phone.lessonStatus.reading");
    case "failed":
      return failureLine(step.why);
  }
}

/**
 * The failure line for a full text that came back unreadable — the one case
 * that is not an exception, so the caller cannot tell it apart by catching.
 */
export function noTextStatus(): string {
  return lessonStatus({ kind: "failed", why: "no-text" });
}
