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
// The candidate list also needs who wrote it and where it appeared.
const SEARCH_FIELDS = `${FIELDS},authors,venue`;

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
  venue: string | null;
  url: string | null;
  abstract: string;
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

export function parseS2Search(body: unknown): S2Hit[] {
  const papers = (body as { data?: S2Paper[] } | null)?.data ?? [];
  return papers
    .filter((p) => (p.title ?? "").trim().length > 0)
    .map((p) => ({
      title: (p.title ?? "").trim(),
      authors: (p.authors ?? []).map((a) => a.name?.trim() ?? "").filter((n) => n.length > 0),
      year: p.year ?? null,
      doi: p.externalIds?.DOI ?? null,
      arxivId: p.externalIds?.ArXiv ?? null,
      pmid: p.externalIds?.PubMed ?? null,
      venue: p.venue?.trim() || null,
      // The open-access PDF when S2 knows one; otherwise its own landing page,
      // which at least gives the reader somewhere to click.
      url: p.openAccessPdf?.url ?? (p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : null),
      abstract: p.abstract ?? "",
    }));
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
