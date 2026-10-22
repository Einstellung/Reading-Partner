// A study's graph expansion, the pure half (docs/info/92 「正例和反例」「哪个库做什么」
// 「预算、闸、缓存和 key」): which papers it starts from and steers away from, the
// streams it reads, how a library's answer becomes the arXiv papers a stream
// keeps, and the cache that spares the libraries a second ask. The requests are
// graph-live.ts's.
//
// Positives are the seeds, then the papers whose latest label is `pinned`, then
// `yes`, newest label first; negatives are the papers whose latest label is
// `no`. A paper is pooled only under an arXiv id, dated by that id's month
// (huggingface.ts paperDay), never by the library's date: OpenAlex can hand back
// another version's date, or another paper (docs/pitfall/668).

import { normalizeArxivId } from "../sources/plugins/arxiv-client";
import { paperDay } from "../sources/plugins/huggingface";
import { openAlexArxivHandle, OA_MAX_OR_IDS, type OpenAlexHit } from "../sources/plugins/openalex-client";
import type { S2Hit } from "../sources/plugins/s2-client";
import {
  graphStreamId,
  RETRIED_OUTCOMES,
  type GraphLibrary,
  type GraphOutcome,
  type GraphPaper,
  type GraphPositive,
  type GraphRead,
  type GraphStream,
  type GraphStreamKind,
  type GraphWhy,
} from "./graph-read";
import { latestLabels, type TopicLabel } from "./labels";
import type { TopicSeed } from "./types";

/** Positives the recommendations start from. */
export const REC_POSITIVES = 20;
/** Negatives the recommendations steer away from. */
export const NEGATIVES_MAX = 10;
/** Positives whose citations and references are walked. */
export const MAX_WALKED = 6;
/** A positive cited more often than this is a hub: its citations are not walked. */
export const HUB_CITATIONS = 300;
/** Recommendations asked of S2. */
export const REC_LIMIT = 100;
/** Papers a stream keeps on file: the recommendations, and each walk. */
export const REC_KEEP = 50;
export const WALK_KEEP = 30;
/** One read's requests at most: S2 (batch, recommendations, six walks each way), OpenAlex list requests, arXiv abstract batches. */
export const S2_REQUESTS_MAX = 2 + 2 * MAX_WALKED;
export const OPENALEX_LISTS_MAX = 18;
/** OpenAlex lookups of single works by id (free of charge): one per recommendation positive at most. */
export const OPENALEX_LOOKUPS_MAX = REC_POSITIVES;
export const ARXIV_ABSTRACT_REQUESTS = 2;
/** Ids per abstract request, OpenAlex's and arXiv's. */
export const ABSTRACT_BATCH = 50;

const DAY_MS = 86_400_000;

// --- positives and negatives ---

export type GraphExample = { key: string; title: string; why: Exclude<GraphWhy, "provisional"> };

export interface GraphExamples {
  /** Every positive, in order. */
  positives: GraphExample[];
  /** Every paper whose latest label is `no`, newest label first. */
  negatives: { key: string; title: string }[];
}

const PAPER_KEY = /^(arxiv|doi):./;

/**
 * The positives and negatives of a study, from its seeds and labels. A seed the
 * reader has since labelled `no` or `borderline` is not a positive; a
 * `borderline` paper is neither. Only papers (arXiv or DOI keys) count.
 */
export function pickExamples(seeds: readonly TopicSeed[], labels: readonly TopicLabel[]): GraphExamples {
  const latest = latestLabels(labels);
  const positives = new Map<string, GraphExample>();
  const add = (key: string, title: string, why: GraphExample["why"]) => {
    if (PAPER_KEY.test(key) && !positives.has(key)) positives.set(key, { key, title, why });
  };
  for (const s of seeds) {
    const now = latest.get(s.key)?.label;
    if (now !== "no" && now !== "borderline") add(s.key, s.title, "seed");
  }
  const newest = [...latest.values()].sort((a, b) => b.at - a.at);
  for (const l of newest) if (l.label === "pinned") add(l.item, l.title, "pinned");
  for (const l of newest) if (l.label === "yes") add(l.item, l.title, "yes");
  const negatives = newest
    .filter((l) => l.label === "no" && PAPER_KEY.test(l.item) && !positives.has(l.item))
    .map((l) => ({ key: l.item, title: l.title }));
  return { positives: [...positives.values()], negatives };
}

