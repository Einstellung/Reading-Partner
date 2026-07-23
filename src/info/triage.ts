// Triage: the one AI call that turns a day's items + the user profile + recent
// feedback into a tiered Briefing (docs/16). Prompt assembly and strict-JSON
// validation are pure and unit-tested; live.ts runs the model call under the
// watchdog. The model sorts every item into exactly one tier and writes the
// overview/reasons/lines to the user.

import { languageInstruction, type AiLanguage } from "../settings";
import type { FeedbackEvent, InfoItem, TriageResult } from "./types";

// How much of each article's text the model sees. Enough to judge substance
// without blowing up the prompt across ~30 items.
export const TRIAGE_TEXT_CHARS = 1500;
// How many feedback events the tail carries.
export const FEEDBACK_TAIL = 30;

export const TRIAGE_SYSTEM_PROMPT = [
  "You are the triage stage of a personal news reader. Each day you read a set of",
  "items from the reader's own subscribed sources — mixed languages (Chinese and",
  "English), mixed depth — and sort them for one specific reader, whose profile and",
  "recent reactions you are given. You are ruthless on their behalf: most items on",
  "any given day are noise, and saying so plainly is the job.",
  "",
  "If the profile is empty, assume nothing about the reader's interests or any",
  "field or vertical — judge each item on its own information value, universally:",
  "what carries real, specific, non-obvious substance stays; PR, recaps, and",
  "rehashes go. Do not invent a preference the profile does not state.",
  "",
  "Write the overview, reasons, and one-liners in English (the UI language), even",
  "when the source item is in another language.",
  "",
  "Some items are marked [summary only]: only their headline and a short summary",
  "were retrieved, not the full text (a discovery-only source, a paywall, or a",
  "failed fetch). Triage these on the headline and summary alone. Never write a",
  "reason or one-liner that implies you read the full article when you did not.",
  "",
  "Sort EVERY item into exactly one of these tiers:",
  "",
  '- "mustRead" (2-4 items): genuinely worth their time given the profile. Each',
  "  needs a `reason` written TO the reader, referencing their interests — why",
  "  THIS reader should open THIS one. No generic praise.",
  '- "oneLiners" (about 3-6 items): worth knowing but not worth opening. The',
  "  `line` IS the consumption — a complete, specific sentence carrying the actual",
  "  news (what happened, who, the number that matters), not a teaser.",
  '- "outOfLane" (0 or 1 item): something important that this reader would NOT',
  "  normally follow — a deliberate anti-echo-chamber pick. `reason` says what it",
  "  is and why it is worth a look anyway. Omit it (empty array) on days with no",
  "  honest candidate; do not force one.",
  '- "filtered" (everything else): each with a short `category` label such as',
  '  "vendor PR", "conference recap", "funding news", "rehash", "listicle".',
  "",
  "If the same story is covered by more than one source — including a Chinese",
  "source and an English source reporting the same event — keep ONE entry in the",
  "tier it belongs to and name both outlets in its reason/line; put the other",
  'item(s) in "filtered" with category "duplicate coverage". Merge across languages,',
  "not just within one language.",
  "",
  "The overview is ONE honest line about the day as a whole. It is allowed — and",
  "expected on a slow day — to say the day is mostly noise.",
  "",
  "Reference items only by the exact `id` given. Output STRICT JSON only, no",
  "markdown fence, no prose around it, matching:",
  "{",
  '  "overview": string,',
  '  "mustRead": [{ "itemId": string, "reason": string }],',
  '  "oneLiners": [{ "itemId": string, "line": string }],',
  '  "outOfLane": [{ "itemId": string, "reason": string }],',
  '  "filtered": [{ "itemId": string, "category": string }]',
  "}",
].join("\n");

// The triage system prompt for a given output language. On "auto" it keeps the
// hardcoded English default (the overview/reasons/lines have no user message to
// mirror); any other value appends the instruction, which overrides the "in
// English" default so the reader gets the tiering in their language.
export function triageSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  const lang = languageInstruction(aiLanguage);
  return lang ? `${TRIAGE_SYSTEM_PROMPT}\n\n${lang}` : TRIAGE_SYSTEM_PROMPT;
}

