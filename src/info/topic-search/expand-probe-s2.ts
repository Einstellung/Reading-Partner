// The hold-out probe's own graph expansion over S2 (docs/info/92 哪个库做什么,
// the S2 column only), until graph-live.ts lands and the probe can drive the
// pipeline's: one batch to resolve the positives and negatives, one
// recommendation request, the citations and references of the first
// MAX_WALKED resolved positives. No OpenAlex fallback: a stream S2 cannot
// answer is recorded as such. No window filter (the probe measures the window
// itself) and the negatives are kept in the streams (the probe counts them).
// Lookups and walks are kept for the process, so a seed both folds walk is
// read once. The transport is the caller's: the script gives the gated,
// budgeted fetch, tests a fake.

import { isHostCoolingDown, isRateLimitError, RateLimitError } from "../../platform/http/host-gate";
import type { FetchFn } from "../../platform/http/throttled-fetch";
import { arxivIdOfDoi } from "../rank/link-identity";
import { normalizeArxivId } from "../sources/plugins/arxiv-client";
import { fetchS2Batch, fetchS2EdgePage, fetchS2Recommendations, type S2Hit } from "../sources/plugins/s2-client";
import {
  emptyGraphRead,
  graphStreamId,
  withDoiOnly,
  withStream,
  type GraphOutcome,
  type GraphPaper,
  type GraphPositive,
  type GraphRead,
  type GraphStream,
  type GraphStreamKind,
} from "./graph-read";
import { PROBE_LIMITS, type ExpandRequest, type ProbeExpander } from "./expand-probe";

export interface S2ExpanderDeps {
  fetchFn: FetchFn;
  apiKey?: string;
  now?: () => Date;
}

/** The S2 id a pool key is asked under: "ARXIV:<id>" or "DOI:<doi>". */
export function s2IdOfKey(key: string): string | null {
  if (key.startsWith("arxiv:")) return `ARXIV:${key.slice(6)}`;
  if (key.startsWith("doi:")) return `DOI:${key.slice(4)}`;
  return null;
}

function arxivIdOfHit(hit: S2Hit): string | null {
  const id = hit.arxivId ? normalizeArxivId(hit.arxivId) : null;
  return id ?? (hit.doi ? arxivIdOfDoi(hit.doi) : null);
}

function paperOf(hit: S2Hit, arxivId: string): GraphPaper {
  return {
    arxivId,
    title: hit.title,
    abstract: hit.abstract,
    authors: hit.authors,
    publishedAt: hit.publicationDate ?? "",
    citationCount: hit.citationCount,
  };
}

function outcomeOf(e: unknown): GraphOutcome {
  if (e instanceof BudgetSpentError) return "failed";
  if (isHostCoolingDown(e)) return "cooling_down";
  if (isRateLimitError(e)) return "rate_limited";
  return "failed";
}

/** A stream's papers: arXiv ones kept (minus the positives), DOI-only ones counted apart. */
function sortHits(hits: S2Hit[], exclude: ReadonlySet<string>): { papers: GraphPaper[]; doiOnly: string[] } {
  const papers: GraphPaper[] = [];
  const doiOnly: string[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    const id = arxivIdOfHit(hit);
    if (!id) {
      if (hit.doi) doiOnly.push(hit.title);
      continue;
    }
    if (seen.has(id) || exclude.has(`arxiv:${id}`)) continue;
    seen.add(id);
    papers.push(paperOf(hit, id));
  }
  return { papers, doiOnly };
}

// A walk's edges carry no ranking; the most cited first, as the OpenAlex
// fallback sorts (docs/info/92 哪个库做什么), so the take is not S2's arbitrary order.
const byCitations = (a: GraphPaper, b: GraphPaper) => (b.citationCount ?? -1) - (a.citationCount ?? -1);

