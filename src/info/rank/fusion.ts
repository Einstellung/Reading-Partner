// Weighted reciprocal rank fusion (docs/88 「打分」 step 3). Each (query,
// source) stream is a ranked list; a candidate earns weight / (60 + rank) from
// every stream it is in, over the top of each (12 unless the stream says how
// many). The sum is normalized to
// 0-100 against 0.08 (about what a candidate near the top of several streams
// accumulates). One author keeps at most 3 candidates, the best ones.
//
// Ported from last30days-skill (lib/fusion.py weighted_rrf and
// _apply_per_author_cap; lib/rerank.py _normalized_rrf), without the
// per-source reservations and the first-party allowance. Portions Copyright
// (c) 2026 Matt Van Horn, under the MIT License; the full notice is in
// third-party-licenses.txt here.

/** The RRF smoothing constant (Cormack et al. 2009). */
export const RRF_K = 60;
/** Candidates taken from the top of each stream. */
export const PER_STREAM = 12;
/** Candidates one author keeps. */
export const MAX_PER_AUTHOR = 3;
/** The raw RRF sum that normalizes to 100. */
export const RRF_FULL = 0.08;

export interface StreamItem {
  /** The candidate's identity across streams (a status id, an arXiv id). */
  key: string;
  author?: string | null;
}

export interface Stream {
  /** The query's weight: 1.0 for the main query, 0.6-0.8 for a subtopic's. */
  weight: number;
  /** Best first. */
  items: StreamItem[];
  /** Candidates taken from its top; the call's `perStream` when absent. */
  take?: number;
}

export interface Fused {
  key: string;
  /** The raw weighted sum. */
  rrf: number;
  /** 0-100. */
  score: number;
  author: string | null;
}

export function normalizeRrf(rrf: number): number {
  return Math.max(0, Math.min(100, (rrf / RRF_FULL) * 100));
}

function authorKey(author: string | null | undefined): string | null {
  const a = author?.trim().replace(/^@/, "").toLowerCase();
  return a ? a : null;
}

/**
 * The fused pool, best first, with the per-author cap applied. Ties keep the
 * order candidates were first seen in. A key repeated inside one stream counts
 * at its first rank only.
 */
export function weightedRrf(
  streams: Stream[],
  opts: { perStream?: number; maxPerAuthor?: number } = {},
): Fused[] {
  const perStream = opts.perStream ?? PER_STREAM;
  const maxPerAuthor = opts.maxPerAuthor ?? MAX_PER_AUTHOR;
  const pool = new Map<string, { rrf: number; author: string | null; order: number }>();
  for (const stream of streams) {
    const seen = new Set<string>();
    let rank = 0;
    const take = stream.take ?? perStream;
    for (const item of stream.items) {
      if (rank >= take) break;
      if (seen.has(item.key)) continue;
      seen.add(item.key);
      rank++;
      const add = stream.weight / (RRF_K + rank);
      const got = pool.get(item.key);
      if (got) {
        got.rrf += add;
        got.author ??= authorKey(item.author);
      } else {
        pool.set(item.key, { rrf: add, author: authorKey(item.author), order: pool.size });
      }
    }
  }
  const sorted = [...pool.entries()].sort((a, b) => b[1].rrf - a[1].rrf || a[1].order - b[1].order);
  const perAuthor = new Map<string, number>();
  const out: Fused[] = [];
  for (const [key, c] of sorted) {
    if (c.author !== null) {
      const n = perAuthor.get(c.author) ?? 0;
      if (n >= maxPerAuthor) continue;
      perAuthor.set(c.author, n + 1);
    }
    out.push({ key, rrf: c.rrf, score: normalizeRrf(c.rrf), author: c.author });
  }
  return out;
}
