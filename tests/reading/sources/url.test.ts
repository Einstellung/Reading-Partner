// Unit tests for URL reading + content sniffing (src/reading/sources/url.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  looksLikeHttpUrl,
  provisionalTitleFromUrl,
  resolveUrlSource,
  slugBaseFromUrl,
  sniffContentType,
} from "../../../src/reading/sources/url";

test("looksLikeHttpUrl takes http as well as https, and nothing else", () => {
  expect(looksLikeHttpUrl("https://a.test/x")).toBe(true);
  expect(looksLikeHttpUrl("http://a.test/x")).toBe(true);
  expect(looksLikeHttpUrl("Attention Is All You Need")).toBe(false);
  expect(looksLikeHttpUrl("file:///etc/passwd")).toBe(false);
  expect(looksLikeHttpUrl("data:text/html,<p>hi</p>")).toBe(false);
});

test("slugBaseFromUrl uses the filename, else the hostname", () => {
  // The stem is raw: the caller's slugify turns the dots into hyphens.
  expect(slugBaseFromUrl("https://arxiv.org/pdf/2303.12345")).toBe("2303.12345");
  expect(slugBaseFromUrl("https://blog.example.com/posts/great-article.html")).toBe(
    "great-article",
  );
  expect(slugBaseFromUrl("https://openreview.net/")).toBe("openreview.net");
  expect(slugBaseFromUrl("not a url at all")).toBe("source");
});

test("provisionalTitleFromUrl is hostname + path", () => {
  expect(provisionalTitleFromUrl("https://www.example.com/blog/post/")).toBe("example.com/blog/post");
  expect(provisionalTitleFromUrl("https://arxiv.org/abs/2303.12345")).toBe("arxiv.org/abs/2303.12345");
});

test("resolveUrlSource reads the URL, a provisional title and a slug stem", () => {
  const s = resolveUrlSource("  https://arxiv.org/pdf/2303.12345  ");
  expect(s.url).toBe("https://arxiv.org/pdf/2303.12345");
  expect(s.title).toBe("arxiv.org/pdf/2303.12345");
  expect(s.slugBase).toBe("2303.12345");
});

test("resolveUrlSource takes an http URL and rejects any other scheme", () => {
  expect(resolveUrlSource("http://plain.test/x").url).toBe("http://plain.test/x");
  expect(() => resolveUrlSource("file:///etc/passwd")).toThrow(/http/);
  expect(() => resolveUrlSource("Attention Is All You Need")).toThrow(/http/);
});

test("sniffContentType: PDF magic bytes win over any header", () => {
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // "%PDF-"
  expect(sniffContentType(pdf, "text/html")).toBe("pdf");
});

test("sniffContentType: HTML bytes are html", () => {
  const html = new TextEncoder().encode("<!doctype html><html>");
  expect(sniffContentType(html, "text/html; charset=utf-8")).toBe("html");
});

test("sniffContentType: application/pdf header without magic bytes still pdf", () => {
  const bytes = new TextEncoder().encode("not-a-pdf-prefix");
  expect(sniffContentType(bytes, "application/pdf")).toBe("pdf");
});
