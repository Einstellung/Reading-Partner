// A run's source health on the collector's state file (docs/info/88 「结果」
// 源健康): the builder writes `<runDir>/topic-search-source-health.json`, the
// run pipeline folds it into info-source-health.json the way the briefing's
// collection writes its own, and the collector's claim carries that file to the
// readers (docs/info/36 `sources`). One entry per (search, query, source), keyed
// `topic-search:<search>:<query>:<source>`; a failed read keeps the last time it
// worked. Pure.

import type { SourceHealth } from "../sources/engine";
import type { SourceHealthFile } from "./build-result";
import type { TopicSearch } from "./types";

export const TOPIC_SEARCH_HEALTH_PREFIX = "topic-search:";

export function topicSearchHealthKey(searchId: string, query: string, source: "x" | "arxiv"): string {
  return `${TOPIC_SEARCH_HEALTH_PREFIX}${searchId}:${query}:${source}`;
}

/** The file as written, or null when it does not read. */
export function parseSourceHealthFile(text: string): SourceHealthFile | null {
  try {
    const raw = JSON.parse(text) as Partial<SourceHealthFile>;
    if (raw.version !== 1 || typeof raw.searchId !== "string" || !Array.isArray(raw.entries)) return null;
    return raw as SourceHealthFile;
  } catch {
    return null;
  }
}

/** The health map with this run's lines in; lines of the search no longer queried go. */
export function foldTopicSearchHealth(
  health: Record<string, SourceHealth>,
  file: SourceHealthFile,
  search: TopicSearch,
): Record<string, SourceHealth> {
  const mine = `${TOPIC_SEARCH_HEALTH_PREFIX}${file.searchId}:`;
  const out: Record<string, SourceHealth> = {};
  const fresh = new Set(file.entries.map((e) => topicSearchHealthKey(file.searchId, e.query, e.source)));
  for (const [key, h] of Object.entries(health)) if (!key.startsWith(mine) || fresh.has(key)) out[key] = h;
  for (const e of file.entries) {
    const key = topicSearchHealthKey(file.searchId, e.query, e.source);
    const q = search.queries.find((x) => x.id === e.query);
    const label = (e.source === "arxiv" ? q?.arxiv : q?.x) ?? e.query;
    const line = { searchId: file.searchId, name: search.name, query: e.query, label, source: e.source, status: e.status, read: e.read, fresh: e.fresh, passedFloor: e.passedFloor };
    const before = out[key] ?? {};
    out[key] =
      e.status === "failed"
        ? { ...before, lastError: e.why ?? "not read", lastErrorAt: file.at, topicSearch: line }
        : { ...before, lastSuccess: e.fetchedAt ?? file.at, lastError: undefined, lastErrorAt: undefined, lastItems: e.read, topicSearch: line };
  }
  return out;
}
