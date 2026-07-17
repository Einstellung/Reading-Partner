// Semantic Scholar Graph API fallback: title search (or arXiv-id lookup) for
// the abstract and an openAccessPdf link. Free tier, shared rate limit —
// fetchWithRetry backs off on 429, and the PDF download is best-effort: the
// open-access URL can point at any host, and inside Tauri only allowlisted
// hosts pass the http plugin scope, so a blocked host degrades to
// abstract-only rather than failing the paper.

import { fetchWithRetry, type FetchFn } from "./http";

const S2_BASE = "https://api.semanticscholar.org/graph/v1";
const FIELDS = "title,abstract,year,openAccessPdf,externalIds";

export function s2SearchUrl(title: string): string {
  return `${S2_BASE}/paper/search?query=${encodeURIComponent(title)}&limit=5&fields=${FIELDS}`;
}

export function s2ArxivUrl(arxivId: string): string {
  return `${S2_BASE}/paper/arXiv:${encodeURIComponent(arxivId)}?fields=${FIELDS}`;
}

interface S2Paper {
  title?: string;
  abstract?: string | null;
  openAccessPdf?: { url?: string } | null;
  externalIds?: { ArXiv?: string } | null;
}

export interface S2Result {
  arxivId: string | null;
  abstract: string;
  pdfBytes: ArrayBuffer | null;
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickS2Match(papers: S2Paper[], title: string): S2Paper | null {
  const want = normalizeTitle(title);
  if (!want) return null;
  for (const p of papers) {
    const got = normalizeTitle(p.title ?? "");
    if (got === want || got.includes(want) || want.includes(got)) return p;
  }
  return null;
}

export async function fetchFromS2(
  paper: { title: string; arxivId: string | null },
  fetchFn?: FetchFn,
): Promise<S2Result | null> {
  const opts = fetchFn ? { fetchFn } : undefined;

  let match: S2Paper | null = null;
  if (paper.arxivId) {
    const res = await fetchWithRetry(s2ArxivUrl(paper.arxivId), undefined, opts);
    if (res.ok) match = (await res.json()) as S2Paper;
  }
  if (!match) {
    const res = await fetchWithRetry(s2SearchUrl(paper.title), undefined, opts);
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