export function s2Expander(deps: S2ExpanderDeps): ProbeExpander {
  const now = deps.now ?? (() => new Date());
  const resolved = new Map<string, S2Hit | null>();
  const walks = new Map<string, { stream: Omit<GraphStream, "papers" | "from">; hits: S2Hit[] }>();

  return async (request: ExpandRequest): Promise<GraphRead> => {
    const keys = [...request.positives.map((p) => p.key), ...request.negatives];
    const ask = keys.filter((k) => !resolved.has(k) && s2IdOfKey(k));
    let lookupFailed: GraphOutcome | null = null;
    if (ask.length) {
      try {
        const hits = await fetchS2Batch(ask.map((k) => s2IdOfKey(k)!), deps.fetchFn, deps.apiKey);
        ask.forEach((k, i) => resolved.set(k, hits[i] ?? null));
      } catch (e) {
        lookupFailed = outcomeOf(e);
      }
    }

    let walked = 0;
    const positives: GraphPositive[] = request.positives.map((p) => {
      const hit = resolved.get(p.key) ?? null;
      const walk = !!hit?.paperId && walked < PROBE_LIMITS.maxWalked;
      if (walk) walked++;
      return { key: p.key, title: hit?.title || p.title, why: p.why, s2: hit?.paperId ?? null, openAlex: null, citationCount: hit?.citationCount ?? null, walked: walk };
    });
    const exclude = new Set(request.positives.map((p) => p.key));
    let read = emptyGraphRead(positives, request.negatives);
    const at = () => now().toISOString();
    const put = (stream: GraphStream, doiOnly: string[]) => {
      read = withDoiOnly(withStream(read, stream), doiOnly);
    };

    // Recommendations: the first resolved positives against the resolved negatives.
    const recFrom = positives.filter((p) => p.s2).slice(0, PROBE_LIMITS.recPositives);
    const recBase = { id: graphStreamId("rec"), kind: "rec" as const, from: recFrom.map((p) => p.key) };
    if (recFrom.length === 0) {
      put({ ...recBase, library: null, outcome: lookupFailed ?? "not_found", total: 0, papers: [], at: at() }, []);
    } else {
      const negatives = request.negatives.flatMap((k) => resolved.get(k)?.paperId ?? []).slice(0, PROBE_LIMITS.recNegatives);
      try {
        const hits = await fetchS2Recommendations({ positive: recFrom.map((p) => p.s2!), negative: negatives }, { limit: 100 }, deps.fetchFn, deps.apiKey);
        if (hits === null) put({ ...recBase, library: null, outcome: "not_found", total: 0, papers: [], at: at() }, []);
        else {
          const { papers, doiOnly } = sortHits(hits, exclude);
          put({ ...recBase, library: "s2", outcome: papers.length ? "ok" : "empty", total: hits.length, papers, at: at() }, doiOnly);
        }
      } catch (e) {
        put({ ...recBase, library: null, outcome: outcomeOf(e), total: 0, papers: [], at: at() }, []);
      }
    }

    // The walks, each read once per process.
    for (const p of positives.filter((x) => x.walked)) {
      for (const kind of ["cites", "refs"] as GraphStreamKind[]) {
        const id = graphStreamId(kind, p.key);
        let walk = walks.get(id);
        if (!walk) {
          if (kind === "cites" && (p.citationCount ?? 0) > PROBE_LIMITS.hubCitations) {
            walk = { stream: { id, kind, library: "s2", outcome: "hub", total: 0, at: at() }, hits: [] };
          } else {
            try {
              const answer = await fetchS2EdgePage(p.s2!, kind === "cites" ? "citations" : "references", deps.fetchFn, deps.apiKey);
              walk =
                answer.kind === "ok"
                  ? { stream: { id, kind, library: "s2", outcome: answer.hits.length ? "ok" : "empty", total: answer.hits.length, at: at() }, hits: answer.hits }
                  : { stream: { id, kind, library: null, outcome: "not_found", total: 0, at: at() }, hits: [] };
            } catch (e) {
              // A failure is not kept: the other fold may ask again, within the cap.
              put({ id, kind, from: [p.key], library: null, outcome: outcomeOf(e), total: 0, papers: [], at: at() }, []);
              continue;
            }
          }
          walks.set(id, walk);
        }
        const { papers, doiOnly } = sortHits(walk.hits, exclude);
        papers.sort(byCitations);
        put({ ...walk.stream, from: [p.key], papers }, doiOnly);
      }
    }
    return read;
  };
}

// --- the request cap --------------------------------------------------------------

// A rate limit of the probe's own making: fetchWithRetry ends its loop on a
// RateLimitError at once, so a spent cap is never retried.
export class BudgetSpentError extends RateLimitError {
  constructor(host: string) {
    super(host);
    this.message = `the probe's request cap for ${host} is spent; no request sent`;
    this.name = "BudgetSpentError";
  }
}

export interface BudgetedFetch {
  fetchFn: FetchFn;
  /** Requests sent so far, by host. */
  spent(): Record<string, number>;
}

/**
 * A transport that sends at most `caps[host]` requests to each host and none
 * to any host not named. A request past the cap throws before it goes out,
 * retries included, so the probe can never loop past its plan.
 */
export function budgetedFetch(inner: FetchFn, caps: Readonly<Record<string, number>>): BudgetedFetch {
  const sent: Record<string, number> = {};
  return {
    fetchFn: (url, init) => {
      const host = new URL(url).hostname;
      const n = sent[host] ?? 0;
      if (n >= (caps[host] ?? 0)) return Promise.reject(new BudgetSpentError(host));
      sent[host] = n + 1;
      return inner(url, init);
    },
    spent: () => ({ ...sent }),
  };
}
