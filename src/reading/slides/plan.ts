// Slides plan (docs/14), pure parts: turn a set of books' notes plus a talk
// instruction into an ordered deck outline. One AI call feeds each book's
// chapter list (plus its overview as the through-line) and the instruction; the
// model returns JSON — a deck title and ordered slides, each tagged with a kind
// and optional book/chapter provenance and asset slots. The AI call itself lives
// in live.ts.
//
// The plan always sees the chapter list (docs/29: it used to see only the
// overview, whose own prompt says it is a cross-chapter synthesis with no
// chapter numbers in it — so every sourceChapters number was a guess, and a
// wrong guess silently fed the same overview to every slide). What the model
// returns is then checked against the same list by validateDeckPlan, so a
// chapter that does not exist or has no note is caught here rather than at
// content time.

import { languageInstruction, type AiLanguage } from "../../platform/app/settings";
import type { ParseTally } from "../../platform/app/structured-output";
import type { SlideKind, SlideOutline } from "./types";

// One chapter as the planner sees it: where it is in the book, whether a note
// exists to distil from, and the note's opening words as a hint of its content.
export interface PlanChapter {
  index: number; // 1-based reading order
  title: string;
  startPage: number;
  endPage: number;
  hasNote: boolean;
  digest?: string;
}

// The plan input for one book: its chapter list, its whole-book overview when
// one has been written, and the figures available to cite.
export interface PlanBook {
  bookId: string;
  title: string;
  overview: string;
  chapters: PlanChapter[];
  figures: { id: string; caption: string }[];
}

export interface DeckPlan {
  title: string;
  slides: SlideOutline[];
}

const KINDS: SlideKind[] = ["title", "section", "content", "closing"];

export const SLIDES_PLAN_SYSTEM_PROMPT = [
  "You are the deck-planning stage of a reading companion. You are given the",
  "reading notes for one or more books and a talk instruction (theme, audience).",
  "Design a talk deck: an ordered outline of slides that makes an argument, not a",
  "book report. Output a single JSON object and nothing else — no prose, no",
  "markdown fences.",
  "",
  "The JSON shape:",
  "{",
  '  "title": "The deck title",',
  '  "slides": [',
  '    { "title": "Slide title", "kind": "title",',
  '      "bookId": "<id>", "sourceChapters": [1,2],',
  '      "illustration": { "prompt": "what to depict" },',
  '      "figure": { "bookId": "<id>", "figId": "3" } }',
  "  ]",
  "}",
  "",
  "Rules:",
  '- kind is one of "title", "section", "content", "closing". Open with a title',
  "  slide and end with a closing slide. Use section slides to divide movements.",
  "- Scale the slide count to the material: a handful for a thin talk, a few dozen",
  "  for a rich one. Do not pad.",
  "- When there is more than one book, the deck is a synthesis across them — weave",
  "  the ideas into one argument, do not go book-after-book, unless the",
  "  instruction explicitly asks for a per-book structure.",
  "- bookId / sourceChapters mark which book and chapters a content slide draws",
  "  on, so the next stage can feed it the right notes. Omit them on title,",
  "  section, and pure-synthesis slides.",
  "- sourceChapters are chapter numbers taken from that book's chapter list below.",
  "  Only chapters marked [note] have a note to distil — citing any other number",
  "  leaves the slide with nothing specific to say. Never invent a number.",
  "- Most content slides should name the one or two chapters they come from. A",
  "  deck where every slide cites the same chapters, or none, is a deck that says",
  "  the same thing on every page.",
  "- illustration is optional: add it to slides that benefit from a conceptual",
  "  image; give a short prompt describing what to depict (no text in the image).",
  "- figure is optional: cite an existing book figure by its id from the figure",
  "  list, only when it carries a result worth showing. Do not invent figure ids.",
  "- A slide may have at most one of illustration or figure, not both.",
].join("\n");

