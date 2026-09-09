// Sanitizing one EPUB spine document. An EPUB may contain JavaScript, and its
// content is served to the app same-origin, so a book's inline script would run
// with the app's own privileges (docs/39 §2). Nothing here trusts the archive.
//
// The shape is the one src/info/extract/sanitize.ts arrived at, adapted to
// XHTML: parse with the platform parser, walk the tree against an allowlist,
// and write the survivors out from the parsed names and values rather than from
// the source text. No regex ever looks at a tag — `[^>]*>` ends a tag at the
// first ">", which a real tokenizer does not do inside a quoted value
// (docs/pitfall/125), so a regex sanitizer passes `<marquee title="a>"
// onstart=...>` through with its handler intact.
//
// Output is also input: sanitize(sanitize(x)) must equal sanitize(x) byte for
// byte (docs/pitfall/126). Two things here exist only for that and cost nothing
// to safety: namespace declarations are written at fixed places with fixed
// prefixes rather than being copied from the source (an XMLSerializer renames
// them to ns1, ns2, … and the numbering moves between passes), and a literal CR
// is written as an entity (docs/pitfall/127).
//
// What that pitfall's other four cases needed — the extra newline after <pre>,
// the re-parse loop around scope boundaries — is not needed here, and the
// reason is worth stating because leaving it out looks like an omission: the
// output is well-formed XML, so the pass that reads it back is the XML parser,
// which has neither the tree builder's scope rules nor its rule about eating
// the newline after a <pre>. The text/html fallback below reads books whose
// markup is not well-formed; what it writes is.
//
// Resource references are recorded, not rewritten. Turning an <img src> into
// something the renderer can load is the rendering line's job; what this side
// owes it is the list of archive entries a document points at.
//
// The book's CSS survives (docs/64): <style> blocks, <link rel="stylesheet">
// and style attributes are kept, each put through css-sanitize.ts, which
// removes what reaches out of the archive or out of the page box. What a page
// card lays over the app's baseline is exactly this tree's CSS.

import { sanitizeCss, sanitizeDeclarations, type CssUrlResolver } from "./css-sanitize";
import { hrefFragment, resolveZipPath } from "./zip";

export const XHTML_NS = "http://www.w3.org/1999/xhtml";
export const SVG_NS = "http://www.w3.org/2000/svg";
export const XLINK_NS = "http://www.w3.org/1999/xlink";
export const EPUB_NS = "http://www.idpf.org/2007/ops";
export const XML_NS = "http://www.w3.org/XML/1998/namespace";

// Everything that may appear in the output. An element that is not here loses
// its tag and keeps its children, so an unknown wrapper costs its tag and not
// its text.
const ALLOWED_ELEMENTS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "body", "br",
  "caption", "cite", "code", "col", "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt",
  "em", "figcaption", "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "head", "header",
  "hgroup", "hr", "html", "i", "img", "ins", "kbd", "li", "link", "main", "mark", "nav", "ol", "p",
  "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small", "span", "strong", "style", "sub",
  "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "title", "tr", "u", "ul",
  "var", "wbr",
]);

// The SVG subset kept, so a book whose figures are <svg><image> keeps them.
// Everything else inside an <svg> is dropped with its content by the rule below,
// which is what closes <svg><script> and the <foreignObject> re-entry into HTML.
const ALLOWED_SVG = new Set(["svg", "image", "g", "title", "desc", "path", "rect", "circle",
  "ellipse", "line", "polyline", "polygon", "text", "tspan", "defs", "use", "symbol"]);

// Dropped with everything inside them. The content belongs to another parser, or
// it is a control, or — button and marquee — it is a tree-builder scope boundary
// whose children would be rearranged by the next parse if the tag were unwrapped
// (docs/pitfall/127).
const DROP_WITH_CONTENT = new Set([
  "applet", "audio", "base", "button", "canvas", "embed", "foreignobject", "form", "frame",
  "frameset", "iframe", "input", "marquee", "meta", "noembed", "noframes", "noscript",
  "object", "optgroup", "option", "plaintext", "script", "select", "template", "textarea",
  "video", "xmp",
]);

