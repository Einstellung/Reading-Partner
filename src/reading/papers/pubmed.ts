// PubMed client (NCBI E-utilities), for topic search only — the reader's book is
// about brain evolution and intelligence, and the neuroscience half of that
// literature is in PubMed and nowhere else the other three clients here reach
// (docs/24). 35M biomedical records, free, no key.
//
// Same shape as arxiv.ts / openalex.ts / s2.ts: pure query construction and pure
// response parsing, both exported for tests, wired to an injected FetchFn at the
// bottom. E-utilities needs two calls per search — esearch returns PMIDs only, so
// efetch fills them in. efetch (not esummary) because esummary carries no
// abstract, and a candidate list without abstracts gives the model nothing to
// choose on.
//
// The XML is read with regexes rather than DOMParser, for the reason arxiv.ts
// gives: DOMParser does not exist in bun, and the record shape is stable enough
// that six fields per article need no real parser.

import { fetchWithRetry, HttpStatusError, interactiveRetry, type FetchFn } from "./http";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
// NCBI asks every unauthenticated caller to identify itself with tool= and
// email=; same posture as OpenAlex's mailto.
const IDENTITY = "tool=Reading-Partner&email=einstellungsu%40gmail.com";

export interface PubmedSearchOptions {
  limit?: number;
  // Only papers published in or after this year. A filter rather than a sort:
  // sort=pub_date returns the newest match instead of the best one, and PubMed's
  // mindate/maxdate must be given as a pair, hence the 2100 upper bound.
  sinceYear?: number | null;
}

// esearch: term -> PMIDs. `sort=relevance` is the ranking; note that the more
// obvious `sort=date` is silently ignored ("Unknown sort schema 'date' ignored"
// in warninglist, verified 2026-07-30) — the date value E-utilities accepts is
// `pub_date`.
export function pubmedSearchUrl(query: string, opts: PubmedSearchOptions = {}): string {
  const params = [
    "db=pubmed",
    "retmode=json",
    `retmax=${opts.limit ?? 5}`,
    "sort=relevance",
    `term=${encodeURIComponent(query.trim())}`,
    IDENTITY,
  ];
  if (opts.sinceYear) {
    params.push("datetype=pdat", `mindate=${opts.sinceYear}/01/01`, "maxdate=2100/12/31");
  }
  return `${EUTILS}/esearch.fcgi?${params.join("&")}`;
}

export function parsePubmedIds(body: unknown): string[] {
  const ids = (body as { esearchresult?: { idlist?: unknown } } | null)?.esearchresult?.idlist;
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => String(id)).filter((id) => /^\d+$/.test(id));
}

export function pubmedFetchUrl(ids: string[]): string {
  return `${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(",")}&${IDENTITY}`;
}

export interface PubmedArticle {
  pmid: string;
  title: string;
  abstract: string;
  authors: string[];
  year: number | null;
  journal: string | null;
  doi: string | null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// Inner text of an XML element, tags dropped. Titles and abstracts carry inline
// markup (<i>, <sup>, MathML) that is noise in a candidate list.
function text(xml: string): string {
  return decodeEntities(xml.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function firstTag(xml: string, tag: string): string | null {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1] : null;
}

function allTags(xml: string, tag: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

// A structured abstract arrives as several labelled <AbstractText> sections; they
// are joined in order, each labelled section prefixed with its label.
function abstractOf(article: string): string {
  const block = firstTag(article, "Abstract");
  if (!block) return "";
  const re = /<AbstractText\b([^>]*)>([\s\S]*?)<\/AbstractText>/g;
  const parts: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    const label = /\bLabel="([^"]*)"/.exec(m[1])?.[1];
    const body = text(m[2]);
    if (!body) continue;
    parts.push(label ? `${label}: ${body}` : body);
  }
  return parts.join(" ");
}

// "ForeName LastName", or the collective name for a consortium byline.
function authorsOf(article: string): string[] {
  const list = firstTag(article, "AuthorList");
  if (!list) return [];
  return allTags(list, "Author")
    .map((a) => {
      const collective = firstTag(a, "CollectiveName");
      if (collective) return text(collective);
      const last = text(firstTag(a, "LastName") ?? "");
      const fore = text(firstTag(a, "ForeName") ?? "");
      return [fore, last].filter(Boolean).join(" ");
    })
    .filter((n) => n.length > 0);
}

// The publication year. <PubDate> is either <Year>2026</Year> or a free-text
// <MedlineDate>2026 Dec-Jan</MedlineDate>; the electronic <ArticleDate> is the
// fallback for records that carry no journal issue date yet.
function yearOf(article: string): number | null {
  const sources = [firstTag(article, "PubDate"), firstTag(article, "ArticleDate")];
  for (const src of sources) {
    if (!src) continue;
    const year = firstTag(src, "Year");
    if (year) {
      const n = Number(text(year));
      if (Number.isFinite(n)) return n;
    }
    const medline = firstTag(src, "MedlineDate");
    const loose = medline ? /\d{4}/.exec(text(medline)) : null;
    if (loose) return Number(loose[0]);
  }
  return null;
}

// The DOI sits in <ELocationID EIdType="doi"> on the citation and again in
// <ArticleIdList> on the PubMed record; either will do.
function doiOf(article: string): string | null {
  const eloc = /<ELocationID\b[^>]*EIdType="doi"[^>]*>([\s\S]*?)<\/ELocationID>/.exec(article);
  if (eloc) return text(eloc[1]) || null;
  const id = /<ArticleId\b[^>]*IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/.exec(article);
  return id ? text(id[1]) || null : null;
}

// Parse an efetch response. Articles without a PMID or a title are dropped
// (guards the regex reader); <PubmedBookArticle> records are ignored, since they
// are books rather than papers.
export function parsePubmedArticles(xml: string): PubmedArticle[] {
  const out: PubmedArticle[] = [];
  for (const article of allTags(xml, "PubmedArticle")) {
    // The first PMID in the record is the citation's own; later ones belong to
    // its reference list.
    const pmid = text(firstTag(article, "PMID") ?? "");
    const title = text(firstTag(article, "ArticleTitle") ?? "");
    if (!/^\d+$/.test(pmid) || !title) continue;
    const journal = firstTag(article, "Journal");
    out.push({
      pmid,
      title,
      abstract: abstractOf(article),
      authors: authorsOf(article),
      year: yearOf(article),
      journal: journal ? text(firstTag(journal, "Title") ?? "") || null : null,
      doi: doiOf(article),
    });
  }
  return out;
}

export function pubmedUrl(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

// Search PubMed by topic: esearch for the ids, efetch for the records. Returns []
// when nothing matches; throws on a status it cannot use or on exhausted retries,
// so a silent library outage is never presented as an empty literature.
export async function searchPubmed(
  query: string,
  opts: PubmedSearchOptions = {},
  fetchFn?: FetchFn,
): Promise<PubmedArticle[]> {
  const retry = interactiveRetry(fetchFn);
  const idRes = await fetchWithRetry(pubmedSearchUrl(query, opts), undefined, retry);
  if (!idRes.ok) throw new HttpStatusError(idRes.status, "eutils.ncbi.nlm.nih.gov");
  const ids = parsePubmedIds(await idRes.json());
  if (ids.length === 0) return [];
  const res = await fetchWithRetry(pubmedFetchUrl(ids), undefined, retry);
  if (!res.ok) throw new HttpStatusError(res.status, "eutils.ncbi.nlm.nih.gov");
  return parsePubmedArticles(await res.text());
}
