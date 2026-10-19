// The Hugging Face step of a topic search's paper reading (docs/info/88
// 「取材 / Hugging Face」): one query's paper search on the Hub, the way the
// arXiv ladder (arxiv-ladder.ts) is one query's on arXiv, with the same six
// outcomes, so the read file, the source health and the retry treat both alike.
//
// The Hub's search is semantic and answers up to 120 papers of any date in
// relevance order, so there are no words to drop and widening needs no request:
//
// 1. One request: the query's HF_QUERY_WORDS most specific words (the arXiv
//    ladder's rule), in the order the query has them, over the widened window.
//    Papers that name none of the query's specific words in title, abstract or
//    the Hub's summary are dropped (the semantic tail: "self-driving lab" brings
//    self-driving cars). Papers in the run's window reaching ARXIV_ENOUGH:
//    `direct`.
// 2. Otherwise the same answer read again with the window's start moved back by
//    ARXIV_WIDEN_DAYS, no second request: `widened`, or `exhausted` when it is
//    still empty.
//
// A failed request is `rate_limited` (429), `cooling_down` (the host gate's
// paper-search lane is cooling down, nothing sent) or `failed`. Pure apart from
// the injected search.

import { HttpStatusError, isHostCoolingDown, isRateLimitError } from "../../platform/http/throttled-fetch";
import type { InfoItem } from "../sources/item";
import { arxivQueryTerms } from "../sources/plugins/arxiv-client";
import { ARXIV_ENOUGH, ARXIV_WIDEN_DAYS, bySpecificity, GENERIC_WORDS, type ArxivLadderResult, type ArxivStep } from "./arxiv-ladder";
import { addDays } from "./windows";

/** Words of the query the Hub is asked with at most: it answers short phrases best. */
export const HF_QUERY_WORDS = 4;
/** Papers one query keeps, after the window and the word check. */
export const HF_KEEP = 20;

/** One Hub paper search: the words, the window applied on the client (huggingface.ts search). */
export type HfSearch = (text: string, window: { since: string; until: string }, signal: AbortSignal) => Promise<InfoItem[]>;

/** The words the Hub is asked with: the most specific ones, in the query's order. */
export function hfQueryWords(query: string): string[] {
  const keep = new Set(bySpecificity(query).slice(0, HF_QUERY_WORDS));
  return arxivQueryTerms(query).filter((w) => keep.has(w));
}

/** Whether a paper names one of the query's specific words in its title, abstract or the Hub's summary. */
export function namesQueryWord(item: InfoItem, words: readonly string[]): boolean {
  if (!words.length) return true;
  const text = [item.title, item.textContent ?? item.summary ?? "", item.signals?.aiSummary ?? ""].join("\n").toLowerCase();
  return words.some((w) => text.includes(w));
}

function dayOf(item: InfoItem): string | null {
  return /^\d{4}-\d{2}-\d{2}/.exec(item.publishedAt)?.[0] ?? null;
}

/** Whether a failed Hub request was its rate limit, or the gate holding off after one. */
export function isHfRateLimit(e: unknown): boolean {
  return isRateLimitError(e) || (e instanceof HttpStatusError && e.status === 429);
}

/** Run one query's Hugging Face step. An abort is thrown; any other failure ends it with the outcome saying which. */
export async function runHfLadder(
  query: string,
  window: { since: string; until: string },
  kind: "first" | "daily",
  search: HfSearch,
  signal: AbortSignal,
): Promise<ArxivLadderResult> {
  const terms = hfQueryWords(query);
  if (!terms.length) return { outcome: "exhausted", steps: [], items: [], error: null };
  const wide = { since: addDays(window.since, -ARXIV_WIDEN_DAYS[kind]), until: window.until };
  let found: InfoItem[];
  try {
    found = await search(terms.join(" "), wide, signal);
  } catch (e) {
    if (signal.aborted) throw e;
    const steps: ArxivStep[] = [{ terms, ...window, hits: null }];
    const why = e instanceof Error ? e.message : String(e);
    if (isHostCoolingDown(e)) return { outcome: "cooling_down", steps, items: [], error: why };
    return isHfRateLimit(e)
      ? { outcome: "rate_limited", steps, items: [], error: `rate limited (${why})` }
      : { outcome: "failed", steps, items: [], error: why };
  }
  const specific = terms.filter((w) => !GENERIC_WORDS.has(w));
  const seen = new Set<string>();
  const named = found.filter((item) => {
    if (seen.has(item.id) || !namesQueryWord(item, specific)) return false;
    seen.add(item.id);
    return true;
  });
  const narrow = named.filter((item) => {
    const day = dayOf(item);
    return day !== null && day >= window.since && day <= window.until;
  });
  const steps: ArxivStep[] = [{ terms, ...window, hits: narrow.length }];
  if (narrow.length >= ARXIV_ENOUGH) return { outcome: "direct", steps, items: narrow.slice(0, HF_KEEP), error: null };
  steps.push({ terms, ...wide, hits: named.length });
  // The run's window first, then what widening added, each in the Hub's order.
  const items = [...narrow, ...named.filter((item) => !narrow.includes(item))].slice(0, HF_KEEP);
  return { outcome: items.length ? "widened" : "exhausted", steps, items, error: null };
}
