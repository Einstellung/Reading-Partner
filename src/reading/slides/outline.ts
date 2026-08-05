// The talk outline that rehearsal mode produced, as the deck planner's input
// (docs/31: "PPT 是把这个已经达成的东西排成页，不是 AI 猜一份大纲").
//
// When the rehearsal recorded decisions about a book, what the talk says about
// that book is settled: which chapters go in, what each one contributes, which
// figure carries it. The plan stage's job shrinks to laying
// that out as pages — how many pages a chapter needs, what to call them, how the
// deck opens and closes. It no longer decides what is in the talk.
//
// Books without decisions keep the old path (chapter list + overview, model
// invents the outline), including inside a mixed talk where only some of the
// books were rehearsed.
//
// This module is pure and one-way: slides reads rehearsal, never the reverse.
// It works on the decisions as data, never on where they are stored — fetching
// them is live.ts's readTalkOutline, which is the one place that knows.

import { languageInstruction, type AiLanguage } from "../../platform/app/settings";
import type { RehearsalPlan } from "../rehearsal/types";
import { bookBlock, type DeckPlan, type PlanBook } from "./plan";
import type { SlideOutline } from "./types";

// One chapter the rehearsal decided goes in the talk.
export interface OutlineEntry {
  chapter: number;
  title: string;
  // The reader's own framing, verbatim. Never rewritten on the way to the deck:
  // the plan stage does not get to restate them and the content stage receives
  // exactly these strings.
  points: string[];
  figure?: string;
  note?: string;
}

// One chapter the rehearsal decided stays out.
export interface OutlineCut {
  chapter: number;
  title: string;
  note?: string;
}

// One rehearsed book's settled shape.
export interface BookOutline {
  bookId: string;
  title: string;
  included: OutlineEntry[];
  cut: OutlineCut[];
}

// The rehearsed part of a talk. Only books with at least one decision appear.
export interface TalkOutline {
  books: BookOutline[];
}

export interface OutlineSource {
  bookId: string;
  title: string;
  plan: RehearsalPlan | null;
}

// Fold each book's decision file into its outline. Returns null when no selected
// book has been rehearsed — that is the signal to take the old plan path, and it
// has to be a distinct value from "rehearsed and everything was cut".
export function buildTalkOutline(sources: readonly OutlineSource[]): TalkOutline | null {
  const books: BookOutline[] = [];
  for (const src of sources) {
    const decisions = src.plan?.decisions ?? [];
    if (decisions.length === 0) continue;
    const included: OutlineEntry[] = [];
    const cut: OutlineCut[] = [];
    for (const d of [...decisions].sort((a, b) => a.chapter - b.chapter)) {
      if (d.include) {
        included.push({
          chapter: d.chapter,
          title: d.title,
          points: d.points.filter((p) => p.trim()),
          ...(d.figure ? { figure: d.figure } : {}),
          ...(d.note ? { note: d.note } : {}),
        });
      } else {
        cut.push({ chapter: d.chapter, title: d.title, ...(d.note ? { note: d.note } : {}) });
      }
    }
    books.push({ bookId: src.bookId, title: src.title, included, cut });
  }
  return books.length ? { books } : null;
}

export function outlineFor(outline: TalkOutline | null, bookId: string): BookOutline | undefined {
  return outline?.books.find((b) => b.bookId === bookId);
}

// The plan stage sees a chapter as usable material only when a note exists
// (plan.ts's [note] marker, checked again by validateDeckPlan). A rehearsed
// chapter is usable whether or not the notes pass ever ran on it: the reader's
// points are the material. So mark those chapters citable before validation,
// otherwise the validator strips the very citations the outline asked for.
//
// A chapter the rehearsal knows and the chapter list does not is added rather
// than dropped: the rehearsal skeleton can come from the PDF's own table of
// contents, so a book that was rehearsed but never had notes generated has
// decisions against chapters that no notes plan ever enumerated.
export function citableWithOutline(books: PlanBook[], outline: TalkOutline | null): PlanBook[] {
  if (!outline) return books;
  return books.map((b) => {
    const o = outlineFor(outline, b.bookId);
    if (!o) return b;
    const decided = new Set(o.included.map((e) => e.chapter));
    const known = new Set(b.chapters.map((c) => c.index));
    const chapters = b.chapters.map((c) => (decided.has(c.index) ? { ...c, hasNote: true } : c));
    for (const e of o.included) {
      if (known.has(e.chapter)) continue;
      // No page range: nothing downstream of validation reads one for a chapter
      // that only the rehearsal knows about.
      chapters.push({
        index: e.chapter,
        title: e.title,
        startPage: 0,
        endPage: 0,
        hasNote: true,
      });
    }
    chapters.sort((x, y) => x.index - y.index);
    return { ...b, chapters };
  });
}

