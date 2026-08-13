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
// It runs on the way in and again on every read, so its output is also its
// input: sanitize(sanitize(x)) has to be sanitize(x) byte for byte, or a stored
// record renders differently depending on how many times it has been read. Safe
// twice is a weaker property and it is not the one to test for. Three things
// here exist only for that property and cost nothing to safety: the CR escape
// in escapeText, the leading newline in padPre, and the AUTO_CLOSES table with
// the extra parse it can ask for. What each of them is compensating for is in
// docs/pitfall/127; none of it was reasoned out, the fuzzer found all of it.
//
// Without a DOMParser there is no sanitizer, so it returns "": a blank body,
// never an unchecked one. Every caller runs in the webview, which has one; the
// tests hand bun a DOMParser (tests/support/dom-parser.ts) so they exercise
// this code rather than a second implementation of it.
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
//
// button and marquee are here for a second reason, and it is the reason this
// list may not shrink: they are scope boundaries in the tree builder. A <p> or
// an <li> nested inside one does not close the <p> or <li> outside it, so the
// parse of `<p>a<button><p>b</p></button></p>` really is a <p> inside a <p> —
// a shape no parse produces without the boundary. Unwrapping the boundary and
// keeping the children writes that shape out, and the next parse takes it
// apart into two siblings. The stored record then renders one way on the read
// that saved it and another way on the read after that. AUTO_CLOSES below is
// the general case; these two are here because dropping them is the better
// answer for what they are, not only the stable one.
const DROP_WITH_CONTENT = new Set([
  "applet", "audio", "base", "button", "canvas", "embed", "form", "frame", "frameset", "head",
  "iframe", "input", "link", "marquee", "math", "meta", "noembed", "noframes", "noscript",
  "object", "optgroup", "option", "plaintext", "script", "select", "style", "svg", "template",
  "textarea", "title", "video", "xmp",
]);

// Every scope boundary the tree builder has, and where each one goes. This is
// the whole list of elements that can hold a shape a re-parse would rearrange,
// so none of them may fall through to the unwrap path; the rest of the tag
// space is ordinary and unwraps without moving anything.
//
//   applet object select template   dropped with content
//   button marquee                  dropped with content (see above)
//   caption table td th             allowed, so the shape is kept, not moved
//   ol ul                           allowed (these two bound list-item scope)
//   html body                       cannot occur: a start tag for either one
//                                   inside the body merges its attributes onto
//                                   the element already open and creates no
//                                   node, so neither is ever a child of body
//
// tests/info/sanitize.test.ts walks that list and puts the two shapes that
// catch an unwrapped boundary through the sanitizer twice. AUTO_CLOSES below
// keeps a boundary that lands in neither set stable anyway, at the price of a
// second parse; what this list decides is what the reader is left with, which
// for a form control and a scrolling banner is nothing.

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

