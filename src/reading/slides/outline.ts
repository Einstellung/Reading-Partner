// The outline a retell settled, as the deck planner's input (docs/31: "PPT 是把这个
// 已经达成的东西排成页，不是 AI 猜一份大纲").
//
// A retell's decisions say what the retell contains: which chapter of which material
// goes in, what it contributes, which figure carries it, and — because the array
// is the outline the reader arranged (reading/retell/outline.ts) — in what order.
// The plan stage's job shrinks to laying that out as pages: how many pages an
// entry needs, what to call them, how the deck opens and closes. It no longer
// decides what is in the retell.
//
// A retell with no decisions yet keeps the old path (chapter list + overview, model
// invents the outline), as does a material inside a settled retell that the
// retell has not reached.
//
// This module is pure and one-way: slides reads retells, never the reverse. It
// works on the retell as a value; loading it is live.ts's readDeckOutline.

import { languageInstruction, type AiLanguage } from "../../platform/app/settings";
import type { Retell } from "../retell/types";
import { bookBlock, type DeckPlan, type PlanBook } from "./plan";
import type { SlideOutline } from "./types";

// One entry of the retell, in the order the retell gives it.
export interface OutlineEntry {
  bookId: string;
  bookTitle: string;
  chapter: number;
  title: string;
  // The reader's own framing, verbatim. Never rewritten on the way to the deck:
  // the plan stage does not get to restate them and the content stage receives
  // exactly these strings.
  points: string[];
  figure?: string;
  note?: string;
}

// One entry the retell settled as staying out.
export interface OutlineCut {
  bookId: string;
  bookTitle: string;
  chapter: number;
  title: string;
  note?: string;
}

// A retell's settled shape: what is in, in order, and what was cut.
export interface RetellOutline {
  included: OutlineEntry[];
  cut: OutlineCut[];
}

// The retell's decisions as the deck reads them. Returns null when nothing has
// been settled — that is the signal to take the old plan path, and it has to be
// a distinct value from "settled and everything was cut".
export function buildRetellOutline(retell: Retell | null): RetellOutline | null {
  if (!retell || retell.decisions.length === 0) return null;
  const titleOf = (bookId: string) =>
    retell.materials.find((m) => m.bookId === bookId)?.title ?? bookId;
  const included: OutlineEntry[] = [];
  const cut: OutlineCut[] = [];
  for (const d of retell.decisions) {
    const head = {
      bookId: d.bookId,
      bookTitle: titleOf(d.bookId),
      chapter: d.chapter,
      title: d.title,
    };
    if (d.include) {
      included.push({
        ...head,
        points: d.points.filter((p) => p.trim()),
        ...(d.figure ? { figure: d.figure } : {}),
        ...(d.note ? { note: d.note } : {}),
      });
    } else {
      cut.push({ ...head, ...(d.note ? { note: d.note } : {}) });
    }
  }
  return { included, cut };
}

export function entriesFor(outline: RetellOutline | null, bookId: string): OutlineEntry[] {
  return (outline?.included ?? []).filter((e) => e.bookId === bookId);
}

// Whether the retell settled anything at all about a material. A material the
// retell has not reached is planned the old way even inside a settled retell.
function settledBooks(outline: RetellOutline): Set<string> {
  const ids = new Set<string>();
  for (const e of outline.included) ids.add(e.bookId);
  for (const c of outline.cut) ids.add(c.bookId);
  return ids;
}