/**
 * The positives a read walks: the first MAX_WALKED on a first look; on an
 * update, the first MAX_WALKED no earlier run walked (none: null, the update
 * reads no graph); on a retry, those its streams to read again start from.
 */
export function chooseWalked(
  positives: readonly GraphExample[],
  plan: { only: readonly string[] | null; walkedBefore: readonly string[] | null },
): Set<string> | null {
  if (plan.only) {
    const from = new Set(plan.only.filter((id) => id !== "rec").map((id) => id.slice(id.indexOf(":") + 1)));
    return new Set(positives.filter((p) => from.has(p.key)).map((p) => p.key));
  }
  if (plan.walkedBefore) {
    const before = new Set(plan.walkedBefore);
    const fresh = positives.filter((p) => !before.has(p.key)).slice(0, MAX_WALKED);
    return fresh.length ? new Set(fresh.map((p) => p.key)) : null;
  }
  return new Set(positives.slice(0, MAX_WALKED).map((p) => p.key));
}

/** The positives a read keeps on file: the recommendations' and the walked ones. */
export function filedPositives(positives: readonly GraphExample[], walked: ReadonlySet<string>): GraphPositive[] {
  const rec = new Set(positives.slice(0, REC_POSITIVES).map((p) => p.key));
  return positives
    .filter((p) => rec.has(p.key) || walked.has(p.key))
    .map((p) => ({ key: p.key, title: p.title, why: p.why, s2: null, openAlex: null, citationCount: null, walked: walked.has(p.key) }));
}

export interface PlannedStream {
  id: string;
  kind: GraphStreamKind;
  from: string[];
}

/** The streams a read takes: the recommendations from the first REC_POSITIVES, each walked positive's citations and references; a retry's, only those named. */
export function planStreams(positives: readonly GraphPositive[], only: readonly string[] | null): PlannedStream[] {
  const all: PlannedStream[] = [
    { id: graphStreamId("rec"), kind: "rec", from: positives.slice(0, REC_POSITIVES).map((p) => p.key) },
    ...positives
      .filter((p) => p.walked)
      .flatMap((p) => (["cites", "refs"] as const).map((kind) => ({ id: graphStreamId(kind, p.key), kind, from: [p.key] }))),
  ];
  return only ? all.filter((s) => only.includes(s.id)) : all;
}

// --- ids ---

/** The arXiv id a key names, if it is an arXiv key. */
export function arxivIdOfKey(key: string): string | null {
  return key.startsWith("arxiv:") ? key.slice("arxiv:".length) : null;
}

/** How S2 is asked for a paper by its key: `ARXIV:<id>` or `DOI:<doi>`. */
export function s2Handle(key: string): string | null {
  if (key.startsWith("arxiv:")) return `ARXIV:${key.slice("arxiv:".length)}`;
  if (key.startsWith("doi:")) return `DOI:${key.slice("doi:".length)}`;
  return null;
}

/** How OpenAlex is asked for a paper by its key: by its arXiv DOI or its DOI. */
export function openAlexHandle(key: string): string | null {
  if (key.startsWith("arxiv:")) return openAlexArxivHandle(key.slice("arxiv:".length));
  if (key.startsWith("doi:")) return `doi:${key.slice("doi:".length)}`;
  return null;
}

const ARXIV_DOI = /^(?:https?:\/\/(?:dx\.)?doi\.org\/)?10\.48550\/arxiv\.(.+)$/i;