// What each allowed element's start tag ends, when the tree builder meets it
// with that element still open. A <li> ends the <li> before it, a second <h2>
// ends the first, any block ends an open <p>, a <td> ends the cell beside it,
// and <rt>/<rp> end a list or paragraph item through the spec's implied end
// tags. Writing one of these inside the element it would end is a position the
// next parse will not agree with — it splits the two into siblings — so a pass
// that wrote one is not the answer on its own.
//
// The tree really can hold that position, which is why this is not a question
// the two element lists above can answer. Three ways in, all of them found by
// the fuzzer rather than reasoned out:
//
//   <p>a<button><p>b</p></button></p>   a scope boundary: <p> does not end <p>
//   <h1>a<em-x><h1>b</h1></em-x></h1>   any element at all, for the h1-h6 rule
//   <li>a<table><li>b</li></table>      foster parenting lifts the inner <li>
//                                       out of the table and drops it beside it
//
// The first two reach the output when the element in the middle is unwrapped;
// the third needs no unwrapping at all, and no edit to either element list
// would have stopped it.
//
// Modelling which of the tree builder's dozen closing rules fires where is
// re-implementing the tree builder, which is what this file was rewritten to
// stop doing. So it does not model the outcome. It notices the position and
// asks the parser again (see sanitizeArticleHtml). Naming one relation too many
// costs one extra parse of one body; missing one costs the property, so this
// table errs long and the barrier list below errs short.
const PARAGRAPH = ["p"];
const HEADING = ["h1", "h2", "h3", "h4", "h5", "h6", "p"];
const RUBY_ITEM = ["dd", "dt", "li", "p", "rp", "rt"];
const CELL = ["td", "th"];
const TABLE_PART = ["caption", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"];
const AUTO_CLOSES: Record<string, readonly string[]> = {
  a: ["a"],
  address: PARAGRAPH, article: PARAGRAPH, aside: PARAGRAPH, blockquote: PARAGRAPH,
  div: PARAGRAPH, dl: PARAGRAPH, figcaption: PARAGRAPH, figure: PARAGRAPH, footer: PARAGRAPH,
  header: PARAGRAPH, hr: PARAGRAPH, main: PARAGRAPH, ol: PARAGRAPH, pre: PARAGRAPH,
  section: PARAGRAPH, ul: PARAGRAPH,
  table: ["p", "table"],
  p: PARAGRAPH,
  li: ["li", "p"],
  dd: ["dd", "dt", "p"], dt: ["dd", "dt", "p"],
  h1: HEADING, h2: HEADING, h3: HEADING, h4: HEADING, h5: HEADING, h6: HEADING,
  rp: RUBY_ITEM, rt: RUBY_ITEM,
  td: CELL, th: CELL, tr: ["td", "th", "tr"],
  caption: TABLE_PART, colgroup: TABLE_PART,
  tbody: TABLE_PART, tfoot: TABLE_PART, thead: TABLE_PART,
};

// Where the walk up stops. Every one of these is a boundary the spec's closing
// rules genuinely stop at, and the spec has more of them than this — two of the
// rules (h1-h6, rt/rp) stop at very nearly any element. A short list only ever
// makes the walk go further and report a position that would have been fine,
// which is the direction that costs a parse rather than the property. The three
// list wrappers are what keeps an ordinary nested list from asking for one.
const AUTO_CLOSE_BARRIER = new Set(["caption", "dl", "ol", "table", "td", "th", "ul"]);

// <a> is the one entry in the table that is not closed by a tree-building rule
// but by the adoption agency, which reads the list of active formatting
// elements and stops at the markers pushed onto it — a shorter list, and not
// this one. A <table> is not a marker, and neither is a list: an <a> inside a
// list inside an <a> really does end the outer one on the next parse. A cell is
// a marker, which is why `<a>1<table>..<td><a>2</a>` keeps both.
const FORMATTING_BARRIER = new Set(["caption", "td", "th"]);

// How far up to look before giving up and saying yes. A thousand nested <div>
// from a hostile file would otherwise be walked once per element written under
// them; past this depth the answer is the expensive one, which costs a parse
// and not a stall.
const AUTO_CLOSE_LOOKUP = 64;

// Is `name` about to be written inside an element its start tag would end?
// `open` is the output's own stack of open elements, innermost last.
function wouldAutoClose(open: readonly string[], name: string): boolean {
  const closes = AUTO_CLOSES[name];
  if (closes === undefined) return false;
  const barrier = name === "a" ? FORMATTING_BARRIER : AUTO_CLOSE_BARRIER;
  const stop = Math.max(0, open.length - AUTO_CLOSE_LOOKUP);
  for (let i = open.length - 1; i >= stop; i -= 1) {
    const up = open[i];
    if (closes.includes(up)) return true;
    if (barrier.has(up)) return false;
  }
  return open.length > AUTO_CLOSE_LOOKUP;
}

// What one walk of the tree produced, and whether it is allowed to be the
// answer on its own.
interface Pass {
  html: string;
  mayDrift: boolean;
}

// One parsed attribute. Named so it does not shadow the DOM's own Attr.
interface TagAttr {
  name: string;
  value: string;
}

// Text is written back escaped, so no run of characters in a text node can
// become a tag when the renderer parses this string.
//
// CR is escaped for the same reason "&" is in an attribute value: not safety,
// stability. The tokenizer normalizes a literal CR in the source to LF before
// anything else looks at it, but a character reference is decoded after that
// step, so `&#13;` really does put a CR in a text node. Writing it back as a
// literal CR hands the next parse an LF instead, and `<pre>&#13;&#10;x</pre>`
// loses its blank line one read later. `&#13;` survives the round trip.
function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\r/g, "&#13;");
}

