// read_chapter (docs/09): the whole of one chapter, in one call, in the turn the
// reader asked for it.
//
// read_pages caps a call at 10 pages, which is the right size for looking
// something up and the wrong size for teaching: the measured chapter is 44 pages
// and would take five calls, each of which drops out of context again as the
// conversation runs. This returns the chapter whole, under the same page anchors
// read_pages uses, and — on the book-level thread — writes the chapter down as
// the thread's focus so the next turn inlines it instead of re-fetching it.
//
// Two shapes, one name. With a usable chapter table the model names a chapter
// number and the table decides the pages. With no usable table (docs/09: two of
// the five measured books have none) the model gives a page range instead, at a
// higher cap than read_pages, because otherwise a book with no bookmarks leaves
// a lecture reading ten pages at a time.

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import { BOOK_PAGE_LABEL, formatPages } from "../../fulltext/format";
import type { Fulltext } from "../../fulltext/types";
import { MAX_CHAPTER_PAGES } from "./inline";
import type { TableChapter } from "../chapters";
import { pageRangeLabel } from "../../ai/tool-labels";

// The page-range form's cap. Four times read_pages', because the reader asking
// for "the part about attention" on a book with no chapter table is asking for
// something chapter-sized.
export const READ_CHAPTER_MAX_PAGES = 40;

// Written into the description so the tool is not reached for on every question
// about the book. The rule is docs/09's: the reader has to have named a chapter.
const ONLY_WHEN_NAMED =
  "Only call this when the reader has explicitly named a chapter or asked for one to be " +
  "taught. Never call it to check what a book is about, and never call it twice in a turn.";

function chapterList(chapters: readonly TableChapter[]): string {
  return (
    chapters
      .map((c) => `${c.number === null ? c.title : `${c.number} (${c.title})`}`)
      .join("; ") || "(none)"
  );
}

export interface ReadChapterDeps {
  bookName: string;
  fulltext: Fulltext;
  // The chapter table, or null when there is no usable one and the tool takes a
  // page range instead.
  chapters: readonly TableChapter[] | null;
  // Where a chapter focus goes when this tool reads one. Absent on a
  // mark-anchored thread: the reader may ask a marked passage's conversation to
  // teach chapter 3 and get it, but the thread is still about the mark, so
  // nothing about it changes (docs/09).
  onFocus?: (chapter: TableChapter) => void;
}

/**
 * The row a read_chapter call draws while it runs, and the only place its
 * wording is decided.
 *
 * It is wording with a second reader: a thread file keeps a settled call's name
 * and label and not its arguments (platform/app/threads.ts, PersistedToolStatus),
 * so the label is where a reopened lesson reads back which chapters have been
 * taught (reading/lesson/thread-state.ts). Change the sentence and change the
 * parser with it.
 */
export function readChapterLabel(chapter: unknown): string {
  return chapter === undefined ? "Reading a chapter" : `Reading chapter ${chapter}`;
}

/** The printed chapter number in one of those labels, or null for anything else. */
export function chapterOfReadChapterLabel(label: string): number | null {
  const m = /^Reading chapter (\d+)$/.exec(label.trim());
  return m ? Number(m[1]) : null;
}

export function buildReadChapterTool(deps: ReadChapterDeps): AgentTool {
  const { fulltext: ft, chapters } = deps;

  if (chapters && chapters.length > 0) {
    return {
      name: "read_chapter",
      label: (args) => readChapterLabel(args.chapter),
      effect: "read",
      description:
        "Read one whole chapter of the book the reader is in, by the chapter number " +
        `printed in the book. Returns every page of it with its page anchors. ${ONLY_WHEN_NAMED}`,
      parameters: Type.Object({
        chapter: Type.Number({ description: "The chapter number as printed in the book." }),
      }),
      execute: async (args) => {
        const n = Math.round(Number(args.chapter));
        const found = chapters.find((c) => c.number === n);
        if (!found) {
          return `This book has no chapter ${n}. Its chapters are: ${chapterList(chapters)}.`;
        }
        deps.onFocus?.(found);
        const head =
          `Chapter ${found.number}, "${found.title}", of "${deps.bookName}" — ` +
          `p.${found.startPage}-${found.endPage}.`;
        const body = formatPages(
          ft,
          found.startPage,
          found.endPage,
          BOOK_PAGE_LABEL,
          MAX_CHAPTER_PAGES,
        );
        return `${head}\n\n${body}`;
      },
    };
  }

  return {
    name: "read_chapter",
    label: (args) => pageRangeLabel(args),
    effect: "read",
    description:
      "Read a chapter-sized stretch of the book the reader is in: a 1-based, inclusive " +
      `page range of up to ${READ_CHAPTER_MAX_PAGES} pages, returned with its page anchors. ` +
      "This book has no usable chapter table, so give the range yourself — find where the " +
      `chapter starts and ends first (read_pages, search_topic). ${ONLY_WHEN_NAMED}`,
    parameters: Type.Object({
      from: Type.Number({ description: "First page (1-based)." }),
      to: Type.Number({ description: "Last page (1-based, inclusive)." }),
    }),
    execute: async (args) =>
      formatPages(
        ft,
        Math.round(Number(args.from)),
        Math.round(Number(args.to)),
        BOOK_PAGE_LABEL,
        READ_CHAPTER_MAX_PAGES,
      ),
  };
}
