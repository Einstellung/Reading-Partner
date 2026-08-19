// Chapter-spine plan (docs/09): the model reads the front matter's table of contents and
// returns the book's chapter structure as JSON. Used when the PDF outline has no
// usable table of its own — reading the outline, and turning either source into
// contiguous page ranges, is reading/chapters. The AI call itself lives in
// live.ts.

import type { Fulltext } from "../../../fulltext/types";
import type { ParseTally } from "../../../platform/app/structured-output";
import { chapterRanges, type TableChapter } from "../../chapters";

// How many leading pages of the book to hand the model when it has to read the
// table of contents itself (no PDF outline).
export const TOC_MAX_PAGES = 12;

export const CHAPTER_SPINE_PLAN_SYSTEM_PROMPT = [
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
//
// `tally` is an optional out-parameter for the structured-output measurement
// (structured-output.ts). `kept` is counted after the ranging, so chapters
// dropped for sharing a start page count as lost too.
export function parseChapterSpinePlan(
  text: string,
  totalPages: number,
  tally?: ParseTally,
): TableChapter[] {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  const rawChapters = Array.isArray(raw.chapters) ? raw.chapters : [];
  if (tally) tally.seen += rawChapters.length;
  const items = rawChapters
    .map((c: any) => {
      const title = typeof c?.title === "string" ? c.title.trim() : "";
      const startPage = Number(c?.startPage);
      if (!Number.isFinite(startPage) || startPage < 1) return null;
      if (!title && tally) tally.repaired++;
      return { title: title || "Untitled", startPage: Math.round(startPage) };
    })
    .filter((c): c is { title: string; startPage: number } => c !== null);
  if (items.length === 0) {
    if (tally) tally.fail = rawChapters.length ? "empty-result" : "missing-field";
    throw new Error("plan has no parseable chapters");
  }
  const chapters = chapterRanges(items, totalPages, { fromFirstPage: true });
  if (tally) tally.kept += chapters.length;
  return chapters;
}
