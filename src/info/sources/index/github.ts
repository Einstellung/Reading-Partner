// Index provider for GitHub (docs/69): one descriptor is one of two queries.
// `trending` asks OSS Insight's public API which repos gathered the most stars,
// PRs and pushes in a window; `search` asks the GitHub Search API for repos
// created in the last N days with at least M stars. Never github.com/trending:
// that page is an internal heuristic served as HTML.
//
// Both modes then ask OpenDigger for the top few repos' OpenRank and activity
// (static JSON per repo), the check docs/69 wants against bought stars. Those
// requests are best effort: a repo OpenDigger has not indexed is a 404 and
// leaves the two fields unset, and nothing there can fail the source.
//
// Requests go straight through deps.fetchFn, one per query (or one per topic
// in search mode). Anonymous GitHub search allows 10 requests a minute and 60
// REST calls an hour, so the provider never enriches through api.github.com.

import { isAbortError, throwIfAborted } from "../../../platform/app/abort";
import { itemId } from "../../extract/id";
import type { SourceDescriptor } from "../descriptor";
import {
  daysBefore,
  queryString,
  queryStrings,
  type IndexDeps,
  type IndexProvider,
  type IndexQuery,
} from "../index-provider";
import type { InfoItem, ItemSignals } from "../item";

const OSSINSIGHT_HOST = "api.ossinsight.io";
const GITHUB_HOST = "api.github.com";
const OPENDIGGER_HOST = "oss.open-digger.cn";

const DEFAULT_DAYS = 14;
const DEFAULT_MIN_STARS = 20;
// Search API's per_page ceiling.
const MAX_PER_PAGE = 100;
// How many items get an OpenDigger look, two requests each.
const ENRICH_TOP = 5;
// Tags a search item carries beyond its language.
const TOPIC_TAGS = 5;
const COLLECTION_TAGS = 3;

type Period = "day" | "week" | "month";
const PERIODS: Period[] = ["day", "week", "month"];
// OSS Insight also serves past_3_months; a quarter is not "trending" for us.
const OSSINSIGHT_PERIOD: Record<Period, string> = {
  day: "past_24_hours",
  week: "past_week",
  month: "past_month",
};
const PERIOD_LABEL: Record<Period, string> = {
  day: "past day",
  week: "past week",
  month: "past month",
};

type GithubIndexQuery =
  | { mode: "trending"; language?: string; period: Period }
  | { mode: "search"; language?: string; topics: string[]; days: number; minStars: number };

function nonNegativeInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : undefined;
}

// The query as the provider reads it, or one line saying what is wrong. A
// field that belongs to the other mode is rejected rather than ignored, so an
// authoring slip ("period" on a search) is reported at add time.
function readQuery(q: IndexQuery): GithubIndexQuery | string {
  const mode = q.mode;
  if (mode !== "trending" && mode !== "search") return 'mode must be "trending" or "search"';
  if (q.language !== undefined && typeof q.language !== "string") return "language must be a string";
  const language = queryString(q, "language");
  if (mode === "trending") {
    for (const key of ["topics", "days", "minStars"]) {
      if (q[key] !== undefined) return `${key} applies to search mode only`;
    }
    let period: Period = "day";
    if (q.period !== undefined) {
      if (!PERIODS.includes(q.period as Period)) return 'period must be "day", "week" or "month"';
      period = q.period as Period;
    }
    return { mode, language, period };
  }
  if (q.period !== undefined) return "period applies to trending mode only";
  if (q.topics !== undefined && typeof q.topics !== "string" && !Array.isArray(q.topics)) {
    return "topics must be a list of strings";
  }
  const topics = [...new Set(queryStrings(q, "topics").map((t) => t.toLowerCase()))];
  let days = DEFAULT_DAYS;
  if (q.days !== undefined) {
    const d = nonNegativeInt(q.days);
    if (d === undefined || d === 0) return "days must be a positive integer";
    days = d;
  }
  let minStars = DEFAULT_MIN_STARS;
  if (q.minStars !== undefined) {
    const s = nonNegativeInt(q.minStars);
    if (s === undefined) return "minStars must be a non-negative integer";
    minStars = s;
  }
  return { mode, language, topics, days, minStars };
}

function mustRead(q: IndexQuery): GithubIndexQuery {
  const read = readQuery(q);
  if (typeof read === "string") throw new Error(read);
  return read;
}

// --- urls --------------------------------------------------------------------

// OSS Insight wants its parameters URI-encoded ("C++" as C%2B%2B), which
// URLSearchParams does; `language` is left off for "all languages".
export function githubTrendingUrl(query: IndexQuery): string {
  const read = mustRead(query);
  if (read.mode !== "trending") throw new Error("not a trending query");
  const params = new URLSearchParams({ period: OSSINSIGHT_PERIOD[read.period] });
  if (read.language) params.set("language", read.language);
  return `https://${OSSINSIGHT_HOST}/v1/trends/repos/?${params}`;
}

// A qualifier value with whitespace ("Emacs Lisp") has to be quoted.
function qualifier(name: string, value: string): string {
  return `${name}:${/\s/.test(value) ? `"${value}"` : value}`;
}