// No end tag, no children.
const VOID_ELEMENTS = new Set(["br", "col", "hr", "img", "link", "wbr"]);

// Attributes carried over from the source, per element. Nothing else survives,
// which is what makes "on*, in every form it can be written" a non-question
// rather than a pattern to keep up with: an attribute name that is not on a list
// here is never emitted.
const GLOBAL_ATTRS = new Set(["id", "class", "dir", "lang", "title", "role"]);
const ATTRS: Record<string, readonly string[]> = {
  a: ["href"],
  col: ["span"],
  colgroup: ["span"],
  img: ["src", "alt", "width", "height"],
  ol: ["start", "type"],
  td: ["colspan", "rowspan", "headers"],
  th: ["colspan", "rowspan", "headers", "scope"],
  time: ["datetime"],
  image: ["width", "height", "x", "y"],
  link: ["href", "rel", "type", "media"],
  svg: ["width", "height", "viewBox", "preserveAspectRatio"],
  use: [],
};

// URL-bearing attributes, and the only schemes allowed through them. A relative
// reference (an archive entry) carries no scheme and is what almost every one of
// these is; an absolute http(s) one is kept as text and recorded as external, so
// nothing downstream mistakes it for an entry. Everything else — javascript:,
// data:, vbscript:, file: — is dropped along with its attribute.
const URL_ATTRS = new Set(["href", "src"]);
const SAFE_SCHEMES = new Set(["http:", "https:", "mailto:"]);

// A scheme can be spelled with leading control characters and with entities the
// parser has already decoded, so the test is on the decoded value with the
// characters an HTML/XML parser strips removed.
function schemeOf(raw: string): string | null {
  const value = raw.replace(/[\u0000-\u0020]/g, "");
  const colon = value.indexOf(":");
  if (colon < 0) return null;
  const slash = value.indexOf("/");
  const question = value.indexOf("?");
  const hash = value.indexOf("#");
  // A colon after the first "/", "?" or "#" is inside a path, not a scheme.
  for (const stop of [slash, question, hash]) {
    if (stop >= 0 && stop < colon) return null;
  }
  return value.slice(0, colon + 1).toLowerCase();
}

function urlAllowed(raw: string): boolean {
  const scheme = schemeOf(raw);
  return scheme === null || SAFE_SCHEMES.has(scheme);
}

/**
 * What one document points at, for the rendering line to resolve later. The two
 * archive lists are kept apart because they are resolved differently: a resource
 * has to become something the renderer can load before the page is shown, while
 * a link is followed only when the reader clicks it.
 */
export interface ResourceRefs {
  /** Archive entries loaded with the page: images, stylesheets, fonts. */
  entries: string[];
  /** Archive entries linked to: another chapter, a footnote's document. */
  links: string[];
  /** Absolute http(s) references, which no archive entry can satisfy. */
  external: string[];
}

export interface SanitizedDocument {
  /** The document, ready to serialize or to walk. */
  doc: Document;
  html: string;
  refs: ResourceRefs;
  /** Whether the XHTML parse failed and the text/html fallback was used. */
  fallback: boolean;
}

// --- serialization ----------------------------------------------------------

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // A literal CR in the output is turned into LF by the next parse's input
    // preprocessing, so the same string renders differently on the read after
    // this one (docs/pitfall/127).
    .replace(/\r/g, "&#13;");
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

// --- the walk ---------------------------------------------------------------

interface WalkState {
  out: string[];
  refs: ResourceRefs;
  entrySet: Set<string>;
  linkSet: Set<string>;
  externalSet: Set<string>;
  /** The archive path of the document being sanitized, for resolving hrefs. */
  entryPath: string;
  /** Whether an archive entry exists, when the caller can say. */
  hasEntry: ((entry: string) => boolean) | null;
}

