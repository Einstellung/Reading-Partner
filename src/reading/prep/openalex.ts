// OpenAlex tier: title search for the abstract and an open-access PDF, sitting
// between arXiv and Semantic Scholar. OpenAlex is keyless; we use the polite
// pool by putting mailto= on every request (their recommended contact param).
// Modeled on s2.ts: same FetchFn injection, same result shape, PDF download
// best-effort (a host outside the Tauri allowlist degrades to abstract-only).
//
// Two OpenAlex quirks handled here: abstracts arrive as an inverted index
// (word -> positions) and are reconstructed to plain text; arXiv ids are not a
// first-class field but show up as arxiv.org URLs in the locations list.

import { fetchWithRetry, type FetchFn } from "./http";
import { normalizeArxivId } from "./arxiv";
import { pickByTitle } from "./match";

const OPENALEX_BASE = "https://api.openalex.org";
// Project's public contact; hardcoding is officially recommended for the pool.
const MAILTO = "einstellungsu@gmail.com";

// The fields we read back, to keep responses small.
const SELECT = "id,display_name,publication_year,ids,abstract_inverted_index,best_oa_location,open_access,locations";

export function openAlexSearchUrl(title: string): string {
  const filter = `title.search:${encodeURIComponent(title)}`;
  return `${OPENALEX_BASE}/works?filter=${filter}&per-page=5&select=${SELECT}&mailto=${MAILTO}`;
}

interface OaLocation {
  pdf_url?: string | null;
  landing_page_url?: string | null;
}

interface OaWork {
  display_name?: string;
  publication_year?: number | null;
  ids?: Record<string, string> | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  best_oa_location?: OaLocation | null;
  open_access?: { oa_url?: string | null } | null;
  locations?: OaLocation[] | null;
}

export interface OpenAlexResult {
  arxivId: string | null;
  abstract: string;
  pdfBytes: ArrayBuffer | null;
}

// Rebuild plain-text abstract from OpenAlex's inverted index (word -> list of
// positions). A word can repeat at several positions, so we scatter each into
// every slot it names, then read the slots in order. Gaps (rare) collapse away.
export function reconstructAbstract(index: Record<string, number[]> | null | undefined): string {
  if (!index) return "";
  const slots: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const pos of positions) slots[pos] = word;
  }
  return slots.filter((w) => w !== undefined).join(" ");
}

// An arXiv id from the work, if any. OpenAlex has no arxiv field in `ids`, but
// arXiv-hosted copies appear as arxiv.org landing/pdf URLs in the locations.
export function extractArxivId(work: OaWork): string | null {
  const fromIds = work.ids?.arxiv;
  if (fromIds) {
    const id = normalizeArxivId(fromIds);
    if (id) return id;
  }
  const locs: OaLocation[] = [];
  if (work.best_oa_location) locs.push(work.best_oa_location);
  if (work.locations) locs.push(...work.locations);
  for (const loc of locs) {
    for (const url of [loc.landing_page_url, loc.pdf_url]) {
      if (url && /arxiv\.org/i.test(url)) {
        const id = normalizeArxivId(url);
        if (id) return id;
      }
    }
  }
  return null;
}

// Best open-access PDF URL: the OA location's direct pdf_url first, then the
// generic oa_url. Landing pages aren't PDFs so they're not used here.
export function extractPdfUrl(work: OaWork): string | null {
  return work.best_oa_location?.pdf_url ?? work.open_access?.oa_url ?? null;
}

export async function fetchFromOpenAlex(
  paper: { title: string; arxivId: string | null },
  fetchFn?: FetchFn,
): Promise<OpenAlexResult | null> {
  const opts = fetchFn ? { fetchFn } : undefined;

  const res = await fetchWithRetry(openAlexSearchUrl(paper.title), undefined, opts);
  if (!res.ok) return null;
  const body = (await res.json()) as { results?: OaWork[] };
  const match = pickByTitle(body.results ?? [], paper.title, (w) => w.display_name ?? "");
  if (!match) return null;

  let pdfBytes: ArrayBuffer | null = null;
  const pdfUrl = extractPdfUrl(match);
  if (pdfUrl) {
    try {
      const pdfRes = await fetchWithRetry(pdfUrl, undefined, opts);
      if (pdfRes.ok) pdfBytes = await pdfRes.arrayBuffer();
    } catch {
      // Host outside the allowlist or a flaky mirror: abstract-only.
    }
  }
  return {
    arxivId: extractArxivId(match),
    abstract: reconstructAbstract(match.abstract_inverted_index),
    pdfBytes,
  };
}
