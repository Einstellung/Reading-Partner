// Screening: the cheap stage that reads every headline the day produced and
// answers one question about each (docs/63 采集). It used to be "is the body
// worth fetching for this reader"; now it is "which observables of which
// research room does this headline hit". Same cost shape — a headline, a source,
// a date, whatever blurb the list carried, never an article body, because
// fetching the body is the decision it is making — but the answer is addressed:
// a kept item names the room it belongs to, and that is what makes it a cable.
//
// The reader's profile is no longer an input. A room's charter says what it
// watches; screening against a personality on top of that was the old design's
// way of having no rooms.
//
// Everything in this file is pure: the targets, the prompt, the parse, the
// batching, and the cap. live.ts makes the model call; pipeline.ts drives the
// batches.

import { aiLanguageName, type AiLanguage } from "../../platform/app/settings";
import type { ParseTally } from "../../platform/app/structured-output";
import type { CableHit } from "../cable/types";
import { activeLabs } from "../labs/labs";
import type { Lab } from "../labs/types";
import type { Picture } from "../picture/types";
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
// overflow is reported, never dropped quietly (see selectKept).
export const SCREEN_MAX_KEEP = 120;
// How much of an item's blurb the screen reads. A list summary is short by
// nature; this only guards against a feed that ships a whole article in it.
export const SCREEN_SUMMARY_CHARS = 400;

// One room as the screen sees it: the charter's scope, and the observables that
// are still live. Flattened out of the lab and its picture so the prompt never
// has to reach into either.
export interface ScreenTarget {
  labId: string;
  name: string;
  scope: string;
  observables: { id: string; text: string }[];
  // The source descriptor ids this room claims; [] claims nothing.
  sources: string[];
}

// One verdict on one item. `confidence` is 0-1 and is only ever consulted when
// the cap has to cut something. There is no `why`: a hit is its own reason, and
// the analyst reads the cable, not a screening note.
export interface ScreenVerdict {
  id: string;
  hits: CableHit[];
  // Set when the item is notable but no room covers it. At most one per day
  // survives the selection.
  outside?: string;
  confidence: number;
}

/** An item worth fetching: it hit a room, or it was flagged as outside them all. */
export function keepVerdict(v: ScreenVerdict): boolean {
  return v.hits.length > 0 || !!v.outside;
}

/**
 * The rooms today's screen is run against: the open ones, each with the
 * observables its picture is still watching. Retired observables are left out —
 * a room stops watching something by retiring it, and a screen that kept
 * matching it would keep filing cables nobody reads.
 *
 * `pictures` is a map or a lookup so the caller can load them however it already
 * has them; a room with no picture yet screens at scope level.
 */
export function screenTargets(
  labs: readonly Lab[],
  pictures: Map<string, Picture> | ((labId: string) => Picture | undefined),
): ScreenTarget[] {
  const lookup = typeof pictures === "function" ? pictures : (id: string) => pictures.get(id);
  return activeLabs(labs).map((lab) => ({
    labId: lab.id,
    name: lab.name,
    scope: lab.charter.scope,
    observables: (lookup(lab.id)?.observables ?? [])
      .filter((o) => !o.retiredOn)
      .map((o) => ({ id: o.id, text: o.text })),
    sources: [...lab.sources],
  }));
}

/**
 * The rooms one item is screened against — labsForSource, over targets. A source
 * somebody claimed is read for the claimants and nobody else (docs/63 源归局不归
 * 人); a source nobody claimed is offered to every open room, because dropping it
 * would silently make a subscription invisible.
 */
export function targetsForItem(
  targets: readonly ScreenTarget[],
  item: InfoItem,
): ScreenTarget[] {
  const claiming = targets.filter((t) => t.sources.includes(item.source));
  return claiming.length > 0 ? claiming : [...targets];
}

// --- the prompt -------------------------------------------------------------

// The one piece of prose the screen writes is the `outside` reason, so the
// language setting has exactly one thing to govern here.
function screenLanguageLine(aiLanguage: AiLanguage): string {
  const name = aiLanguageName(aiLanguage);
  return name
    ? `Write the \`outside\` reason in ${name}, even when the item is in another language.`
    : "Write the `outside` reason in English (the UI language), even when the item is in another language.";
}

