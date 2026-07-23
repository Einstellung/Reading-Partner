// The pure page reader (src/info/extract/read-page.ts): HTML → title / readable
// text / full link list; non-HTML bodies passed back raw with their content-type.
// DOM-free, so it runs in bun. Run: bun test.

import { expect, test } from "bun:test";
import {
  readPage,
  extractTitle,
  extractPageLinks,
  isHtmlPage,
  READ_PAGE_TEXT_CHARS,
  READ_PAGE_MAX_LINKS,
} from "../../src/info/extract/read-page";

test("extractTitle decodes and collapses whitespace, empty when absent", () => {
  expect(extractTitle("<html><head><title>  Jiemian &amp;\n News </title></head></html>")).toBe("Jiemian & News");
  expect(extractTitle("<html><body>no title</body></html>")).toBe("");
});

test("extractPageLinks resolves relative hrefs against the base and keeps nav links", () => {
  const html = `
    <nav>
      <a href="/lists/65.html">时政</a>
      <a href="https://www.jiemian.com/lists/2.html">财经</a>
      <a href="culture/">文化</a>
    </nav>`;
  const links = extractPageLinks(html, "https://www.jiemian.com/");
  expect(links).toEqual([
    { text: "时政", url: "https://www.jiemian.com/lists/65.html" },
    { text: "财经", url: "https://www.jiemian.com/lists/2.html" },
    { text: "文化", url: "https://www.jiemian.com/culture/" },
  ]);
});

test("extractPageLinks skips empty-text anchors, fragments, and non-http schemes", () => {
  const html = `
    <a href="/real">Real</a>
    <a href="/icon"><img src="x.png"></a>
    <a href="#top">Top</a>
    <a href="javascript:void(0)">JS</a>
    <a href="mailto:a@b.com">Mail</a>`;
  const links = extractPageLinks(html, "https://example.com/");
  expect(links).toEqual([{ text: "Real", url: "https://example.com/real" }]);
});

test("extractPageLinks dedupes by absolute URL, first anchor text wins", () => {
  const html = `<a href="/a">First</a><a href="/a">Second</a><a href="/b">B</a>`;
  const links = extractPageLinks(html, "https://example.com/");
  expect(links.map((l) => l.text)).toEqual(["First", "B"]);
});

test("extractPageLinks pulls anchor text out of nested markup", () => {
  const html = `<a href="/p"><span>Deep</span> <b>Link</b></a>`;
  expect(extractPageLinks(html, "https://example.com/")).toEqual([
    { text: "Deep Link", url: "https://example.com/p" },
  ]);
});

test("isHtmlPage trusts content-type, then sniffs the body", () => {
  expect(isHtmlPage("<html></html>", "text/html; charset=utf-8")).toBe(true);
  expect(isHtmlPage("<rss></rss>", "application/rss+xml")).toBe(false);
  expect(isHtmlPage("{}", "application/json")).toBe(false);
  // No content-type: sniff.
  expect(isHtmlPage("<!doctype html><html></html>", null)).toBe(true);
  expect(isHtmlPage('<?xml version="1.0"?><rss></rss>', null)).toBe(false);
  expect(isHtmlPage('{"a":1}', undefined)).toBe(false);
});

test("readPage returns title, text, and links for an HTML page", () => {
  const html = `<html><head><title>Home</title></head>
    <body><nav><a href="/news">News</a></nav><p>Hello world.</p></body></html>`;
  const r = readPage(html, "https://site.com/", "text/html");
  expect(r.isHtml).toBe(true);
  expect(r.title).toBe("Home");
  expect(r.text).toContain("Hello world.");
  expect(r.links).toEqual([{ text: "News", url: "https://site.com/news" }]);
  expect(r.textTruncated).toBe(false);
  expect(r.linksTruncated).toBe(false);
});

test("readPage truncates long text and caps the link list, flagging both", () => {
  const longText = "词".repeat(READ_PAGE_TEXT_CHARS + 500);
  const manyLinks = Array.from({ length: READ_PAGE_MAX_LINKS + 10 }, (_, i) => `<a href="/p${i}">L${i}</a>`).join("");
  const html = `<title>T</title><body><p>${longText}</p>${manyLinks}</body>`;
  const r = readPage(html, "https://site.com/", "text/html");
  expect(r.text!.length).toBe(READ_PAGE_TEXT_CHARS);
  expect(r.textTruncated).toBe(true);
  expect(r.links!.length).toBe(READ_PAGE_MAX_LINKS);
  expect(r.linksTruncated).toBe(true);
});

test("readPage passes a non-HTML body back raw with its content-type", () => {
  const feed = '<?xml version="1.0"?><rss><channel><item><title>x</title></item></channel></rss>';
  const r = readPage(feed, "https://site.com/feed", "application/rss+xml; charset=utf-8");
  expect(r.isHtml).toBe(false);
  expect(r.contentType).toBe("application/rss+xml");
  expect(r.raw).toContain("<rss>");
  expect(r.rawTruncated).toBe(false);
});
