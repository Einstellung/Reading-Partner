// Semantic Scholar Graph API fallback: title search (or arXiv-id lookup) for
// the abstract and an openAccessPdf link. Free tier, shared rate limit —
// fetchWithRetry backs off on 429, and the PDF download is best-effort: the
// open-access URL can point at any host, and inside Tauri only allowlisted
// hosts pass the http plugin scope, so a blocked host degrades to
// abstract-only rather than failing the paper.

import { fetchWithRetry, HttpStatusError, interactiveRetry, type FetchFn } from "./http";
import { pickByTitle } from "./match";

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "title,abstract,year,openAccessPdf,externalIds";
// The candidate list also needs who wrote it, where it appeared, and how often it
// has been cited (the ranking signal for a citation walk).
const SEARCH_FIELDS = `${FIELDS},authors,venue,citationCount`;

export function s2SearchUrl(title: string): string {
  return `${S2_BASE}/paper/search?query=${encodeURIComponent(title)}&limit=5&fields=${FIELDS}`;
}

export function s2ArxivUrl(arxivId: string): string {
  return `${S2_BASE}/paper/arXiv:${encodeURIComponent(arxivId)}?fields=${FIELDS}`;
}

interface S2Paper {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  authors?: { name?: string | null }[] | null;
  openAccessPdf?: { url?: string } | null;
  externalIds?: { ArXiv?: string; DOI?: string; PubMed?: string } | null;
  citationCount?: number | null;
}

export interface S2Result {
  arxivId: string | null;
  abstract: string;
  pdfBytes: ArrayBuffer | null;
}

export function pickS2Match(papers: S2Paper[], title: string): S2Paper | null {
  return pickByTitle(papers, title, (p) => p.title ?? "");
}

// --- topic search (docs/24: what is the latest work on X) ---

export interface S2TopicOptions {
  limit?: number;
  sinceYear?: number | null;
}

export interface S2Hit {
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  pmid: string | null;
  // S2's own opaque id, the cheapest handle for a follow-up call on this paper.
  paperId: string | null;
  venue: string | null;
  url: string | null;
  abstract: string;
  citationCount: number | null;
}

// Relevance search across every discipline. `year=2024-` is S2's open-ended range
// syntax; recency is a filter here too, since /paper/search has no sort parameter
// at all (only the bulk endpoint does).
export function s2TopicSearchUrl(query: string, opts: S2TopicOptions = {}): string {
  const params = [
    `query=${encodeURIComponent(query.trim())}`,
    `limit=${opts.limit ?? 5}`,
    `fields=${SEARCH_FIELDS}`,
  ];
  if (opts.sinceYear) params.push(`year=${opts.sinceYear}-`);
  return `${S2_BASE}/paper/search?${params.join("&")}`;
}

function s2Hit(p: S2Paper): S2Hit {
  return {
    title: (p.title ?? "").trim(),
    authors: (p.authors ?? []).map((a) => a.name?.trim() ?? "").filter((n) => n.length > 0),
    year: p.year ?? null,
    doi: p.externalIds?.DOI ?? null,
    arxivId: p.externalIds?.ArXiv ?? null,
    pmid: p.externalIds?.PubMed ?? null,
    paperId: p.paperId ?? null,
    venue: p.venue?.trim() || null,
    // The open-access PDF when S2 knows one; otherwise its own landing page,
    // which at least gives the reader somewhere to click.
    url: p.openAccessPdf?.url ?? (p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : null),
    abstract: p.abstract ?? "",
    citationCount: p.citationCount ?? null,
  };
}

export function parseS2Search(body: unknown): S2Hit[] {
  const papers = (body as { data?: S2Paper[] | null } | null)?.data ?? [];
  return papers.filter((p) => (p.title ?? "").trim().length > 0).map(s2Hit);
}

// Search Semantic Scholar by topic. The keyless pool is a single global budget —
// three requests four seconds apart already went 200/429/429 — so a 429 here is
// routine and comes back as a RateLimitError from fetchWithRetry, to be reported
// as "this library did not answer" rather than as "no results".
export async function searchS2Topic(
  query: string,
  opts: S2TopicOptions = {},
  fetchFn?: FetchFn,
  apiKey?: string,
): Promise<S2Hit[]> {
  const init: RequestInit | undefined = apiKey ? { headers: { "x-api-key": apiKey } } : undefined;
  const res = await fetchWithRetry(s2TopicSearchUrl(query, opts), init, interactiveRetry(fetchFn));
  if (!res.ok) throw new HttpStatusError(res.status, "api.semanticscholar.org");
  return parseS2Search(await res.json());
}

// --- citation graph (docs/24: snowballing out from a seed paper) ---

// An identifier S2 resolves in a path segment: "DOI:10.1073/…", "ARXIV:1706.03762",
// "PMID:17553422", or a bare S2 paperId. The prefixes are S2's own spelling.
export function s2PaperUrl(id: string, fields = SEARCH_FIELDS): string {
  return `${S2_BASE}/paper/${encodeURIComponent(id)}?fields=${fields}`;
}