/** The arXiv id in arXiv's own DOI ("10.48550/arXiv.<id>"), else null. */
export function arxivIdOfDoi(doi: string | null | undefined): string | null {
  const m = doi ? ARXIV_DOI.exec(doi.trim()) : null;
  return m ? normalizeArxivId(m[1]) : null;
}

/** A library's paper as the expansion takes it: an arXiv paper, one with a DOI only (counted, not pooled), or nothing usable. */
export type Found =
  | { kind: "paper"; paper: GraphPaper }
  | { kind: "doi"; title: string; day: string | null }
  | null;

function arxivPaper(id: string, hit: { title: string; abstract: string; authors: string[] }, date: string | null, citationCount: number | null): Found {
  return {
    kind: "paper",
    paper: {
      arxivId: id,
      title: hit.title,
      abstract: hit.abstract ?? "",
      authors: hit.authors,
      publishedAt: paperDay(id, date ?? "") ?? "",
      citationCount,
    },
  };
}

export function foundFromS2(hit: S2Hit): Found {
  const id = (hit.arxivId ? normalizeArxivId(hit.arxivId) : null) ?? arxivIdOfDoi(hit.doi);
  if (id) return arxivPaper(id, hit, hit.publicationDate ?? null, hit.citationCount);
  if (hit.doi) return { kind: "doi", title: hit.title, day: hit.publicationDate ?? (hit.year ? `${hit.year}-01-01` : null) };
  return null;
}

export function foundFromOpenAlex(hit: OpenAlexHit): Found {
  const id = hit.arxivId ? normalizeArxivId(hit.arxivId) : null;
  if (id) return arxivPaper(id, hit, hit.publicationDate, hit.citedByCount);
  if (hit.doi) return { kind: "doi", title: hit.title, day: hit.publicationDate ?? (hit.year ? `${hit.year}-01-01` : null) };
  return null;
}

// --- one answer, sifted ---

/** What a stream's answer comes to before exclusions: the arXiv papers in the window, the titles of those with only a DOI. */
export type Sifted = { total: number; papers: GraphPaper[]; doiOnly: string[] };

/** Whether a paper's arXiv day falls on or after the window's first day. */
export function inWindow(paper: GraphPaper, since: string): boolean {
  return paper.publishedAt !== "" && paper.publishedAt >= since;
}

/** A library's answer, kept to the window: arXiv papers once each, DOI-only titles (undated ones too) once each. */
export function sift(found: readonly Found[], since: string): Sifted {
  const papers = new Map<string, GraphPaper>();
  const doiOnly = new Set<string>();
  for (const f of found) {
    if (!f) continue;
    if (f.kind === "paper") {
      if (inWindow(f.paper, since) && !papers.has(f.paper.arxivId)) papers.set(f.paper.arxivId, f.paper);
    } else if (f.title && (!f.day || f.day >= since)) doiOnly.add(f.title);
  }
  return { total: found.length, papers: [...papers.values()], doiOnly: [...doiOnly] };
}

/**
 * The papers a stream keeps: none excluded (the positives, the papers labelled
 * `no`), ranked — the recommendations in the library's order, a walk by
 * citations then by day — and cut to REC_KEEP or WALK_KEEP.
 */
export function keepPapers(kind: GraphStreamKind, papers: readonly GraphPaper[], exclude: ReadonlySet<string>, since: string): GraphPaper[] {
  const left = papers.filter((p) => !exclude.has(p.arxivId) && inWindow(p, since));
  if (kind !== "rec") {
    left.sort((a, b) => (b.citationCount ?? 0) - (a.citationCount ?? 0) || (a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0));
  }
  return left.slice(0, kind === "rec" ? REC_KEEP : WALK_KEEP);
}

/** The arXiv ids no stream may keep: every positive's and every paper labelled `no`. */
export function excludedIds(examples: GraphExamples, resolved: readonly (string | null)[] = []): Set<string> {
  const ids = [...examples.positives, ...examples.negatives].map((e) => arxivIdOfKey(e.key));
  return new Set([...ids, ...resolved].filter((id): id is string => !!id));
}