// The plan system prompt for a given output language. "auto" keeps the default;
// any other value appends the pinning instruction so the deck title and slide
// titles come out in that language.
export function slidesPlanSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  const lang = languageInstruction(aiLanguage);
  return lang ? `${SLIDES_PLAN_SYSTEM_PROMPT}\n\n${lang}` : SLIDES_PLAN_SYSTEM_PROMPT;
}

// One chapter line for the plan message: number, title, pages, whether a note
// exists, and the note's first words.
function chapterLine(c: PlanChapter): string {
  const note = c.hasNote ? "[note]" : "[no note]";
  const digest = c.digest?.trim() ? ` — ${c.digest.trim()}` : "";
  return `${c.index}. ${c.title} (pp.${c.startPage}-${c.endPage}) ${note}${digest}`;
}

// One book as the planner reads it: overview (the through-line), chapter list
// (what the slides can be sourced from), figure list. Shared with the
// rehearsal-outline path (outline.ts), which renders rehearsed books its own way
// but still needs this one for the books that were never rehearsed.
export function bookBlock(b: PlanBook): string {
  const lines = [`=== Book "${b.title}" (bookId: ${b.bookId}) ===`];
  if (b.overview.trim()) {
    lines.push("Whole-book overview (the through-line):", b.overview.trim(), "");
  }
  if (b.chapters.length) {
    lines.push("Chapters (cite these numbers in sourceChapters):", ...b.chapters.map(chapterLine));
  } else {
    lines.push("No chapter list is available for this book.");
  }
  if (b.figures.length) {
    lines.push(
      "",
      "Available figures (cite by figId):",
      ...b.figures.slice(0, 40).map((f) => `- ${f.id}: ${f.caption}`),
    );
  }
  return lines.join("\n");
}

// Build the plan call's user message: each book's block, then the talk
// instruction.
export function planUserMessage(books: PlanBook[], instruction: string): string {
  const parts: string[] = books.map(bookBlock);
  const steer = instruction.trim();
  parts.push(
    steer
      ? `Talk instruction (theme / audience): ${steer}`
      : "No specific talk instruction was given; design a clear general-audience talk.",
  );
  parts.push("Return the deck outline JSON now.");
  return parts.join("\n\n");
}

// Models wrap JSON in fences or preamble; cut from the first "{" to the last "}".
export function extractJson(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in the model output");
  return text.slice(start, end + 1);
}

function asKind(v: unknown, tally?: ParseTally): SlideKind {
  if (KINDS.includes(v as SlideKind)) return v as SlideKind;
  if (tally) tally.repaired++;
  return "content";
}

function asChapters(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const nums = v
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n >= 1);
  return nums.length ? nums : undefined;
}

function cleanSlide(raw: any, tally?: ParseTally): SlideOutline | null {
  const repair = () => {
    if (tally) tally.repaired++;
  };
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  const kind = asKind(raw?.kind, tally);
  // A slide with neither a title nor a kind cue is unusable; section/title/closing
  // can carry a short title, content needs one.
  if (!title && kind === "content") return null;
  if (!title) repair();
  const slide: SlideOutline = { title: title || defaultTitle(kind), kind };

  if (typeof raw?.bookId === "string" && raw.bookId.trim()) slide.bookId = raw.bookId.trim();
  if (raw?.sourceChapters !== undefined && !Array.isArray(raw.sourceChapters)) repair();
  const chapters = asChapters(raw?.sourceChapters);
  if (chapters) slide.sourceChapters = chapters;

  const ill = raw?.illustration;
  const figure = raw?.figure;
  const wantsFigure = !!(figure && typeof figure.figId === "string" && figure.figId.trim());
  const wantsIllustration = !!(ill && typeof ill.prompt === "string" && ill.prompt.trim());
  // The prompt allows at most one asset slot; asking for both loses one.
  if (wantsFigure && wantsIllustration) repair();
  // At most one asset slot; a figure with a real id wins over an illustration.
  if (wantsFigure) {
    const bookId = typeof figure.bookId === "string" && figure.bookId.trim() ? figure.bookId.trim() : slide.bookId;
    if (bookId) slide.figure = { bookId, figId: String(figure.figId).trim().toLowerCase() };
    // A figure citation with no book to resolve it against is dropped whole.
    else repair();
  } else if (wantsIllustration) {
    slide.illustration = { prompt: ill.prompt.trim() };
  }
  return slide;
}

