// Cleanup pass (docs/15). One call to the user's existing chat provider at low
// thinking that turns a raw speech transcript into polished chat-input text:
// strips fillers, keeps only the corrected half of a self-correction, adds
// punctuation, preserves the original language(s), and fixes obvious
// mis-transcriptions of the book's technical terms. It never adds content or
// answers the question. Prompt building is pure and unit-tested; the model call
// is injected. On any failure the caller keeps the raw transcript.

import type { ProviderId } from "../providers";
import type { ThinkingLevel } from "@earendil-works/pi-ai";

const GLOSSARY_MAX_CHARS = 300;

export interface GlossarySource {
  title?: string | null;
  outline?: { title: string }[];
}

// The current book's proper names, one term at a time: the title plus
// outline/chapter headings, de-duplicated and capped so what is built from them
// stays small. Empty when no book is open.
//
// Two callers want the same list in two shapes. A prompt wants it joined
// (buildGlossary, below); iOS wants the terms themselves, as the recognizer's
// contextualStrings (docs/15) — so the list and its cap live here once rather
// than being split back out of a string.
export function glossaryTerms(source: GlossarySource): string[] {
  const terms: string[] = [];
  const push = (t: string | undefined | null) => {
    const v = t?.trim();
    if (v && !terms.includes(v)) terms.push(v);
  };
  push(source.title);
  for (const item of source.outline ?? []) push(item.title);

  const kept: string[] = [];
  let length = 0;
  for (const t of terms) {
    const next = length ? length + 2 + t.length : t.length;
    if (next > GLOSSARY_MAX_CHARS) break;
    kept.push(t);
    length = next;
  }
  return kept;
}

// A compact glossary of the current book's proper names for the model to anchor
// mis-transcriptions against. Empty string when no book is open.
export function buildGlossary(source: GlossarySource): string {
  return glossaryTerms(source).join("; ");
}

export function buildCleanupSystemPrompt(glossary: string): string {
  const base = [
    "You clean up a raw speech transcript so it reads well as text typed into a reading app's chat box.",
    "Rules:",
    "- Remove filler words and hesitations (um, uh, 呃, 那个, like, you know).",
    "- When the speaker self-corrects, keep only the corrected version.",
    "- Add punctuation and sentence breaks.",
    "- Keep the original language exactly: Chinese stays Chinese, English stays English, mixed stays mixed. Do not translate.",
    "- Fix obvious mis-transcriptions of the technical terms and proper names listed in the glossary.",
    "- Do NOT add content. Do NOT answer the question. Do NOT explain. Output only the cleaned text, nothing else.",
  ].join("\n");
  const glossaryBlock = glossary ? `\n\nGlossary (correct spellings):\n${glossary}` : "";
  return base + glossaryBlock;
}

export interface CleanupModel {
  providerId: ProviderId;
  modelId: string;
  reasoning?: ThinkingLevel;
}

// A one-shot, tool-less model call: system + user text in, final text out. The
// concrete implementation wraps streamChat; tests inject a fake.
export type CleanupRunner = (
  model: CleanupModel,
  systemPrompt: string,
  userText: string,
  signal?: AbortSignal,
) => Promise<string>;

// Polish a transcript. Returns the cleaned text, or the raw transcript unchanged
// if there is no model, the transcript is blank, or the call fails/returns
// nothing — voice input degrades, it never dies.
export async function cleanupTranscript(
  raw: string,
  glossary: string,
  model: CleanupModel | null,
  run: CleanupRunner,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = raw.trim();
  if (!trimmed || !model) return trimmed;
  try {
    const cleaned = (await run(model, buildCleanupSystemPrompt(glossary), trimmed, signal)).trim();
    return cleaned || trimmed;
  } catch {
    return trimmed;
  }
}
