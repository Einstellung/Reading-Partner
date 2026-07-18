// Unit tests for the pure HTML main-content extractor (src/prep/article.ts).
// Run: bun test. No DOM, no network.

import { expect, test } from "bun:test";
import {
  ARTICLE_MAX_CHARS,
  TRUNCATION_MARKER,
  extractArticle,
  extractArticleTitle,
} from "../../src/prep/article";

test("prefers <article> over surrounding nav/footer chrome", () => {
  const html = `
    <html><head><title>My Post</title></head><body>
      <nav><a href="/">Home</a><a href="/about">About</a> lots of nav links here</nav>
      <header>site header banner</header>
      <article><p>The real content is here.</p><p>A second paragraph.</p></article>
      <footer>copyright and more footer junk</footer>
    </body></html>`;
  const { title, text } = extractArticle(html);
  expect(title).toBe("My Post");
  expect(text).toContain("The real content is here.");
  expect(text).toContain("A second paragraph.");
  expect(text).not.toContain("nav links");
  expect(text).not.toContain("footer junk");
});

test("nav-heavy page without <article>/<main> falls back to the cleaned body", () => {
  const html = `
    <html><head><title>Docs</title></head><body>
      <nav>menu one two three four five six seven eight</nav>
      <div><p>Paragraph of the actual article body that we want to keep.</p></div>
      <aside>related links sidebar noise</aside>
    </body></html>`;
  const { text } = extractArticle(html);
  expect(text).toContain("actual article body");
  expect(text).not.toContain("menu one two");
  expect(text).not.toContain("sidebar noise");
});

test("strips <script> and <style> content", () => {
  const html =
    "<body><article><script>alert('x')</script><style>.a{color:red}</style><p>Keep me.</p></article></body>";
  const { text } = extractArticle(html);
  expect(text).toBe("Keep me.");
});

test("decodes entities and collapses whitespace", () => {
  const html = "<body><article><p>Tom &amp; Jerry   &lt;3</p></article></body>";
  expect(extractArticle(html).text).toBe("Tom & Jerry <3");
});

test("title falls back to the first <h1> when there is no <title>", () => {
  const html = "<body><h1>Heading Title</h1><article><p>Body.</p></article></body>";
  expect(extractArticleTitle(html)).toBe("Heading Title");
});

test("caps very long content with a truncation marker", () => {
  const big = "word ".repeat(ARTICLE_MAX_CHARS); // well over the cap
  const html = `<body><article><p>${big}</p></article></body>`;
  const { text, truncated } = extractArticle(html);
  expect(truncated).toBe(true);
  expect(text.endsWith(TRUNCATION_MARKER)).toBe(true);
  expect(text.length).toBe(ARTICLE_MAX_CHARS + TRUNCATION_MARKER.length);
});

test("short content is not marked truncated", () => {
  const { truncated } = extractArticle("<body><main><p>tiny</p></main></body>");
  expect(truncated).toBe(false);
});
