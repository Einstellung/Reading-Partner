// arXiv export API client. Pure parts (id normalization, query URLs, Atom
// parsing, title matching) are exported for tests; fetchFromArxiv wires them to
// a FetchFn. The Atom parsing is a small regex reader rather than DOMParser so
// it runs in bun tests and the webview alike — arXiv's feed shape is stable and
// we only need five fields per entry.

import { fetchWithRetry, type FetchFn } from "./http";

export interface ArxivEntry {
  id: string; // normalized, e.g. "2303.12345"
  title: string;
  summary: string;
  authors: string[];
  pdfUrl: string;
}

// "arXiv:2303.12345v2" / a full abs URL / bare id -> "2303.12345". Old-style
// ids (cs/0112017) pass through. Null when it doesn't look like an arXiv id.
export function normalizeArxivId(raw: string): string | null {
  let s = raw.trim();
  s = s.replace(/^https?:\/\/(www\.|export\.)?arxiv\.org\/(abs|pdf)\//i, "");
  s = s.replace(/^arxiv:\s*/i, "");
  s = s.replace(/\.pdf$/i, "");
  s = s.replace(/v\d+$/i, "");
  if (/^\d{4}\.\d{4,5}$/.test(s)) return s;
  if (/^[a-z-]+(\.[A-Z]{2})?\/\d{7}$/.test(s)) return s;
  return null;
}

export function arxivIdUrl(id: string): string {
  return `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`;
}

export function arxivTitleSearchUrl(title: string, maxResults = 5): string {
  // The export API's ti: field wants quoted phrases; strip quotes from the
  // title itself so the query stays well-formed.
  const phrase = title.replace(/"/g, " ").replace(/\s+/g, " ").trim();
  const q = encodeURIComponent(`ti:"${phrase}"`);
  return `https://export.arxiv.org/api/query?search_query=${q}&max_results=${maxResults}`;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

function tagText(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
}

// Parse an arXiv Atom feed into entries. Entries whose id doesn't normalize are
// dropped (never seen in practice; guards the regex reader).
export function parseArxivAtom(xml: string): ArxivEntry[] {
  const out: ArxivEntry[] = [];
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml))) {
    const entry = m[1];
    const rawId = tagText(entry, "id"); // e.g. http://arxiv.org/abs/2303.12345v2
    const id = normalizeArxivId(rawId);
    if (!id) continue;
    const authors: string[] = [];
    const authorRe = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
    let a: RegExpExecArray | null;
    while ((a = authorRe.exec(entry))) authors.push(decodeEntities(a[1]).trim());
    out.push({
      id,
      title: tagText(entry, "title"),
      summary: tagText(entry, "summary"),
      authors,
      pdfUrl: `https://arxiv.org/pdf/${id}`,
    });
  }
  return out;
}

function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// The entry whose title matches (normalized equality, or one contains the
// other for subtitle drift). Null when no entry is close enough — a wrong
// paper is worse than no paper.
export function pickArxivMatch(entries: ArxivEntry[], title: string): ArxivEntry | null {
  const want = normalizeTitle(title);
  if (!want) return null;
  for (const e of entries) {
    const got = normalizeTitle(e.title);
    if (got === want || got.includes(want) || want.includes(got)) return e;
  }
  return null;
}

export interface ArxivResult {
  arxivId: string;
  abstract: string;
  pdfBytes: ArrayBuffer | null;
}

// Look a paper up on arXiv (by id when known, else title search) and download
// its PDF. Returns null when arXiv doesn't have it; throws only on repeated
// network failure (fetchWithRetry exhausted).
export async function fetchFromArxiv(
  paper: { title: string; arxivId: string | null },
  fetchFn?: FetchFn,
): Promise<ArxivResult | null> {
  const opts = fetchFn ? { fetchFn } : undefined;
  const id = paper.arxivId ? normalizeArxivId(paper.arxivId) : null;
  const url = id ? arxivIdUrl(id) : arxivTitleSearchUrl(paper.title);
  const res = await fetchWithRetry(url, undefined, opts);
  if (!res.ok) return null;
  const entries = parseArxivAtom(await res.text());
  const entry = id ? entries[0] ?? null : pickArxivMatch(entries, paper.title);
  if (!entry) return null;

  let pdfBytes: ArrayBuffer | null = null;
  try {
    const pdfRes = await fetchWithRetry(entry.pdfUrl, undefined, opts);
    if (pdfRes.ok) pdfBytes = await pdfRes.arrayBuffer();
  } catch {
    // Metadata without the PDF still yields an abstract-only note.
  }
  return { arxivId: entry.id, abstract: entry.summary, pdfBytes };
}
