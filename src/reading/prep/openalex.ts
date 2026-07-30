// OpenAlex tier: title search for the abstract and an open-access PDF, sitting
// between arXiv and Semantic Scholar. OpenAlex is keyless; we use the polite
// pool by putting mailto= on every request (their recommended contact param).
// Modeled on s2.ts: same FetchFn injection, same result shape, PDF download
// best-effort (a host outside the Tauri allowlist degrades to abstract-only).
//
// Two OpenAlex quirks handled here: abstracts arrive as an inverted index
// (word -> positions) and are reconstructed to plain text; arXiv ids are not a
// first-class field but show up as arxiv.org URLs in the locations list.
//
// The second half of the file is the other direction — a topic search that
// returns candidates for the reading conversation (docs/24). Note the pricing
// change of 2026-02-13: keyless callers get 100 free credits and then 409, so a
// spent quota is reported as a named failure rather than an empty result.

import { fetchWithRetry, HttpStatusError, interactiveRetry, type FetchFn } from "./http";
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
  source?: { display_name?: string | null } | null;
}

interface OaWork {
  display_name?: string;
  publication_year?: number | null;
  doi?: string | null;
  ids?: Record<string, string> | null;
  abstract_inverted_index?: Record<string, number[]> | null;
  best_oa_location?: OaLocation | null;
  open_access?: { oa_url?: string | null } | null;
  locations?: OaLocation[] | null;
  primary_location?: OaLocation | null;
  authorships?: { author?: { display_name?: string | null } | null }[] | null;
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

// --- topic search (docs/24: what is the latest work on X) ---

// Authors and venue join the selection for the candidate list; the title lookup
// keeps its own leaner SELECT, since it only ever wants an abstract and a PDF.
const SEARCH_SELECT = `${SELECT},doi,primary_location,authorships`;

export interface OpenAlexTopicOptions {
  limit?: number;
  sinceYear?: number | null;
}

export interface OpenAlexHit {
  title: string;
  authors: string[];
  year: number | null;
  doi: string | null;
  arxivId: string | null;
  venue: string | null;
  url: string | null;
  abstract: string;
}

// A works search over the whole corpus. `search` is OpenAlex's full-text query;
// recency is a filter, not a sort — `sort=publication_date:desc` answers a
// neuroscience query with whatever was published most recently anywhere (a
// management paper, measured 2026-07-30), because a date sort throws the
// relevance ranking away.
export function openAlexTopicSearchUrl(query: string, opts: OpenAlexTopicOptions = {}): string {
  const params = [
    `search=${encodeURIComponent(query.trim())}`,
    `per-page=${opts.limit ?? 5}`,
    `select=${SEARCH_SELECT}`,
    `mailto=${MAILTO}`,
  ];
  if (opts.sinceYear) params.push(`filter=from_publication_date:${opts.sinceYear}-01-01`);
  return `${OPENALEX_BASE}/works?${params.join("&")}`;
}

function oaAuthors(work: OaWork): string[] {
  return (work.authorships ?? [])
    .map((a) => a.author?.display_name?.trim() ?? "")
    .filter((n) => n.length > 0);
}

function oaVenue(work: OaWork): string | null {
  return work.primary_location?.source?.display_name?.trim() || null;
}

// The best link to hand on: an open-access PDF when there is one, else the
// publisher's landing page, else nothing (the DOI still identifies the paper).
function oaUrl(work: OaWork): string | null {
  return (
    work.best_oa_location?.pdf_url ??
    work.open_access?.oa_url ??
    work.primary_location?.landing_page_url ??
    null
  );
}

export function parseOpenAlexSearch(body: unknown): OpenAlexHit[] {
  const works = (body as { results?: OaWork[] } | null)?.results ?? [];
  return works
    .filter((w) => (w.display_name ?? "").trim().length > 0)
    .map((w) => ({
      title: (w.display_name ?? "").trim(),
      authors: oaAuthors(w),
      year: w.publication_year ?? null,
      doi: w.doi ?? null,
      arxivId: extractArxivId(w),
      venue: oaVenue(w),
      url: oaUrl(w),
      abstract: reconstructAbstract(w.abstract_inverted_index),
    }));
}

// Search OpenAlex by topic. Throws HttpStatusError on a status it cannot use —
// notably 409, which since 2026-02-13 is how OpenAlex says the keyless account's
// 100 free credits are spent and an API key is now required. That has to surface
// as a named failure, not an empty list (docs/24).
export async function searchOpenAlexTopic(
  query: string,
  opts: OpenAlexTopicOptions = {},
  fetchFn?: FetchFn,
): Promise<OpenAlexHit[]> {
  const res = await fetchWithRetry(openAlexTopicSearchUrl(query, opts), undefined, interactiveRetry(fetchFn));
  if (!res.ok) throw new HttpStatusError(res.status, "api.openalex.org");
  return parseOpenAlexSearch(await res.json());
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
