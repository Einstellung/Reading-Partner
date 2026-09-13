// Hugging Face index provider (docs/69): three queries against the Hub API. The
// daily papers page by date (one request per day back), and the model and
// dataset lists by trending score, likes, downloads or creation date, narrowed
// by pipeline tag, author and tags. Headlines with the Hub's own counts as
// signals, never a body: a paper's abstract is the most this list carries.
//
// The model list is nine tenths finetunes and quantised conversions (docs/69),
// so conversions are dropped unless the query asks for them. Downloads are
// request counts (CI and mirrors included) and trending has been gamed; the
// numbers go through as the Hub reports them, and reading them is the analyst's
// job.

import { throwIfAborted } from "../../../platform/app/abort";
import { fetchText } from "../../extract/http";
import { itemId } from "../../extract/id";
import type { SourceDescriptor } from "../descriptor";
import {
  daysBefore,
  queryInt,
  queryString,
  queryStrings,
  type PluginDeps,
  type SourcePlugin,
  type IndexQuery,
} from "../plugin";
import type { InfoItem, ItemSignals } from "../item";

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
    return `kind must be one of ${KINDS.join(", ")}`;
  }
  const papers = kind === "papers";
  if (q.days !== undefined) {
    if (!papers) return "days applies to papers only";
    const n = queryInt(q, "days");
    if (n === undefined || q.days !== n) return "days must be a positive integer";
    if (n > MAX_DAYS) return `days must be at most ${MAX_DAYS}`;
  }
  for (const key of ["pipelineTag", "author"]) {
    if (q[key] === undefined) continue;
    if (papers) return `${key} applies to models and datasets only`;
    if (typeof q[key] !== "string" || !(q[key] as string).trim()) return `${key} must be a non-empty string`;
  }
  if (q.tags !== undefined) {
    if (papers) return "tags applies to models and datasets only";
    const ok = Array.isArray(q.tags) && q.tags.every((t) => typeof t === "string" && t.trim());
    if (!ok) return "tags must be a list of non-empty strings";
  }
  if (q.sort !== undefined) {
    if (papers) return "sort applies to models and datasets only";
    if (typeof q.sort !== "string" || !(SORTS as readonly string[]).includes(q.sort)) {
      return `sort must be one of ${SORTS.join(", ")}`;
    }
  }
  if (q.includeConversions !== undefined) {
    if (kind !== "models") return "includeConversions applies to models only";
    if (typeof q.includeConversions !== "boolean") return "includeConversions must be a boolean";
  }
  return null;
}

function describeQuery(q: IndexQuery): string {
  const p = parse(q);
  if (p.kind === "papers") {
    return `HF papers · ${p.days === 1 ? "today" : `last ${p.days} days`}`;
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

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function strs(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

async function fetchRows(url: string, deps: PluginDeps): Promise<Record<string, unknown>[]> {
  throwIfAborted(deps.signal);
  const text = await fetchText(url, deps.fetchFn, undefined, { signal: deps.signal });
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Hugging Face returned non-JSON from ${url}`);
  }
  if (!Array.isArray(data)) throw new Error(`Hugging Face returned an unexpected shape from ${url}`);
  return data.filter((r): r is Record<string, unknown> => !!r && typeof r === "object");
}

// One daily_papers row: `{ paper: { id, title, summary, upvotes, publishedAt },
// numComments, publishedAt, ... }`. Null when the row has no arXiv id.
function paperItem(desc: SourceDescriptor, row: Record<string, unknown>): InfoItem | null {
  const paper = (row.paper && typeof row.paper === "object" ? row.paper : {}) as Record<string, unknown>;
  const id = str(paper.id);
  if (!id) return null;
  const summary = str(paper.summary).trim();
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
    title: str(paper.title) || str(row.title) || id,
    url: `${HOST}/papers/${id}`,
    publishedAt: str(row.publishedAt) || str(paper.publishedAt),
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
  const id = str(row.id);
  if (!id) return null;
  const tags = strs(row.tags);
  const prefixed = (prefix: string) => tags.find((t) => t.startsWith(prefix))?.slice(prefix.length);
  const pipeline = str(row.pipeline_tag) || prefixed("task_categories:");
  const library = str(row.library_name) || prefixed("library:");
  const plainTags = tags.filter((t) => !t.includes(":")).slice(0, 8);
  const signals: ItemSignals = {
    tags: [pipeline, library, kind === "datasets" ? "dataset" : "weights"].filter((t): t is string => !!t),
  };
  const likes = num(row.likes);
  if (likes !== undefined) signals.likes = likes;
  const downloads = num(row.downloads);
  if (downloads !== undefined) signals.downloads = downloads;
  const createdAt = str(row.createdAt);
  if (createdAt) signals.createdAt = createdAt;
  const line = [pipeline ? `pipeline: ${pipeline}` : "", plainTags.length ? `tags: ${plainTags.join(", ")}` : ""]
    .filter(Boolean)
    .join(" · ");
  const description = oneLine(str(row.description));
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
  const name = str(row.id).split("/").pop() ?? "";
  return CONVERSION_ID.test(name);
}

// --- discover ---------------------------------------------------------------

async function discover(desc: SourceDescriptor, query: IndexQuery, deps: PluginDeps): Promise<InfoItem[]> {
  const p = parse(query);
  const limit = deps.limit ?? huggingfacePlugin.defaultLimit;
  if (p.kind === "papers") {
    // Today first, then back one page a day. The Hub has no page for a weekend
    // day and answers [] (pitfall 298); the loop just moves on.
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

export const huggingfacePlugin: SourcePlugin = {
  id: "huggingface",
  name: "Hugging Face",
  hosts: ["huggingface.co"],
  defaultLimit: 30,
  validateQuery,
  describeQuery,
  discover,
};
