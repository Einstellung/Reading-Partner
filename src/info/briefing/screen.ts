// Screening: the cheap stage that decides which discovered items are worth a
// page fetch (docs/35). It reads a headline, a source, a date and whatever blurb
// the list response carried — never an article body, because fetching the body
// is the decision it is making — and answers one question per item: is the full
// text worth going and getting for THIS reader.
//
// It does not rank, tier, merge or summarize. Triage still does all of that,
// over the few items that survive here.
//
// Everything in this file is pure: the prompt, the parse, the batching, and the
// cap. live.ts makes the model call; pipeline.ts drives the batches.

import { aiLanguageName, type AiLanguage } from "../../platform/app/settings";
import type { ParseTally } from "../../platform/app/structured-output";
import { profileForPrompt } from "../../memory/profile/guess";
import type { InfoItem } from "../sources/item";

// Items per screening call. Big enough that a few hundred items are a handful
// of calls, small enough that one bad reply costs little and that the model
// still attends to the last item in the list.
export const SCREEN_BATCH_SIZE = 50;
// Screening calls in flight. The batches are independent by construction — an
// absolute judgement per item — so this is purely about wall clock.
export const SCREEN_CONCURRENCY = 3;
// The hard ceiling on how many items one day may fetch bodies for. It is a cost
// guard, not a quota: the screen never aims at it, and when it is hit the
// overflow is reported, never dropped quietly (see capKept).
export const SCREEN_MAX_KEEP = 120;
// How much of an item's blurb the screen reads. A list summary is short by
// nature; this only guards against a feed that ships a whole article in it.
export const SCREEN_SUMMARY_CHARS = 400;

// One verdict on one item. `why` is a working note (it goes to the log, never
// to the reader); `confidence` is 0-3 and is only ever consulted when the cap
// has to cut something.
export interface ScreenVerdict {
  id: string;
  keep: boolean;
  why: string;
  confidence: number;
}

// The language of `why`. It is internal, but it is still text a model writes, so
// it follows the same language setting as everything else rather than drifting.
function screenLanguageLine(aiLanguage: AiLanguage): string {
  const name = aiLanguageName(aiLanguage);
  return name
    ? `Write each \`why\` in ${name}, even when the item is in another language.`
    : "Write each `why` in English (the UI language), even when the item is in another language.";
}

export function screenSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  return [
    "You are the screening stage of a personal news reader. You are looking at the",
    "headlines of everything the reader's sources published — hundreds of items on a",
    "busy day. All you have is each item's headline, source, date, and whatever short",
    "blurb the list carried. You have NOT read any article, and you will not: fetching",
    "the article is precisely what you are deciding about.",
    "",
    "For each item answer ONE question: is it worth fetching the full text of this one",
    "for this reader? Keep it if the full text plausibly carries something they would",
    "want; drop it if the headline already tells you the piece is noise for them —",
    "vendor PR, a funding round they do not follow, a recap, a listicle, a horoscope,",
    "a topic nowhere near anything they care about.",
    "",
    "You are NOT ranking, NOT sorting into tiers, NOT writing summaries, NOT merging",
    "duplicate coverage. A later stage does all of that, on what you keep. Do not do",
    "its job; do not hedge by keeping something so that stage can decide.",
    "",
    "Judge every item on its own merits, absolutely. There is NO quota and NO budget:",
    "keep every item that clears the bar and drop every item that does not, even if",
    "that means keeping all of them or none of them. Never keep an item because a",
    "batch ought to have some keepers. Never drop one because you feel you have kept",
    "enough already. Never balance across sources. The set you are shown is an",
    "arbitrary slice of the day, not a list to pick winners from.",
    "",
    "When you genuinely cannot tell from the headline, keep it: the cost of a wasted",
    "fetch is small, and the cost of dropping the one piece that mattered is not.",
    "",
    "If the reader's profile is empty, assume nothing about their interests and judge",
    "on information value alone: what looks specific and substantive stays, what looks",
    "like PR, a rehash, or a recap goes. Do not invent a preference.",
    "",
    "You may also be given AI GUESSES ABOUT THE READER — inferences the system made on",
    "its own, from what they read and mark. Nobody confirmed these and some are wrong.",
    "A guess may tip a borderline call; it may never be the sole reason to drop an",
    "item, and the reader's own profile always wins where the two disagree.",
    "",
    screenLanguageLine(aiLanguage),
    "",
    "Some items show a URL where a headline should be: their source publishes a list of",
    "links with no titles. Read what you can out of the URL slug and the source, and",
    "when it tells you nothing, keep the item.",
    "",
    "For every item return: its exact `id`, `keep` (true/false), a `why` of at most a",
    "dozen words, and `confidence` 0-3 for how sure you are of the verdict (3 = certain,",
    "0 = a guess). Cover EVERY id you were given, exactly once.",
    "",
    "Output STRICT JSON only, no markdown fence, no prose around it, matching:",
    "{",
    '  "verdicts": [{ "id": string, "keep": boolean, "why": string, "confidence": number }]',
    "}",
  ].join("\n");
}

