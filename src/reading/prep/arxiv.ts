// arXiv export API client. Pure parts (id normalization, query URLs, Atom
// parsing, title matching) are exported for tests; fetchFromArxiv wires them to
// a FetchFn. The Atom parsing is a small regex reader rather than DOMParser so
// it runs in bun tests and the webview alike — arXiv's feed shape is stable and
// we only need five fields per entry.

import { fetchWithRetry, HttpStatusError, interactiveRetry, type FetchFn } from "./http";
import { pickByTitle } from "./match";

export interface ArxivEntry {
  id: string; // normalized, e.g. "2303.12345"
  title: string;
  summary: string;
  authors: string[];
  pdfUrl: string;
  // Submission date as the feed gives it (ISO 8601), or "" when absent. Only the
  // topic search reads it (to show the year); the title lookup ignores it.
  published: string;
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
      published: tagText(entry, "published"),
    });
  }
  return out;
}

export function pickArxivMatch(entries: ArxivEntry[], title: string): ArxivEntry | null {
  return pickByTitle(entries, title, (e) => e.title);
}

// --- topic search (docs/24: what is the latest work on X) ---

// Words that carry no retrieval signal in an `all:` term. Deliberately short:
// only function words and the phrasing a question drags in. Domain words the
// reader might actually mean ("study", "review") are left alone.
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "how", "in", "into", "is", "it",
  "its", "latest", "new", "of", "on", "or", "recent", "that", "the", "their", "there", "to", "was",
  "what", "when", "where", "which", "who", "why", "with",
]);

// Terms at most, so a long question cannot AND itself down to zero hits.
const MAX_TERMS = 6;

// A natural-language query reduced to the terms an `all:` search can use. The
// export API's parser has no notion of a free-text query: a bare string with
// spaces is read as an implicit boolean over undeclared fields and returns
// nonsense, so every term is prefixed and ANDed explicitly.
export function arxivQueryTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s-]+/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, MAX_TERMS);
}

export interface ArxivTopicOptions {
  limit?: number;
  // Only papers submitted in or after this year. Recency is a filter rather than
  // a sort on every library here: sorting by date returns the newest match
  // instead of the best one, and on arXiv `sortBy=submittedDate` does not answer
  // at all (docs/pitfall/72).
  sinceYear?: number | null;
}

// The export API's date field wants a closed range of minute-precision stamps,
// so an open-ended "since" needs an upper bound; 2100 is one no submission will
// reach.
export function arxivTopicSearchUrl(query: string, opts: ArxivTopicOptions = {}): string {
  const terms = arxivQueryTerms(query);
  const clauses = (terms.length ? terms : [query.trim()]).map((t) => `all:${t}`);
  if (opts.sinceYear) {
    clauses.push(`submittedDate:[${opts.sinceYear}01010000 TO 210001010000]`);
  }
  const q = encodeURIComponent(clauses.join(" AND "));
  return `https://export.arxiv.org/api/query?search_query=${q}&max_results=${opts.limit ?? 5}`;
}

// Search arXiv by topic. Returns [] when arXiv has nothing; throws on a bad
// status or exhausted retries (a terminal 429 is a RateLimitError), so the caller
// can report which library did not answer instead of showing an empty result as
// "no such research exists". arXiv's limiter is strict — six requests in a row
// were enough to earn a 429 — so this goes through fetchWithRetry's per-host
// spacing and backoff like every other call here.
export async function searchArxivTopic(
  query: string,
  opts: ArxivTopicOptions = {},
  fetchFn?: FetchFn,
): Promise<ArxivEntry[]> {
  const res = await fetchWithRetry(arxivTopicSearchUrl(query, opts), undefined, interactiveRetry(fetchFn));
  if (!res.ok) throw new HttpStatusError(res.status, "export.arxiv.org");
  return parseArxivAtom(await res.text());
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
  let entry = id ? entries[0] ?? null : pickArxivMatch(entries, paper.title);
  // Titles like "RT-1: Robotics Transformer ..." often carry a subtitle the
  // exact phrase search won't match. Retry once on the pre-colon part; the
  // contains-matching in pickArxivMatch keeps a wrong hit from slipping through.
  if (!entry && !id && paper.title.includes(":")) {
    const head = paper.title.slice(0, paper.title.indexOf(":")).trim();
    if (head) {
      const retry = await fetchWithRetry(arxivTitleSearchUrl(head), undefined, opts);
      if (retry.ok) entry = pickArxivMatch(parseArxivAtom(await retry.text()), paper.title);
    }
  }
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
