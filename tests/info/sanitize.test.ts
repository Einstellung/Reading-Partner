// Article-HTML sanitizer (src/info/sanitize.ts). Run: bun test.

import { expect, test } from "bun:test";
import { htmlToText, sanitizeArticleHtml } from "../../src/info/sanitize";

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

test("drops images with a non-http/data src (lazy placeholders, trackers)", () => {
  expect(sanitizeArticleHtml(`<img src="/rel.jpg">`)).toBe("");
  expect(sanitizeArticleHtml(`<img data-src="https://x/y.jpg">`)).toBe("");
  expect(sanitizeArticleHtml(`<img src="data:image/png;base64,AAAA">`)).toContain("data:image/png");
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
