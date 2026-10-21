// A brief issue in the reader (docs/info/88 「简报书」): which mode a document
// opens in, and what the door's turn tells the model while one is open.
//
// An issue reads without the lesson and without the reader's own conversation;
// the one who talks about it is the companion, in the day's conversation at the door.
// Where the reader is in it, what they marked and which page a quoted question
// came from go to the model as an app note on the reader's line, the way
// take_link's numbering does (reading/ingest/take-link-tool.ts): never into the
// thread file, never on screen.

import type { LibraryEntry } from "../platform/app/library";
import { annotationPage, isPageMark, type Annotation } from "../platform/app/reader-contract";
import { locateQuote } from "./prep/quote-locate";

// The words a mark shows (the same rule as reading/turn/reopen.ts markExcerpt,
// which this directory cannot import without a cycle).
function markExcerpt(mark: Annotation): string {
  if (typeof mark.text === "string" && mark.text) return mark.text;
  if (typeof mark.comment === "string" && mark.comment) return mark.comment;
  return "";
}

export type ReaderMode = "book" | "issue";

/** An issue is the night's brief; every other document reads as a book. */
export function readerModeOf(entry: Pick<LibraryEntry, "kind"> | null | undefined): ReaderMode {
  return entry?.kind === "issue" ? "issue" : "book";
}

export interface IssueHighlight {
  /** 1-based; null when the mark carries no page. */
  page: number | null;
  text: string;
}

// An issue is read the day it lands and its marks carry no time, so the note
// lists all of them; a brief has a dozen pages, and a reader who marked more
// than this many is better served by the first ones than by a wall.
export const HIGHLIGHT_MAX = 12;
const HIGHLIGHT_CHARS = 200;

function clip(text: string): string {
  return text.length <= HIGHLIGHT_CHARS ? text : `${text.slice(0, HIGHLIGHT_CHARS - 1)}…`;
}

/** The passages the reader marked in the issue, in page order. */
export function issueHighlights(marks: readonly Annotation[]): IssueHighlight[] {
  const out: IssueHighlight[] = [];
  for (const mark of marks) {
    if (!isPageMark(mark)) continue;
    const text = markExcerpt(mark).replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push({ page: annotationPage(mark as { position?: { pageIndex?: number } }), text: clip(text) });
  }
  out.sort((a, b) => (a.page ?? Number.MAX_SAFE_INTEGER) - (b.page ?? Number.MAX_SAFE_INTEGER));
  return out.slice(0, HIGHLIGHT_MAX);
}

/** The first page (1-based) whose text holds the quote; null when none does. */
export function pageOfQuote(fulltext: { pages: readonly string[] } | null, quote: string): number | null {
  if (!fulltext || !quote.trim()) return null;
  for (let i = 0; i < fulltext.pages.length; i++) {
    const text = fulltext.pages[i];
    if (text && locateQuote(text, quote) !== null) return i + 1;
  }
  return null;
}

/**
 * The page (1-based) an item of the brief stands on, found by its heading: the
 * page that opens with it (an entry's section), otherwise the first page that
 * holds it other than the contents (a Note). Null when no page does.
 */
export function headingPage(fulltext: { pages: readonly string[] } | null, heading: string): number | null {
  if (!fulltext || !heading.trim()) return null;
  const fold = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const want = fold(heading);
  const opens = fulltext.pages.findIndex((p) => p && fold(p).startsWith(want));
  if (opens >= 0) return opens + 1;
  for (let i = 0; i < fulltext.pages.length; i++) {
    const text = fulltext.pages[i];
    if (!text || /^\s*contents\b/i.test(text)) continue;
    if (locateQuote(text, heading) !== null) return i + 1;
  }
  return null;
}

export interface IssueNoteInput {
  title: string;
  /** Where the reader is, 1-based, and how many pages there are; null before the view reports. */
  page: number | null;
  pageCount: number | null;
  highlights: readonly IssueHighlight[];
  /** The line quotes a passage (ui/components/chat/quoted-question.ts). */
  quotes: boolean;
  /** The page that passage is on, when the issue's text finds it. */
  quotePage: number | null;
}

/**
 * The note on the reader's line while an issue is open. It says what the
 * reader is looking at; the book itself is on the desk (issue-desk.ts).
 */
export function issueTurnNote(input: IssueNoteInput): string {
  const where =
    input.page !== null
      ? input.pageCount !== null
        ? `, on page ${input.page} of ${input.pageCount}`
        : `, on page ${input.page}`
      : "";
  const marks =
    input.highlights.length > 0
      ? `Passages they marked in it: ${input.highlights
          .map((h) => `${h.page !== null ? `p.${h.page} ` : ""}"${h.text}"`)
          .join("; ")}.`
      : "They have marked nothing in it.";
  const quoted = input.quotes
    ? input.quotePage !== null
      ? ` The passage quoted at the top of this message is on page ${input.quotePage}.`
      : " The passage quoted at the top of this message is from the brief."
    : "";
  return (
    `\n\n[App note, not the reader's words. The reader has the brief "${input.title}" open${where}. ` +
    `${marks}${quoted} Bring the marks up only where they bear on what is asked.]`
  );
}

/** An item of the brief and the page (1-based) it stands on; null when no page holds its heading. */
export interface IssueContentsLine {
  heading: string;
  page: number | null;
}

/** The brief's items by their headings, each with the page it stands on. */
export function issueContents(
  fulltext: { pages: readonly string[] } | null,
  headings: readonly string[],
): IssueContentsLine[] {
  return headings.map((heading) => ({ heading, page: headingPage(fulltext, heading) }));
}

// A voice call's front has a short context by design (docs/companion/136), so
// it gets fewer and shorter marks than the door's note, and headings cut short.
export const CALL_HIGHLIGHT_MAX = 4;
const CALL_HIGHLIGHT_CHARS = 80;
const CALL_HEADING_CHARS = 60;

function cut(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
}

export interface IssueCallPlaceInput {
  title: string;
  page: number | null;
  pageCount: number | null;
  highlights: readonly IssueHighlight[];
  contents: readonly IssueContentsLine[];
}

/**
 * What a voice call's front is told while a brief is open (docs/info/88
 * 「简报的对话」): which one, where the reader is in it, what they marked, and
 * what is in it. The contents go last because the front's place is cut from
 * the end. The text itself is not here; a question about what an item says
 * goes to a think run, whose desk has the brief.
 */
export function issueCallPlace(input: IssueCallPlaceInput): string {
  const where =
    input.page !== null
      ? input.pageCount !== null
        ? `, on page ${input.page} of ${input.pageCount}`
        : `, on page ${input.page}`
      : "";
  const lines = [
    `They have the brief "${input.title}" open in the reader${where}.`,
    "You have its headings, not its text: delegate anything about what an item says.",
  ];
  if (input.highlights.length > 0) {
    const shown = input.highlights
      .slice(0, CALL_HIGHLIGHT_MAX)
      .map((h) => `${h.page !== null ? `p.${h.page} ` : ""}"${cut(h.text, CALL_HIGHLIGHT_CHARS)}"`);
    lines.push(`They marked: ${shown.join("; ")}.`);
  }
  if (input.contents.length > 0) {
    const items = input.contents.map((c) => {
      const heading = cut(c.heading, CALL_HEADING_CHARS);
      return c.page !== null ? `p.${c.page} ${heading}` : heading;
    });
    lines.push(`In it: ${items.join("; ")}.`);
  }
  return lines.join("\n");
}
