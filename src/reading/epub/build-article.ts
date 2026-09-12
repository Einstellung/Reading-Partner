// Building an EPUB out of a web article (docs/67). A page that came off the
// network is read the way a book is read, and the way that is arranged is to
// make it a book: one spine document, a navigation document, the images packed
// beside them, `library/<hash>.epub`. From that moment the reader, the
// pagination, the CFIs, the marks and the prep have nothing new to learn.
//
// Two properties are load-bearing, and both are about the page numbers.
//
// Nothing remote survives. Two devices have to lay the same text out on the
// same sheets (docs/64), and a remote image's size depends on the network and
// the cache, so a document that reaches for one paginates differently offline.
// Every <img> either points at an entry of this archive or has become a
// placeholder of a fixed height. The sanitizer is what enforces the rest —
// script, iframes, remote stylesheets, url() reaching out of the archive — and
// it runs here at build time, so what is written is already the tree the reader
// will be handed rather than something checked again on every open.
//
// The bytes are a function of the input. importBook hashes the file to decide
// whether it already holds this book, so building the same article twice has to
// produce the same file, or the shelf grows a second copy of it and the sync
// carries two. Zip entries therefore go in in a fixed order with a fixed
// timestamp, and everything derived — the image names, the publication
// identifier — is derived from content and not from the clock.

import { strToU8, zipSync, type Zippable } from "fflate";
import { contentHash } from "../../platform/app/content-hash";
import { sanitizeDocument } from "./sanitize";

export interface ArticleImage {
  /** The reference as it appears in the article's HTML, matched verbatim. */
  src: string;
  bytes: Uint8Array;
  /** The media type the fetch reported; a type not packable is a placeholder. */
  mediaType: string;
}

export interface ArticleEpubInput {
  title: string;
  byline?: string;
  sourceUrl: string;
  /** ISO date or datetime, as the page declared it. */
  publishedAt?: string;
  /** Body HTML, as extractReadable produced it: an article body, not a page. */
  html: string;
  /**
   * The images the caller managed to fetch. One that failed to download is
   * simply absent, and the <img> that pointed at it becomes a placeholder.
   */
  images: readonly ArticleImage[];
  /** BCP 47 language tag; "en" when the caller has nothing better. */
  language?: string;
}

/** Archive layout. The spine document's images resolve one level up. */
const ARTICLE_ENTRY = "text/article.xhtml";
const NAV_ENTRY = "nav.xhtml";
const OPF_ENTRY = "package.opf";
const IMAGE_DIR = "images";

/**
 * The height a missing image leaves behind. A fixed number of pixels, not a
 * share of anything: the block has to occupy the same space on every device,
 * because it is part of what the pagination measured.
 */
export const MISSING_IMAGE_HEIGHT = 240;

// What can go in the archive, and the extension each type is written with. A
// type that is not here — SVG above all, which is markup and can carry script —
// is not packed, and the <img> that wanted it gets a placeholder.
const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
};

// The instant every entry in the archive is stamped with. Built from local
// calendar fields on purpose: a zip stores the DOS date, fflate writes it from
// the Date's local getters, so a fixed number of milliseconds would be written
// as different bytes in two time zones and the same article would hash to two
// books. Local noon on a day no zone shifts renders to the same bytes
// everywhere.
const FIXED_MTIME = new Date(2001, 0, 1, 12, 0, 0).getTime();

// dcterms:modified is required of an EPUB 3 package document, and this is a
// constant for the same reason the timestamps above are: the file may not
// depend on when it was built.
const FIXED_MODIFIED = "2001-01-01T00:00:00Z";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// --- images -----------------------------------------------------------------

interface PackedImages {
  /** Article-relative href, by the src the HTML spelled. */
  hrefBySrc: Map<string, string>;
  /** Archive entry -> bytes, in name order. */
  entries: Map<string, Uint8Array>;
  /** Archive entry -> media type, for the manifest. */
  typeByEntry: Map<string, string>;
}

/**
 * Name every packable image after its content and drop the rest. Two <img>
 * elements pointing at the same bytes — the same picture served from two URLs —
 * become one entry, which is the whole point of hashing the content.
 */