export const SLIDES_OUTLINE_PLAN_SYSTEM_PROMPT = [
  "You are the deck-planning stage of a reading companion. For at least one of",
  "these books the talk is already settled: the reader went through it chapter by",
  "chapter and recorded what each chapter contributes, what it is worth saying",
  "about it, and which chapters they are not going to talk about at all.",
  "",
  "You are not deciding what the talk says. That is decided. You are laying it out",
  "as pages. Output a single JSON object and nothing else — no prose, no markdown",
  "fences.",
  "",
  "The JSON shape:",
  "{",
  '  "title": "The deck title",',
  '  "slides": [',
  '    { "title": "Slide title", "kind": "content",',
  '      "bookId": "<id>", "sourceChapters": [3],',
  '      "illustration": { "prompt": "what to depict" },',
  '      "figure": { "bookId": "<id>", "figId": "3" } }',
  "  ]",
  "}",
  "",
  "Rules for a settled book:",
  "- Every chapter listed as IN gets at least one content slide. A chapter with one",
  "  point is one slide; a chapter with five may need two or three. Do not fold two",
  "  chapters into one slide to be tidy.",
  "- Chapters listed as CUT get no slide. Do not bring them back, do not mention",
  "  them in passing, do not fold their material into a neighbouring slide.",
  "- Keep the chapter order. The reader walked the book in that order and that is",
  "  the order they are going to speak in.",
  "- Do not write the points out in your titles and do not invent new ones. The",
  "  next stage receives the reader's own wording for the chapters a slide cites;",
  "  your titles only have to say what the page is about.",
  "- When a chapter's record names a figure: if it looks like a figure id from that",
  "  book's figure list, cite it in \"figure\"; if it is a description of a picture,",
  "  put it in \"illustration\" as the prompt.",
  "",
  "What is still yours: the deck title, the slide titles, how a chapter's points",
  "split across pages, section dividers between movements, the opening title slide",
  "and the closing slide. Open with a title slide and end with a closing slide.",
  "A slide may have at most one of illustration or figure, not both.",
  "",
  "A book listed below with a chapter list instead of a settled outline was not",
  "rehearsed: for that book, plan it yourself from its overview and chapters, and",
  "only cite chapters marked [note].",
].join("\n");

export function outlinePlanSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  const lang = languageInstruction(aiLanguage);
  return lang
    ? `${SLIDES_OUTLINE_PLAN_SYSTEM_PROMPT}\n\n${lang}`
    : SLIDES_OUTLINE_PLAN_SYSTEM_PROMPT;
}

function outlineBlock(book: BookOutline, figures: PlanBook["figures"]): string {
  const lines = [`=== Book "${book.title}" (bookId: ${book.bookId}) — settled outline ===`];
  if (book.included.length) {
    lines.push("Chapters IN the talk (cite these numbers in sourceChapters):");
    for (const e of book.included) {
      lines.push(`${e.chapter}. ${e.title}`);
      for (const p of e.points) lines.push(`  - ${p}`);
      if (!e.points.length) lines.push("  (no points recorded; write the page from the chapter itself)");
      if (e.figure) lines.push(`  figure: ${e.figure}`);
      if (e.note) lines.push(`  note: ${e.note}`);
    }
  } else {
    lines.push("No chapter of this book was kept for the talk.");
  }
  if (book.cut.length) {
    lines.push(
      "",
      "Chapters CUT — no slide, no mention:",
      ...book.cut.map((c) => `${c.chapter}. ${c.title}${c.note ? ` — ${c.note}` : ""}`),
    );
  }
  if (figures.length) {
    lines.push(
      "",
      "Available figures (cite by figId):",
      ...figures.slice(0, 40).map((f) => `- ${f.id}: ${f.caption}`),
    );
  }
  return lines.join("\n");
}

