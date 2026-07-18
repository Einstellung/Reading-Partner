// Notes plan (docs/14), pure parts: turn a book into a chapter list with page
// ranges. The PDF outline is preferred (its top-level entries are the chapters);
// when there is no usable outline the model reads the front matter's table of
// contents and returns the structure as JSON. Both go through toChapters, which
// makes the ranges contiguous and covering the whole book. The AI call itself
// lives in live.ts.

import type { Fulltext, OutlineItem } from "../fulltext/types";
import type { NoteChapter } from "./types";

// How many leading pages of the book to hand the model when it has to read the
// table of contents itself (no PDF outline).
export const TOC_MAX_PAGES = 12;

// Assign contiguous, whole-book-covering page ranges to a list of chapter starts.
// Inputs are (title, startPage) in any order; output is 1-based, sorted, with
// each chapter ending the page before the next begins and the last ending at the
// final page. The first chapter is pulled back to page 1 so front matter is
// covered, and chapters sharing a start page are de-duplicated. Pure.
export function toChapters(
  items: { title: string; startPage: number }[],
  totalPages: number,
): NoteChapter[] {
  const total = Math.max(1, Math.round(totalPages));
  const clean = items
    .map((it) => ({
      title: it.title.trim() || "Untitled",
      startPage: Math.max(1, Math.min(total, Math.round(it.startPage))),
    }))
    .sort((a, b) => a.startPage - b.startPage);

  const dd: { title: string; startPage: number }[] = [];
  for (const it of clean) {
    if (dd.length && dd[dd.length - 1].startPage === it.startPage) continue;
    dd.push(it);
  }
  if (dd.length === 0) {
    return [{ index: 1, title: "The whole book", startPage: 1, endPage: total, status: "pending" }];
  }
  dd[0].startPage = 1; // cover any front matter before the first heading

  return dd.map((it, i) => {
    const endPage = i < dd.length - 1 ? dd[i + 1].startPage - 1 : total;
    return {
      index: i + 1,
      title: it.title,
      startPage: it.startPage,
      endPage: Math.max(it.startPage, endPage),
      status: "pending" as const,
    };
  });
}

// Chapters from a PDF outline: the top-level (level 0) entries in reading order.
// Returns null when the outline has fewer than two usable top-level entries — the
// caller then falls back to the model reading the table of contents.
export function chaptersFromOutline(
  outline: OutlineItem[],
  totalPages: number,
): NoteChapter[] | null {
  const total = Math.max(1, Math.round(totalPages));
  const tops = outline.filter((o) => o.level === 0 && o.page >= 1 && o.page <= total);
  if (tops.length < 2) return null;
  const chapters = toChapters(
    tops.map((o) => ({ title: o.title, startPage: o.page })),
    total,
  );
  return chapters.length >= 2 ? chapters : null;
}

// --- AI table-of-contents fallback ---

export const NOTES_PLAN_SYSTEM_PROMPT = [
  "You are the note-taking stage of a reading companion. You are given the front",
  "matter of a book (its first pages, which usually hold the table of contents).",
  "Produce the book's chapter structure as a single JSON object and nothing else",
  "— no prose, no markdown fences.",
  "",
  "The JSON shape:",
  "{",
  '  "chapters": [{ "title": "Introduction", "startPage": 1 }]',
  "}",
  "",
  "Rules:",
  "- chapters: the book's top-level sections in reading order, each with the",
  "  1-based page it starts on. Use the printed table of contents when present;",
  "  otherwise infer the top-level divisions from the pages shown.",
  "- Keep it top-level. Do not descend into sub-sections; a handful to a few",
  "  dozen chapters, not hundreds.",
  "- startPage is the physical PDF page (1-based), not a printed page label.",
].join("\n");

// The leading pages of the book, page-marked, for the model to read the TOC.
export function planUserMessage(ft: Fulltext, maxPages: number = TOC_MAX_PAGES): string {
  const n = Math.min(ft.pages.length, Math.max(1, maxPages));
  const parts: string[] = [`Here are the first ${n} pages of the book:`];
  for (let i = 0; i < n; i++) parts.push(`=== Page ${i + 1} ===\n${ft.pages[i]}`);
  parts.push("Return the chapter structure now.");
  return parts.join("\n\n");
}

// Models wrap JSON in fences or preamble; cut from the first "{" to the last "}".
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the model output");
  return text.slice(start, end + 1);
}

// Parse the plan call's output into chapters with whole-book page ranges. Throws
// when no chapter is parseable so the pipeline can surface a plan failure.
export function parseNotesPlan(text: string, totalPages: number): NoteChapter[] {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  const items = (Array.isArray(raw.chapters) ? raw.chapters : [])
    .map((c: any) => {
      const title = typeof c?.title === "string" ? c.title.trim() : "";
      const startPage = Number(c?.startPage);
      if (!Number.isFinite(startPage) || startPage < 1) return null;
      return { title: title || "Untitled", startPage: Math.round(startPage) };
    })
    .filter((c): c is { title: string; startPage: number } => c !== null);
  if (items.length === 0) throw new Error("plan has no parseable chapters");
  return toChapters(items, totalPages);
}