async function packImages(images: readonly ArticleImage[]): Promise<PackedImages> {
  const packed: PackedImages = {
    hrefBySrc: new Map(),
    entries: new Map(),
    typeByEntry: new Map(),
  };
  for (const image of images) {
    const mediaType = image.mediaType.split(";")[0].trim().toLowerCase();
    const ext = IMAGE_EXTENSIONS[mediaType];
    if (!ext || image.bytes.length === 0) continue;
    const hash = await contentHash(image.bytes);
    const entry = `${IMAGE_DIR}/${hash}.${ext}`;
    packed.entries.set(entry, image.bytes);
    packed.typeByEntry.set(entry, mediaType);
    // The spine document sits one directory down, so it reaches up to them.
    packed.hrefBySrc.set(image.src, `../${entry}`);
  }
  return packed;
}

// --- the body ---------------------------------------------------------------

interface Heading {
  id: string;
  title: string;
  /** Nesting depth, 0 for the top level, with no gaps. */
  depth: number;
}

// Attributes that fetch. A remote value in any of them is removed rather than
// rewritten: there is nothing in the archive it could mean. An <a href> is left
// alone — a link is somewhere to go when the reader taps it, not something the
// page loads, so it costs the pagination nothing and losing it would lose where
// the article's citations point.
const FETCHING_ATTRS = ["src", "srcset", "href", "poster", "background", "data", "lowsrc"];

function isRemote(value: string): boolean {
  // The characters a parser strips out of a URL come off first, so a scheme
  // spelled with a tab or a newline in it is still recognised.
  const v = value.replace(/[\u0000-\u0020]/g, "");
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || v.startsWith("//");
}

function stripRemoteRefs(root: Element): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (el.localName.toLowerCase() === "a") continue;
    for (const attr of Array.from(el.attributes)) {
      const name = attr.localName.toLowerCase();
      if (!FETCHING_ATTRS.includes(name)) continue;
      if (name === "srcset" || isRemote(attr.value)) el.removeAttribute(attr.name);
    }
  }
}

function placeholderFor(doc: Document, img: Element): Element {
  const div = doc.createElement("div");
  div.setAttribute("class", "rp-missing-image");
  div.setAttribute("style", `height: ${MISSING_IMAGE_HEIGHT}px`);
  const alt = collapse(img.getAttribute("alt") ?? "");
  if (alt !== "") div.textContent = alt;
  return div;
}

/**
 * Point every <img> at an entry of the archive or replace it with a block of
 * the same height. Done before the sanitizer runs, so what the sanitizer sees
 * is already free of the network.
 */
function rewriteImages(doc: Document, packed: PackedImages): void {
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    const src = img.getAttribute("src") ?? "";
    const href = packed.hrefBySrc.get(src);
    if (href === undefined) {
      img.replaceWith(placeholderFor(doc, img));
      continue;
    }
    img.setAttribute("src", href);
    // A width or height the page declared was about the page's column, not
    // about our sheet, and a stale pair distorts the picture.
    img.removeAttribute("width");
    img.removeAttribute("height");
  }
}

const NCNAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/**
 * The outline: h1 to h3 in document order, each with an id a nav link can point
 * at. An id the article already carries is kept when it is usable and unique,
 * so a link inside the body to a section still lands; anything else is named
 * here.
 */
function collectHeadings(root: Element): Heading[] {
  const seen = new Set<string>();
  for (const el of Array.from(root.querySelectorAll("[id]"))) {
    const id = el.getAttribute("id") ?? "";
    if (id !== "") seen.add(id);
  }
  const found: Array<{ level: number; id: string; title: string }> = [];
  // Ids already spoken for by an earlier heading. An article that repeats one
  // would otherwise send two nav entries to the same place.
  const claimed = new Set<string>();
  const elements = Array.from(root.querySelectorAll("h1, h2, h3"));
  elements.forEach((el, index) => {
    const title = collapse(el.textContent ?? "");
    if (title === "") return;
    let id = el.getAttribute("id") ?? "";
    if (!NCNAME.test(id) || claimed.has(id)) {
      id = `rp-h${index + 1}`;
      while (seen.has(id)) id = `${id}x`;
      el.setAttribute("id", id);
    }
    seen.add(id);
    claimed.add(id);
    found.push({ level: Number(el.localName.slice(1)), id, title });
  });
  // Depths are relative: an article whose sections are h2 under an h1 title and
  // one whose sections are h3 produce the same two-level list.
  const open: number[] = [];
  return found.map((h) => {
    while (open.length > 0 && open[open.length - 1] >= h.level) open.pop();
    const depth = open.length;
    open.push(h.level);
    return { id: h.id, title: h.title, depth };
  });
}

