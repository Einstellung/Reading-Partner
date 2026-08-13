// Article-HTML sanitizer (src/info/extract/sanitize.ts). Run: bun test.

import { expect, test } from "bun:test";
import { htmlToText, sanitizeArticleHtml, stripDataImages } from "../../src/info/extract/sanitize";

test("drops scripts, styles, iframes, and event handlers", () => {
  const out = sanitizeArticleHtml(
    `<p onclick="steal()">Hi</p><script>evil()</script><style>x{}</style><iframe src="https://ad"></iframe>`,
  );
  expect(out).toContain("<p>Hi</p>");
  expect(out).not.toContain("script");
  expect(out).not.toContain("onclick");
  expect(out).not.toContain("iframe");
  expect(out).not.toContain("x{}");
});

test("keeps http(s) images and lets them load lazily", () => {
  const out = sanitizeArticleHtml(`<img src="https://cdn.qbitai.com/a.jpg" onerror="x()" width="600">`);
  expect(out).toContain('src="https://cdn.qbitai.com/a.jpg"');
  expect(out).toContain('loading="lazy"');
  // The img: proxy fetches these, so a referrer policy on the tag would decide
  // nothing (docs/pitfall/30).
  expect(out).not.toContain("referrerpolicy");
  expect(out).not.toContain("onerror");
  expect(out).not.toContain("width");
});

test("drops images with a non-http/data src and no lazy fallback (relative, trackers)", () => {
  expect(sanitizeArticleHtml(`<img src="/rel.jpg">`)).toBe("");
  expect(sanitizeArticleHtml(`<img src="about:blank">`)).toBe("");
  expect(sanitizeArticleHtml(`<img src="data:image/png;base64,AAAA">`)).toContain("data:image/png");
});

test("recovers lazy-loaded images from data-src/srcset (WeChat/mmbiz mirrors)", () => {
  // Real mmbiz shape: no src, image only in data-src, fragment preserved.
  const mm = sanitizeArticleHtml(
    `<img class="rich_pages" data-src="https://mmbiz.qpic.cn/sz_mmbiz_gif/a.gif?wx_fmt=gif&from=appmsg#imgIndex=1" data-ratio="0.51" data-type="gif">`,
  );
  expect(mm).toContain('src="https://mmbiz.qpic.cn/sz_mmbiz_gif/a.gif?wx_fmt=gif&from=appmsg#imgIndex=1"');
  expect(mm).toContain('loading="lazy"');
  expect(mm).not.toContain("data-src");
  expect(mm).not.toContain("data-ratio");

  // Placeholder src + real data-src: the real image wins.
  const ph = sanitizeArticleHtml(
    `<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" data-src="https://mmbiz.qpic.cn/real.jpg">`,
  );
  expect(ph).toContain('src="https://mmbiz.qpic.cn/real.jpg"');
  expect(ph).not.toContain("data:image");

  // Other lazy attributes.
  expect(sanitizeArticleHtml(`<img data-original="https://x/o.jpg">`)).toContain('src="https://x/o.jpg"');
  expect(sanitizeArticleHtml(`<img data-actual-src="https://x/a.jpg">`)).toContain('src="https://x/a.jpg"');

  // srcset / data-srcset fall back to the first candidate URL.
  const ss = sanitizeArticleHtml(`<img srcset="https://x/1x.jpg 1x, https://x/2x.jpg 2x">`);
  expect(ss).toContain('src="https://x/1x.jpg"');
  expect(sanitizeArticleHtml(`<img data-srcset="https://x/d.jpg 1x">`)).toContain('src="https://x/d.jpg"');

  // A real http src still wins over lazy attributes.
  expect(
    sanitizeArticleHtml(`<img src="https://x/real.jpg" data-src="https://x/lazy.jpg">`),
  ).toContain('src="https://x/real.jpg"');

  // Protocol-relative URLs are normalized to https.
  expect(sanitizeArticleHtml(`<img src="//cdn.x/p.jpg">`)).toContain('src="https://cdn.x/p.jpg"');
});

test("recovers images from off-list lazy attribute names (generic, not a whitelist)", () => {
  // Names no hard-coded list would enumerate; the generic scan still finds them.
  expect(sanitizeArticleHtml(`<img data-echo="https://x/e.jpg">`)).toContain('src="https://x/e.jpg"');
  expect(sanitizeArticleHtml(`<img data-image="https://x/i.jpg">`)).toContain('src="https://x/i.jpg"');
  expect(sanitizeArticleHtml(`<img data-flickity-lazyload="https://x/f.jpg">`)).toContain('src="https://x/f.jpg"');
  // Extensionless CDN paths still qualify through the format parameter.
  expect(sanitizeArticleHtml(`<img data-echo="https://mmbiz.qpic.cn/mmbiz_jpg/abc/640?wx_fmt=jpeg">`)).toContain(
    'src="https://mmbiz.qpic.cn/mmbiz_jpg/abc/640?wx_fmt=jpeg"',
  );
});

