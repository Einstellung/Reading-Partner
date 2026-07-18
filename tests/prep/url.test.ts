// Unit tests for URL resolution + content sniffing (src/prep/url.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  isHttpsUrl,
  looksLikeHttpUrl,
  provisionalTitleFromUrl,
  resolveUrlAddition,
  slugFromUrl,
  sniffContentType,
} from "../../src/prep/url";

test("looksLikeHttpUrl / isHttpsUrl", () => {
  expect(looksLikeHttpUrl("https://a.test/x")).toBe(true);
  expect(looksLikeHttpUrl("http://a.test/x")).toBe(true);
  expect(looksLikeHttpUrl("Attention Is All You Need")).toBe(false);
  expect(isHttpsUrl("https://a.test")).toBe(true);
  expect(isHttpsUrl("http://a.test")).toBe(false);
});

test("slugFromUrl uses the filename, else the hostname", () => {
  expect(slugFromUrl("https://arxiv.org/pdf/2303.12345")).toBe("2303-12345");
  expect(slugFromUrl("https://blog.example.com/posts/great-article.html")).toBe("great-article");
  expect(slugFromUrl("https://openreview.net/")).toBe("openreview-net");
});

test("provisionalTitleFromUrl is hostname + path", () => {
  expect(provisionalTitleFromUrl("https://www.example.com/blog/post/")).toBe("example.com/blog/post");
  expect(provisionalTitleFromUrl("https://arxiv.org/abs/2303.12345")).toBe("arxiv.org/abs/2303.12345");
});

test("resolveUrlAddition builds a queued user source with a provisional title/slug", () => {
  const p = resolveUrlAddition("https://arxiv.org/pdf/2303.12345", new Set());
  expect(p.sourceUrl).toBe("https://arxiv.org/pdf/2303.12345");
  expect(p.addedByUser).toBe(true);
  expect(p.status).toBe("queued");
  expect(p.slug).toBe("2303-12345");
  expect(p.title).toBe("arxiv.org/pdf/2303.12345");
  expect(p.arxivId).toBeNull();
});

test("resolveUrlAddition dedups slugs against taken", () => {
  const p = resolveUrlAddition("https://arxiv.org/pdf/2303.12345", new Set(["2303-12345"]));
  expect(p.slug).toBe("2303-12345-2");
});

test("resolveUrlAddition rejects a non-https URL", () => {
  expect(() => resolveUrlAddition("http://insecure.test/x", new Set())).toThrow(/https/);
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
