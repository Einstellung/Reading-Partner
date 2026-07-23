// Slides plan (docs/14), pure parts: turn a set of books' notes plus a talk
// instruction into an ordered deck outline. One AI call feeds each book's
// overview (or a fallback summary) and the instruction; the model returns JSON —
// a deck title and ordered slides, each tagged with a kind and optional
// book/chapter provenance and asset slots. The AI call itself lives in live.ts.

import { languageInstruction, type AiLanguage } from "../app/settings";
import type { SlideKind, SlideOutline } from "./types";

// The plan input for one book: its whole-book overview (or a fallback summary
// when no overview exists yet) and the figures available to cite.
export interface PlanBook {
  bookId: string;
  title: string;
  material: string;
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

// Build the plan call's user message: each book's material and figure list,
// followed by the talk instruction.
export function planUserMessage(books: PlanBook[], instruction: string): string {
  const parts: string[] = [];
  for (const b of books) {
    const lines = [`=== Book "${b.title}" (bookId: ${b.bookId}) ===`, b.material.trim()];
    if (b.figures.length) {
      lines.push(
        "",
        "Available figures (cite by figId):",
        ...b.figures.slice(0, 40).map((f) => `- ${f.id}: ${f.caption}`),
      );
    }
    parts.push(lines.join("\n"));
  }
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

function asKind(v: unknown): SlideKind {
  return KINDS.includes(v as SlideKind) ? (v as SlideKind) : "content";
}

function asChapters(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const nums = v
    .map((n) => Math.round(Number(n)))
    .filter((n) => Number.isFinite(n) && n >= 1);
  return nums.length ? nums : undefined;
}

function cleanSlide(raw: any): SlideOutline | null {
  const title = typeof raw?.title === "string" ? raw.title.trim() : "";
  const kind = asKind(raw?.kind);
  // A slide with neither a title nor a kind cue is unusable; section/title/closing
  // can carry a short title, content needs one.
  if (!title && kind === "content") return null;
  const slide: SlideOutline = { title: title || defaultTitle(kind), kind };

  if (typeof raw?.bookId === "string" && raw.bookId.trim()) slide.bookId = raw.bookId.trim();
  const chapters = asChapters(raw?.sourceChapters);
  if (chapters) slide.sourceChapters = chapters;

  const ill = raw?.illustration;
  const figure = raw?.figure;
  // At most one asset slot; a figure with a real id wins over an illustration.
  if (figure && typeof figure.figId === "string" && figure.figId.trim()) {
    const bookId = typeof figure.bookId === "string" && figure.bookId.trim() ? figure.bookId.trim() : slide.bookId;
    if (bookId) slide.figure = { bookId, figId: String(figure.figId).trim().toLowerCase() };
  } else if (ill && typeof ill.prompt === "string" && ill.prompt.trim()) {
    slide.illustration = { prompt: ill.prompt.trim() };
  }
  return slide;
}

function defaultTitle(kind: SlideKind): string {
  return kind === "title" ? "Untitled" : kind === "closing" ? "Wrapping up" : "Section";
}

// Parse and validate the plan call's output into a deck plan. Invalid slides are
// dropped; an empty deck throws so the pipeline can surface a plan failure.
export function parseSlidePlan(text: string): DeckPlan {
  const raw = JSON.parse(extractJson(text)) as Record<string, unknown>;
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Untitled talk";
  const slides = (Array.isArray(raw.slides) ? raw.slides : [])
    .map(cleanSlide)
    .filter((s): s is SlideOutline => s !== null);
  if (slides.length === 0) throw new Error("plan produced no slides");
  return { title, slides };
}
