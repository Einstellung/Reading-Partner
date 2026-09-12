// What a fetched page says about itself (src/reading/ingest/page-meta.ts).
// Run: bash scripts/t.sh tests/reading/ingest/page-meta.test.ts

import { expect, test } from "bun:test";
import {
  articleFileName,
  collectImageSrcs,
  decodeDataImage,
  metaTags,
  normalizeDate,
  pageLanguage,
  readPageMeta,
} from "../../../src/reading/ingest/page-meta";

test("meta tags are read by name, property and itemprop", () => {
  const tags = metaTags(`<head>
    <meta charset="utf-8">
    <meta name="author" content="A Writer">
    <meta property="article:published_time" content="2026-09-12T08:30:00Z">
    <meta itemprop="datePublished" content="2026-09-11">
    <meta name="author" content="Someone Else">
  </head>`);
  expect(tags.get("author")).toBe("A Writer");
  expect(tags.get("article:published_time")).toBe("2026-09-12T08:30:00Z");
  expect(tags.get("datepublished")).toBe("2026-09-11");
});

test("an ISO date is kept verbatim so no timezone can move the day", () => {
  expect(normalizeDate("2026-09-12T23:40:00+08:00")).toBe("2026-09-12T23:40:00+08:00");
  expect(normalizeDate("2026-09-12")).toBe("2026-09-12");
});

test("a non-ISO date is normalized, and a non-date is nothing", () => {
  expect(normalizeDate("September 12, 2026")).toBe(new Date("September 12, 2026").toISOString());
  expect(normalizeDate("2026")).toBeUndefined();
  expect(normalizeDate("recently")).toBeUndefined();
  expect(normalizeDate("")).toBeUndefined();
});

test("the byline and the date come off the head, entities decoded", () => {
  const meta = readPageMeta(`<html lang="en"><head>
    <meta name="author" content="Ada &amp; Grace">
    <meta property="article:published_time" content="2026-09-12T08:30:00Z">
  </head><body>x</body></html>`);
  expect(meta).toEqual({ byline: "Ada & Grace", publishedAt: "2026-09-12T08:30:00Z" });
});

test("a byline that is a profile URL is not a name", () => {
  const meta = readPageMeta(
    `<head><meta property="article:author" content="https://facebook.com/thepaper"></head>`,
  );
  expect(meta.byline).toBeUndefined();
});

test("JSON-LD answers when the meta tags do not", () => {
  const meta = readPageMeta(`<head><script type="application/ld+json">
    {"@type":"NewsArticle","datePublished":"2026-09-10T06:00:00Z",
     "author":{"@type":"Person","name":"A Reporter"}}
  </script></head>`);
  expect(meta).toEqual({ publishedAt: "2026-09-10T06:00:00Z", byline: "A Reporter" });
});

test("the page's language is its html lang, when that is a tag at all", () => {
  expect(pageLanguage(`<html lang="zh-CN"><head></head></html>`)).toBe("zh-CN");
  expect(pageLanguage(`<html lang=""><head></head></html>`)).toBeUndefined();
  expect(pageLanguage(`<html><head></head></html>`)).toBeUndefined();
});

test("image srcs keep the string the HTML spelled, and relatives resolve", () => {
  const got = collectImageSrcs(
    `<p><img src="https://cdn.example.com/a.png"></p>
     <p><img src="/img/b.jpg"></p>
     <p><img src="https://cdn.example.com/a.png"></p>
     <p><img alt="no src"></p>`,
    "https://example.com/posts/one",
  );
  expect(got).toEqual([
    { src: "https://cdn.example.com/a.png", url: "https://cdn.example.com/a.png" },
    { src: "/img/b.jpg", url: "https://example.com/img/b.jpg" },
  ]);
});

test("a data: image decodes to its bytes; anything else is null", () => {
  const png = decodeDataImage("data:image/png;base64,QUJD");
  expect(png?.mediaType).toBe("image/png");
  expect(Array.from(png?.bytes ?? [])).toEqual([65, 66, 67]);
  expect(decodeDataImage("https://example.com/a.png")).toBeNull();
  expect(decodeDataImage("data:image/svg+xml,<svg/>")).toBeNull();
});

test("the file name is the article's title, made safe to sit in a path", () => {
  expect(articleFileName("How a web page becomes a book", "how-a-web-page")).toBe(
    "How a web page becomes a book.epub",
  );
  expect(articleFileName("Windows/Linux: a note", "x")).toBe("Windows Linux a note.epub");
  expect(articleFileName("   ", "the-slug")).toBe("the-slug.epub");
  expect(articleFileName("", "", "pdf")).toBe("article.pdf");
  expect(articleFileName("x".repeat(200), "s").length).toBe(125);
});