// The header of the spine document: what the article is, and where it came
// from. Built as elements rather than as markup, so a title with an angle
// bracket in it is escaped by the serializer and not by this file. The source
// URL is written as text and not only as a link, because a page read offline
// still has to say where its words came from; as text it also references
// nothing.
function prependHeader(doc: Document, body: Element, input: ArticleEpubInput): void {
  const header = doc.createElement("header");
  header.setAttribute("class", "rp-header");
  const line = (tag: string, className: string, text: string): Element => {
    const el = doc.createElement(tag);
    el.setAttribute("class", className);
    el.textContent = text;
    header.appendChild(el);
    return el;
  };
  // The title is an h1, so the outline's first entry is the article itself.
  line("h1", "rp-title", collapse(input.title) || "Untitled");
  const byline = collapse(input.byline ?? "");
  if (byline !== "") line("p", "rp-byline", byline);
  const published = collapse(input.publishedAt ?? "");
  if (published !== "") {
    const p = line("p", "rp-published", "");
    const time = doc.createElement("time");
    time.setAttribute("datetime", published);
    time.textContent = /^\d{4}-\d{2}-\d{2}T/.test(published) ? published.slice(0, 10) : published;
    p.appendChild(time);
  }
  line("p", "rp-source", collapse(input.sourceUrl));
  body.insertBefore(header, body.firstChild);
}

// The article's own sheet of CSS. Deliberately almost nothing: the page card
// already sets the type (docs/64), and what a header and a missing picture need
// on top of that is a little space and one visible edge.
const ARTICLE_CSS = [
  ".rp-header { margin-bottom: 2em; }",
  ".rp-byline, .rp-published, .rp-source { margin: 0.25em 0; font-size: 0.85em; }",
  ".rp-source { word-break: break-all; }",
  ".rp-missing-image { margin: 1em 0; border: 1px solid #b9b2a6; background: #f0ece4; }",
].join("\n");

// --- the archive ------------------------------------------------------------

function navBranch(items: readonly Heading[], start: number, depth: number): {
  html: string;
  next: number;
} {
  let html = "<ol>";
  let i = start;
  while (i < items.length && items[i].depth >= depth) {
    const item = items[i];
    i++;
    let children = "";
    if (i < items.length && items[i].depth > depth) {
      const sub = navBranch(items, i, items[i].depth);
      children = sub.html;
      i = sub.next;
    }
    const href = `${ARTICLE_ENTRY}#${item.id}`;
    html += `<li><a href="${escapeXml(href)}">${escapeXml(item.title)}</a>${children}</li>`;
  }
  return { html: `${html}</ol>`, next: i };
}

function navDocument(headings: readonly Heading[], language: string, title: string): string {
  // A nav with no list at all is not a table of contents; an article with no
  // headings still gets one entry, which is the article.
  const list =
    headings.length > 0
      ? navBranch(headings, 0, headings[0].depth).html
      : `<ol><li><a href="${ARTICLE_ENTRY}">${escapeXml(collapse(title) || "Untitled")}</a></li></ol>`;
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(language)}">
<head><title>Contents</title></head>
<body><nav epub:type="toc" id="toc">${list}</nav></body>
</html>`;
}

function packageDocument(
  input: ArticleEpubInput,
  language: string,
  identifier: string,
  images: PackedImages,
): string {
  const meta = [`<dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>`];
  meta.push(`<dc:title>${escapeXml(collapse(input.title) || "Untitled")}</dc:title>`);
  meta.push(`<dc:language>${escapeXml(language)}</dc:language>`);
  const byline = collapse(input.byline ?? "");
  if (byline !== "") meta.push(`<dc:creator>${escapeXml(byline)}</dc:creator>`);
  const published = collapse(input.publishedAt ?? "");
  if (published !== "") meta.push(`<dc:date>${escapeXml(published)}</dc:date>`);
  meta.push(`<dc:source>${escapeXml(collapse(input.sourceUrl))}</dc:source>`);
  meta.push(`<meta property="dcterms:modified">${FIXED_MODIFIED}</meta>`);

  const manifest = [
    `<item id="nav" href="${NAV_ENTRY}" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="article" href="${ARTICLE_ENTRY}" media-type="application/xhtml+xml"/>`,
  ];
  for (const entry of [...images.entries.keys()].sort()) {
    const id = `img-${entry.slice(IMAGE_DIR.length + 1).replace(/\./g, "-")}`;
    manifest.push(
      `<item id="${id}" href="${entry}" media-type="${images.typeByEntry.get(entry)}"/>`,
    );
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${meta.join("")}</metadata>
  <manifest>${manifest.join("")}</manifest>
  <spine><itemref idref="article"/></spine>
</package>`;
}