export function screenSystemPrompt(aiLanguage: AiLanguage = "auto"): string {
  return [
    "You are the screening stage of a personal research bureau. The bureau is made of",
    "research rooms. Each room has a scope — the paragraph saying where its field of",
    "view ends — and a list of observables: the specific things it is watching for now.",
    "",
    "You are shown the headlines of everything the reader's sources published. All you",
    "have is each item's headline, source, date, and whatever short blurb the list",
    "carried. You have NOT read any article, and you will not: fetching the article is",
    "precisely what you are deciding about.",
    "",
    "For each item answer ONE question: which rooms' observables does it hit? An item",
    "hits an observable when the headline plausibly reports on that exact thing. Return",
    "the room with an EMPTY observable list only when the room lists no observables at",
    "all and the item falls inside its scope; when a room does list observables and the",
    "item matches none of them, that room is not hit.",
    "",
    "You are NOT ranking, NOT sorting into tiers, NOT writing summaries, NOT merging",
    "duplicate coverage. A later stage reads the bodies of what you keep and does all of",
    "that. Do not do its job; do not hedge by claiming a hit so it can decide.",
    "",
    "Judge every item on its own merits, absolutely. There is NO quota and NO budget: an",
    "item that hits nothing hits nothing, even if that is every item you were shown, and",
    "an item that hits four rooms hits four rooms. Never invent a hit to give a room a",
    "day's work. Never balance across rooms or across sources. The set you are shown is",
    "an arbitrary slice of the day, not a list to pick winners from.",
    "",
    "When you genuinely cannot tell from the headline whether it hits, say it hits with a",
    "low confidence: the cost of a wasted fetch is small, and the cost of missing the one",
    "piece that mattered is not.",
    "",
    "At most ONCE per batch you may flag an item as NOTABLE BUT OUTSIDE EVERY ROOM: a",
    "headline plainly significant for this reader that no scope covers. Give it an",
    "`outside` field with a one-line reason and no hits. Most batches have none; leave it",
    "out rather than reaching for one.",
    "",
    screenLanguageLine(aiLanguage),
    "",
    "Some items show a URL where a headline should be: their source publishes a list of",
    "links with no titles. Read what you can out of the URL slug and the source, and when",
    "it tells you nothing, treat it as a low-confidence hit on whatever room the source",
    "belongs to rather than dropping it.",
    "",
    "For every item that hits something return: its exact `id`, `hits`, and `confidence`",
    "0-1 for how sure you are (1 = certain, 0 = a guess). Use the lab ids and observable",
    "ids EXACTLY as they are printed below — never a number, a name, or an id you were",
    "not given. An item that hits nothing you may leave out entirely.",
    "",
    "Output STRICT JSON only, no markdown fence, no prose around it, matching:",
    "{",
    '  "verdicts": [{ "id": string, "hits": [{ "labId": string, "observables": string[] }],',
    '                 "confidence": number, "outside": string (optional) }]',
    "}",
  ].join("\n");
}

