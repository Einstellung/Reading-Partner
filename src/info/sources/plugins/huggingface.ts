// Hugging Face index provider (docs/69): three queries against the Hub API. The
// daily papers page by date (one request per day back), and the model and
// dataset lists by trending score, likes, downloads or creation date, narrowed
// by pipeline tag, author and tags. Headlines with the Hub's own counts as
// signals, never a body: a paper's abstract is the most this list carries.
//
// The search slot (docs/88 「取材 / Hugging Face」) asks the Hub's paper search:
// no auth, up to 120 papers in relevance order, no date, sort or paging
// parameter, so the window is applied here on the client. Each row already
// names the paper's code repository, stars and project page. Its own rate-limit
// bucket (50 per 5 minutes) is a lane of the host gate (platform/http/host-gate.ts).
//
// The model list is nine tenths finetunes and quantised conversions (docs/69),
// so conversions are dropped unless the query asks for them. Downloads are
// request counts (CI and mirrors included) and trending has been gamed; the
// numbers go through as the Hub reports them, and reading them is the analyst's
// job.

import { throwIfAborted } from "../../../platform/app/abort";
import { fetchWithRetry, HttpStatusError, interactiveRetry } from "../../../platform/http/throttled-fetch";
import { asString } from "../../../platform/std/json";
import { oneLine } from "../../../platform/std/text";
import { fetchText } from "../../../workshop/extract/http";
import { itemId } from "../../../workshop/extract/id";
import type { SourceDescriptor } from "../descriptor";
import {
  daysBefore,
  queryInt,
  queryString,
  queryStrings,
  type PluginDeps,
  type SearchOptions,
  type SourcePlugin,
  type IndexQuery,
} from "../plugin";
import type { InfoItem, ItemSignals } from "../item";
import { t } from "../../../i18n";

const HOST = "https://huggingface.co";
const KINDS = ["papers", "models", "datasets"] as const;
type Kind = (typeof KINDS)[number];
const SORTS = ["trending", "likes", "downloads", "created"] as const;
type Sort = (typeof SORTS)[number];
// The Hub's `sort=` values for ours (huggingface_hub maps them the same way).
const SORT_PARAM: Record<Sort, string> = {
  trending: "trendingScore",
  likes: "likes",
  downloads: "downloads",
  created: "createdAt",
};
// One request per day; a month of daily pages is already more than a poll wants.
const MAX_DAYS = 31;
const SUMMARY_CHARS = 400;
// Tags and id fragments that mark a repo as a quantised or converted copy of
// another model rather than a model of its own.
const CONVERSION_MARKERS = ["gguf", "awq", "gptq", "mlx", "onnx", "exl2"];
const CONVERSION_ID = new RegExp(`(?:^|[-_.])(?:${CONVERSION_MARKERS.join("|")})(?:$|[-_.])`, "i");

interface Parsed {
  kind: Kind;
  days: number;
  pipelineTag?: string;
  author?: string;
  tags: string[];
  sort: Sort;
  includeConversions: boolean;
}

function parse(q: IndexQuery): Parsed {
  return {
    kind: q.kind as Kind,
    days: queryInt(q, "days") ?? 1,
    pipelineTag: queryString(q, "pipelineTag"),
    author: queryString(q, "author"),
    tags: queryStrings(q, "tags"),
    sort: (queryString(q, "sort") as Sort | undefined) ?? "trending",
    includeConversions: q.includeConversions === true,
  };
}

function validateQuery(q: IndexQuery): string | null {
  const kind = q.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    return t("sources.plugins.huggingface.kindMustBeOneOf", { kinds: KINDS.join(", ") });
  }
  const papers = kind === "papers";
  if (q.days !== undefined) {
    if (!papers) return t("sources.plugins.huggingface.daysPapersOnly");
    const n = queryInt(q, "days");
    if (n === undefined || q.days !== n) return t("sources.plugins.daysPositiveInteger");
    if (n > MAX_DAYS) return t("sources.plugins.daysMustBeAtMost", { max: MAX_DAYS });
  }
  for (const key of ["pipelineTag", "author"]) {
    if (q[key] === undefined) continue;
    if (papers) return t("sources.plugins.huggingface.fieldAppliesToModelsDatasetsOnly", { field: key });
    if (typeof q[key] !== "string" || !(q[key] as string).trim())
      return t("sources.plugins.huggingface.fieldMustBeNonEmptyString", { field: key });
  }
  if (q.tags !== undefined) {
    if (papers) return t("sources.plugins.huggingface.fieldAppliesToModelsDatasetsOnly", { field: "tags" });
    const ok = Array.isArray(q.tags) && q.tags.every((tag) => typeof tag === "string" && tag.trim());
    if (!ok) return t("sources.plugins.huggingface.tagsMustBeNonEmptyStrings");
  }
  if (q.sort !== undefined) {
    if (papers) return t("sources.plugins.huggingface.fieldAppliesToModelsDatasetsOnly", { field: "sort" });
    if (typeof q.sort !== "string" || !(SORTS as readonly string[]).includes(q.sort)) {
      return t("sources.plugins.huggingface.sortMustBeOneOf", { sorts: SORTS.join(", ") });
    }
  }
  if (q.includeConversions !== undefined) {
    if (kind !== "models") return t("sources.plugins.huggingface.includeConversionsModelsOnly");
    if (typeof q.includeConversions !== "boolean")
      return t("sources.plugins.huggingface.includeConversionsMustBeBoolean");
  }
  return null;
}