const CONTAINER = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${OPF_ENTRY}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

/**
 * The article as an EPUB. Async only because the image names are SHA-256
 * digests and Web Crypto's digest is async; nothing here touches the network,
 * the clock or the disk, and the same input always gives the same bytes.
 *
 * Throws when the markup cannot be sanitized, which is what a missing
 * DOMParser means: an unsanitized article is not something to put on the shelf,
 * and a caller that gets bytes back can trust them the way it trusts a book's.
 */
export async function buildArticleEpub(input: ArticleEpubInput): Promise<Uint8Array> {
  if (typeof DOMParser === "undefined") {
    throw new Error("no DOMParser: an article cannot be built unsanitized");
  }
  const language = collapse(input.language ?? "") || "en";
  const packed = await packImages(input.images);

  // The body comes in as a fragment. Parsing it as a document is what the
  // reader would do to it anyway, and it keeps this side from ever assigning
  // untrusted markup to an innerHTML.
  const parsed = new DOMParser().parseFromString(input.html, "text/html");
  const body = parsed.body;
  if (!body) throw new Error("the article HTML parsed to no body");
  // Images first: their src is the remote URL the caller fetched them by, and
  // it is the key they are matched on, so it has to still be there. What the
  // pass after it removes is every remote reference that is left.
  rewriteImages(parsed, packed);
  stripRemoteRefs(body);
  prependHeader(parsed, body, input);
  const headings = collectHeadings(body);

  const source = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(language)}">
<head><title>${escapeXml(collapse(input.title) || "Untitled")}</title>
<style>${ARTICLE_CSS}</style></head>
<body>${body.innerHTML}</body>
</html>`;
  // The serialization above is HTML, not XHTML — an <img> in it has no closing
  // slash — so the sanitizer reads it with its text/html fallback. What it
  // writes is well-formed XML either way, and that is what goes in the archive.
  const sanitized = sanitizeDocument(source, ARTICLE_ENTRY, (entry) => packed.entries.has(entry));
  if (!sanitized) throw new Error("the article markup could not be sanitized");
  const article = `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n${sanitized.html}`;

  // The publication's identity is its content, like everything else on the
  // shelf: the same article built twice is the same publication, and a new
  // snapshot of a page that changed is a new one.
  const identifier = `urn:rp:article:${await contentHash(strToU8(article))}`;

  const files: Zippable = {};
  // The mimetype entry goes in first and uncompressed, which is what the OCF
  // container wants and what a sniffer reading only the first bytes finds.
  files["mimetype"] = [strToU8("application/epub+zip"), { level: 0, mtime: FIXED_MTIME }];
  const rest: Record<string, Uint8Array> = {
    "META-INF/container.xml": strToU8(CONTAINER),
    [OPF_ENTRY]: strToU8(packageDocument(input, language, identifier, packed)),
    [NAV_ENTRY]: strToU8(navDocument(headings, language, input.title)),
    [ARTICLE_ENTRY]: strToU8(article),
    ...Object.fromEntries(packed.entries),
  };
  // Sorted, so the order of the entries is a property of the article and not of
  // the order the caller happened to hand the images over in.
  for (const name of Object.keys(rest).sort()) {
    files[name] = [rest[name], { level: 6, mtime: FIXED_MTIME }];
  }
  return zipSync(files);
}