function formatTarget(t: ScreenTarget): string {
  const lines = [`lab: ${t.labId} | ${t.name}`, `scope: ${t.scope}`];
  if (t.observables.length === 0) {
    lines.push("observables: (none yet — hit this room with an empty observable list)");
  } else {
    lines.push("observables:");
    t.observables.forEach((o, i) => lines.push(`  ${i + 1}. ${o.id} — ${o.text}`));
  }
  return lines.join("\n");
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

export function screenUserMessage(
  targets: readonly ScreenTarget[],
  items: readonly InfoItem[],
): string {
  return [
    `RESEARCH ROOMS (${targets.length})`,
    targets.length ? targets.map(formatTarget).join("\n\n") : "(none)",
    "",
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

// Validate the model's JSON against the batch and the rooms it was shown.
//
// Every id the model returns has to be one it was given: an item id from the
// batch, a lab id from the targets, an observable id from that lab. Nothing is
// repaired upward — an invented observable is dropped, and a hit whose
// observables were all invented is dropped with it, because a hit on a room that
// lists observables has to say which one. The one exception is a room with no
// observables yet, where an empty list is the whole answer.
//
// An empty `verdicts` array is a valid reply: a batch where nothing hit anything
// is an ordinary day, not a failed call. A reply that returned entries and had
// none of them survive is not — that is a model answering about something else,
// and the caller retries.
export function parseScreenVerdicts(
  text: string,
  targets: readonly ScreenTarget[],
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
  const byLab = new Map(targets.map((t) => [t.labId, t]));
  const seen = new Set<string>();
  const verdicts: ScreenVerdict[] = [];
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    if (!validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const hits = readHits(o.hits, byLab, tally);
    const outside =
      typeof o.outside === "string" && o.outside.trim() !== "" ? o.outside.trim() : undefined;
    verdicts.push({
      id,
      hits,
      ...(outside ? { outside } : {}),
      confidence: clampConfidence(o.confidence),
    });
  }
  if (tally) tally.kept += verdicts.length;
  if (raw.length > 0 && verdicts.length === 0) {
    if (tally) tally.fail = "empty-result";
    return { ok: false, error: "no usable verdicts" };
  }
  return { ok: true, verdicts };
}

function readHits(
  raw: unknown,
  byLab: Map<string, ScreenTarget>,
  tally?: ParseTally,
): CableHit[] {
  if (!Array.isArray(raw)) return [];
  const hits: CableHit[] = [];
  const claimed = new Set<string>();
  for (const el of raw) {
    if (!el || typeof el !== "object") continue;
    const o = el as Record<string, unknown>;
    const labId = typeof o.labId === "string" ? o.labId : "";
    const target = byLab.get(labId);
    if (!target || claimed.has(labId)) continue;
    const known = new Set(target.observables.map((ob) => ob.id));
    const observables: string[] = [];
    let dropped = false;
    for (const ob of Array.isArray(o.observables) ? o.observables : []) {
      if (typeof ob !== "string") continue;
      if (!known.has(ob)) {
        dropped = true;
        continue;
      }
      if (!observables.includes(ob)) observables.push(ob);
    }
    // A room that lists observables is only hit through one of them: an empty
    // list here means every id the model gave was invented (or it gave none),
    // and a scope-level hit is not available to say so.
    if (observables.length === 0 && target.observables.length > 0) {
      if (tally) tally.repaired++;
      continue;
    }
    if (dropped && tally) tally.repaired++;
    claimed.add(labId);
    hits.push({ labId, observables });
  }
  return hits;
}

// 0-1, so the cap has a total order to cut along. A model that answers on the
// old 0-3 scale lands on 1 rather than out of range.
function clampConfidence(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
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
// returned one, so a batch that lands can never leave an item in limbo — which
// is what lets the resume treat "has a verdict" as "already paid for".
//
// The fail-open direction is the other way round from the old screen. There it
// was cheaper to fetch a body nobody wanted than to lose the one that mattered,
// so a missing verdict became a keep. Here a kept item has to name the room it
// belongs to, and there is no room to name: a fabricated hit would put a false
// cable into a picture, which costs more than a missed headline.
export function fillMissingVerdicts(ids: string[], verdicts: ScreenVerdict[]): ScreenVerdict[] {
  const byId = new Map(verdicts.map((v) => [v.id, v]));
  return ids.map((id) => byId.get(id) ?? { id, hits: [], confidence: 0 });
}

export interface Selection {
  // The ids that go on to have their bodies fetched, in discovery order.
  ids: string[];
  // Keeps the cap cut. Reported everywhere it happens — the log and the progress
  // line — because a ceiling that trims the day in silence is indistinguishable
  // from a screen that is quietly too strict.
  cappedOut: number;
}

/**
 * What the day fetches bodies for: every verdict that hit something, cut to the
 * ceiling if there are more than it allows. The cut is by confidence — the hits
 * the screen was least sure of go first — and ties break on the order the
 * verdicts came in, so it is deterministic and a resumed run reproduces it.
 * Survivors keep that order rather than confidence order.
 *
 * The one `outside` item is never cut, and there is only one: a second flag on a
 * later verdict is ignored, so a day carries at most one out-of-lane cable
 * however many batches asked for one.
 */
export function selectKept(
  verdicts: readonly ScreenVerdict[],
  max = SCREEN_MAX_KEEP,
): Selection {
  const kept: { id: string; confidence: number; outside: boolean }[] = [];
  let outsideTaken = false;
  for (const v of verdicts) {
    const outside = !!v.outside && !outsideTaken;
    if (v.outside) outsideTaken = true;
    if (v.hits.length === 0 && !outside) continue;
    kept.push({ id: v.id, confidence: v.confidence, outside });
  }
  if (kept.length <= max) return { ids: kept.map((k) => k.id), cappedOut: 0 };
  const survivors = new Set(
    kept
      .map((k, index) => ({ ...k, index }))
      .sort(
        (a, b) =>
          Number(b.outside) - Number(a.outside) ||
          b.confidence - a.confidence ||
          a.index - b.index,
      )
      .slice(0, max)
      .map((k) => k.id),
  );
  return {
    ids: kept.filter((k) => survivors.has(k.id)).map((k) => k.id),
    cappedOut: kept.length - survivors.size,
  };
}
