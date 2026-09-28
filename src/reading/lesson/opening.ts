// What the reader says to open a lesson, and what a tap on the chapter sheet
// says (docs/74).
//
// Both are the reader's own words, written by the program. The lesson has to
// begin with the skeleton of the paper and then go straight into the first
// stop, and nothing here is a system instruction: the model is told something a
// reader would plausibly have typed, which is the same posture the two standing
// chips take (docs/09 — the AI does not open its own mouth).

import { t } from "../../i18n";
import type { TableChapter } from "../chapters";

/**
 * The first message of a lesson, sent for the reader the moment a paper that
 * has never been taught on this phone is opened.
 *
 * Three things, in the order they have to happen: the shape of the paper, how
 * figures are to be handled on a screen with no pages on it, and permission to
 * start without asking for it. In the reader's own language, since it reads as
 * something they would plausibly have typed (docs/09).
 */
export function lessonOpening(): string {
  return t("phone.lessonOpening.text");
}

/**
 * A tap on a chapter in the sheet. It asks rather than moves: the focus is
 * read_chapter's to write and nothing else may write one (docs/09), so the tap
 * sends a line and the tool does the parking.
 */
export function takeMeTo(chapter: TableChapter): string {
  const title = chapter.title.trim().replace(/[.。]+$/, "");
  if (title) return t("phone.lessonOpening.takeMeToChapterTitle", { title });
  // A chapter with no title of its own is still a chapter to be taught; the
  // printed number is what the reader has to point at with.
  return chapter.number === null
    ? t("phone.lessonOpening.takeMeToPage", { page: chapter.startPage })
    : t("phone.lessonOpening.takeMeToChapterNumber", { number: chapter.number });
}
