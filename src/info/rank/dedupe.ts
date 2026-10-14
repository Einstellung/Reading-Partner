// Has this topic already reported this? (docs/88 「结果」, 去重). An item is
// checked against the topic's results of the last 30 days, which the caller
// passes in:
//
//   1. a shared key (status id, canonical URL, arXiv id, repo) -> duplicate;
//      so is the same headline once normalized;
//   2. different keys, ≥ 4 shared headline tokens and Jaccard ≥ 0.5 -> duplicate
//      (the same story from another account, reworded);
//   3. Jaccard in [0.35, 0.5) with ≥ 3 shared tokens -> for the model to judge;
//      this module only lists them, with the records they came close to.
//
// Jaccard, not containment: a follow-up that appends facts to an earlier
// headline contains it whole and must not be eaten. Chinese headlines are
// tokenized into character bigrams beside the Latin words.
//
// The continuation exception (a seen event whose engagement doubled) is the
// caller's: a key duplicate says which record it matched.
//
// Ported from ai-research-arm (scripts/dedupe_headline_alerts.py:
// normalize_headline, headline_tokens, duplicate_reason passes 1 and 2;
// scripts/headline_judge.py: the shortlist band). Portions Copyright (c) 2026
// guzus, under the MIT License; the full notice is in third-party-licenses.txt
// here.

export const CROSS_SOURCE_JACCARD = 0.5;
export const CROSS_SOURCE_MIN_SHARED = 4;
export const JUDGE_BAND_LOW = 0.35;
export const JUDGE_MIN_SHARED = 3;
/** Records a judge entry carries at most, closest first. */
export const JUDGE_MAX_RECORDS = 5;

const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "and", "are", "as", "at", "by", "for", "from", "in", "into", "is", "new", "now", "of",
  "on", "or", "over", "the", "to", "via", "with",
]);

const CJK = "\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff\\u3040-\\u30ff\\uac00-\\ud7af";
const NOT_KEPT = new RegExp(`[^a-z0-9.$${CJK}]+`, "gu");
const TOKEN = new RegExp(`[${CJK}]+|[a-z0-9.$]+`, "gu");
const CJK_RUN = new RegExp(`^[${CJK}]+$`, "u");

/** NFKC, lowercased, links out, sentence dots and punctuation to spaces. */
export function normalizeHeadline(text: string): string {
  return (text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/(?<!\d)\.(?!\d)/g, " ")
    .replace(NOT_KEPT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant tokens: Latin words of two or more characters, CJK bigrams. */
export function headlineTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of normalizeHeadline(text).matchAll(TOKEN)) {
    const run = m[0];
    if (CJK_RUN.test(run)) {
      const chars = [...run];
      for (let i = 0; i + 1 < chars.length; i++) out.add(chars[i] + chars[i + 1]);
    } else if (run.length > 1 && !STOPWORDS.has(run)) {
      out.add(run);
    }
  }
  return out;
}

export interface Headline {
  id: string;
  headline: string;
  /** Status id, canonical URL, arXiv id, repo: whatever identifies it, prefixed by kind. */
  keys: readonly string[];
}

export interface JudgeMatch {
  id: string;
  headline: string;
  jaccard: number;
  shared: number;
}

export type DedupeVerdict =
  | { kind: "new" }
  | { kind: "duplicate"; reason: "key" | "headline" | "cross-source"; matched: string }
  | { kind: "judge"; matches: JudgeMatch[] };

interface Prepared {
  record: Headline;
  normalized: string;
  tokens: Set<string>;
  keys: Set<string>;
}

function prepare(h: Headline): Prepared {
  return { record: h, normalized: normalizeHeadline(h.headline), tokens: headlineTokens(h.headline), keys: new Set(h.keys) };
}

function verdictOf(item: Prepared, history: readonly Prepared[]): DedupeVerdict {
  // Pass 1: identity.
  for (const r of history) {
    if ([...item.keys].some((k) => r.keys.has(k))) return { kind: "duplicate", reason: "key", matched: r.record.id };
    if (item.normalized && item.normalized === r.normalized) {
      return { kind: "duplicate", reason: "headline", matched: r.record.id };
    }
  }
  // Pass 2: the same story under another key; and the band below it.
  const band: JudgeMatch[] = [];
  for (const r of history) {
    let shared = 0;
    for (const t of item.tokens) if (r.tokens.has(t)) shared++;
    if (shared === 0) continue;
    const jaccard = shared / (item.tokens.size + r.tokens.size - shared);
    if (shared >= CROSS_SOURCE_MIN_SHARED && jaccard >= CROSS_SOURCE_JACCARD) {
      return { kind: "duplicate", reason: "cross-source", matched: r.record.id };
    }
    if (shared >= JUDGE_MIN_SHARED && jaccard >= JUDGE_BAND_LOW && jaccard < CROSS_SOURCE_JACCARD) {
      band.push({ id: r.record.id, headline: r.record.headline, jaccard, shared });
    }
  }
  if (band.length) {
    band.sort((a, b) => b.jaccard - a.jaccard || b.shared - a.shared);
    return { kind: "judge", matches: band.slice(0, JUDGE_MAX_RECORDS) };
  }
  return { kind: "new" };
}

/** One item against the history. */
export function dedupeVerdict(item: Headline, history: readonly Headline[]): DedupeVerdict {
  return verdictOf(prepare(item), history.map(prepare));
}

/**
 * A run's items in order, each against the history and the items before it
 * that were kept: one that is new or goes to the judge (and is sent unless
 * the judge is certain) counts as reported for the ones after it.
 */
export function dedupeBatch<H extends Headline>(
  items: readonly H[],
  history: readonly Headline[],
): { item: H; verdict: DedupeVerdict }[] {
  const seen = history.map(prepare);
  return items.map((item) => {
    const p = prepare(item);
    const verdict = verdictOf(p, seen);
    if (verdict.kind !== "duplicate") seen.push(p);
    return { item, verdict };
  });
}