// The plan stage sees a chapter as usable material only when a note exists
// (plan.ts's [note] marker, checked again by validateDeckPlan). A settled
// chapter is usable whether or not the notes pass ever ran on it: the reader's
// points are the material. So mark those chapters citable before validation,
// otherwise the validator strips the very citations the outline asked for.
//
// A chapter the retell knows and the chapter list does not is added rather than
// dropped: the retell skeleton can come from the PDF's own table of contents,
// so a material retold without a notes pass has decisions against chapters no
// notes plan ever enumerated.
export function citableWithOutline(books: PlanBook[], outline: RetellOutline | null): PlanBook[] {
  if (!outline) return books;
  return books.map((b) => {
    const entries = entriesFor(outline, b.bookId);
    if (!entries.length) return b;
    const decided = new Set(entries.map((e) => e.chapter));
    const known = new Set(b.chapters.map((c) => c.index));
    const chapters = b.chapters.map((c) => (decided.has(c.index) ? { ...c, hasNote: true } : c));
    for (const e of entries) {
      if (known.has(e.chapter)) continue;
      // No page range: nothing downstream of validation reads one for a chapter
      // that only the retell knows about.
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
  "You are the deck-planning stage of a reading companion. This retell is already",
  "settled: the reader went through their material chapter by chapter and recorded",
  "what each chapter contributes, what it is worth saying about it, which chapters",
  "they are not going to talk about at all, and the order they will speak in.",
  "",
  "You are not deciding what the retell says. That is decided. You are laying it out",
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
  "Rules for the settled outline:",
  "- Every entry listed as IN gets at least one content slide, citing that entry's",
  "  bookId and chapter number. An entry with one point is one slide; an entry with",
  "  five may need two or three. Do not fold two entries into one slide to be tidy.",
  "- Entries listed as CUT get no slide. Do not bring them back, do not mention",
  "  them in passing, do not fold their material into a neighbouring slide.",
  "- Keep the outline order. That is the order the reader arranged and the order",
  "  they are going to speak in — it is not always chapter order, and when the retell",
  "  spans several materials it moves between them.",
  "- Do not write the points out in your titles and do not invent new ones. The",
  "  next stage receives the reader's own wording for the entries a slide cites;",
  "  your titles only have to say what the page is about.",
  "- When an entry names a figure: if it looks like a figure id from that",
  "  material's figure list, cite it in \"figure\"; if it is a description of a",
  "  picture, put it in \"illustration\" as the prompt.",
  "",
  "What is still yours: the deck title, the slide titles, how an entry's points",
  "split across pages, section dividers between movements, the opening title slide",
  "and the closing slide. Open with a title slide and end with a closing slide.",
  "A slide may have at most one of illustration or figure, not both.",
  "",
  "A material listed below with a chapter list instead of outline entries is one",
  "the retell has not reached: for that one, plan it yourself from its overview",
  "and chapters, after the settled entries, and only cite chapters marked [note].",
].join("\n");

export function outlinePlanSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  const lang = languageInstruction(aiLanguage);
  return lang
    ? `${SLIDES_OUTLINE_PLAN_SYSTEM_PROMPT}\n\n${lang}`
    : SLIDES_OUTLINE_PLAN_SYSTEM_PROMPT;
}

// The settled outline as one ordered list. Every row names its bookId, because
// the order is the retell's and a retell over several materials moves between them —
// grouping the rows by book would throw away the one thing this list is for.
function outlineBlock(outline: RetellOutline, books: PlanBook[]): string {
  const lines = ["=== The retell's settled outline ==="];
  if (outline.included.length) {
    lines.push("In the retell, in the order it will be given:");
    outline.included.forEach((e, i) => {
      lines.push(`${i + 1}. [bookId: ${e.bookId}] chapter ${e.chapter} — ${e.title}`);
      for (const p of e.points) lines.push(`  - ${p}`);
      if (!e.points.length) lines.push("  (no points recorded; write the page from the chapter itself)");
      if (e.figure) lines.push(`  figure: ${e.figure}`);
      if (e.note) lines.push(`  note: ${e.note}`);
    });
  } else {
    lines.push("Nothing was kept for the retell.");
  }
  if (outline.cut.length) {
    lines.push(
      "",
      "CUT — no slide, no mention:",
      ...outline.cut.map(
        (c) => `[bookId: ${c.bookId}] chapter ${c.chapter} — ${c.title}${c.note ? ` — ${c.note}` : ""}`,
      ),
    );
  }
  for (const b of books) {
    if (!b.figures.length) continue;
    lines.push(
      "",
      `Available figures in "${b.title}" (bookId: ${b.bookId}, cite by figId):`,
      ...b.figures.slice(0, 40).map((f) => `- ${f.id}: ${f.caption}`),
    );
  }
  return lines.join("\n");
}

// The plan call's user message when the retell has settled something: the outline
// first, then the ordinary block for any material the retell has not reached.
export function outlinePlanUserMessage(
  books: PlanBook[],
  outline: RetellOutline,
  instruction: string,
): string {
  const settled = settledBooks(outline);
  const inOutline = books.filter((b) => settled.has(b.bookId));
  const parts: string[] = [outlineBlock(outline, inOutline)];
  for (const b of books) {
    if (!settled.has(b.bookId)) parts.push(bookBlock(b));
  }
  const steer = instruction.trim();
  parts.push(
    steer
      ? `Deck instruction (theme / audience): ${steer}`
      : "No specific deck instruction was given; the settled outline is the deck.",
  );
  parts.push("Return the deck outline JSON now.");
  return parts.join("\n\n");
}

// Hold the planned deck to the outline. Unlike validateDeckPlan this one drops
// slides: a page for a chapter the reader decided not to talk about is not a
// repairable citation, it is a page that must not exist.
//
// The other direction is repaired rather than dropped — an entry the reader kept
// that the plan forgot is appended, because losing it silently is the exact
// failure this whole path exists to prevent.
export function applyRetellOutline(plan: DeckPlan, outline: RetellOutline): DeckPlan {
  const settled = settledBooks(outline);
  const included = new Set(outline.included.map((e) => `${e.bookId}:${e.chapter}`));
  const cut = new Set(outline.cut.map((c) => `${c.bookId}:${c.chapter}`));
  const slides: SlideOutline[] = [];

  for (const slide of plan.slides) {
    if (!slide.bookId || !settled.has(slide.bookId) || !slide.sourceChapters?.length) {
      slides.push(slide);
      continue;
    }
    const bookId = slide.bookId;
    const kept = slide.sourceChapters.filter((n) => included.has(`${bookId}:${n}`));
    if (kept.length === slide.sourceChapters.length) {
      slides.push(slide);
      continue;
    }
    // Nothing left to say: the page existed only for chapters the retell took out.
    if (!kept.length) continue;
    const droppedCut = slide.sourceChapters.filter((n) => cut.has(`${bookId}:${n}`));
    const undecided = slide.sourceChapters.filter(
      (n) => !included.has(`${bookId}:${n}`) && !cut.has(`${bookId}:${n}`),
    );
    const notices: string[] = [];
    if (droppedCut.length) {
      notices.push(`Chapter ${droppedCut.join(", ")} was cut in the retell and is not in the retell.`);
    }
    if (undecided.length) {
      notices.push(`Chapter ${undecided.join(", ")} has no retell decision, so it was left out.`);
    }
    slides.push({
      ...slide,
      sourceChapters: kept,
      planNotice: [slide.planNotice, ...notices].filter(Boolean).join(" "),
    });
  }

  // Put back any kept entry the plan never gave a page to, in outline order.
  const covered = new Set<string>();
  for (const s of slides) {
    if (!s.bookId) continue;
    for (const n of s.sourceChapters ?? []) covered.add(`${s.bookId}:${n}`);
  }
  const missing: SlideOutline[] = [];
  for (const e of outline.included) {
    if (covered.has(`${e.bookId}:${e.chapter}`)) continue;
    missing.push({
      title: e.title || `Chapter ${e.chapter}`,
      kind: "content",
      bookId: e.bookId,
      sourceChapters: [e.chapter],
      planNotice: "The plan left this entry out; it is in the retell, so a slide was added back.",
    });
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
  outline: RetellOutline | null,
  slide: Pick<SlideOutline, "bookId" | "sourceChapters">,
): string[] {
  if (!outline || !slide.bookId || !slide.sourceChapters?.length) return [];
  const wanted = new Set(slide.sourceChapters);
  const out: string[] = [];
  for (const e of outline.included) {
    if (e.bookId === slide.bookId && wanted.has(e.chapter)) out.push(...e.points);
  }
  return out;
}
