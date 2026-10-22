// The final score of a candidate (docs/88 「打分」 step 5), 0-100:
//
//   post   0.65·score + 0.20·RRF + 0.15·engagement
//   paper  0.80·score + 0.20·RRF
//
// A post whose main (the link it is about) is a paper is scored as a paper;
// the caller passes kind "paper" for it (topic-search/rank-pool.ts).
//
// `score` is the rerank model's 0-100; below 20 the whole sum is multiplied by
// 0.3. Relevance is the model's call: nothing is taken off for wording (a
// candidate that never names the topic's anchors scores as any other). When
// the rerank failed, `score` is 0.7·relevance·100 and the 0.3 cliff does not
// apply (a weak lexical overlap is not a judge calling it irrelevant).
//
// Ported from last30days-skill (lib/rerank.py: _final_score and the fallback
// score), with docs/88's weights in place of the freshness and source-quality
// terms and without its entity-miss penalties. Portions
// Copyright (c) 2026 Matt Van Horn, under the MIT License; the full notice is
// in third-party-licenses.txt here.

import { hasCjk } from "./tokens";
import { normalizePhrase } from "./relevance";

export const RERANK_CLIFF = 20;
export const RERANK_CLIFF_FACTOR = 0.3;

export type CandidateKind = "post" | "paper";

export interface ScoreInput {
  kind: CandidateKind;
  /** The rerank model's score, 0-100; null when the rerank failed for this candidate. */
  rerank: number | null;
  /** Local relevance, 0-1 (the best over the queries that matched it). */
  relevance: number;
  /** Normalized RRF, 0-100. */
  rrf: number;
  /** 0-100, posts only; null when the post has none. */
  engagement: number | null;
}

function clamp100(x: number): number {
  return Math.max(0, Math.min(100, x));
}

/** The stand-in for the model's score when the rerank failed. */
export function fallbackRerankScore(relevance: number): number {
  return clamp100(0.7 * relevance * 100);
}

export function finalScore(c: ScoreInput): number {
  const score = c.rerank ?? fallbackRerankScore(c.relevance);
  let base =
    c.kind === "post"
      ? 0.65 * score + 0.2 * c.rrf + 0.15 * clamp100(c.engagement ?? 0)
      : 0.8 * score + 0.2 * c.rrf;
  if (c.rerank !== null && c.rerank < RERANK_CLIFF) base *= RERANK_CLIFF_FACTOR;
  return clamp100(base);
}

/**
 * Whether any of the texts (a post's body, a link card's title, a paper's
 * title and abstract) names any anchor. A Latin anchor matches whole words; a
 * CJK one matches anywhere, spaces ignored. With no anchors, or no text at all
 * to look in, nothing can be missed and the answer is true.
 */
export function mentionsAnchor(texts: readonly string[], anchors: readonly string[]): boolean {
  const phrases = anchors.map(normalizePhrase).filter(Boolean);
  if (phrases.length === 0) return true;
  const haystack = normalizePhrase(texts.join(" \n "));
  if (!haystack) return true;
  const padded = ` ${haystack} `;
  const unspaced = haystack.replace(/ /g, "");
  return phrases.some((p) => (hasCjk(p) ? unspaced.includes(p.replace(/ /g, "")) : padded.includes(` ${p} `)));
}