function describeQuery(q: IndexQuery): string {
  const p = parse(q);
  if (p.kind === "papers") {
    return `HF papers · ${p.days === 1 ? t("sources.window.today") : t("sources.window.lastDays", { count: p.days })}`;
  }
  const parts = [`HF ${p.kind}`];
  if (p.pipelineTag) parts.push(p.pipelineTag);
  if (p.author) parts.push(`by ${p.author}`);
  if (p.tags.length) parts.push(`tags ${p.tags.join(", ")}`);
  parts.push(p.sort);
  return parts.join(" · ");
}

// --- request urls (exported for tests) --------------------------------------

export function papersUrl(date: string): string {
  return `${HOST}/api/daily_papers?date=${encodeURIComponent(date)}`;
}

export function reposUrl(q: IndexQuery, limit: number): string {
  const p = parse(q);
  const params = new URLSearchParams();
  params.set("sort", SORT_PARAM[p.sort]);
  params.set("direction", "-1");
  params.set("limit", String(limit));
  if (p.pipelineTag) params.set("pipeline_tag", p.pipelineTag);
  if (p.author) params.set("author", p.author);
  // Repeated `filter=`: the Hub ANDs them, as the official client sends a list.
  for (const t of p.tags) params.append("filter", t);
  return `${HOST}/api/${p.kind}?${params}`;
}

// --- rows -------------------------------------------------------------------

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

async function fetchRows(url: string, deps: PluginDeps): Promise<Record<string, unknown>[]> {
  throwIfAborted(deps.signal);
  const text = await fetchText(url, deps.fetchFn, undefined, { signal: deps.signal });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t("sources.plugins.huggingface.nonJson", { url }));
  }
  if (!Array.isArray(data)) throw new Error(t("sources.plugins.huggingface.unexpectedShape", { url }));
  return data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

// One daily_papers row: `{ paper: { id, title, summary, upvotes, publishedAt },
// numComments, publishedAt, ... }`. Null when the row has no arXiv id.
function paperItem(desc: SourceDescriptor, row: Record<string, unknown>): InfoItem | null {
  const paper = (row.paper && typeof row.paper === "object" ? row.paper : {}) as Record<string, unknown>;
  const id = asString(paper.id);
  if (!id) return null;
  const summary = asString(paper.summary).trim();
  const signals: ItemSignals = { tags: ["paper"] };
  const upvotes = num(paper.upvotes) ?? num(row.upvotes);
  if (upvotes !== undefined) signals.upvotes = upvotes;
  const comments = num(row.numComments) ?? num(paper.numComments);
  if (comments !== undefined) signals.comments = comments;
  const item: InfoItem = {
    id: itemId(desc.id, id),
    source: desc.id,
    sourceName: desc.name,
    sourceKey: id,
    title: asString(paper.title) || asString(row.title) || id,
    url: `${HOST}/papers/${id}`,
    publishedAt: asString(row.publishedAt) || asString(paper.publishedAt),
    summaryOnly: true,
    signals,
  };
  if (summary) {
    item.summary = oneLine(summary).slice(0, SUMMARY_CHARS);
    item.textContent = summary;
  }
  return item;
}