test("an off-list attribute that is not a picture never becomes a request", () => {
  // Every src the sanitizer emits is fetched by the img: proxy, the app's only
  // outbound request driven by third-party markup. Share links, analytics
  // endpoints and canonical URLs sitting on an <img> must not reach it.
  const beacons = sanitizeArticleHtml(
    `<img data-share-url="https://social.example/post/1" data-track="https://beacon.example/p?id=1" data-canonical="https://news.example/article/9" title="https://ads.example/x">`,
  );
  expect(beacons).toBe("");

  // Even alone, with nothing else on the tag to prefer.
  expect(sanitizeArticleHtml(`<img data-open="https://news.example/article/9">`)).toBe("");
  expect(sanitizeArticleHtml(`<img data-echo="https://x/e">`)).toBe("");

  // A real image on the same tag is unaffected: it is reached first.
  const mixed = sanitizeArticleHtml(
    `<img data-track="https://beacon.example/p?id=1" data-echo="https://x/photo.jpg">`,
  );
  expect(mixed).toContain('src="https://x/photo.jpg"');
  expect(mixed).not.toContain("beacon.example");
});

test("prefers the image URL over a stray non-image link on the same img", () => {
  // A real image URL (src or *src*) is always reached before the generic
  // any-http-URL fallback, so a share/track link elsewhere on the tag is ignored.
  const withSrc = sanitizeArticleHtml(
    `<img src="https://x/photo.jpg" data-share-url="https://social.example/post/1">`,
  );
  expect(withSrc).toContain('src="https://x/photo.jpg"');
  expect(withSrc).not.toContain("social.example");

  const withLazySrc = sanitizeArticleHtml(
    `<img data-lazy-src="https://x/photo.jpg" data-share-url="https://social.example/post/1">`,
  );
  expect(withLazySrc).toContain('src="https://x/photo.jpg"');
  expect(withLazySrc).not.toContain("social.example");
  // An img carrying only a non-image http URL yields nothing at all; see the
  // next test.
});

test("neutralizes javascript: anchors, keeps http links with rel/noreferrer", () => {
  const js = sanitizeArticleHtml(`<a href="javascript:alert(1)">x</a>`);
  expect(js).toBe("<a>x</a>");
  const ok = sanitizeArticleHtml(`<a href="https://example.com" onclick="y()">x</a>`);
  expect(ok).toContain('href="https://example.com"');
  expect(ok).toContain('rel="noreferrer noopener"');
  expect(ok).not.toContain("onclick");
});

// An unquoted attribute value is legal HTML and ends at whitespace or ">", so a
// handler written without quotes used to walk straight through the scrubber:
// `<p onmouseover=alert(1)>` came out unchanged and the article view renders the
// result with dangerouslySetInnerHTML. A hostile page the collector fetched, or
// a body edited into the synced folder, is the realistic way that arrives.
test("strips inline handlers written without quotes", () => {
  expect(sanitizeArticleHtml(`<p onmouseover=alert(1)>hi</p>`)).toBe("<p>hi</p>");
  expect(sanitizeArticleHtml(`<p ONCLICK=alert(1)>x</p>`)).toBe("<p>x</p>");
  expect(sanitizeArticleHtml("<p onclick=`alert(1)`>x</p>")).toBe("<p>x</p>");
  expect(sanitizeArticleHtml(`<body onload=alert(1)>`)).toBe("<body>");
});

// A solidus inside a tag is an ignored self-closing marker to the tokenizer, so
// `<p/onclick=…>` is a <p> with a handler. Matching only on whitespace before
// the attribute name missed it.
test("strips a handler separated from the tag name by a solidus", () => {
  expect(sanitizeArticleHtml(`<p/onclick=alert(1)>x</p>`)).toBe("<p>x</p>");
});

test("strips an unquoted javascript: URL on any attribute", () => {
  expect(sanitizeArticleHtml(`<blockquote cite=javascript:alert(1)>x</blockquote>`)).toBe(
    "<blockquote>x</blockquote>",
  );
});

test("unquoted presentational attributes go too, and prose is left alone", () => {
  expect(sanitizeArticleHtml(`<p class=big style=color:red>x</p>`)).toBe("<p>x</p>");
  expect(sanitizeArticleHtml(`<p>hi <b>there</b></p><h2>T</h2><ul><li>x</li></ul>`)).toBe(
    "<p>hi <b>there</b></p><h2>T</h2><ul><li>x</li></ul>",
  );
});

test("htmlToText turns blocks into breaks and decodes entities", () => {
  const t = htmlToText(`<h1>Title</h1><p>a &amp; b</p><p>c</p>`);
  expect(t).toBe("Title\n\na & b\n\nc");
});

// --- stripDataImages --------------------------------------------------------
// Run on both bodies that travel: the published briefing bodies and a kept
// article. An inlined image outweighs the article it illustrates; an external
// one is a URL, and the reading end renders it through the img: proxy.

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