/** A stream on file. */
export function streamOf(
  planned: PlannedStream,
  answer: { library: GraphLibrary | null; outcome: GraphOutcome; total: number; papers: GraphPaper[] },
  at: number,
): GraphStream {
  return { id: planned.id, kind: planned.kind, from: planned.from, ...answer, at: new Date(at).toISOString() };
}

// --- OpenAlex ---

const workNumber = (id: string) => Number(id.replace(/^W/, "")) || 0;

/**
 * The works most positives share among their related works, as many as one
 * request takes; ties go to the newer work (a higher id). OpenAlex's related
 * works are old (docs/pitfall/669), so the window leaves few.
 */
export function rankRelated(lists: readonly (readonly string[])[], limit = OA_MAX_OR_IDS): string[] {
  const hits = new Map<string, number>();
  for (const list of lists) for (const id of new Set(list)) hits.set(id, (hits.get(id) ?? 0) + 1);
  return [...hits]
    .sort((a, b) => b[1] - a[1] || workNumber(b[0]) - workNumber(a[0]))
    .slice(0, limit)
    .map(([id]) => id);
}

/** A bibliography's newest works, as many as one request takes: OpenAlex numbers its works in the order it made them. */
export function newestWorks(ids: readonly string[], limit = OA_MAX_OR_IDS): string[] {
  return [...new Set(ids)].sort((a, b) => workNumber(b) - workNumber(a)).slice(0, limit);
}

// --- across runs ---

/** Each stream's latest reading across a study's runs, by when it was read. */
export function latestStreams(reads: readonly GraphRead[]): GraphStream[] {
  const out = new Map<string, GraphStream>();
  for (const read of reads) {
    for (const s of read.streams) {
      const had = out.get(s.id);
      if (!had || s.at >= had.at) out.set(s.id, s);
    }
  }
  return [...out.values()];
}

/** The streams a retry reads again: those whose latest reading did not come back. */
export function streamsToRetry(reads: readonly GraphRead[]): string[] {
  return latestStreams(reads)
    .filter((s) => RETRIED_OUTCOMES.includes(s.outcome))
    .map((s) => s.id);
}

/** The positives some run of the study walked. */
export function walkedKeys(reads: readonly GraphRead[]): string[] {
  return [...new Set(reads.flatMap((r) => r.positives.filter((p) => p.walked).map((p) => p.key)))];
}

/** One line on how far the expansion has got: counts and outcomes only. */
export function graphProgressLine(read: GraphRead | null, planned: number): string {
  if (!read) return "citation graph: starting";
  const papers = read.streams.reduce((n, s) => n + s.papers.length, 0);
  const outcomes = new Map<string, number>();
  for (const s of read.streams) outcomes.set(s.outcome, (outcomes.get(s.outcome) ?? 0) + 1);
  const how = outcomes.size ? ` (${[...outcomes].map(([o, n]) => `${n} ${o.replace("_", " ")}`).join(", ")})` : "";
  const count = `${papers} paper${papers === 1 ? "" : "s"}`;
  const done = read.streams.length >= planned;
  return done
    ? `citation graph done: ${planned} stream${planned === 1 ? "" : "s"} read${how}, ${count}`
    : `citation graph: ${read.streams.length} of ${planned} streams read${how}, ${count}`;
}

// --- the cache (topic-search-graph-cache.json, this device only) ---

export const GRAPH_CACHE_FILE = "topic-search-graph-cache.json";

/** How long an answer is kept: ids and references a month, citations and recommendations three days. */
export const CACHE_TTL_MS = {
  ids: 30 * DAY_MS,
  works: 30 * DAY_MS,
  refs: 30 * DAY_MS,
  cites: 3 * DAY_MS,
  rec: 3 * DAY_MS,
  abstracts: 30 * DAY_MS,
} as const;

