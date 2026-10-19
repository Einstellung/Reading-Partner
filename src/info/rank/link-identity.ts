// Which document a link names, whatever its spelling (docs/info/88 「看原文」,
// research doc 开源读论文与读资料项目调研 items 5 and 6): a redirect wrapper
// (google.com/url?q=, l.facebook.com/l.php?u=, ...) unwrapped to its target;
// an arXiv paper by any of its mirrors, its Hugging Face page or its own DOI; a
// DOI by its resolver or by a publisher page that carries it in the path; an
// OpenReview, ACL Anthology or IEEE Xplore paper by its id there. Pure; nothing
// is fetched. A short link (goo.gle, bit.ly) says nothing about its target until
// its redirect is read, which isShortLink only recognises.
//
// The tables are our own, written from the sites' URL shapes.

import { arxivPaperOfUrl, normalizeArxivId } from "../sources/plugins/arxiv-client";

/** The paper a link names, as a key: "arxiv:<id>", "doi:<lowercased doi>", "openreview:<id>", "acl:<id>", "ieee:<n>". */
export type PaperKey = `${"arxiv" | "doi" | "openreview" | "acl" | "ieee"}:${string}`;

function parse(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function bareHost(u: URL): string {
  return u.hostname.toLowerCase().replace(/^www\./, "");
}

function decodedPath(u: URL): string {
  try {
    return decodeURIComponent(u.pathname);
  } catch {
    return u.pathname;
  }
}

// --- redirect wrappers ------------------------------------------------------

interface Wrapper {
  host: RegExp;
  path: RegExp;
  /** The query parameters the target may be in, first found wins. */
  params: readonly string[];
}

const WRAPPERS: readonly Wrapper[] = [
  { host: /^(?:www\.)?google\.(?:[a-z]{2,3}|co\.[a-z]{2}|com\.[a-z]{2})$/, path: /^\/url$/, params: ["q", "url"] },
  { host: /^(?:l|lm|m|www)\.facebook\.com$/, path: /^\/l\.php$/, params: ["u"] },
  { host: /^l\.instagram\.com$/, path: /^\/?$/, params: ["u"] },
  { host: /^l\.threads\.(?:net|com)$/, path: /^\/?$/, params: ["u"] },
  { host: /^(?:www\.|m\.)?youtube\.com$/, path: /^\/redirect$/, params: ["q"] },
  { host: /^out\.reddit\.com$/, path: /^\//, params: ["url"] },
  { host: /^(?:www\.)?linkedin\.com$/, path: /^\/(?:redir\/redirect|safety\/go)\/?$/, params: ["url"] },
  { host: /^slack-redir\.net$/, path: /^\/link$/, params: ["url"] },
  { host: /^t\.umblr\.com$/, path: /^\/redirect$/, params: ["z"] },
  { host: /^steamcommunity\.com$/, path: /^\/linkfilter\/?$/, params: ["url", "u"] },
  { host: /\.safelinks\.protection\.outlook\.com$/, path: /^\//, params: ["url"] },
];

/** How many wrappers deep a link is unwrapped. */
const MAX_UNWRAP = 3;

/**
 * The link a redirect wrapper stands for (google.com/url?q=…, l.facebook.com/l.php?u=…,
 * youtube.com/redirect?q=…), unwrapped as deep as it goes; any other link as it is.
 */
export function unwrapLink(raw: string): string {
  let url = raw;
  for (let i = 0; i < MAX_UNWRAP; i++) {
    const u = parse(url);
    if (!u) return url;
    const host = u.hostname.toLowerCase();
    const w = WRAPPERS.find((x) => x.host.test(host) && x.path.test(u.pathname));
    if (!w) return url;
    const target = w.params.map((p) => u.searchParams.get(p)).find((v) => v && parse(v));
    if (!target) return url;
    url = target.trim();
  }
  return url;
}

// Link shorteners whose target only their redirect tells (t.co is read off X's own page first).
const SHORT_HOSTS = new Set([
  "goo.gle",
  "goo.gl",
  "bit.ly",
  "buff.ly",
  "ow.ly",
  "lnkd.in",
  "tinyurl.com",
  "t.ly",
  "is.gd",
  "rb.gy",
  "dlvr.it",
  "shorturl.at",
  "tiny.cc",
  "t.co",
]);

/** Whether a link is a shortener's: where it goes is known only by reading its redirect. */
export function isShortLink(raw: string): boolean {
  const u = parse(raw);
  return !!u && SHORT_HOSTS.has(bareHost(u)) && u.pathname.length > 1;
}

// --- DOIs -------------------------------------------------------------------

const DOI = /^10\.\d{4,9}\/\S+$/;

/** A DOI as a key: lowercased (DOIs are case-insensitive), without the punctuation a sentence leaves after it. */
export function normalizeDoi(raw: string): string | null {
  let doi = raw
    .trim()
    .replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, "")
    .replace(/[.,;/]+$/, "")
    .toLowerCase();
  // A closing bracket is the DOI's own only when the DOI opened one.
  while (/[)\]]$/.test(doi) && (doi.match(/[(\[]/g)?.length ?? 0) < (doi.match(/[)\]]/g)?.length ?? 0)) {
    doi = doi.slice(0, -1).replace(/[.,;/]+$/, "");
  }
  return DOI.test(doi) ? doi : null;
}

