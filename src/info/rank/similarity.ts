// Text similarity for merging events (docs/88 「打分」 step 6): the larger of
// the character-trigram Jaccard and the word Jaccard, so a paraphrase scores
// on shared words and a reworded title on shared spelling.
//
// Ported from last30days-skill (lib/dedupe.py: normalize_text, get_ngrams,
// jaccard_similarity, token_jaccard, hybrid_similarity). Portions Copyright (c)
// 2026 Matt Van Horn, under the MIT License; the full notice is in
// third-party-licenses.txt here.

import { segment, STOPWORDS } from "./tokens";

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Character n-grams of the normalized text (code points, spaces included). */
export function charNgrams(text: string, n = 3): Set<string> {
  const chars = [...normalizeText(text)];
  if (chars.length < n) return chars.length ? new Set([chars.join("")]) : new Set();
  const out = new Set<string>();
  for (let i = 0; i + n <= chars.length; i++) out.add(chars.slice(i, i + n).join(""));
  return out;
}

export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

function wordSet(text: string): Set<string> {
  return new Set(segment(normalizeText(text)).filter((t) => [...t].length > 1 && !STOPWORDS.has(t)));
}

export function wordJaccard(a: string, b: string): number {
  return jaccard(wordSet(a), wordSet(b));
}

/** A text prepared once for many comparisons. */
export interface PreparedText {
  grams: Set<string>;
  words: Set<string>;
}

export function prepareText(text: string): PreparedText {
  return { grams: charNgrams(text), words: wordSet(text) };
}

export function hybridSimilarity(a: string | PreparedText, b: string | PreparedText): number {
  const pa = typeof a === "string" ? prepareText(a) : a;
  const pb = typeof b === "string" ? prepareText(b) : b;
  return Math.max(jaccard(pa.grams, pb.grams), jaccard(pa.words, pb.words));
}
