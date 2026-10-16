// The arXiv query ladder of a topic search run (docs/info/88 「取材 / arXiv」).
//
// The export API ANDs every word as an `all:` clause, so a query of six words
// in a narrow window mostly finds nothing. The ladder starts narrow and widens
// one step at a time until it has enough papers, all by program, never by the
// model:
//
// 1. The query's ARXIV_CORE_TERMS most specific searchable words
//    (arxivQueryTerms), in the run's window. The specificity rule: a word on
//    GENERIC_WORDS (words so frequent in arXiv titles and abstracts that they
//    narrow nothing: "machine", "learning", "model") is less specific than any
//    other; otherwise an earlier word is more specific than a later one, since
//    the drafting prompt asks for the most specific word first. So "machine
//    learning materials discovery" starts from "materials discovery machine".
// 2. The last word dropped, one at a time, down to ARXIV_MIN_TERMS words (a
//    query of fewer words keeps all of them).
// 3. The narrowest words again, the window's start moved back by
//    ARXIV_WIDEN_DAYS.
//
// It stops at the first step whose papers, together with the earlier steps',
// reach ARXIV_ENOUGH, and never sends more than ARXIV_LADDER_MAX_REQUESTS. The
// steps run one after another: arXiv rate-limits hard, and the caller's search
// keeps the per-host spacing. Papers are kept in the order found, so the ones the
// narrower words found rank first. A failed request ends the ladder; what the
// earlier steps found is kept, and the outcome tells a rate limit apart from
// any other failure and from a search that found nothing.

import { HttpStatusError, isRateLimitError } from "../../platform/http/throttled-fetch";
import type { InfoItem } from "../sources/item";
import { arxivQueryTerms } from "../sources/plugins/arxiv-client";
import { addDays } from "./windows";

/** Searchable words the first step ANDs at most. */
export const ARXIV_CORE_TERMS = 3;
/** Words the dropping stops at. */
export const ARXIV_MIN_TERMS = 2;
/** Papers a query should find before the ladder stops widening (initial value). */
export const ARXIV_ENOUGH = 3;
/** How far back the last step moves the window's start, by run kind (initial values). */
export const ARXIV_WIDEN_DAYS = { first: 365, daily: 7 } as const;
/** Requests one query's ladder may send. */
export const ARXIV_LADDER_MAX_REQUESTS = 3;

/**
 * How a query's ladder ended. direct: the first step found enough; widened:
 * something was found after at least one widening; exhausted: every step ran
 * and found nothing; rate_limited / failed: a request was refused for the rate
 * limit, or failed otherwise.
 */
export type ArxivOutcome = "direct" | "widened" | "exhausted" | "rate_limited" | "failed";

export interface ArxivStepPlan {
  terms: string[];
  since: string;
  until: string;
}

export interface ArxivStep extends ArxivStepPlan {
  /** Papers this step answered with; null when its request failed. */
  hits: number | null;
}

export interface ArxivLadder {
  outcome: ArxivOutcome;
  steps: ArxivStep[];
}

export interface ArxivLadderResult extends ArxivLadder {
  items: InfoItem[];
  /** Why the ladder failed; null unless the outcome is rate_limited or failed. */
  error: string | null;
}

/** One arXiv search: the words ANDed as `all:` clauses, in the window. */
export type ArxivSearch = (text: string, window: { since: string; until: string }, signal: AbortSignal) => Promise<InfoItem[]>;

/** Words too frequent on arXiv to narrow a search; they rank after every other word. */
export const GENERIC_WORDS = new Set([
  "analysis", "approach", "artificial", "based", "data", "deep", "framework", "intelligence", "large",
  "learning", "machine", "method", "methods", "model", "models", "network", "networks", "neural",
  "novel", "system", "systems", "toward", "towards", "using", "via",
]);

/** A query's searchable words, most specific first (the rule above). */
export function bySpecificity(query: string): string[] {
  const terms = arxivQueryTerms(query);
  return [...terms.filter((t) => !GENERIC_WORDS.has(t)), ...terms.filter((t) => GENERIC_WORDS.has(t))];
}

/** The steps the ladder may take for a query, in order; empty when the query has no searchable word. */
export function ladderSteps(query: string, window: { since: string; until: string }, kind: "first" | "daily"): ArxivStepPlan[] {
  const terms = bySpecificity(query).slice(0, ARXIV_CORE_TERMS);
  if (!terms.length) return [];
  const floor = Math.min(ARXIV_MIN_TERMS, terms.length);
  const steps: ArxivStepPlan[] = [];
  for (let n = terms.length; n >= floor; n--) steps.push({ terms: terms.slice(0, n), ...window });
  steps.push({ terms: terms.slice(0, floor), since: addDays(window.since, -ARXIV_WIDEN_DAYS[kind]), until: window.until });
  return steps.slice(0, ARXIV_LADDER_MAX_REQUESTS);
}

/** Whether a failed arXiv request was its rate limiter: a terminal 429, or the 403 "Rate exceeded." it also answers with. */
export function isArxivRateLimit(e: unknown): boolean {
  return isRateLimitError(e) || (e instanceof HttpStatusError && (e.status === 429 || e.status === 403));
}

/** Run one query's ladder. An abort is thrown; any other failure ends it with the outcome saying which. */
export async function runArxivLadder(
  query: string,
  window: { since: string; until: string },
  kind: "first" | "daily",
  search: ArxivSearch,
  signal: AbortSignal,
): Promise<ArxivLadderResult> {
  const plan = ladderSteps(query, window, kind);
  const steps: ArxivStep[] = [];
  const items: InfoItem[] = [];
  const seen = new Set<string>();
  for (const step of plan) {
    let found: InfoItem[];
    try {
      found = await search(step.terms.join(" "), { since: step.since, until: step.until }, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      steps.push({ ...step, hits: null });
      const why = e instanceof Error ? e.message : String(e);
      return isArxivRateLimit(e)
        ? { outcome: "rate_limited", steps, items, error: `rate limited (${why})` }
        : { outcome: "failed", steps, items, error: why };
    }
    steps.push({ ...step, hits: found.length });
    for (const item of found) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    if (items.length >= ARXIV_ENOUGH) break;
  }
  const outcome: ArxivOutcome =
    items.length === 0 ? "exhausted" : steps.length === 1 && items.length >= ARXIV_ENOUGH ? "direct" : "widened";
  return { outcome, steps, items, error: null };
}
