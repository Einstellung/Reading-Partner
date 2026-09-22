// The phone's lesson screen, minus React: everything the screen is handed, and
// the two lines it works out for itself.
//
// A PDF on the phone is not turned page by page — it is taught (docs/70). The
// screen is the book-level conversation with a top bar over it, and none of the
// turn is its own: the messages, the streaming flag, the chapter table and the
// focus all arrive as props, so what is left here is wording and state, which
// are testable without a renderer.
//
// The focus is the book-level thread's `focusChapter`, written by read_chapter
// and by nothing else (platform/app/threads.ts). This file never derives one —
// it only says it. What is stored there is the number printed in the book, not
// the reading order (reading/desk.ts onFocus), so every match here is on
// TableChapter.number; `index` is only ever a key.

import type { TableChapter } from "../../../reading/chapters/table";
import type { ThreadMessage } from "../chat/types";

// Where a chapter stands in this lesson. "done" is a chapter this thread has
// been taught and left; "now" is the one the focus is on; "none" is one the
// lesson has not reached — including every chapter of a lesson that has not
// started.
export type ChapterState = "done" | "now" | "none";

export interface LessonChapterRow {
  // The chapter's reading order (TableChapter.index): a key, and nothing else.
  index: number;
  // The number printed in the book, which is what the focus and the taught set
  // are in. Null for front matter and anything else that carries none — such a
  // chapter is drawn but never becomes the focus.
  number: number | null;
  title: string;
  startPage: number;
  state: ChapterState;
}

// Where the lesson is. `chapter` is the printed chapter number the thread is
// parked on; `page` is the page the AI last quoted, or null when it has not
// quoted one yet; `resumed` is a screen reopened on a lesson already under way
// that has not had a turn since, which is the one case the line says something
// other than "Now".
export interface LessonFocus {
  chapter: number;
  page: number | null;
  resumed: boolean;
}

// The two chips that sit over the composer for the whole lesson. A chip sends a
// message in the reader's own words rather than a command — the model is being
// told something, not operated (docs/09) — so each carries both the label and
// the line it sends.
export interface LessonChip {
  label: string;
  text: string;
}

export const LESSON_CHIPS: readonly LessonChip[] = [
  { label: "I don't follow", text: "I don't follow." },
  { label: "Skip", text: "Skip this one." },
];

/**
 * Everything the lesson screen takes. The turn half of it — the messages, the
 * streaming state, what a send does, the chapter table and the focus — is
 * injected: this screen assembles a lesson, it does not run one.
 */
export interface LessonViewProps {
  // The book being taught, and what its top bar calls it.
  bookId: string;
  title: string;
  onBack: () => void;
  // Hand the file to another app. Absent = this build has no such door, and the
  // top bar draws no icon for one (Android, and any iOS build without the
  // plugin).
  onOpenIn?: () => void;

  // The conversation, as CallView takes it.
  messages: ThreadMessage[];
  streaming: boolean;
  onSend: (text: string) => void;
  onStop?: () => void;
  // One line where the focus line goes, while the paper is being fetched and
  // read (reading/lesson/status.ts). Null once there is nothing to report.
  status: string | null;

  // The book's chapters, or null when nothing on this device has a table for it
  // yet — the chapter sheet then says so rather than offering an empty list.
  chapters: readonly TableChapter[] | null;
  // Which chapter the lesson is parked on, and where.
  focus: LessonFocus | null;
  // The chapters this thread's read_chapter calls have already covered, by
  // printed number. The current one is in it too and is drawn as the current
  // one.
  taught: ReadonlySet<number>;
  // A tap on a chapter. It sends a message rather than moving anything: the
  // focus is the tool's to write (docs/09).
  onPickChapter: (chapter: TableChapter) => void;

  // This screen is itself an aside off the lesson (reading/aside.ts). Absent =
  // it is the lesson.
  aside?: { onBack?: () => void };
}

/**
 * The line under the top bar. Null when there is no chapter to name — no focus,
 * or a focus whose chapter is not in the table this device has — which is also
 * what tells the row not to render, the way the desk's line does
 * (chat/chapterFocus.ts).
 */
export function lessonFocusLine(
  chapters: readonly TableChapter[] | null,
  focus: LessonFocus | null,
): string | null {
  if (!focus) return null;
  const title = chapters?.find((c) => c.number === focus.chapter)?.title.trim();
  if (!title) return null;
  if (focus.resumed) return `Continuing from: ${title}`;
  return focus.page === null ? `Now: ${title}` : `Now: ${title} · p.${focus.page}`;
}

/**
 * The chapter sheet's rows. Empty for a book with no table, which is a sheet
 * that says the paper has no chapters rather than one with nothing in it.
 */
export function lessonChapterRows(
  chapters: readonly TableChapter[] | null,
  focusChapter: number | null,
  taught: ReadonlySet<number>,
): LessonChapterRow[] {
  return (chapters ?? []).map((c) => ({
    index: c.index,
    number: c.number,
    title: c.title,
    startPage: c.startPage,
    state: state(c.number, focusChapter, taught),
  }));
}

function state(
  number: number | null,
  focusChapter: number | null,
  taught: ReadonlySet<number>,
): ChapterState {
  if (number === null) return "none";
  if (number === focusChapter) return "now";
  return taught.has(number) ? "done" : "none";
}