// An attribute value for a double-quoted slot. "&" is escaped first, so the
// value the renderer decodes back out is the value that was checked here.
// Leaving it bare kept the string safe but not stable: this runs on every read
// of a stored body, and `https://&#101;vil.example/a.jpg` written out unescaped
// is `https://evil.example/a.jpg` to the next pass. Same record, different host,
// no attacker needed beyond the one who wrote the entity. The scheme test is not
// what this protects — "&" cannot spell http(s) — the rest of the URL is.
//
// image-proxy.ts reads src back out of this text with a regex and now decodes
// these four entities before proxying, so a query string's "&" still reaches the
// img: handler as one character.
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
//
// The only empty entry it writes is a <pre>'s slot, and a slot always follows
// that <pre>'s own start tag, so two of them are never adjacent and `out[slot +
// 1]` is the first thing actually written inside the <pre> — which is what the
// fixup below reads.
function serializeChildren(root: Element): Pass {
  const out: string[] = [];
  // For each <pre>, the index of the empty slot sitting between its start tag
  // and its content, filled in at the end (see padPre).
  const preSlots: number[] = [];
  // The output's own stack of open elements, and whether anything was written
  // into it that the next parse would move (see AUTO_CLOSES).
  const open: string[] = [];
  let mayDrift = false;
  const stack: (Node | string)[] = [];
  pushChildren(stack, root);
  while (stack.length > 0) {
    const item = stack.pop();
    if (item === undefined) break;
    // The only strings on the stack are end tags, one per open element.
    if (typeof item === "string") {
      out.push(item);
      open.pop();
      continue;
    }
    if (item.nodeType === 3) {
      const text = escapeText(item.nodeValue ?? "");
      if (text !== "") out.push(text);
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
      pushImg(out, imgTag(pictureAttrs(el)));
      continue;
    }
    if (!ALLOWED_ELEMENTS.has(name)) {
      pushChildren(stack, el);
      continue;
    }
    const attrs = attrsOf(el);
    if (name === "img") {
      pushImg(out, imgTag(attrs));
      continue;
    }
    if (!mayDrift && wouldAutoClose(open, name)) mayDrift = true;
    out.push(name === "a" ? anchorTag(attrs) : openTag(name, attrs));
    if (VOID_ELEMENTS.has(name)) continue;
    if (name === "pre") {
      preSlots.push(out.length);
      out.push("");
    }
    open.push(name);
    stack.push(`</${name}>`);
    pushChildren(stack, el);
  }
  padPre(out, preSlots);
  return { html: out.join("").trim(), mayDrift };
}

function pushImg(out: string[], tag: string): void {
  if (tag !== "") out.push(tag);
}

// The one place the output is not just the tree written back. The tree builder
// throws away an LF that comes straight after a <pre> start tag, so the text
// node under `<pre>\n\ncode` holds one LF, not two. Writing that node back
// verbatim hands the next parse a <pre> that starts with an LF, it throws that
// one away too, and the blank line most code blocks lifted off a web page begin
// with disappears a line per read.
//
// So a <pre> whose content starts with an LF gets a second one, which the next
// parse eats and gives the same content back. This is what innerHTML does (the
// HTML fragment serialization algorithm has the same rule for pre, textarea and
// listing) and it is why round-tripping through innerHTML is stable.
//
// The test is on what was written, not on the element's first child: a comment
// or a dropped <script> ahead of the text stops the tree builder from eating
// anything on the way in, and both are gone by the time this runs, so the
// output's first character is the only one that says what the next parse sees.
function padPre(out: string[], preSlots: readonly number[]): void {
  for (const slot of preSlots) {
    if (out[slot + 1]?.startsWith("\n")) out[slot] = "\n";
  }
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

function onePass(html: string): Pass | null {
  try {
    const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, "text/html");
    const body = doc.body;
    if (!body) return null;
    return serializeChildren(body);
  } catch {
    // A parser that threw leaves nothing checked, so nothing renders.
    return null;
  }
}

// A body this walk could have moved something in goes back through the parser
// until the parser stops moving it. Every pass is safe on its own — the
// allowlist is applied on all of them — so this loop is only about the output
// being its own input, and the parse it costs is charged to the one body in a
// few hundred that needs it rather than to every read.
//
// Measured over 90,000 generated nestings: 99.95% settle on the first pass and
// the rest on the second; none needed a third. The cap is here because the
// input can be hostile and a parse of a large body is not cheap, not because
// anything is expected to reach it. A body that did reach it would render the
// same way twice anyway on every read after the one that stored it.
const MAX_PASSES = 5;

export function sanitizeArticleHtml(html: string): string {
  if (html === "") return "";
  if (typeof DOMParser === "undefined") return "";
  let pass = onePass(html);
  if (pass === null) return "";
  for (let i = 1; i < MAX_PASSES && pass.mayDrift; i += 1) {
    const next = onePass(pass.html);
    if (next === null) return "";
    if (next.html === pass.html) break;
    pass = next;
  }
  return pass.html;
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