// A model or dataset row. Models have `pipeline_tag` and `library_name`;
// datasets carry the same facts as `task_categories:` and `library:` tags and
// a truncated `description`.
function repoItem(desc: SourceDescriptor, kind: Kind, row: Record<string, unknown>): InfoItem | null {
  const id = asString(row.id);
  if (!id) return null;
  const tags = strs(row.tags);
  const prefixed = (prefix: string) => tags.find((t) => t.startsWith(prefix))?.slice(prefix.length);
  const pipeline = asString(row.pipeline_tag) || prefixed("task_categories:");
  const library = asString(row.library_name) || prefixed("library:");
  const plainTags = tags.filter((t) => !t.includes(":")).slice(0, 8);
  const signals: ItemSignals = {
    tags: [pipeline, library, kind === "datasets" ? "dataset" : "weights"].filter((t): t is string => !!t),
  };
  const likes = num(row.likes);
  if (likes !== undefined) signals.likes = likes;
  const downloads = num(row.downloads);
  if (downloads !== undefined) signals.downloads = downloads;
  const createdAt = asString(row.createdAt);
  if (createdAt) signals.createdAt = createdAt;
  const line = [pipeline ? `pipeline: ${pipeline}` : "", plainTags.length ? `tags: ${plainTags.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");
  const description = oneLine(asString(row.description));
  return {
    id: itemId(desc.id, id),
    source: desc.id,
    sourceName: desc.name,
    sourceKey: id,
    title: pipeline ? `${id} (${pipeline})` : id,
    url: kind === "datasets" ? `${HOST}/datasets/${id}` : `${HOST}/${id}`,
    publishedAt: createdAt,
    summary: (description || line).slice(0, SUMMARY_CHARS) || undefined,
    summaryOnly: true,
    signals,
  };
}

// A quantised or converted copy: marked by a tag, by the `base_model:quantized:`
// relation, or by a marker in the repo name ("Qwen3-8B-GGUF", "x-AWQ-INT4").
export function isConversion(row: { id?: unknown; tags?: unknown }): boolean {
  const tags = strs(row.tags).map((t) => t.toLowerCase());
  if (tags.some((t) => CONVERSION_MARKERS.includes(t) || t.startsWith("base_model:quantized:"))) return true;
  const name = asString(row.id).split("/").pop() ?? "";
  return CONVERSION_ID.test(name);
}

// --- discover ---------------------------------------------------------------

async function discover(desc: SourceDescriptor, query: IndexQuery, deps: PluginDeps): Promise<InfoItem[]> {
  const p = parse(query);
  const limit = deps.limit ?? huggingfacePlugin.defaultLimit;
  if (p.kind === "papers") {
    // Today first, then back one page a day. The Hub has no page for a weekend
    // day and answers [] (pitfall 323); the loop just moves on.
    const items: InfoItem[] = [];
    const today = deps.today();
    for (let back = 0; back < p.days && items.length < limit; back++) {
      const rows = await fetchRows(papersUrl(daysBefore(today, back)), deps);
      for (const row of rows) {
        const item = paperItem(desc, row);
        if (item) items.push(item);
      }
    }
    return items.slice(0, limit);
  }
  const rows = await fetchRows(reposUrl(query, limit), deps);
  const items: InfoItem[] = [];
  for (const row of rows) {
    if (p.kind === "models" && !p.includeConversions && isConversion(row)) continue;
    const item = repoItem(desc, p.kind, row);
    if (item) items.push(item);
  }
  return items.slice(0, limit);
}

// --- search -----------------------------------------------------------------

/** Papers one search answers with at most; the Hub ignores anything above. */
export const HF_SEARCH_MAX = 120;
/** The longest `q` the Hub takes. */
const HF_QUERY_CHARS = 250;
// The source a search item names: the plugin itself.
const SEARCH_SOURCE = { id: "huggingface", name: "Hugging Face" };

export function paperSearchUrl(text: string): string {
  const q = text.trim().slice(0, HF_QUERY_CHARS);
  return `${HOST}/api/papers/search?q=${encodeURIComponent(q)}&limit=${HF_SEARCH_MAX}`;
}

const DAY = /^\d{4}-\d{2}-\d{2}/;
// A new-style arXiv id's year and month: "2602.08885" -> 2026-02.
const ID_MONTH = /^(\d{2})(0[1-9]|1[0-2])\.\d{4,5}$/;

function lastDayOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * The day a paper went up on arXiv, as near as the row tells. The Hub's
 * `paper.publishedAt` is not always the v1 date (2026-10-18: 75 of 635 papers
 * fell in another month than their id says, 53 of them later), while the id's
 * year and month are v1's. So the Hub's day stands when it is in the id's month;
 * a later day becomes the month's last day, an earlier one its first. Null when
 * neither the id nor the row gives a date.
 */
export function paperDay(id: string, publishedAt: string): string | null {
  const day = DAY.exec(publishedAt)?.[0] ?? null;
  const m = ID_MONTH.exec(id);
  if (!m) return day;
  const month = `20${m[1]}-${m[2]}`;
  if (!day) return `${month}-01`;
  if (day.startsWith(month)) return day;
  return day > month ? lastDayOf(month) : `${month}-01`;
}

function organizationOf(v: unknown): string | undefined {
  if (typeof v === "string") return v || undefined;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return asString(o.fullname) || asString(o.name) || undefined;
  }
  return undefined;
}

// One papers/search row: `{ paper: { id, title, summary, publishedAt, authors,
// upvotes, ai_summary, ai_keywords, githubRepo?, githubStars?, projectPage?,
// organization? }, numComments, highlighted*, ... }`. The item points at the
// arXiv abstract, so a topic search merges it with what arXiv found by id; its
// date is paperDay's. Null when the row has no id.
export function searchItem(row: Record<string, unknown>): InfoItem | null {
  const paper = (row.paper && typeof row.paper === "object" ? row.paper : {}) as Record<string, unknown>;
  const id = asString(paper.id);
  if (!id) return null;
  const published = asString(paper.publishedAt);
  const day = paperDay(id, published);
  const summary = asString(paper.summary).trim();
  const authors = (Array.isArray(paper.authors) ? paper.authors : [])
    .map((a) => (a && typeof a === "object" ? asString((a as Record<string, unknown>).name).trim() : ""))
    .filter(Boolean);
  const repo = asString(paper.githubRepo);
  const signals: ItemSignals = { tags: ["paper", ...(repo ? ["code"] : [])] };
  const upvotes = num(paper.upvotes);
  if (upvotes !== undefined) signals.upvotes = upvotes;
  const comments = num(row.numComments) ?? num(paper.numComments);
  if (comments !== undefined) signals.comments = comments;
  const stars = num(paper.githubStars);
  if (stars !== undefined) signals.stars = stars;
  if (repo) signals.repo = repo;
  const page = asString(paper.projectPage);
  if (page) signals.projectPage = page;
  const ai = oneLine(asString(paper.ai_summary));
  if (ai) signals.aiSummary = ai;
  const org = organizationOf(paper.organization);
  if (org) signals.tags!.push(org);
  const item: InfoItem = {
    id: itemId(SEARCH_SOURCE.id, id),
    source: SEARCH_SOURCE.id,
    sourceName: SEARCH_SOURCE.name,
    sourceKey: id,
    title: oneLine(asString(paper.title) || asString(row.title)) || id,
    url: `https://arxiv.org/abs/${id}`,
    // The full stamp when it is the day paperDay keeps, else that day.
    publishedAt: day && published.startsWith(day) ? published : (day ?? ""),
    summaryOnly: true,
    signals,
  };
  if (authors.length) item.authors = authors;
  if (summary) {
    item.summary = oneLine(summary).slice(0, SUMMARY_CHARS);
    item.textContent = summary;
  }
  return item;
}

/** Whether an item's day is in the window; `since` and `until` are inclusive days, either may be open. */
export function inWindow(item: Pick<InfoItem, "publishedAt">, since?: string, until?: string): boolean {
  const day = DAY.exec(item.publishedAt)?.[0];
  if (!day) return since === undefined && until === undefined;
  return (since === undefined || day >= since) && (until === undefined || day <= until);
}

// Free text to the Hub's paper search, one request; the answer filtered to the
// window and cut to the limit, in the Hub's relevance order.
async function search(text: string, opts: SearchOptions, deps: PluginDeps): Promise<InfoItem[]> {
  throwIfAborted(deps.signal);
  const url = paperSearchUrl(text);
  const init: RequestInit = { headers: { Accept: "application/json" }, ...(deps.signal ? { signal: deps.signal } : {}) };
  const res = await fetchWithRetry(url, init, interactiveRetry(deps.fetchFn));
  if (!res.ok) throw new HttpStatusError(res.status, "huggingface.co");
  let data: unknown;
  try {
    data = JSON.parse(await res.text());
  } catch {
    throw new Error(t("sources.plugins.huggingface.nonJson", { url }));
  }
  if (!Array.isArray(data)) throw new Error(t("sources.plugins.huggingface.unexpectedShape", { url }));
  const since = opts.since ?? (opts.sinceYear === undefined ? undefined : `${opts.sinceYear}-01-01`);
  const seen = new Set<string>();
  const items: InfoItem[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;
    const item = searchItem(row as Record<string, unknown>);
    if (!item || seen.has(item.id) || !inWindow(item, since, opts.until)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items.slice(0, opts.limit ?? deps.limit ?? HF_SEARCH_MAX);
}

export const huggingfacePlugin: SourcePlugin = {
  id: "huggingface",
  name: "Hugging Face",
  hosts: ["huggingface.co"],
  defaultLimit: 30,
  validateQuery,
  describeQuery,
  discover,
  search,
};
