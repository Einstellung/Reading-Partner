// The second pass (docs/09): the chapter graph. Every chapter's spine is written
// first, in parallel, and each one can say what it builds on — the chapter's own
// back-references are in its pages. What no chapter can say is what comes to
// depend on it, so one call reads all the spines at once, connects them, and
// writes the edges the other way round.
//
// It never touches the book: the spines are the input, which is what makes this
// one call instead of one per chapter.
//
// It lands in the same file the whole-book framework used to (overview.md), and
// the state keeps the name overviewStatus. Pure prompt parts; the AI call is
// wired in live.ts.

import { type ThinkingLevel } from "@earendil-works/pi-ai";
import { aiLanguageName, type AiLanguage } from "../../../platform/app/settings";

// The graph prompt for a given output language. The output language is templated
// into the "Write in ___" line rather than pinned by an appended instruction, so
// the prompt carries exactly one language directive: "auto" keeps the English
// default, a set language replaces it.
export function overviewSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  const lang = aiLanguageName(aiLanguage) ?? "English";
  return [
    "You are preparing a book for a reading companion that teaches it a chapter at",
    "a time. Every chapter's spine is below; each says what its chapter covers and",
    "what it builds on. Write the chapter graph: the same dependencies read",
    "forwards, so the companion can answer where a chapter leads, what a reader has",
    "to have read before starting one, and what a reader can pass over.",
    "",
    "You are reading the spines only — the book is not in front of you. Do not add",
    "anything that is not in them, and keep any [p.N] anchor you carry over.",
    "",
    `Write in ${lang} as markdown, in exactly these three sections:`,
    "",
    "## Through-line",
    "Three to five lines: what the book is building, chapter block by chapter",
    "block. Not a summary of each chapter — the spines already hold those.",
    "",
    "## Chapters",
    "One block per chapter, in order, exactly:",
    "`ch.N <title>`",
    "`  needs: ch.A, ch.B — what it takes from them` (or `needs: nothing`)",
    "`  feeds: ch.C, ch.D — what they take from it` (or `feeds: nothing later`)",
    "A `feeds` edge must be the mirror of a `needs` line in that later chapter's",
    "spine, or something that spine plainly relies on. Do not invent an edge to",
    "make a chapter look connected; `feeds: nothing later` is a real answer and is",
    "the useful one for an appendix, an acknowledgements section or a coda.",
    "",
    "## Entry points",
    "Which chapters a reader can start at with nothing before them, and for each of",
    "the rest the shortest chain that has to come first. One line each.",
    "",
    "Output only those three sections.",
  ].join("\n");
}

// The chapter spines, section by section, as the model's input.
export function overviewUserMessage(chapters: { index: number; title: string; body: string }[]): string {
  const parts: string[] = ["Here are the chapter spines:"];
  for (const c of chapters) {
    parts.push(`=== ch.${c.index} ${c.title} ===\n${c.body.trim()}`);
  }
  parts.push("Write the chapter graph now.");
  return parts.join("\n\n");
}

export interface OverviewModel {
  providerId: string;
  modelId: string;
  reasoning?: ThinkingLevel;
}