// One item as the screen sees it: no body, ever.
function formatItem(item: InfoItem): string {
  const date = item.publishedAt ? ` | ${item.publishedAt}` : "";
  const blurb = (item.summary || "").slice(0, SCREEN_SUMMARY_CHARS).trim();
  return [
    `id: ${item.id} | ${item.sourceName || item.source}${date}`,
    `title: ${item.title}`,
    blurb ? `blurb: ${blurb}` : "blurb: (none)",
  ].join("\n");
}

export function screenUserMessage(profile: string, items: InfoItem[]): string {
  // Same split as triage: what the reader said about themselves, and what the
  // system guessed, labelled apart so the prompt can weigh them differently.
  const identity = profileForPrompt(profile);
  return [
    "READER PROFILE (what the reader has told us themselves)",
    identity.declared || "(no profile set)",
    "",
    ...(identity.guesses
      ? ["AI GUESSES ABOUT THE READER (our own inferences, unconfirmed)", identity.guesses, ""]
      : []),
    `ITEMS TO SCREEN (${items.length})`,
    items.map(formatItem).join("\n\n"),
    "",
    "Return the screening JSON now.",
  ].join("\n");
}

// --- validation -----------------------------------------------------------

function extractJson(text: string): string | null {
  let s = text.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return s.slice(start, end + 1);
}

export type ScreenParseOutcome =
  | { ok: true; verdicts: ScreenVerdict[] }
  | { ok: false; error: string };

// Validate the model's JSON against the ids in the batch. Verdicts for ids that
// were not asked about are dropped, and so are duplicates (the first wins). A
// verdict missing `keep` is repaired to a keep with confidence 0, on the same
// reasoning the prompt gives the model: an unfetched article that mattered is
// the expensive mistake, a wasted fetch is the cheap one.
export function parseScreenVerdicts(
  text: string,
  validIds: Set<string>,
  tally?: ParseTally,
): ScreenParseOutcome {
  const json = extractJson(text);
  if (!json) return { ok: false, error: "no JSON object in reply" };
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!data || typeof data !== "object") return { ok: false, error: "reply is not an object" };
  const raw = (data as Record<string, unknown>).verdicts;
  if (!Array.isArray(raw)) {
    if (tally) tally.fail = "missing-field";
    return { ok: false, error: "missing verdicts array" };
  }
  if (tally) tally.seen += raw.length;
  const seen = new Set<string>();
  const verdicts: ScreenVerdict[] = [];
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const keep = typeof o.keep === "boolean" ? o.keep : true;
    if (typeof o.keep !== "boolean" && tally) tally.repaired++;
    verdicts.push({
      id,
      keep,
      why: typeof o.why === "string" ? o.why.trim() : "",
      confidence: clampConfidence(o.confidence),
    });
  }
  if (tally) tally.kept += verdicts.length;
  if (verdicts.length === 0) {
    if (tally) tally.fail = "empty-result";
    return { ok: false, error: "no usable verdicts" };
  }
  return { ok: true, verdicts };
}

function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(3, Math.max(0, Math.round(n)));
}

// --- batching and the cap --------------------------------------------------

// Split the items into screening calls. Order is preserved, so a resumed run
// batches what it still owes the same way it would have the first time.
export function screenBatches<T>(items: T[], size = SCREEN_BATCH_SIZE): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

// Every id the batch asked about gets a verdict, whether or not the model
// returned one. A model that skips an item must not be able to silently drop
// it, so the missing ones come back as keeps — the same fail-open direction the
// prompt asks for, made structural.
export function fillMissingVerdicts(ids: string[], verdicts: ScreenVerdict[]): ScreenVerdict[] {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  return ids.map(
    (id) => byId.get(id) ?? { id, keep: true, why: "not judged; kept by default", confidence: 0 },
  );
}

export interface Selection {
  // The ids that go on to have their bodies fetched, in discovery order.
  ids: string[];
  // Keeps the cap cut. Reported everywhere it happens — the log, the progress
  // line, the briefing — because a ceiling that trims the day in silence is
  // indistinguishable from a screen that is quietly too strict.
  cappedOut: number;
}

// The kept items, in discovery order, cut to the ceiling if there are more than
// it allows. The cut is by confidence — the verdicts the screen was least sure
// of go first — and ties break on discovery order, so it is deterministic and a
// resumed run reproduces it.
export function capKept(
  keptIds: string[],
  confidence: Map<string, number>,
  max = SCREEN_MAX_KEEP,
): Selection {
  if (keptIds.length <= max) return { ids: [...keptIds], cappedOut: 0 };
  const ranked = keptIds
    .map((id, index) => ({ id, index, confidence: confidence.get(id) ?? 0 }))
    .sort((a, b) => b.confidence - a.confidence || a.index - b.index)
    .slice(0, max);
  const survivors = new Set(ranked.map((r) => r.id));
  return {
    ids: keptIds.filter((id) => survivors.has(id)),
    cappedOut: keptIds.length - survivors.size,
  };
}
