// A web page pasted into the prep panel, read into text
// (src/reading/prep/papers/web-source.ts). The extractor stands in for
// Readability, as in the ingest's test: what is pinned is that the page goes
// through the bindery's web adapter and gate, and the cap.
// Run: bash scripts/t.sh tests/reading/prep/papers/web-source.test.ts

import { expect, test } from "bun:test";
import {
  readWebSource,
  TRUNCATION_MARKER,
  WEB_SOURCE_MAX_CHARS,
} from "../../../../src/reading/prep/papers/web-source";
import type { Extraction } from "../../../../src/workshop/extract/readable-select";

const URL_A = "https://example.com/posts/a";
const PROSE = "the quick brown fox jumps over the lazy dog. ".repeat(8);

function extractor(title: string) {
  return (html: string): Extraction | null => {
    const m = /<body>([\s\S]*)<\/body>/.exec(html);
    if (!m) return null;
    return {
      title,
      contentHtml: m[1],
      textContent: m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
    };
  };
}

const page = (body: string) => `<html><head><title>chrome</title></head><body>${body}</body></html>`;

test("the article's text and title come off the web adapter", async () => {
  const got = await readWebSource(
    { url: URL_A, html: page(`<p>${PROSE}</p><p>${PROSE}</p>`) },
    { extractReadable: extractor("The real title") },
  );
  expect(got.title).toBe("The real title");
  expect(got.text).toContain("the quick brown fox");
  expect(got.text).not.toContain("<p>");
  expect(got.truncated).toBe(false);
});

test("a page the gate turns back is an error carrying the reason", async () => {
  await expect(
    readWebSource(
      { url: URL_A, html: page("<p>JavaScript is not available.</p>") },
      { extractReadable: extractor("x") },
    ),
  ).rejects.toThrow(/sign-in or script wall/);
  await expect(
    readWebSource({ url: URL_A, html: "<html></html>" }, { extractReadable: extractor("x") }),
  ).rejects.toThrow(/no readable article/);
});

test("an untitled page answers no title, for the pipeline to keep its own", async () => {
  const got = await readWebSource(
    { url: URL_A, html: page(`<p>${PROSE}</p>`) },
    { extractReadable: extractor("") },
  );
  expect(got.title).toBeUndefined();
});

test("a huge page is cut at the cap with a visible marker", async () => {
  const big = "word ".repeat(WEB_SOURCE_MAX_CHARS / 2);
  const got = await readWebSource(
    { url: URL_A, html: page(`<p>${big}</p>`) },
    { extractReadable: extractor("Big") },
  );
  expect(got.truncated).toBe(true);
  expect(got.text.endsWith(TRUNCATION_MARKER)).toBe(true);
  expect(got.text.length).toBe(WEB_SOURCE_MAX_CHARS + TRUNCATION_MARKER.length);
});
