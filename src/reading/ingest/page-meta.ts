// What a fetched page says about itself beyond its body: who wrote it and when
// it was published (docs/67). The readable extractor answers neither — an
// Extraction is a title and a body — and both fields are what an article's row
// on the shelf shows under its title, so they are read here, out of the page's
// own head.
//
// Regex rather than the DOM on purpose. This runs on the raw page, before the
// extractor has built a Document, and a <meta> tag is one tag with two
// attributes: there is no tree to walk. It also keeps the module pure, so the
// rules below are pinned by tests instead of by a webview.

/** What the page's head says about its own publication. */
export interface PageMeta {
  byline?: string;
  /** ISO 8601 when the page gave something a Date could read; else absent. */
  publishedAt?: string;
}

// How far into the page to look. Everything here lives in <head>, and a page
// whose head is longer than this has other problems.
const HEAD_CHARS = 200_000;

// <meta> names and properties that carry a publication date, best first. The
// first one that parses as a date wins, so a site that writes several gets the
// one it declared most deliberately.
const DATE_KEYS = [
  "article:published_time",
  "og:article:published_time",
  "article:published",
  "datepublished",
  "parsely-pub-date",
  "sailthru.date",
  "pubdate",
  "publishdate",
  "publish-date",
  "date",
  "dc.date.issued",
  "dc.date",
  "dcterms.created",
];

// The same, for the byline. "article:author" sits low because half the web
// fills it with a URL to a profile page, which is not a name.
const AUTHOR_KEYS = [
  "author",
  "parsely-author",
  "byl",
  "article:author",
  "og:article:author",
  "dc.creator",
  "citation_author",
];

