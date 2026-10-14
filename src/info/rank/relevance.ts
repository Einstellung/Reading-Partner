// Local relevance (docs/88 「打分」 step 2): how well a candidate's text answers
// one query, from token overlap alone, 0 to 1. Query-centric: an exact phrase
// scores high, a partial match pays, and a match on generic words alone
// ("latest", "model") stays under the floor.
//
//   coverage    = |Q ∩ T| / |Q|
//   informative = |Qi ∩ T| / |Qi|          (Qi: Q without the low-signal words)
//   precision   = |Q ∩ T| / min(|T|, |Q| + 4)
//   base = 0.55·coverage^1.35 + 0.25·informative + 0.20·precision
//   the whole query as a phrase in the text: +0.12 (several words) / +0.16 (one)
//   only low-signal words matched: min(0.24, base)
//
// Ported from last30days-skill (lib/relevance.py, token_overlap_relevance),
// without the hashtag splitting. Portions Copyright (c) 2026 Matt Van Horn,
// under the MIT License; the full notice is in third-party-licenses.txt here.

import { hasCjk, LOW_SIGNAL_QUERY_TOKENS, tokenize } from "./tokens";

/** Below this a candidate is off-topic and dropped. */
export const RELEVANCE_FLOOR = 0.15;
/** The cap for a candidate that matched only low-signal query words. */
export const LOW_SIGNAL_CAP = 0.24;

export interface PreparedQuery {
  raw: string;
  tokens: Set<string>;
  // The query's tokens without the low-signal ones; all of them when that
  // leaves none.
  informative: Set<string>;
  phrase: string;
}

/** Lowercased, punctuation to spaces, whitespace collapsed. */
export function normalizePhrase(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/** A query tokenized once, for scoring many texts against it. */
export function prepareQuery(query: string): PreparedQuery {
  const tokens = tokenize(query);
  const informative = new Set([...tokens].filter((t) => !LOW_SIGNAL_QUERY_TOKENS.has(t)));
  return { raw: query, tokens, informative: informative.size ? informative : tokens, phrase: normalizePhrase(query) };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function intersection(a: Set<string>, b: Set<string>): number {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
}

/** 0 to 1, rounded to two places; 0.5 for a query with no usable words. */
export function localRelevance(query: string | PreparedQuery, text: string): number {
  const q = typeof query === "string" ? prepareQuery(query) : query;
  if (q.tokens.size === 0) return 0.5;
  const t = tokenize(text);
  const overlap = intersection(q.tokens, t);
  if (overlap === 0) return 0;

  const coverage = overlap / q.tokens.size;
  const informativeHits = intersection(q.informative, t);
  const informative = informativeHits / q.informative.size;
  const precision = overlap / (Math.min(t.size, q.tokens.size + 4) || 1);

  let phraseBonus = 0;
  if (q.phrase) {
    const normalized = normalizePhrase(text);
    let contained = normalized.includes(q.phrase);
    // CJK has no spaces between words, so a spaced Chinese query never occurs
    // verbatim in running text; compare with the spaces removed.
    if (!contained && hasCjk(q.phrase)) {
      contained = normalized.replace(/ /g, "").includes(q.phrase.replace(/ /g, ""));
    }
    if (contained) phraseBonus = q.phrase.split(" ").length > 1 ? 0.12 : 0.16;
  }

  const base = 0.55 * coverage ** 1.35 + 0.25 * informative + 0.2 * precision;
  if (informativeHits === 0) return round2(Math.min(LOW_SIGNAL_CAP, base));
  return round2(Math.min(1, base + phraseBonus));
}