// One search URL per topic, or one with none. GitHub ANDs every qualifier and
// has no OR between two `topic:` qualifiers, so "robotics or embodied-ai" is
// two requests whose results are merged and deduped by full_name (discover).
// Sorted by stars so the cap keeps the largest, not the newest.
export function githubSearchUrls(query: IndexQuery, today: string, limit: number): string[] {
  const read = mustRead(query);
  if (read.mode !== "search") throw new Error("not a search query");
  const base = [`created:>${daysBefore(today, read.days)}`, `stars:>=${read.minStars}`];
  if (read.language) base.push(qualifier("language", read.language));
  const variants = read.topics.length ? read.topics.map((t) => [...base, qualifier("topic", t)]) : [base];
  const perPage = String(Math.min(MAX_PER_PAGE, Math.max(1, limit)));
  return variants.map((qs) => {
    const params = new URLSearchParams({ q: qs.join(" "), sort: "stars", order: "desc", per_page: perPage });
    return `https://${GITHUB_HOST}/search/repositories?${params}`;
  });
}

export function openDiggerUrl(fullName: string, metric: "openrank" | "activity"): string {
  return `https://${OPENDIGGER_HOST}/github/${fullName}/${metric}.json`;
}

// --- fetching ----------------------------------------------------------------

async function fetchJson(url: string, deps: IndexDeps, headers?: Record<string, string>): Promise<unknown> {
  throwIfAborted(deps.signal);
  const init: RequestInit = { headers };
  if (deps.signal) init.signal = deps.signal;
  const res = await deps.fetchFn(url, init);
  if (!res.ok) {
    // GitHub answers a spent anonymous quota with 403 (primary) or 429
    // (secondary) and says so in the headers; worth naming in the health note.
    const spent = (res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0";
    throw new Error(`HTTP ${res.status} from ${url}${spent ? " (rate limit spent)" : ""}`);
  }
  return res.json();
}

// A count the API may hand over as a number, a numeric string, or "" (OSS
// Insight rows are all strings, and an empty one means null).
function count(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function repoItem(desc: SourceDescriptor, fullName: string, description: string | undefined, url: string, publishedAt: string, signals: ItemSignals): InfoItem {
  const item: InfoItem = {
    id: itemId(desc.id, fullName),
    source: desc.id,
    sourceName: desc.name,
    sourceKey: fullName,
    title: description ? `${fullName}: ${description}` : fullName,
    url,
    publishedAt,
    summaryOnly: true,
    signals,
  };
  if (description) item.summary = description;
  return item;
}

// --- trending (OSS Insight) --------------------------------------------------

// Verified live 2026-09-13: the envelope is { type: "sql_endpoint", data: {
// columns, rows, result }, data_quality? }. Row shape is from the API's own
// OpenAPI document (api.ossinsight.io/docs/json): every value is a string,
// `stars` / `forks` / `pull_requests` / `pushes` count the period, not totals,
// so there is no total-stars signal here. Since 2026-03-01 the live endpoint
// has answered zero rows with data_quality.status "unavailable" (pitfall 296);
// that is a source failure with the API's own reason, not an empty day.
interface TrendingRow {
  repo_name?: unknown;
  primary_language?: unknown;
  description?: unknown;
  stars?: unknown;
  collection_names?: unknown;
}

async function discoverTrending(desc: SourceDescriptor, query: IndexQuery, deps: IndexDeps, limit: number): Promise<InfoItem[]> {
  const body = (await fetchJson(githubTrendingUrl(query), deps)) as {
    data?: { rows?: unknown };
    data_quality?: { status?: unknown; unavailable_since?: unknown; reason?: unknown };
  };
  const rows = Array.isArray(body?.data?.rows) ? (body.data!.rows as TrendingRow[]) : [];
  const dq = body?.data_quality;
  if (!rows.length && dq?.status === "unavailable") {
    const since = str(dq.unavailable_since);
    const reason = str(dq.reason);
    throw new Error(`OSS Insight trending unavailable${since ? ` since ${since}` : ""}${reason ? `: ${reason}` : ""}`);
  }
  const today = deps.today();
  const items: InfoItem[] = [];
  for (const row of rows) {
    const name = str(row.repo_name);
    if (!name) continue;
    const tags: string[] = [];
    const language = str(row.primary_language);
    if (language) tags.push(language);
    const collections = str(row.collection_names);
    if (collections) tags.push(...collections.split(",").map((c) => c.trim()).filter(Boolean).slice(0, COLLECTION_TAGS));
    const signals: ItemSignals = {};
    const starsPeriod = count(row.stars);
    if (starsPeriod !== undefined) signals.starsPeriod = starsPeriod;
    if (tags.length) signals.tags = tags;
    // The day it surfaced is the only date the ranking knows.
    items.push(repoItem(desc, name, str(row.description), `https://github.com/${name}`, today, signals));
    if (items.length >= limit) break;
  }
  return items;
}

// --- search (GitHub Search API) ----------------------------------------------

// Shape from GitHub's REST docs (search/repositories), not verified live: this
// sandbox cannot reach api.github.com.
interface SearchRepo {
  full_name?: unknown;
  html_url?: unknown;
  description?: unknown;
  created_at?: unknown;
  stargazers_count?: unknown;
  forks_count?: unknown;
  language?: unknown;
  topics?: unknown;
}

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function discoverSearch(desc: SourceDescriptor, query: IndexQuery, deps: IndexDeps, limit: number): Promise<InfoItem[]> {
  const byName = new Map<string, { repo: SearchRepo; stars: number }>();
  // Sequential: the anonymous limiter counts per minute, and two topics' worth
  // of results is not worth racing it.
  for (const url of githubSearchUrls(query, deps.today(), limit)) {
    const body = (await fetchJson(url, deps, GITHUB_HEADERS)) as { items?: unknown };
    const repos = Array.isArray(body?.items) ? (body.items as SearchRepo[]) : [];
    for (const repo of repos) {
      const name = str(repo.full_name);
      if (!name || byName.has(name)) continue;
      byName.set(name, { repo, stars: count(repo.stargazers_count) ?? 0 });
    }
  }
  return [...byName.values()]
    .sort((a, b) => b.stars - a.stars)
    .slice(0, limit)
    .map(({ repo }) => {
      const name = str(repo.full_name)!;
      const tags: string[] = [];
      const language = str(repo.language);
      if (language) tags.push(language);
      if (Array.isArray(repo.topics)) {
        tags.push(...repo.topics.filter((t): t is string => typeof t === "string" && !!t).slice(0, TOPIC_TAGS));
      }
      const signals: ItemSignals = {};
      const stars = count(repo.stargazers_count);
      if (stars !== undefined) signals.stars = stars;
      const forks = count(repo.forks_count);
      if (forks !== undefined) signals.forks = forks;
      const created = str(repo.created_at);
      if (created) signals.createdAt = created;
      if (tags.length) signals.tags = tags;
      return repoItem(desc, name, str(repo.description), str(repo.html_url) ?? `https://github.com/${name}`, created ?? "", signals);
    });
}

// --- OpenDigger enrichment ---------------------------------------------------

// Verified live 2026-09-13: one JSON object keyed by year ("2025"), quarter
// ("2025Q3") and month ("2025-09"), values numbers. The latest month is what
// the item carries.
export function latestMonthValue(metric: unknown): number | undefined {
  if (!metric || typeof metric !== "object") return undefined;
  let bestKey = "";
  let best: number | undefined;
  for (const [key, value] of Object.entries(metric as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}$/.test(key) || typeof value !== "number" || !Number.isFinite(value)) continue;
    if (key > bestKey) {
      bestKey = key;
      best = value;
    }
  }
  return best;
}

// Sequential and quiet: a miss (404 for a repo OpenDigger has not indexed, a
// dead host, junk) leaves the fields unset. Only a cancellation propagates.
async function enrich(items: InfoItem[], deps: IndexDeps): Promise<void> {
  for (const item of items.slice(0, ENRICH_TOP)) {
    if (!item.sourceKey) continue;
    for (const metric of ["openrank", "activity"] as const) {
      throwIfAborted(deps.signal);
      try {
        const value = latestMonthValue(await fetchJson(openDiggerUrl(item.sourceKey, metric), deps));
        if (value !== undefined) (item.signals ??= {})[metric] = value;
      } catch (e) {
        if (isAbortError(e)) throw e;
      }
    }
  }
}

// --- the provider ------------------------------------------------------------

export const githubProvider: IndexProvider = {
  id: "github",
  name: "GitHub",
  hosts: [OSSINSIGHT_HOST, GITHUB_HOST, OPENDIGGER_HOST],
  defaultLimit: 30,

  validateQuery(query: IndexQuery): string | null {
    const read = readQuery(query);
    return typeof read === "string" ? read : null;
  },

  // "GitHub trending · Python · past week"
  // "GitHub new repos · topic robotics, embodied-ai · created in 14 days · ≥ 50 stars"
  describeQuery(query: IndexQuery): string {
    const read = readQuery(query);
    if (typeof read === "string") return `GitHub (invalid query: ${read})`;
    if (read.mode === "trending") {
      const parts = ["GitHub trending"];
      if (read.language) parts.push(read.language);
      parts.push(PERIOD_LABEL[read.period]);
      return parts.join(" · ");
    }
    const parts = ["GitHub new repos"];
    if (read.language) parts.push(read.language);
    if (read.topics.length) parts.push(`topic ${read.topics.join(", ")}`);
    parts.push(`created in ${read.days} day${read.days === 1 ? "" : "s"}`, `≥ ${read.minStars} stars`);
    return parts.join(" · ");
  },

  async discover(desc: SourceDescriptor, query: IndexQuery, deps: IndexDeps): Promise<InfoItem[]> {
    throwIfAborted(deps.signal);
    const read = mustRead(query);
    const limit = deps.limit ?? this.defaultLimit;
    const items =
      read.mode === "trending"
        ? await discoverTrending(desc, query, deps, limit)
        : await discoverSearch(desc, query, deps, limit);
    await enrich(items, deps);
    return items;
  },
};