// How many edges to ask for in one request. These endpoints take no sort and no
// working filter (see below), so the only way to rank is to pull a page and rank
// it here — which means the page size decides whether the ranking is meaningful.
//
// A bibliography is bounded, so 500 fetches every reference of any real paper and
// the ranking that follows is over the complete set. A citation list is not
// bounded: "Attention Is All You Need" has six figures of them, so 100 is a
// sample, and a caller ranking it must say so.
export const S2_REFERENCES_PAGE = 500;
export const S2_CITATIONS_PAGE = 100;

export function s2ReferencesUrl(id: string, limit = S2_REFERENCES_PAGE): string {
  return `${S2_BASE}/paper/${encodeURIComponent(id)}/references?fields=${SEARCH_FIELDS}&limit=${limit}`;
}

// No `year=` here on purpose: the parameter is accepted, returns 200, and is
// silently ignored. Measured 2026-07-30 on ARXIV:1706.03762, `year=1990-1995`
// returned the same 2026 papers as no filter at all — a window that must have been
// empty. Passing it would buy nothing and make the caller believe it had filtered.
export function s2CitationsUrl(id: string, limit = S2_CITATIONS_PAGE): string {
  return `${S2_BASE}/paper/${encodeURIComponent(id)}/citations?fields=${SEARCH_FIELDS}&limit=${limit}`;
}

// Edges come wrapped one level deep, under `citedPaper` on /references and
// `citingPaper` on /citations.
export type S2EdgeKey = "citedPaper" | "citingPaper";

// `data` is null, not [], when a publisher has elided the reference list —
// measured 2026-07-30 on DOI:10.1073/pnas.0611396104, which answered 200 with
// `{data: null, citingPaperInfo: {...disclaimer}}`. A caller that trusts the
// documented array shape throws a TypeError on a perfectly ordinary paper, so this
// treats a null page as "S2 has no edges to give" and lets the caller fall back.
export function parseS2Edges(body: unknown, key: S2EdgeKey): S2Hit[] {
  const rows = (body as { data?: Record<string, S2Paper | null>[] | null } | null)?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => row?.[key])
    .filter((p): p is S2Paper => !!p && (p.title ?? "").trim().length > 0)
    .map(s2Hit);
}

function s2Init(apiKey?: string): RequestInit | undefined {
  return apiKey ? { headers: { "x-api-key": apiKey } } : undefined;
}

async function s2Get(url: string, fetchFn?: FetchFn, apiKey?: string): Promise<Response> {
  const res = await fetchWithRetry(url, s2Init(apiKey), interactiveRetry(fetchFn));
  // 404 is a seed S2 does not know — a miss for the caller to fall back on, not a
  // failure of the library.
  if (!res.ok && res.status !== 404) throw new HttpStatusError(res.status, "api.semanticscholar.org");
  return res;
}

// One paper by identifier. Null when S2 does not have it.
export async function fetchS2Paper(
  id: string,
  fetchFn?: FetchFn,
  apiKey?: string,
): Promise<S2Hit | null> {
  const res = await s2Get(s2PaperUrl(id), fetchFn, apiKey);
  if (res.status === 404) return null;
  const p = (await res.json()) as S2Paper | null;
  return p && (p.title ?? "").trim() ? s2Hit(p) : null;
}

export async function fetchS2Edges(
  id: string,
  direction: "references" | "citations",
  fetchFn?: FetchFn,
  apiKey?: string,
): Promise<S2Hit[]> {
  const url = direction === "references" ? s2ReferencesUrl(id) : s2CitationsUrl(id);
  const res = await s2Get(url, fetchFn, apiKey);
  if (res.status === 404) return [];
  return parseS2Edges(await res.json(), direction === "references" ? "citedPaper" : "citingPaper");
}

export async function fetchFromS2(
  paper: { title: string; arxivId: string | null },
  fetchFn?: FetchFn,
  apiKey?: string,
): Promise<S2Result | null> {
  const opts = fetchFn ? { fetchFn } : undefined;
  // A personal API key gets its own rate budget instead of the shared free
  // pool. Sent per request; never logged.
  const init: RequestInit | undefined = apiKey ? { headers: { "x-api-key": apiKey } } : undefined;

  let match: S2Paper | null = null;
  if (paper.arxivId) {
    const res = await fetchWithRetry(s2ArxivUrl(paper.arxivId), init, opts);
    if (res.ok) match = (await res.json()) as S2Paper;
  }
  if (!match) {
    const res = await fetchWithRetry(s2SearchUrl(paper.title), init, opts);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: S2Paper[] };
    match = pickS2Match(body.data ?? [], paper.title);
  }
  if (!match) return null;

  let pdfBytes: ArrayBuffer | null = null;
  const pdfUrl = match.openAccessPdf?.url;
  if (pdfUrl) {
    try {
      const pdfRes = await fetchWithRetry(pdfUrl, undefined, opts);
      if (pdfRes.ok) pdfBytes = await pdfRes.arrayBuffer();
    } catch {
      // Host outside the allowlist or a flaky mirror: abstract-only.
    }
  }
  return {
    arxivId: match.externalIds?.ArXiv ?? null,
    abstract: match.abstract ?? "",
    pdfBytes,
  };
}
