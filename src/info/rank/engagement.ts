// An X post's engagement on an absolute 0-100 scale (docs/88 「打分」 step 5):
// log1p of each count, weighted likes .55, reposts .25, replies .15, quotes
// .05, divided by 9.2 (about log1p(10 000)). A 3-like post lands near 8; the
// scale says how much attention a post got, not how it compares to its stream.
//
// Ported from last30days-skill (lib/signals.py: the x weights,
// _weighted_engagement, engagement_score). Portions Copyright (c) 2026 Matt
// Van Horn, under the MIT License; the full notice is in
// third-party-licenses.txt here.

export const X_ENGAGEMENT_WEIGHTS = { likes: 0.55, reposts: 0.25, replies: 0.15, quotes: 0.05 } as const;
/** The weighted log that scores 100. */
export const X_ENGAGEMENT_REFERENCE = 9.2;

export interface XCounts {
  likes?: number | null;
  reposts?: number | null;
  replies?: number | null;
  quotes?: number | null;
}

function log1pSafe(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.log1p(v) : 0;
}

/** The weighted log of the counts; null when every count is zero or absent. */
export function xEngagementRaw(c: XCounts): number | null {
  let sum = 0;
  let any = false;
  for (const [field, weight] of Object.entries(X_ENGAGEMENT_WEIGHTS) as [keyof XCounts, number][]) {
    const v = log1pSafe(c[field]);
    if (v > 0) any = true;
    sum += v * weight;
  }
  return any ? sum : null;
}

/** 0-100, an integer; null when the post has no engagement at all. */
export function xEngagement(c: XCounts): number | null {
  const raw = xEngagementRaw(c);
  if (raw === null) return null;
  return Math.round(100 * Math.max(0, Math.min(1, raw / X_ENGAGEMENT_REFERENCE)));
}