/** The arXiv paper an arXiv-issued DOI (10.48550/arXiv.<id>) names, or null for any other DOI. */
export function arxivIdOfDoi(doi: string): string | null {
  const m = /^10\.48550\/arxiv\.(.+)$/i.exec(doi.trim());
  return m ? normalizeArxivId(m[1]) : null;
}

// Publisher pages with the DOI in the path, beyond the common /doi/<doi> shape
// (science.org, dl.acm.org, Wiley, Taylor & Francis, SAGE, PNAS, ...).
const DOI_PAGES: readonly { host: RegExp; doi: (path: string) => string | null }[] = [
  { host: /^(?:dx\.)?doi\.org$/, doi: (p) => p.slice(1) },
  {
    host: /^link\.springer\.com$/,
    doi: (p) => /^\/(?:article|chapter|book|referenceworkentry|protocol|content\/pdf)\/(10\.\d{4,9}\/.+?)(?:\.pdf)?$/.exec(p)?.[1] ?? null,
  },
  { host: /^journals\.aps\.org$/, doi: (p) => /^\/[a-z]+\/(?:abstract|pdf|supplemental)\/(10\.\d{4,9}\/.+)$/.exec(p)?.[1] ?? null },
  {
    host: /^nature\.com$/,
    doi: (p) => {
      const id = /^\/articles\/([a-z0-9][a-z0-9.-]*?)(?:\.pdf)?$/i.exec(p)?.[1];
      return id ? `10.1038/${id}` : null;
    },
  },
  { host: /^(?:bio|med)rxiv\.org$/, doi: (p) => /^\/content\/(?:early\/[\d/]+\/)?(10\.1101\/(?:\d{4}\.\d{2}\.\d{2}\.)?\d+)(?:v\d+)?(?:[./].*)?$/.exec(p)?.[1] ?? null },
  { host: /^frontiersin\.org$/, doi: (p) => /^\/articles?\/(10\.\d{4,9}\/[^/]+)/.exec(p)?.[1] ?? null },
];
const DOI_PATH = /\/doi\/(?:(?:abs|full|pdf|epdf|pdfdirect|pdfplus|fullhtml|reader|book|suppl)\/)?(10\.\d{4,9}\/.+)$/i;

/** The DOI a link names: a doi.org link, a publisher page with the DOI in its path, a ?doi= parameter; else null. */
export function doiOfUrl(raw: string): string | null {
  const u = parse(raw);
  if (!u) return null;
  const host = bareHost(u);
  const path = decodedPath(u);
  for (const page of DOI_PAGES) {
    if (!page.host.test(host)) continue;
    const doi = page.doi(path);
    if (doi) return normalizeDoi(doi);
  }
  const inPath = DOI_PATH.exec(path)?.[1];
  if (inPath) return normalizeDoi(inPath);
  const param = u.searchParams.get("doi");
  return param ? normalizeDoi(param) : null;
}

// --- papers by their site's id ----------------------------------------------

