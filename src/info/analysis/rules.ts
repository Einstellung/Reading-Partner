// The program-checked half of docs/63 质量规则 that belongs to the cover:
// 标题不强于正文 — the cover the reader sees may not claim more than the
// judgments behind it. A cover saying "almost certain" over a body that only
// reached "likely" is how a picture leaks certainty it never earned, and it is
// the one drift a program can catch without a model.
//
// The check reads words, so it is approximate by construction: it can miss a
// claim phrased around the vocabulary, and that is fine. It never blocks the
// cover — run.ts keeps the text and adds a warning — so a false positive costs
// a line in a log, not a briefing.

import { likelihoodRank } from "../picture/picture";
import type { Judgment } from "../picture/types";
import type { AiLanguage } from "../../platform/app/settings";

// The ladder in words, by rank (0 = almost-no-chance, 6 = almost-certain). Not
// a translation table: these are the phrases a model actually writes when it
// means that rung. Longer phrases must sit next to their shorter neighbours —
// the scanner takes the longest match at each position, so "very unlikely"
// never reads as "unlikely" and "probably not" never reads as "probably".
const EN_PHRASES: readonly (readonly string[])[] = [
  ["almost no chance", "no realistic chance", "highly improbable", "virtually impossible"],
  ["very unlikely", "highly unlikely", "little chance", "improbable"],
  ["unlikely", "probably not", "not likely", "doubtful", "not expected"],
  ["roughly even", "about even", "even chance", "even odds", "toss-up", "coin flip", "50-50"],
  ["likely", "probable", "probably", "expected to", "on track to"],
  ["very likely", "highly likely", "strong chance", "well on the way to"],
  ["almost certain", "all but certain", "virtually certain", "certain to", "inevitable"],
];

const ZH_PHRASES: readonly (readonly string[])[] = [
  ["几乎不可能", "毫无可能", "不可能"],
  ["很不可能", "极不可能", "希望渺茫", "可能性很小"],
  ["不太可能", "可能性不大", "恐怕不会"],
  ["五五开", "各占一半", "可能性相当", "五五之数"],
  ["有可能", "可能性较大", "多半", "大概率"],
  ["很有可能", "极有可能", "很可能", "非常可能"],
  ["几乎确定", "几乎可以肯定", "势在必行", "必然"],
];

export interface CoverCheck {
  ok: boolean;
  /** The phrase that claimed more than the body did. */
  offending?: string;
}

// Which word lists to scan. English is always scanned: the ladder's own words
// are English, and a model writing Chinese still reaches for them. A set
// language adds its own list; "auto" and an unset language scan everything,
// because then nobody knows what the cover will be written in.
function listsFor(aiLanguage?: AiLanguage): readonly (readonly (readonly string[])[])[] {
  if (aiLanguage === undefined || aiLanguage === "auto" || aiLanguage === "zh-CN") {
    return [EN_PHRASES, ZH_PHRASES];
  }
  return [EN_PHRASES];
}

interface Match {
  rank: number;
  phrase: string;
}

// The strongest likelihood phrase in the text, or null. Left to right, longest
// match at each position, then jump past what matched — so a phrase is never
// read as the shorter phrase it contains.
function strongestPhrase(text: string, lists: readonly (readonly (readonly string[])[])[]): Match | null {
  const hay = text.toLowerCase();
  let best: Match | null = null;
  for (let i = 0; i < hay.length; ) {
    let hit: Match | null = null;
    let hitLength = 0;
    for (const list of lists) {
      for (let rank = 0; rank < list.length; rank++) {
        for (const phrase of list[rank]!) {
          if (phrase.length <= hitLength) continue;
          if (hay.startsWith(phrase, i)) {
            hit = { rank, phrase };
            hitLength = phrase.length;
          }
        }
      }
    }
    if (!hit) {
      i++;
      continue;
    }
    if (!best || hit.rank > best.rank) best = hit;
    i += hitLength;
  }
  return best;
}

/**
 * Whether the cover stays within what today's judgments support.
 *
 * A cover with no likelihood phrase always passes. With one, its rank must be at
 * most the strongest rank among the judgments the room added today — and a day
 * that added no judgment supports no likelihood claim at all.
 */
export function coverWithinBody(
  cover: string,
  judgmentsToday: Judgment[],
  aiLanguage?: AiLanguage,
): CoverCheck {
  const found = strongestPhrase(cover, listsFor(aiLanguage));
  if (!found) return { ok: true };
  const ceiling = judgmentsToday.reduce(
    (max, j) => Math.max(max, likelihoodRank(j.likelihood)),
    -1,
  );
  if (found.rank <= ceiling) return { ok: true };
  return { ok: false, offending: found.phrase };
}
