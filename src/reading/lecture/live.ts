// The disk side of the lecture assembly: where the chapter table and the chapter
// spine are read from. Everything here is best-effort — a lecture turn is never
// blocked, failed or delayed by material that has not been written yet — and
// every decision it makes lives in the pure modules beside it.

import type { Fulltext } from "../../fulltext/types";
import {
  chapterNumber,
  outlineEntries,
  pickChapterTable,
  type TableChapter,
  type ChapterEntry,
} from "../chapters";
import { loadChapterSpineState, readChapterSpine } from "../prep/chapters/store";
import type { PrepChapter } from "../prep/papers/types";
import type { ChapterOutline } from "./prompt";

// The chapter table for a book, from the best source that has one (docs/09):
//
//   1. the PDF outline's level-0 entries — right when the book's bookmarks are
//      its chapters, which is one book in five,
//   2. the chapter-spine pass's own table (prep-<bookId>/chapters/state.json),
//      which is either the same outline or a table the model read out of the
//      printed contents,
//   3. the prep plan's chapters.
//
// Null when none of them survives the filtering: the chapter chip then does not
// appear and read_chapter takes a page range instead.
export async function loadChapterTable(
  bookId: string,
  ft: Fulltext | null,
  prepChapters: readonly PrepChapter[] = [],
): Promise<TableChapter[] | null> {
  if (!ft || ft.status !== "ok") return null;
  const total = ft.pages.length;

  const fromOutline = outlineEntries(ft.outline, total);

  const state = await loadChapterSpineState(bookId).catch(() => null);
  const fromSpine: ChapterEntry[] = (state?.chapters ?? []).map((c) => ({
    title: c.title,
    startPage: c.startPage,
  }));

  const fromPrep: ChapterEntry[] = prepChapters.map((c) => ({
    title: c.title,
    startPage: c.startPage,
  }));

  return pickChapterTable([fromOutline, fromSpine, fromPrep], ft);
}

// How far the pass that writes the spine has got, for the turn to state as a
// fact: what a chapter covers is in the book's pages either way, but what one
// chapter takes from another is only written once every chapter is.
export interface SpineProgress {
  done: number;
  total: number;
}

// The chapter spine, one paragraph per chapter, as the spine pass left it
// (docs/09), and how far that pass has got. Read against that pass's own chapter
// table rather than the lecture table, because a note was written about the
// range that pass had in mind.
//
// This function is the whole contract between the two: the pass writes a chapter
// note where its store puts it, this reads every finished one. A pass that
// changes what it writes changes nothing here; a pass that has not run yet
// answers no outlines and no progress, and the lecture goes ahead without a
// spine.
export interface ChapterSpine {
  outlines: ChapterOutline[];
  // Null when no run exists for this book, and when one has finished every
  // chapter: in both cases there is nothing about progress to say.
  progress: SpineProgress | null;
}

export async function loadChapterSpine(bookId: string): Promise<ChapterSpine> {
  const state = await loadChapterSpineState(bookId).catch(() => null);
  if (!state || state.chapters.length === 0) return { outlines: [], progress: null };
  const settled = state.chapters.filter((c) => c.status === "done" || c.status === "failed").length;
  const progress =
    settled >= state.chapters.length ? null : { done: settled, total: state.chapters.length };
  const done = state.chapters.filter((c) => c.status === "done");
  const bodies = await Promise.all(
    done.map((c) => readChapterSpine(bookId, c.index).catch(() => null)),
  );
  const out: ChapterOutline[] = [];
  for (let i = 0; i < done.length; i++) {
    const body = (bodies[i] ?? "").trim();
    if (!body) continue;
    const c = done[i];
    out.push({
      index: c.index,
      number: chapterNumber(c.title),
      title: c.title,
      startPage: c.startPage,
      endPage: c.endPage,
      body,
    });
  }
  return { outlines: out, progress };
}