// Pages about one arXiv paper that name it by its id: Hugging Face's paper page
// (hf.co is its short domain), SciRate, papers.cool, Semantic Scholar's arXiv route.
const ARXIV_PAGES: readonly { host: RegExp; path: RegExp }[] = [
  { host: /^(?:huggingface\.co|hf\.co)$/, path: /^\/papers\/([^/]+)/ },
  { host: /^scirate\.com$/, path: /^\/arxiv\/(.+?)\/?$/ },
  { host: /^papers\.cool$/, path: /^\/arxiv\/(.+?)\/?$/ },
  { host: /^semanticscholar\.org$/, path: /^\/arxiv\/(.+?)\/?$/ },
];

const ACL_ID = /^\/(?:anthology\/)?([A-Z]\d{2}-\d{4}|\d{4}\.[a-z0-9-]+\.\d+)(?:\.pdf)?\/?$/i;

/**
 * The paper a link names, as a key, or null when it names none this knows:
 * "arxiv:2505.06708" for arXiv and its mirrors, its Hugging Face page or its own
 * DOI; "doi:10.1038/s41586-024-07421-0" for a DOI link or a publisher page with
 * the DOI in its path; "openreview:<id>", "acl:<id>", "ieee:<n>" for those sites'
 * pages. A redirect wrapper is unwrapped first.
 */
export function paperKeyOfUrl(raw: string): PaperKey | null {
  const url = unwrapLink(raw);
  const arxiv = arxivPaperOfUrl(url);
  if (arxiv) return `arxiv:${arxiv.id}`;
  const u = parse(url);
  if (!u) return null;
  const host = bareHost(u);
  const path = decodedPath(u);
  for (const page of ARXIV_PAGES) {
    const m = page.host.test(host) ? page.path.exec(path) : null;
    const id = m ? normalizeArxivId(m[1]) : null;
    if (id) return `arxiv:${id}`;
  }
  const doi = doiOfUrl(url);
  if (doi) {
    const id = arxivIdOfDoi(doi);
    return id ? `arxiv:${id}` : `doi:${doi}`;
  }
  if (host === "openreview.net" && /^\/(?:forum|pdf|attachment)\/?$/.test(u.pathname)) {
    const id = u.searchParams.get("id");
    if (id && /^[\w-]+$/.test(id)) return `openreview:${id}`;
  }
  if (host === "aclanthology.org" || (host === "aclweb.org" && path.startsWith("/anthology/"))) {
    const m = ACL_ID.exec(path);
    if (m) return `acl:${m[1].toLowerCase()}`;
  }
  if (host === "ieeexplore.ieee.org") {
    const n = /^\/(?:abstract\/)?document\/(\d+)/.exec(path)?.[1] ?? (path === "/stamp/stamp.jsp" ? u.searchParams.get("arnumber") : null);
    if (n && /^\d+$/.test(n)) return `ieee:${n}`;
  }
  return null;
}

/**
 * The arXiv paper a page's head says it is: `citation_arxiv_id`, a citation or
 * og:url link to arXiv, or an arXiv-issued DOI in `citation_doi`/`dc.identifier`.
 * Keys are lower-cased <meta> names (page-meta.ts metaTags).
 */
export function arxivIdOfPageMeta(tags: ReadonlyMap<string, string>): string | null {
  const direct = tags.get("citation_arxiv_id");
  const id = direct ? normalizeArxivId(direct) : null;
  if (id) return id;
  for (const key of ["citation_abstract_html_url", "citation_pdf_url", "citation_fulltext_html_url", "og:url"]) {
    const v = tags.get(key);
    const paper = v ? arxivPaperOfUrl(v) : null;
    if (paper) return paper.id;
  }
  for (const key of ["citation_doi", "dc.identifier"]) {
    const v = tags.get(key);
    if (!v) continue;
    const doi = normalizeDoi(v);
    const fromDoi = doi ? arxivIdOfDoi(doi) : null;
    if (fromDoi) return fromDoi;
    if (/^arxiv:/i.test(v.trim())) {
      const fromId = normalizeArxivId(v);
      if (fromId) return fromId;
    }
  }
  return null;
}