// A url() in the book's CSS is kept when it names an entry of the archive and
// is written back as the book spelled it, so the next pass resolves it the same
// way. Anything with a scheme is out: the sheet may not fetch.
function cssResolver(state: WalkState): CssUrlResolver {
  return (raw) => {
    if (schemeOf(raw) !== null || raw.startsWith("#")) return null;
    const entry = resolveZipPath(state.entryPath, raw);
    if (entry === "" || entry === state.entryPath) return null;
    if (state.hasEntry && !state.hasEntry(entry)) return null;
    recordRef(state, raw, "resource");
    return raw.replace(/[\s"'()]/g, "");
  };
}

function recordRef(state: WalkState, raw: string, kind: "resource" | "link"): void {
  const scheme = schemeOf(raw);
  if (scheme !== null) {
    if (scheme === "http:" || scheme === "https:") {
      if (!state.externalSet.has(raw)) {
        state.externalSet.add(raw);
        state.refs.external.push(raw);
      }
    }
    return;
  }
  if (raw.startsWith("#")) return; // an anchor inside this same document
  const entry = resolveZipPath(state.entryPath, raw);
  if (entry === "" || entry === state.entryPath) return;
  const seen = kind === "resource" ? state.entrySet : state.linkSet;
  if (seen.has(entry)) return;
  seen.add(entry);
  (kind === "resource" ? state.refs.entries : state.refs.links).push(entry);
}

function attrName(attr: Attr): string {
  // epub:type is the only namespaced attribute kept, and it is written with a
  // fixed prefix so the output does not depend on how the source spelled it.
  if (attr.namespaceURI === EPUB_NS) return `epub:${attr.localName}`;
  if (attr.namespaceURI === XLINK_NS) return `xlink:${attr.localName}`;
  if (attr.namespaceURI === XML_NS) return `xml:${attr.localName}`;
  return attr.localName;
}

// Namespaced attributes kept regardless of the element: epub:type carries the
// pagebreak markers the pagination reads, xlink:href the image an <svg><image>
// points at, xml:lang the language of a passage.
function namespacedAllowed(attr: Attr): boolean {
  if (attr.namespaceURI === EPUB_NS) return attr.localName === "type";
  if (attr.namespaceURI === XLINK_NS) return attr.localName === "href";
  if (attr.namespaceURI === XML_NS) return attr.localName === "lang";
  return false;
}

function isAria(name: string): boolean {
  return name.startsWith("aria-");
}

function attrsFor(state: WalkState, el: Element, tag: string): string {
  const kept: Array<[string, string]> = [];
  for (const attr of Array.from(el.attributes)) {
    const name = attrName(attr);
    if (name.startsWith("xmlns")) continue; // written by the emitter, not copied
    if (attr.namespaceURI === null && name === "style") {
      const decls = sanitizeDeclarations(attr.value, { resolveUrl: cssResolver(state) });
      if (decls !== "") kept.push(["style", decls]);
      continue;
    }
    const plain = attr.namespaceURI === null;
    const allowed = plain
      ? GLOBAL_ATTRS.has(name) || isAria(name) || (ATTRS[tag]?.includes(name) ?? false)
      : namespacedAllowed(attr);
    if (!allowed) continue;
    const value = attr.value;
    if (URL_ATTRS.has(attr.localName)) {
      if (!urlAllowed(value)) continue;
      recordRef(state, value, tag === "a" ? "link" : "resource");
    }
    kept.push([name, value]);
  }
  // Sorted, so two spellings of the same element produce the same bytes and the
  // second pass over the output produces those bytes again.
  kept.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return kept.map(([n, v]) => ` ${n}="${escapeAttr(v)}"`).join("");
}

function emitChildren(state: WalkState, node: Node): void {
  for (const child of Array.from(node.childNodes)) emit(state, child);
}

function emit(state: WalkState, node: Node): void {
  if (node.nodeType === 3 /* text */ || node.nodeType === 4 /* cdata */) {
    state.out.push(escapeText(node.nodeValue ?? ""));
    return;
  }
  if (node.nodeType !== 1) return; // comments, PIs and doctypes are dropped
  const el = node as Element;
  const tag = el.localName.toLowerCase();
  if (DROP_WITH_CONTENT.has(tag)) return;
  const svg = el.namespaceURI === SVG_NS;
  // A <style> inside an <svg> belongs to the SVG subset, which does not carry it.
  if (svg && tag === "style") return;
  const allowed = svg ? ALLOWED_SVG.has(tag) : ALLOWED_ELEMENTS.has(tag);
  if (!allowed) {
    emitChildren(state, el);
    return;
  }
  if (tag === "style") {
    const css = sanitizeCss(el.textContent ?? "", { resolveUrl: cssResolver(state) });
    if (css !== "") state.out.push(`<style>${escapeText(css)}</style>`);
    return;
  }
  // A <link> is a stylesheet of the archive or nothing: any other relation
  // (preload, icon, alternate) reaches for something the page does not load.
  if (tag === "link") {
    const rel = (el.getAttribute("rel") ?? "").trim().toLowerCase().split(/\s+/);
    const href = el.getAttribute("href") ?? "";
    if (!rel.includes("stylesheet") || href === "" || schemeOf(href) !== null) return;
  }

  let open = `<${tag}`;
  // Declared on the root whether or not this document uses them, so a prefixed
  // attribute anywhere below is bound and the output parses back as XML.
  if (tag === "html") open += ` xmlns="${XHTML_NS}" xmlns:epub="${EPUB_NS}" xmlns:xlink="${XLINK_NS}"`;
  if (tag === "svg") open += ` xmlns="${SVG_NS}" xmlns:xlink="${XLINK_NS}"`;
  open += attrsFor(state, el, tag);

  if (VOID_ELEMENTS.has(tag)) {
    state.out.push(`${open}/>`);
    return;
  }
  state.out.push(`${open}>`);
  emitChildren(state, el);
  state.out.push(`</${tag}>`);
}

// --- parsing ----------------------------------------------------------------

function parse(source: string): { doc: Document; fallback: boolean } | null {
  if (typeof DOMParser === "undefined") return null;
  const parser = new DOMParser();
  const xml = parser.parseFromString(source, "application/xhtml+xml");
  if (!xml.querySelector("parsererror") && xml.documentElement) {
    return { doc: xml, fallback: false };
  }
  // An EPUB 2 book, or one whose XHTML is not well-formed. The HTML parser
  // never fails, so this is the floor.
  return { doc: parser.parseFromString(source, "text/html"), fallback: true };
}

/**
 * Sanitize one spine document. Returns null when there is no DOMParser: a blank
 * result, never an unchecked one, and the caller decides what a document it
 * cannot read means for the book.
 */
export function sanitizeDocument(
  source: string,
  entryPath: string,
  hasEntry: ((entry: string) => boolean) | null = null,
): SanitizedDocument | null {
  const parsed = parse(source);
  if (!parsed) return null;
  const state: WalkState = {
    out: [],
    refs: { entries: [], links: [], external: [] },
    entrySet: new Set(),
    linkSet: new Set(),
    externalSet: new Set(),
    entryPath,
    hasEntry,
  };
  emit(state, parsed.doc.documentElement);
  const html = state.out.join("");
  // The tree the rest of the pipeline walks is the one built from the output,
  // not the one built from the archive: what the pagination counts, what the
  // figure index points at and what a locator addresses all have to be the same
  // tree the renderer will be handed.
  const reparsed = parse(html);
  if (!reparsed) return null;
  return { doc: reparsed.doc, html, refs: state.refs, fallback: parsed.fallback };
}

/** Sanitize and keep only the serialized output. */
export function sanitize(source: string, entryPath = "index.xhtml"): string {
  return sanitizeDocument(source, entryPath)?.html ?? "";
}

export { hrefFragment };