// The plan call's user message when at least one book was rehearsed: the settled
// outline for those, the ordinary chapter list for the rest.
export function outlinePlanUserMessage(
  books: PlanBook[],
  outline: TalkOutline,
  instruction: string,
): string {
  const parts: string[] = [];
  for (const b of books) {
    const o = outlineFor(outline, b.bookId);
    parts.push(o ? outlineBlock(o, b.figures) : bookBlock(b));
  }
  const steer = instruction.trim();
  parts.push(
    steer
      ? `Talk instruction (theme / audience): ${steer}`
      : "No specific talk instruction was given; the settled outline is the talk.",
  );
  parts.push("Return the deck outline JSON now.");
  return parts.join("\n\n");
}

// Hold the planned deck to the outline. Unlike validateDeckPlan this one drops
// slides: a page for a chapter the reader decided not to talk about is not a
// repairable citation, it is a page that must not exist.
//
// The other direction is repaired rather than dropped — a chapter the reader
// kept that the plan forgot is appended, because losing it silently is the exact
// failure this whole path exists to prevent.
export function applyTalkOutline(plan: DeckPlan, outline: TalkOutline): DeckPlan {
  const rehearsed = new Map(outline.books.map((b) => [b.bookId, b]));
  const slides: SlideOutline[] = [];

  for (const slide of plan.slides) {
    const book = slide.bookId ? rehearsed.get(slide.bookId) : undefined;
    if (!book || !slide.sourceChapters?.length) {
      slides.push(slide);
      continue;
    }
    const included = new Set(book.included.map((e) => e.chapter));
    const cut = new Set(book.cut.map((c) => c.chapter));
    const kept = slide.sourceChapters.filter((n) => included.has(n));
    if (kept.length === slide.sourceChapters.length) {
      slides.push(slide);
      continue;
    }
    const droppedCut = slide.sourceChapters.filter((n) => cut.has(n));
    const undecided = slide.sourceChapters.filter((n) => !included.has(n) && !cut.has(n));
    // Nothing left to say: the page existed only for chapters the rehearsal
    // took out of the talk.
    if (!kept.length) continue;
    const notices: string[] = [];
    if (droppedCut.length) {
      notices.push(`Chapter ${droppedCut.join(", ")} was cut in the rehearsal and is not in the talk.`);
    }
    if (undecided.length) {
      notices.push(`Chapter ${undecided.join(", ")} has no rehearsal decision, so it was left out.`);
    }
    slides.push({
      ...slide,
      sourceChapters: kept,
      planNotice: [slide.planNotice, ...notices].filter(Boolean).join(" "),
    });
  }

  // Put back any kept chapter the plan never gave a page to.
  const covered = new Set<string>();
  for (const s of slides) {
    if (!s.bookId) continue;
    for (const n of s.sourceChapters ?? []) covered.add(`${s.bookId}:${n}`);
  }
  const missing: SlideOutline[] = [];
  for (const book of outline.books) {
    for (const e of book.included) {
      if (covered.has(`${book.bookId}:${e.chapter}`)) continue;
      missing.push({
        title: e.title || `Chapter ${e.chapter}`,
        kind: "content",
        bookId: book.bookId,
        sourceChapters: [e.chapter],
        planNotice: "The plan left this chapter out; it is in the talk, so a slide was added back.",
      });
    }
  }
  if (missing.length) {
    // Before the closing slide, so the deck still ends where it meant to.
    const at = slides.length && slides[slides.length - 1].kind === "closing" ? slides.length - 1 : slides.length;
    slides.splice(at, 0, ...missing);
  }

  return { title: plan.title, slides };
}

// The reader's own points for the chapters a slide draws on, verbatim. This is
// what the content stage writes the page from; the plan stage never touched
// these strings.
export function readerPointsFor(
  outline: TalkOutline | null,
  slide: Pick<SlideOutline, "bookId" | "sourceChapters">,
): string[] {
  const book = slide.bookId ? outlineFor(outline, slide.bookId) : undefined;
  if (!book || !slide.sourceChapters?.length) return [];
  const wanted = new Set(slide.sourceChapters);
  const out: string[] = [];
  for (const e of book.included) if (wanted.has(e.chapter)) out.push(...e.points);
  return out;
}
