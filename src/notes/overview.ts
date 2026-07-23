// The whole-book framework (docs/14): the "全书框架" section that opens the notes
// document — core thesis and the chapter-to-chapter logic line, the direct raw
// material for a future slide-deck outline. Written from the chapter notes only,
// after every chapter is done; it does not re-read the book. Pure prompt parts;
// the AI call is wired in live.ts.

import { type ThinkingLevel } from "@earendil-works/pi-ai";
import { languageInstruction, type AiLanguage } from "../app/settings";

export const OVERVIEW_SYSTEM_PROMPT = [
  "You are the note-taking stage of a reading companion. The per-chapter lecture",
  "notes for a whole book are given below. Write the book's framework: the",
  "opening section a reader (and a later slide deck) leans on to see the shape of",
  "the whole.",
  "",
  "Write in English as markdown, 200-500 words. Cover the book's core thesis and",
  "the logic line running chapter to chapter — how the argument is built up. This",
  "is a synthesis across chapters, not a chapter-by-chapter summary. Keep any",
  "[p.N] page anchors that appear in the chapter notes when you carry a claim",
  "over. Do not add a title heading; start directly with the content. Output only",
  "the framework.",
].join("\n");

// The overview system prompt for a given output language. "auto" keeps the
// English default; any other value appends the pinning instruction.
export function overviewSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  const lang = languageInstruction(aiLanguage);
  return lang ? `${OVERVIEW_SYSTEM_PROMPT}\n\n${lang}` : OVERVIEW_SYSTEM_PROMPT;
}

// The chapter notes, section by section, as the model's input.
export function overviewUserMessage(chapters: { index: number; title: string; body: string }[]): string {
  const parts: string[] = ["Here are the chapter notes:"];
  for (const c of chapters) {
    parts.push(`=== Chapter ${c.index}: ${c.title} ===\n${c.body.trim()}`);
  }
  parts.push("Write the whole-book framework now.");
  return parts.join("\n\n");
}

export interface OverviewModel {
  providerId: string;
  modelId: string;
  reasoning?: ThinkingLevel;
}
