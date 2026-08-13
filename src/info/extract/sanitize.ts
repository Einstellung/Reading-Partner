// Article-HTML sanitizer for the info article view (docs/16) and for every
// stored body on its way to dangerouslySetInnerHTML. The input is a third-party
// news page's body, or a record that arrived over the sync folder: keep the
// readable formatting, let nothing else through.
//
// It parses with the webview's own DOMParser and walks the tree, keeping only
// what an allowlist names — elements, attributes per element, URL schemes. The
// dangerous set is not enumerable (an inline handler can be written six ways, a
// scheme can be spelled with entities and control characters, a tag can hide a
// ">" inside a quoted value); the readable set is. Anything unnamed is dropped,
// and every tag that survives is written out from the parsed name and values
// rather than copied from the source text, so what the renderer re-parses is
// exactly what was checked.
//
// It used to be regexes over the source text. Two bypasses killed that design:
// `[^>]*>` ends a tag at the first ">", which a real tokenizer does not do
// inside a quoted value (`<marquee title="a>" onstart=...>` kept its handler),
// and removing an attribute by replacing it with "" fused its neighbours into a
// handler that was not in the input (`<p on class="x"click=alert(1)>`).
//
// Without a DOMParser there is no sanitizer, so it returns "": a blank body,
// never an unchecked one. Every caller runs in the webview, which has one; the
// tests hand bun a DOMParser (tests/dom.ts) so they exercise this code rather
// than a second implementation of it.
//
// The text helpers below (htmlToText, stripTagsToText, decodeEntities,
// stripDataImages) stay string-based and DOM-free: they feed prompts, length
// measurements and a file-size guard, not innerHTML, and their callers
// (info/sources/*, info/extract/read-page.ts, reading/sources/article.ts) run in
// bun tests without a DOM.
//
// Remote images are kept (news pages are mostly images) and left to load
// lazily. They used to be given referrerpolicy="no-referrer". That attribute no
// longer reaches anything: the webview does not fetch these images at all, the
// Rust img: handler does (docs/pitfall/30), and hotlink protection wants the
// article's URL in the Referer rather than nothing at all.

// Everything that may appear in the output: the tags proseCss.ts styles, plus
// the inline semantics a news page uses. An element that is not here loses its
// tag but keeps its children (which face this same list), so a <font> or a
// <custom-card> costs its wrapper and not its text.
const ALLOWED_ELEMENTS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "caption",
  "cite", "code", "col", "colgroup", "dd", "del", "dfn", "div", "dl", "dt", "em", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd",
  "li", "main", "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small",
  "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr",
  "tt", "u", "ul", "var", "wbr",
]);

// Allowed elements with no end tag and no children.
const VOID_ELEMENTS = new Set(["br", "col", "hr", "img", "wbr"]);

// Dropped with everything inside them, because the children are not prose: the
// content belongs to another parser (script, style, svg, math, template, xmp,
// plaintext, title, textarea), or it is a fallback nobody should read on its
// own (iframe, object, embed, video, audio, canvas, noscript, form controls).
// svg and math also carry the namespace escapes — <svg><script>, the
// <svg><foreignObject> re-entry into HTML, the math/mtext mXSS chains — so the
// whole subtree goes rather than being unwrapped into the HTML namespace.
const DROP_WITH_CONTENT = new Set([
  "applet", "audio", "base", "canvas", "embed", "form", "frame", "frameset", "head", "iframe",
  "input", "link", "math", "meta", "noembed", "noframes", "noscript", "object", "optgroup",
  "option", "plaintext", "script", "select", "style", "svg", "template", "textarea", "title",
  "video", "xmp",
]);

// The only attributes carried over from the source that are not URLs: counts,
// written back as digits. Everything else in the output is built here (img's
// src/loading, a's href/target/rel), so no attribute name from the source text
// is ever emitted — which is what makes "on*, in every form it can be written"
// a non-question rather than a pattern to keep up with.
const NUMERIC_ATTRS: Record<string, readonly string[]> = {
  col: ["span"],
  colgroup: ["span"],
  ol: ["start"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
};

// One parsed attribute. Named so it does not shadow the DOM's own Attr.
interface TagAttr {
  name: string;
  value: string;
}

// Text is written back escaped, so no run of characters in a text node can
// become a tag when the renderer parses this string.
function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// An attribute value for a double-quoted slot. "&" is deliberately left alone:
// the value has already passed the scheme test in the form the DOM decoded it,
// a bare "&" can neither end the value nor reach the scheme (which contains
// none), and image-proxy.ts reads this src back out of the source text with a
// regex, so an &amp; here would reach the img: proxy as four literal characters.
function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Strip what a browser strips from a URL before it looks at the scheme: C0
// controls, tab, CR, LF. That is what makes "jav&#x09;ascript:" a javascript:
// URL to the renderer, so the scheme test below has to read the same string.
const URL_NOISE = /[\u0000-\u001f\u007f]/g;
function cleanUrl(value: string): string {
  return value.replace(URL_NOISE, "").trim();
}

// One http(s) URL, or "" when the value is anything else — relative, about:,
// data:, javascript: however it is spelled. Protocol-relative "//host/x" is
// normalized to https. A `srcset` shape ("url 640w, url2 1280w") gives its
// first candidate; any other attribute is taken whole, so a CDN path with a
// comma in it (".../w_800,h_600/a.jpg") survives.
function toHttpUrl(value: string, srcset: boolean): string {
  const cleaned = cleanUrl(value);
  const first = srcset ? (cleaned.split(",")[0]?.trim().split(/\s+/)[0]?.trim() ?? "") : cleaned;
  if (first === "" || /\s/.test(first)) return "";
  const url = first.startsWith("//") ? `https:${first}` : first;
  return /^https?:\/\//i.test(url) ? url : "";
}

// Inline images that are actually images. data:image/svg+xml is markup with its
// own parser and its own script vector, so it is not one of them.
const DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon)[;,]/i;