// The tail of the feedback log the model reads, formatted compactly. Most recent
// last. Empty string when there is no history.
export function formatFeedbackTail(events: FeedbackEvent[], max = FEEDBACK_TAIL): string {
  const tail = events.slice(-max);
  if (tail.length === 0) return "(no reactions logged yet)";
  return tail
    .map((e) => {
      const cat = e.category ? ` [${e.category}]` : "";
      return `- ${e.action}: "${e.title}"${cat}`;
    })
    .join("\n");
}

// One item block for the prompt: id/source/date header + trimmed text (or the
// summary when the full text is missing). Summary-only items are flagged so the
// model triages them on headline+summary and does not fake having read them.
function formatItem(item: InfoItem, textChars: number): string {
  const hasFull = !!item.textContent && !item.summaryOnly;
  const body = (item.textContent || item.summary || "").slice(0, textChars).trim();
  const date = item.publishedAt ? ` | ${item.publishedAt}` : "";
  const flag = hasFull ? "" : " | [summary only]";
  return [
    `id: ${item.id} | ${item.sourceName || item.source}${date}${flag}`,
    `title: ${item.title}`,
    body ? `text: ${body}` : "text: (no body retrieved)",
  ].join("\n");
}

export function triageUserMessage(
  profile: string,
  feedback: FeedbackEvent[],
  items: InfoItem[],
  opts: { textChars?: number; feedbackMax?: number } = {},
): string {
  const textChars = opts.textChars ?? TRIAGE_TEXT_CHARS;
  return [
    "READER PROFILE",
    profile.trim() || "(no profile set)",
    "",
    "RECENT REACTIONS (oldest first; learn the reader's taste from these)",
    formatFeedbackTail(feedback, opts.feedbackMax),
    "",
    `TODAY'S ITEMS (${items.length})`,
    items.map((it) => formatItem(it, textChars)).join("\n\n"),
    "",
    "Return the triage JSON now.",
  ].join("\n");
}

// --- validation -----------------------------------------------------------

// Pull a JSON object out of the model's reply, tolerating a stray markdown fence
// or leading/trailing prose.
function extractJson(text: string): string | null {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

function asRefs<T extends { itemId: string }>(
  raw: unknown,
  validIds: Set<string>,
  build: (o: Record<string, unknown>, id: string) => T | null,
): T[] {
  if (!Array.isArray(raw)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    const id = typeof o.itemId === "string" ? o.itemId : "";
    if (!validIds.has(id) || seen.has(id)) continue;
    const built = build(o, id);
    if (built) {
      out.push(built);
      seen.add(id);
    }
  }
  return out;
}

export type ParseOutcome =
  | { ok: true; result: TriageResult }
  | { ok: false; error: string };

// Validate the model's JSON against the known item ids. Unknown-id or duplicate
// references are dropped; a missing overview or an unparseable body fails so the
// caller can retry once.
export function parseTriageResult(text: string, validIds: Set<string>): ParseOutcome {
  const json = extractJson(text);
  if (!json) return { ok: false, error: "no JSON object in reply" };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!data || typeof data !== "object") return { ok: false, error: "reply is not an object" };
  const o = data as Record<string, unknown>;
  const overview = typeof o.overview === "string" ? o.overview.trim() : "";
  if (!overview) return { ok: false, error: "missing overview" };

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const result: TriageResult = {
    overview,
    mustRead: asRefs(o.mustRead, validIds, (r, itemId) => {
      const reason = str(r.reason);
      return reason ? { itemId, reason } : null;
    }),
    oneLiners: asRefs(o.oneLiners, validIds, (r, itemId) => {
      const line = str(r.line);
      return line ? { itemId, line } : null;
    }),
    outOfLane: asRefs(o.outOfLane, validIds, (r, itemId) => {
      const reason = str(r.reason);
      return reason ? { itemId, reason } : null;
    }).slice(0, 1),
    filtered: asRefs(o.filtered, validIds, (r, itemId) => ({
      itemId,
      category: str(r.category) || "other",
    })),
  };
  return { ok: true, result };
}