// A byline longer than this is a paragraph that landed in a meta tag.
const MAX_BYLINE = 120;

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&(?:quot|#34|#x22);/gi, '"')
    .replace(/&(?:apos|#39|#x27);/gi, "'")
    .replace(/&(?:lt|#60);/gi, "<")
    .replace(/&(?:gt|#62);/gi, ">")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(?:amp|#38);/gi, "&");
}

function collapse(s: string): string {
  return decodeBasicEntities(s).replace(/\s+/g, " ").trim();
}

const META_TAG = /<meta\b[^>]*>/gi;
const ATTR = /\b([a-z0-9:_.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/**
 * Every <meta> tag's key and content, keyed by a lower-cased name/property.
 * A key that appears twice keeps its first value, which is the one a page that
 * repeats itself meant.
 */
export function metaTags(html: string): Map<string, string> {
  const head = html.slice(0, HEAD_CHARS);
  const out = new Map<string, string>();
  for (const tag of head.match(META_TAG) ?? []) {
    let key = "";
    let content = "";
    ATTR.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ATTR.exec(tag)) !== null) {
      const name = m[1].toLowerCase();
      const value = m[2] ?? m[3] ?? m[4] ?? "";
      if (name === "name" || name === "property" || name === "itemprop") {
        if (key === "") key = collapse(value).toLowerCase();
      } else if (name === "content") {
        content = collapse(value);
      }
    }
    if (key !== "" && content !== "" && !out.has(key)) out.set(key, content);
  }
  return out;
}

/**
 * A publication date, as ISO 8601, or undefined.
 *
 * A value that already starts with an ISO date is kept verbatim rather than
 * re-rendered: the shelf cuts the date off the front of it (article-row.ts), so
 * a piece published late in the evening must not be moved onto the next day by
 * a timezone on the way through. Anything else has to be a date a Date can read
 * and is normalized; a number, a word or a stray year alone is not a date.
 */
export function normalizeDate(raw: string): string | undefined {
  const value = raw.trim();
  if (value === "") return undefined;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value;
  // A bare year or a unix timestamp reads as a valid Date in some engines and
  // says nothing useful, so a date has to carry at least a day.
  if (!/\d{1,4}[-/.\s]\d{1,2}[-/.\s]\d{1,4}|\d{1,2}\s+\w{3,}\s+\d{4}|\w{3,}\s+\d{1,2},?\s+\d{4}/.test(value)) {
    return undefined;
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return undefined;
  return at.toISOString();
}

function isUrlish(s: string): boolean {
  return /^(?:https?:)?\/\//i.test(s) || /^www\./i.test(s);
}

function cleanByline(raw: string): string | undefined {
  const value = collapse(raw);
  if (value === "" || value.length > MAX_BYLINE || isUrlish(value)) return undefined;
  return value;
}

// The JSON-LD blocks, searched as text. Parsing them properly means walking
// @graph arrays and three shapes of author, and the two fields wanted here are
// spelled the same in all of them.
const LD_DATE = /"datePublished"\s*:\s*"([^"]{4,64})"/i;
const LD_AUTHOR_OBJECT = /"author"\s*:\s*(?:\[\s*)?\{[^{}]*?"name"\s*:\s*"([^"]{1,200})"/i;
const LD_AUTHOR_STRING = /"author"\s*:\s*"([^"]{1,200})"/i;

/** Who wrote the page and when, as the page's own head declares it. */
export function readPageMeta(html: string): PageMeta {
  const tags = metaTags(html);
  const meta: PageMeta = {};

  for (const key of DATE_KEYS) {
    const iso = normalizeDate(tags.get(key) ?? "");
    if (iso !== undefined) {
      meta.publishedAt = iso;
      break;
    }
  }
  if (meta.publishedAt === undefined) {
    const ld = LD_DATE.exec(html.slice(0, HEAD_CHARS));
    const iso = ld ? normalizeDate(decodeBasicEntities(ld[1])) : undefined;
    if (iso !== undefined) meta.publishedAt = iso;
  }

  for (const key of AUTHOR_KEYS) {
    const byline = cleanByline(tags.get(key) ?? "");
    if (byline !== undefined) {
      meta.byline = byline;
      break;
    }
  }
  if (meta.byline === undefined) {
    const head = html.slice(0, HEAD_CHARS);
    const ld = LD_AUTHOR_OBJECT.exec(head) ?? LD_AUTHOR_STRING.exec(head);
    const byline = ld ? cleanByline(decodeBasicEntities(ld[1])) : undefined;
    if (byline !== undefined) meta.byline = byline;
  }
  return meta;
}

// The document language, for the EPUB's metadata: what the reader's own <html
// lang> declared, or undefined when it declared nothing usable. It reaches the
// pagination through the spine document, so a Chinese page must not be built as
// an English one.
const HTML_LANG = /<html\b[^>]*\blang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

export function pageLanguage(html: string): string | undefined {
  const m = HTML_LANG.exec(html.slice(0, HEAD_CHARS));
  const raw = (m?.[1] ?? m?.[2] ?? m?.[3] ?? "").trim();
  return /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(raw) ? raw : undefined;
}

// --- the images the body asks for -------------------------------------------

const IMG_TAG = /<img\b[^>]*>/gi;
const SRC_ATTR = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i;

/**
 * Every `<img src>` in the extracted body, in document order, deduplicated and
 * with the string kept exactly as the HTML spelled it: buildArticleEpub matches
 * its image list against that string, so a src that is normalized on the way
 * through is a src that will not be found again (docs/67).
 *
 * Relative values are resolved against the page, which is a guard rather than a
 * common case — the extractor's sanitizer already drops a src it cannot make
 * absolute — and an unresolvable one is left as it came so the caller can skip
 * it and leave a placeholder.
 */
export function collectImageSrcs(html: string, pageUrl: string): { src: string; url: string }[] {
  const out: { src: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const tag of html.match(IMG_TAG) ?? []) {
    const m = SRC_ATTR.exec(tag);
    if (!m) continue;
    const src = decodeBasicEntities((m[1] ?? m[2] ?? m[3] ?? "").trim());
    if (src === "" || seen.has(src)) continue;
    seen.add(src);
    out.push({ src, url: resolveAgainst(src, pageUrl) });
  }
  return out;
}

function resolveAgainst(src: string, pageUrl: string): string {
  if (/^data:/i.test(src)) return src;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return src;
  }
}

const DATA_IMAGE = /^data:(image\/[a-z0-9.+-]+)\s*;\s*base64\s*,\s*([A-Za-z0-9+/=\s]+)$/i;

/**
 * The bytes of an inline `data:` image, or null. These are the only images that
 * need no network, and an article that inlines its pictures would otherwise put
 * a placeholder where each one was.
 */
export function decodeDataImage(src: string): { bytes: Uint8Array; mediaType: string } | null {
  const m = DATA_IMAGE.exec(src.trim());
  if (!m) return null;
  try {
    const binary = atob(m[2].replace(/\s+/g, ""));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.length === 0 ? null : { bytes, mediaType: m[1].toLowerCase() };
  } catch {
    return null;
  }
}

// --- naming the document ----------------------------------------------------

// Characters that cannot go in the name half of a stored reference: the two
// separators basename() splits on, plus the colon and the C0 controls, which
// Windows and iOS both refuse. Each run becomes one space.
const UNSAFE_NAME = /[/\\:\u0000-\u001f\u007f]+/g;
// Trailing dots and spaces, which some hosts cannot represent at all.
const NAME_EDGE = /^[\s.]+|[\s.]+$/g;
const MAX_NAME = 120;

/**
 * The file name an ingested article is listed under. FileRef.name is the
 * basename of its path and the shelf's row title is derived from it
 * (shelf/file-title.ts), so this is what the reader sees — the article's own
 * title, made safe to sit in a path, with a stem from the URL as the fallback
 * for a page that gave no title at all.
 */
export function articleFileName(title: string, slugBase: string, extension = "epub"): string {
  const cleaned = collapse(title)
    .replace(UNSAFE_NAME, " ")
    .replace(/\s{2,}/g, " ")
    .replace(NAME_EDGE, "")
    .slice(0, MAX_NAME)
    .replace(NAME_EDGE, "");
  const stem =
    cleaned ||
    collapse(slugBase).replace(UNSAFE_NAME, " ").replace(NAME_EDGE, "").slice(0, MAX_NAME) ||
    "article";
  return `${stem}.${extension}`;
}