// Does this URL name a picture? Used only where the attribute name says nothing
// (see imgTag step 3): every URL that gets through becomes an outbound request
// from the device, so an off-list attribute has to earn it with the URL itself —
// a file extension on the path, or a format parameter (mmbiz and other CDNs
// serve extensionless paths with `wx_fmt=jpeg` and the like).
const IMAGE_PATH = /\.(?:jpe?g|png|gif|webp|avif|bmp|ico|tiff?|heic|heif|svg)$/i;
const IMAGE_FORMAT_PARAM = /[?&](?:wx_fmt|format|fmt|f|ext)=(?:jpe?g|png|gif|webp|avif|bmp|heic|heif)\b/i;
function looksLikeImageUrl(url: string): boolean {
  const path = url.split(/[?#]/)[0] ?? "";
  return IMAGE_PATH.test(path) || IMAGE_FORMAT_PARAM.test(url);
}

function buildImg(url: string): string {
  return `<img src="${escapeAttr(url)}" loading="lazy">`;
}

// Lazy-load-agnostic image rewrite. Instead of a hard-coded attribute-name list
// (whack-a-mole across lazy-load libraries), scan every attribute and recover
// the first value that is an http(s) image URL, so mirrored WeChat/mmbiz and any
// lazy page keep their images instead of being blanked out. Priority:
//   1. a real http(s) src wins outright (about:blank / data: / relative fail it);
//   2. any *src*-named attribute (data-src, data-lazy-src, data-srcset, *-src);
//   3. any remaining attribute whose value is an http(s) URL that looks like a
//      picture (covers off-list names like data-echo/data-image). The shape
//      test is the whole point of this step: the src it produces is fetched by
//      the img: proxy, which is the app's only outbound request driven by
//      third-party markup, and an <img> also carries share links, analytics
//      endpoints and canonical URLs. Taking any URL here would turn every one
//      of them into a GET that tells its host the device's IP and the time.
// The tag is rebuilt from that one URL; nothing else on the source <img> (alt,
// class, sizes, srcset, every data-*) is carried over.
function imgTag(attrs: readonly TagAttr[]): string {
  const rawSrc = attrs.find((a) => a.name === "src")?.value ?? "";
  // 1.
  const src = toHttpUrl(rawSrc, false);
  if (src) return buildImg(src);
  // 2.
  for (const a of attrs) {
    if (a.name === "src" || !a.name.includes("src")) continue;
    const u = toHttpUrl(a.value, a.name.includes("srcset"));
    if (u) return buildImg(u);
  }
  // 3.
  for (const a of attrs) {
    if (a.name === "src" || a.name.includes("src")) continue;
    const u = toHttpUrl(a.value, false);
    if (u && looksLikeImageUrl(u)) return buildImg(u);
  }
  // 4. A genuine inline data: image with no http(s) candidate (kept as-is).
  const inline = cleanUrl(rawSrc);
  if (DATA_IMAGE.test(inline)) return buildImg(inline);
  // No usable image (relative/placeholder src, tracking pixel).
  return "";
}

// An anchor keeps its href only when that href is http(s), and always opens
// outside the app. A link to anything else keeps its text and loses its
// destination, which is what platform/app/external-link.ts sees as "no href".
function anchorTag(attrs: readonly TagAttr[]): string {
  const href = attrs.find((a) => a.name === "href")?.value ?? "";
  const cleaned = cleanUrl(href);
  // No protocol-relative promotion here (an <img> is fetched by the proxy, a
  // link is handed to the OS): the href has to say http(s) itself.
  if (!/^https?:\/\//i.test(cleaned)) return "<a>";
  const url = toHttpUrl(href, false);
  if (!url) return "<a>";
  return `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer noopener">`;
}

function openTag(name: string, attrs: readonly TagAttr[]): string {
  const numeric = NUMERIC_ATTRS[name];
  if (!numeric) return `<${name}>`;
  let out = `<${name}`;
  for (const attr of attrs) {
    if (!numeric.includes(attr.name)) continue;
    const digits = attr.value.trim();
    if (/^\d{1,4}$/.test(digits)) out += ` ${attr.name}="${digits}"`;
  }
  return `${out}>`;
}

function attrsOf(el: Element): TagAttr[] {
  const out: TagAttr[] = [];
  const list = el.attributes;
  for (let i = 0; i < list.length; i += 1) {
    const attr = list[i];
    // localName rather than name: an attribute the parser put in a namespace
    // (xlink:href on an SVG element) would otherwise read as "xlink:href" here
    // and as href there. Nothing in a namespace survives the element allowlist,
    // but the value that decides an image URL should not depend on that.
    out.push({ name: attr.localName.toLowerCase(), value: attr.value });
  }
  return out;
}

// The tree walk. Iterative rather than recursive: the input can be a thousand
// levels of nested <div> from a hostile file, and blowing the stack inside
// parseSavedArticles would take the whole saved list down with it. The stack
// holds nodes still to visit and the literal end tags that close them.
function serializeChildren(root: Element): string {
  const out: string[] = [];
  const stack: (Node | string)[] = [];
  pushChildren(stack, root);
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (item.nodeType === 3) {
      out.push(escapeText(item.nodeValue ?? ""));
      continue;
    }
    // Comments, doctypes, processing instructions and anything else: gone.
    if (item.nodeType !== 1) continue;
    const el = item as Element;
    const name = el.localName.toLowerCase();
    if (DROP_WITH_CONTENT.has(name)) continue;
    // <picture> collapses to the one <img> its candidates resolve to. <source>
    // is not an element the output may contain (it would be a second URL for
    // the device to fetch, chosen by rules this file does not model), but a news
    // page that puts the real image only in a <source srcset> would otherwise
    // lose it, so its URLs are candidates for the <img> instead.
    if (name === "picture") {
      out.push(imgTag(pictureAttrs(el)));
      continue;
    }
    if (!ALLOWED_ELEMENTS.has(name)) {
      pushChildren(stack, el);
      continue;
    }
    const attrs = attrsOf(el);
    if (name === "img") {
      out.push(imgTag(attrs));
      continue;
    }
    out.push(name === "a" ? anchorTag(attrs) : openTag(name, attrs));
    if (VOID_ELEMENTS.has(name)) continue;
    stack.push(`</${name}>`);
    pushChildren(stack, el);
  }
  return out.join("");
}

// Every attribute of a <picture>'s <img> and <source> children, the <img>'s
// first so its own src still wins over a candidate list.
function pictureAttrs(el: Element): TagAttr[] {
  const out: TagAttr[] = [];
  for (const tag of ["img", "source"]) {
    const found = el.getElementsByTagName(tag);
    for (let i = 0; i < found.length; i += 1) out.push(...attrsOf(found[i]));
  }
  return out;
}

function pushChildren(stack: (Node | string)[], el: Element): void {
  const kids = el.childNodes;
  for (let i = kids.length - 1; i >= 0; i -= 1) stack.push(kids[i]);
}

export function sanitizeArticleHtml(html: string): string {
  if (html === "") return "";
  if (typeof DOMParser === "undefined") return "";
  try {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
    const body = doc.body;
    if (!body) return "";
    return serializeChildren(body).trim();
  } catch {
    // A parser that threw leaves nothing checked, so nothing renders.
    return "";
  }
}

// Drop every <img> whose src is a data: URL, tag and all. The tag, not just the
// attribute: an <img> with nothing to load is a broken-image icon in the middle
// of the prose. Every path that writes an article body to a file that syncs runs
// this — one inlined image can outweigh the article it illustrates. Two sources
// of those remain: a page that shipped its images inline, and a day cache
// written before the img: proxy (docs/pitfall/30) replaced the base64 inliner.
// External <img> tags are kept: they cost a URL each and render through that
// proxy.
//
// A file-size guard, not a security boundary, and it runs on bodies that
// sanitizeArticleHtml has already rebuilt (or that this device produced), so a
// regex over the tag is enough here.
export function stripDataImages(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    /\ssrc\s*=\s*(?:"\s*data:|'\s*data:|data:)/i.test(tag) ? "" : tag,
  );
}

// Plain text of an HTML fragment, block tags becoming line breaks. Used for an
// item's textContent (triage input, chat context) when a feed hands us HTML.
export function htmlToText(html: string): string {
  let out = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const tag of ["script", "style", "noscript", "svg"]) {
    out = out.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, "gi"), " ");
  }
  out = out
    .replace(/<\/(p|div|section|article|header|figure|figcaption|li|ul|ol|tr|table|blockquote|h[1-6])>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n");
  return stripTagsToText(out);
}

// The tail every fragment-to-text pass ends with: drop what is left of the
// markup, decode entities, collapse each line's inner whitespace and any run of
// blank lines. The caller turns block tags into newlines first, which is where
// the two callers differ — reading/sources/article.ts breaks on <h1>-<h6>
// separately so a heading lands on a line of its own.
export function stripTagsToText(fragment: string): string {
  const text = decodeEntities(fragment.replace(/<[^>]+>/g, " "));
  return text
    .split("\n")
    .map((l) => l.replace(/[ \t\f\v ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}
