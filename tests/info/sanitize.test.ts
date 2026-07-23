// Article-HTML sanitizer (src/info/sanitize.ts). Run: bun test.

import { expect, test } from "bun:test";
import { htmlToText, sanitizeArticleHtml } from "../../src/info/extract/sanitize";

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

test("keeps http(s) images and forces no-referrer", () => {
  const out = sanitizeArticleHtml(`<img src="https://cdn.qbitai.com/a.jpg" onerror="x()" width="600">`);
  expect(out).toContain('src="https://cdn.qbitai.com/a.jpg"');
  expect(out).toContain('referrerpolicy="no-referrer"');
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
  expect(mm).toContain('referrerpolicy="no-referrer"');
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
});

test("neutralizes javascript: anchors, keeps http links with rel/noreferrer", () => {
  const js = sanitizeArticleHtml(`<a href="javascript:alert(1)">x</a>`);
  expect(js).toBe("<a>x</a>");
  const ok = sanitizeArticleHtml(`<a href="https://example.com" onclick="y()">x</a>`);
  expect(ok).toContain('href="https://example.com"');
  expect(ok).toContain('rel="noreferrer noopener"');
  expect(ok).not.toContain("onclick");
});

test("htmlToText turns blocks into breaks and decodes entities", () => {
  const t = htmlToText(`<h1>Title</h1><p>a &amp; b</p><p>c</p>`);
  expect(t).toBe("Title\n\na & b\n\nc");
});
