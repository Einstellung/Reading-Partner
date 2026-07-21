// System prompts for the floating info chat (docs/16). Two anchors: a
// briefing-level thread (the whole briefing as context) and an article thread
// (that article's full text plus the day's overview). Pure string assembly so
// the calling component stays thin; the AI call reuses streamChat.

import { languageInstruction, type AiLanguage } from "../settings";
import type { Briefing } from "./types";

// How much article text the chat carries as context (chat models take a big
// window; a very long piece still gets a sane cap).
const ARTICLE_CHARS = 12_000;

const BASE =
  "You are the reading companion for a daily AI-news briefing. Answer the user's " +
  "questions about the material below concisely and honestly, in the user's language. " +
  "If something isn't in the provided text, say so rather than inventing it.";

export function articleChatSystemPrompt(
  overview: string,
  title: string,
  text: string,
  aiLanguage: AiLanguage = "auto",
): string {
  const lang = languageInstruction(aiLanguage);
  return [
    lang ? `${BASE}\n${lang}` : BASE,
    "",
    `Today's briefing, in one line: ${overview}`,
    "",
    `The user is reading this article: "${title}".`,
    "Full text:",
    text.slice(0, ARTICLE_CHARS) || "(full text unavailable)",
  ].join("\n");
}

// The briefing-level thread: the whole document as context (overview + every
// tier's titles and the reasons/lines the triage wrote).
export function briefingChatSystemPrompt(b: Briefing, aiLanguage: AiLanguage = "auto"): string {
  const line = (id: string) => b.items[id]?.title ?? id;
  const lang = languageInstruction(aiLanguage);
  const parts = [
    lang ? `${BASE}\n${lang}` : BASE,
    "",
    `Overview: ${b.overview}`,
    "",
    "Worth your time:",
    ...b.mustRead.map((r) => `- ${line(r.itemId)} — ${r.reason}`),
    "",
    "In one line:",
    ...b.oneLiners.map((r) => `- ${r.line}`),
  ];
  if (b.outOfLane.length) {
    parts.push("", "Out of lane:", ...b.outOfLane.map((r) => `- ${line(r.itemId)} — ${r.reason}`));
  }
  if (b.filtered.length) {
    parts.push("", `Filtered ${b.filtered.length} items as noise (vendor PR, recaps, duplicates).`);
  }
  return parts.join("\n");
}