/** S2's id batch for one key; `s2` null: S2 does not know it. */
export type CachedIds = { s2: string | null; arxivId: string | null; citationCount: number | null; at: number };
/** OpenAlex's work for one key; `openAlex` null: OpenAlex does not know it, or names another paper. */
export type CachedWork = { openAlex: string | null; citedBy: number | null; referenced: string[]; related: string[]; at: number };
/** A stream's answer, sifted to the window that starts on `since`. */
export type CachedStream = { library: GraphLibrary; since: string; total: number; papers: GraphPaper[]; doiOnly: string[]; at: number };

export type GraphCache = {
  version: 1;
  ids: Record<string, CachedIds>;
  works: Record<string, CachedWork>;
  /** Keyed `rec:<hash of the examples>`, `cites:<key>`, `refs:<key>`. */
  streams: Record<string, CachedStream>;
  /** arXiv id to abstract. */
  abstracts: Record<string, { text: string; at: number }>;
};

export function emptyGraphCache(): GraphCache {
  return { version: 1, ids: {}, works: {}, streams: {}, abstracts: {} };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function section<T>(v: unknown, ok: (e: Record<string, unknown>) => boolean): Record<string, T> {
  if (!isObject(v)) return {};
  const out: Record<string, T> = {};
  for (const [k, e] of Object.entries(v)) if (isObject(e) && typeof e.at === "number" && ok(e)) out[k] = e as T;
  return out;
}

/** The cache file's text, or an empty cache when it does not read: it is only a cache. */
export function parseGraphCache(text: string | null): GraphCache {
  if (!text) return emptyGraphCache();
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return emptyGraphCache();
  }
  if (!isObject(raw) || raw.version !== 1) return emptyGraphCache();
  return {
    version: 1,
    ids: section(raw.ids, (e) => e.s2 === null || typeof e.s2 === "string"),
    works: section(raw.works, (e) => Array.isArray(e.referenced) && Array.isArray(e.related)),
    streams: section(raw.streams, (e) => typeof e.since === "string" && Array.isArray(e.papers) && Array.isArray(e.doiOnly)),
    abstracts: section(raw.abstracts, (e) => typeof e.text === "string"),
  };
}

const streamTtl = (key: string) => (key.startsWith("refs:") ? CACHE_TTL_MS.refs : key.startsWith("cites:") ? CACHE_TTL_MS.cites : CACHE_TTL_MS.rec);

/** Whether an entry written at `at` still stands. */
export const fresh = (at: number, ttl: number, now: number) => now - at < ttl;

export function cachedStream(cache: GraphCache, key: string, since: string, now: number): CachedStream | null {
  const e = cache.streams[key];
  // A list sifted to a later window lacks papers this one wants.
  return e && fresh(e.at, streamTtl(key), now) && e.since <= since ? e : null;
}

/** The cache without what has expired, as written to the file. */
export function pruneGraphCache(cache: GraphCache, now: number): GraphCache {
  const keep = <T extends { at: number }>(rec: Record<string, T>, ttl: (k: string) => number) =>
    Object.fromEntries(Object.entries(rec).filter(([k, e]) => fresh(e.at, ttl(k), now)));
  return {
    version: 1,
    ids: keep(cache.ids, () => CACHE_TTL_MS.ids),
    works: keep(cache.works, () => CACHE_TTL_MS.works),
    streams: keep(cache.streams, streamTtl),
    abstracts: keep(cache.abstracts, () => CACHE_TTL_MS.abstracts),
  };
}

/** The recommendations' cache key: the positive and negative sets, hashed (FNV-1a). */
export function recCacheKey(positives: readonly string[], negatives: readonly string[]): string {
  const text = `${[...positives].sort().join("\n")}\n--\n${[...negatives].sort().join("\n")}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `rec:${h.toString(16).padStart(8, "0")}`;
}
