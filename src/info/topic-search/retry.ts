// Reading again what a topic search's first look missed (docs/info/88 「重跑第一次」).
// A retry is a run of its own kind, keyed `topic-search:<id>:retry:<n>`: the
// first run's key `topic-search:<id>:first` is done, its durable task is
// terminal under the same run id, and its run directory already holds what it
// read, so asking under that key again would only hand the old run back.
//
// What is read again is decided from the source health on the collector's state
// file (source-health.ts): a (query, source) the last run of the search failed
// on or never read, and an arXiv query that came back empty before the query
// ladder existed (no ladder recorded), since widening may find it something.
// Hugging Face is read like arXiv, for the queries with arXiv words. An
// X query that read and found nothing new is left alone, as is everything ok.
// Reads no model judged (the rerank failed) are not read again: the plan names
// their runs, and the build takes them in from those runs' directories.
// Pure.

import type { SourceHealth } from "../sources/engine";
import { topicSearchHealthKey } from "./source-health";
import type { TopicSearch } from "./types";

/** The X rule, said the same way wherever the door needs it (retry-tool.ts, guidance.ts). */
export const X_READ_RULE =
  "This conversation cannot read X. X is read only in a topic search's first run, a retry of " +
  "it (retry_topic_search_first_run) and the nightly run from 01:00, on the desktop collector.";

/** The queries (ids) a retry reads, per source. */
export interface RetryPlan {
  x: string[];
  arxiv: string[];
  /** Absent in a plan made before Hugging Face was a source; such a retry reads it where it reads arXiv. */
  huggingface?: string[];
  /** Runs whose reads no model judged (result-types.ts pendingJudging): taken in and judged, not read again. Absent: none. */
  judge?: string[];
}

export function isEmptyPlan(plan: RetryPlan): boolean {
  return plan.x.length === 0 && plan.arxiv.length === 0 && (plan.huggingface?.length ?? 0) === 0 && (plan.judge?.length ?? 0) === 0;
}

/** The queries a run reads: those of the whole topic and of a picked subtopic. */
export function readQueries(search: TopicSearch): TopicSearch["queries"] {
  const picked = new Set(search.subtopics.filter((s) => s.picked).map((s) => s.id));
  return search.queries.filter((q) => q.subtopic === null || picked.has(q.subtopic));
}

/**
 * What a retry of the search's first look reads, from the health its runs left,
 * and which runs' unjudged reads it judges (`waiting`, by run id).
 */
export function planRetry(search: TopicSearch, health: Readonly<Record<string, SourceHealth>>, waiting: readonly string[] = []): RetryPlan {
  const plan: RetryPlan = { x: [], arxiv: [], huggingface: [] };
  for (const q of readQueries(search)) {
    const x = health[topicSearchHealthKey(search.id, q.id, "x")]?.topicSearch;
    if (!x || x.status === "failed") plan.x.push(q.id);
    if (!q.arxiv) continue;
    const a = health[topicSearchHealthKey(search.id, q.id, "arxiv")]?.topicSearch;
    if (!a || a.status === "failed" || (a.status === "empty" && !a.ladder)) plan.arxiv.push(q.id);
    const h = health[topicSearchHealthKey(search.id, q.id, "huggingface")]?.topicSearch;
    if (!h || h.status === "failed") plan.huggingface!.push(q.id);
  }
  return waiting.length ? { ...plan, judge: [...waiting] } : plan;
}

const RETRY_KEY = /^topic-search:(.+):retry:(\d+)$/;

/** The number the next retry of a search is keyed by: one past the highest still on file. */
export function nextRetryNumber(keys: readonly (string | undefined)[], searchId: string): number {
  let most = 0;
  for (const key of keys) {
    const m = key ? RETRY_KEY.exec(key) : null;
    if (m && m[1] === searchId) most = Math.max(most, Number(m[2]));
  }
  return most + 1;
}
