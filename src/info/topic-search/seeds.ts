// The seeds a drafting card carries (docs/info/91 起草与种子): which of the
// papers find_seed_paper put on seed cards the reader confirmed, by the card's
// buttons or in words as the model reports it. Pure.

import { asString, asStrings } from "../../platform/std/json";
import { normalizeTitle } from "../sources/plugins/match";
import type { ProposedSeed, StudySeedCandidate, StudySeedsCardData } from "./cards";
import { arxivIdIn } from "./seed-lookup";

/** What a model's seed reference names, as it may come: the key, the bare id, "arXiv 2401.12345", a link, the title. */
function refers(ref: string, c: StudySeedCandidate): boolean {
  const raw = ref.trim();
  if (!raw) return false;
  const id = c.key.slice(c.key.indexOf(":") + 1);
  const lower = raw.toLowerCase();
  if (lower === c.key || lower === id || lower === c.handle.toLowerCase()) return true;
  if (c.key.startsWith("arxiv:") && arxivIdIn(raw) === id) return true;
  return normalizeTitle(raw) !== "" && normalizeTitle(raw) === normalizeTitle(c.title);
}

export interface PickedSeeds {
  seeds: ProposedSeed[];
  /** References the model gave that no seed card in the conversation holds. */
  unknown: string[];
  /** References to candidates the reader marked 「不是」. */
  refused: string[];
}

/**
 * The seeds a drafting card carries: every candidate the reader marked
 * 「是这篇」 on a seed card in this conversation, and those the model names as
 * confirmed in words, unless the reader marked them 「不是」. A paper on more
 * than one card goes by the newest. In card order.
 */
export function pickSeeds(cards: readonly StudySeedsCardData[], refs: readonly string[], now: number): PickedSeeds {
  const latest = new Map<string, { card: StudySeedsCardData; candidate: StudySeedCandidate }>();
  for (const card of cards) for (const candidate of card.candidates) {
    latest.delete(candidate.key);
    latest.set(candidate.key, { card, candidate });
  }
  const named = new Set<string>();
  const unknown: string[] = [];
  const refused: string[] = [];
  for (const ref of refs) {
    const hit = [...latest.values()].find(({ candidate }) => refers(ref, candidate));
    if (!hit) unknown.push(ref);
    else if (hit.candidate.verdict === "no") refused.push(ref);
    else named.add(hit.candidate.key);
  }
  const seeds: ProposedSeed[] = [];
  for (const { card, candidate } of latest.values()) {
    if (candidate.verdict !== "yes" && !named.has(candidate.key)) continue;
    seeds.push({
      key: candidate.key,
      title: candidate.title,
      said: card.said,
      at: now,
      authors: candidate.authors,
      date: candidate.date,
      evidence: card.evidence,
    });
  }
  return { seeds, unknown, refused };
}

/** The model's seeds argument, read loosely: strings, or objects with a key. */
export function seedRefs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return asStrings(raw);
  return raw
    .map((r) => (typeof r === "string" ? r : r && typeof r === "object" ? asString((r as Record<string, unknown>).key) : ""))
    .map((r) => r.trim())
    .filter(Boolean);
}