function defaultTitle(kind: SlideKind): string {
  return kind === "title" ? "Untitled" : kind === "closing" ? "Wrapping up" : "Section";
}

// Parse and validate the plan call's output into a deck plan. Invalid slides are
// dropped; an empty deck throws so the pipeline can surface a plan failure.
//
// `tally` is an optional out-parameter for the structured-output measurement
// (structured-output.ts).
export function parseSlidePlan(text: string, tally?: ParseTally): DeckPlan {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  const hasTitle = typeof raw.title === "string" && !!raw.title.trim();
  if (!hasTitle && tally) tally.repaired++;
  const title = hasTitle ? (raw.title as string).trim() : "Untitled talk";
  const rawSlides = Array.isArray(raw.slides) ? raw.slides : [];
  const slides = rawSlides
    .map((s) => cleanSlide(s, tally))
    .filter((s): s is SlideOutline => s !== null);
  if (tally) {
    tally.seen += rawSlides.length;
    tally.kept += slides.length;
  }
  if (slides.length === 0) {
    if (tally) tally.fail = rawSlides.length ? "empty-result" : "missing-field";
    throw new Error("plan produced no slides");
  }
  return { title, slides };
}

// Check a parsed plan against the books it claims to draw on, and say so when it
// does not line up (docs/29: an invented chapter number used to travel all the
// way to the content stage and silently become "distil the overview again", and
// an invented figure id was only discovered in the asset stage, which then
// marked itself done).
//
// Repairs, never drops a slide: a slide with a bad citation still gets written,
// it just carries a planNotice saying what it lost.
export function validateDeckPlan(plan: DeckPlan, books: PlanBook[]): DeckPlan {
  const byId = new Map(books.map((b) => [b.bookId, b]));
  const slides = plan.slides.map((slide) => {
    const notices: string[] = [];
    const out: SlideOutline = { ...slide };

    const book = out.bookId ? byId.get(out.bookId) : undefined;
    if (out.bookId && !book) {
      notices.push(`Unknown book id "${out.bookId}" — the slide falls back to the shared overviews.`);
      delete out.bookId;
      delete out.sourceChapters;
    }

    if (book && out.sourceChapters?.length) {
      const known = new Map(book.chapters.map((c) => [c.index, c]));
      const kept: number[] = [];
      const missing: number[] = [];
      const noNote: number[] = [];
      for (const i of out.sourceChapters) {
        const ch = known.get(i);
        if (!ch) missing.push(i);
        else if (!ch.hasNote) noNote.push(i);
        else kept.push(i);
      }
      if (missing.length) {
        notices.push(
          `Chapter ${missing.join(", ")} does not exist in "${book.title}" (it has ${book.chapters.length}).`,
        );
      }
      if (noNote.length) notices.push(`Chapter ${noNote.join(", ")} has no note yet.`);
      if (kept.length) out.sourceChapters = kept;
      else {
        delete out.sourceChapters;
        if (missing.length || noNote.length) {
          notices.push("No chapter note left to draw on — this slide falls back to the book overview.");
        }
      }
    }

    if (out.figure) {
      const figBook = byId.get(out.figure.bookId);
      const figId = out.figure.figId.toLowerCase();
      const known = figBook?.figures.some((f) => f.id.toLowerCase() === figId) ?? false;
      if (!known) {
        notices.push(
          `Figure "${out.figure.figId}" is not in ${figBook ? `"${figBook.title}"` : "any selected book"}'s figure index — the slide has no figure.`,
        );
        delete out.figure;
      }
    }

    if (notices.length) out.planNotice = notices.join(" ");
    return out;
  });
  return { title: plan.title, slides };
}
