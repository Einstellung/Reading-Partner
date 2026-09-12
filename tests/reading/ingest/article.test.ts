// Ingesting a pasted URL into a topic's documents (src/reading/ingest/article.ts).
// The fetch and the extractor are injected, so the whole path runs here with a
// fixture page: what is pinned is the metadata that lands on the entry, the
// document that comes out, and the filing.
// Run: bash scripts/t.sh tests/reading/ingest/article.test.ts

import { beforeEach, expect, test } from "bun:test";
import { LIBRARY_FILE, libraryBookPath, type LibraryStore } from "../../../src/platform/app/library";
import { importBook } from "../../../src/platform/app/library";
import { ingestArticleUrl, type ArticleIngestDeps, type FetchedBytes } from "../../../src/reading/ingest/article";
import { isEpub } from "../../../src/reading/epub/sniff";
import { openZip } from "../../../src/reading/epub/zip";
import { parseEpub } from "../../../src/reading/epub/parse";
import type { Extraction } from "../../../src/info/extract/readable-select";
import { PNG } from "../epub/fixture";
import { installAppData, type FakeDisk } from "../../support/appdata-fake";

const PAGE_URL = "https://example.com/posts/how-a-web-page-becomes-a-book";
const GOOD_IMAGE = "https://cdn.example.com/a.png";
const DEAD_IMAGE = "https://cdn.example.com/gone.jpg";

const PROSE = "the quick brown fox jumps over the lazy dog. ".repeat(8);

const BODY = `<div>
  <p>${PROSE}</p>
  <h2>The first section</h2>
  <p><img src="${GOOD_IMAGE}"></p>
  <p><img src="${DEAD_IMAGE}"></p>
  <p>${PROSE}</p>
</div>`;

const PAGE = `<html lang="en"><head>
  <title>The page title nobody reads</title>
  <meta name="author" content="A Writer">
  <meta property="article:published_time" content="2026-09-12T08:30:00Z">
</head><body>${BODY}</body></html>`;

const PDF_BYTES = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n");

function ok(body: Uint8Array | string, contentType: string): FetchedBytes {
  return {
    ok: true,
    status: 200,
    bytes: typeof body === "string" ? new TextEncoder().encode(body) : body,
    contentType,
  };
}

const MISSING: FetchedBytes = { ok: false, status: 404, bytes: new Uint8Array(), contentType: null };

// The extractor stands in for Readability: it is a dep precisely so this test
// does not need a DOM library, and what it returns is the shape readable.ts
// returns (a sanitized body, already absolute).
function fakeExtract(html: string): Extraction | null {
  const m = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!m) return null;
  return {
    title: "How a web page becomes a book",
    contentHtml: m[1],
    textContent: m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
  };
}

interface Recorder {
  deps: ArticleIngestDeps;
  attached: { topicId: string; path: string; hash: string }[];
  fetched: string[];
}

function recorder(responses: Record<string, FetchedBytes>): Recorder {
  const attached: Recorder["attached"] = [];
  const fetched: string[] = [];
  return {
    attached,
    fetched,
    deps: {
      fetch: async (url) => {
        fetched.push(url);
        return responses[url] ?? MISSING;
      },
      extractReadable: (html) => fakeExtract(html),
      importBook,
      attach: async (topicId, path, hash) => {
        attached.push({ topicId, path, hash });
      },
    },
  };
}

const HTML_PAGE = {
  [PAGE_URL]: ok(PAGE, "text/html; charset=utf-8"),
  [GOOD_IMAGE]: ok(PNG, "image/png"),
  [DEAD_IMAGE]: MISSING,
};

let disk: FakeDisk;
beforeEach(() => {
  disk = installAppData();
});

test("a web page becomes an article in the library, filed under the topic", async () => {
  const r = recorder(HTML_PAGE);
  const got = await ingestArticleUrl(PAGE_URL, "t1", r.deps);

  expect(got.kind).toBe("article");
  expect(got.entry.kind).toBe("article");
  expect(got.entry.sourceUrl).toBe(PAGE_URL);
  expect(got.entry.byline).toBe("A Writer");
  expect(got.entry.publishedAt).toBe("2026-09-12T08:30:00Z");
  expect(got.entry.format).toBe("epub");
  // The title the reader sees comes off the reference's basename, so the entry
  // and the topic row are named by the article, not by the URL.
  expect(got.entry.title).toBe("How a web page becomes a book.epub");
  expect(got.path).toBe(`library/${got.entry.hash}/How a web page becomes a book.epub`);
  expect(got.chars).toBeGreaterThan(500);
  expect(r.attached).toEqual([{ topicId: "t1", path: got.path, hash: got.entry.hash }]);

  const store = JSON.parse(disk.files.get(LIBRARY_FILE)!) as LibraryStore;
  expect(Object.keys(store.books)).toEqual([got.entry.hash]);
  expect(disk.blobs.has(libraryBookPath(got.entry.hash, "epub"))).toBe(true);
});

test("the image that answered is embedded; the one that 404ed is a placeholder", async () => {
  const r = recorder(HTML_PAGE);
  const got = await ingestArticleUrl(PAGE_URL, "t1", r.deps);
  expect(got.imagesEmbedded).toBe(1);
  expect(got.imagePlaceholders).toBe(1);

  const bytes = disk.blobs.get(libraryBookPath(got.entry.hash, "epub"))!;
  expect(isEpub(bytes)).toBe(true);
  const zip = openZip(bytes);
  const article = zip.text("text/article.xhtml")!;
  expect(article).toContain("rp-missing-image");
  // One packed image, referenced from the spine document and nowhere else.
  const names = zip.entries.map((e) => e.name).filter((n) => n.startsWith("images/"));
  expect(names).toHaveLength(1);
  expect(article).toContain(`../${names[0]}`);
  expect(article).not.toContain("https://cdn.example.com");
  // And the whole thing still opens as a book.
  expect(parseEpub(bytes).docs).toHaveLength(1);
});

test("the same URL twice is one entry, and is filed again", async () => {
  const first = await ingestArticleUrl(PAGE_URL, "t1", recorder(HTML_PAGE).deps);
  const again = recorder(HTML_PAGE);
  const second = await ingestArticleUrl(PAGE_URL, "t2", again.deps);

  expect(second.entry.hash).toBe(first.entry.hash);
  expect(second.entry.addedAt).toBe(first.entry.addedAt);
  const store = JSON.parse(disk.files.get(LIBRARY_FILE)!) as LibraryStore;
  expect(Object.keys(store.books)).toHaveLength(1);
  expect(again.attached).toEqual([{ topicId: "t2", path: second.path, hash: first.entry.hash }]);
});

test("no topic named means the document is imported and filed nowhere", async () => {
  const r = recorder(HTML_PAGE);
  const got = await ingestArticleUrl(PAGE_URL, null, r.deps);
  expect(got.attachedTo).toBeNull();
  expect(r.attached).toEqual([]);
});

test("a link that is a PDF is imported as a book, not an article", async () => {
  const r = recorder({
    "https://example.com/papers/attention.pdf": ok(PDF_BYTES, "application/pdf"),
  });
  const got = await ingestArticleUrl("https://example.com/papers/attention.pdf", "t1", r.deps);

  expect(got.kind).toBe("book");
  expect(got.entry.kind).toBeUndefined();
  expect(got.entry.format).toBe("pdf");
  expect(got.entry.title).toBe("attention.pdf");
  expect(got.entry.sourceUrl).toBe("https://example.com/papers/attention.pdf");
  // Nothing was extracted and no image was reached for: one fetch, the link.
  expect(r.fetched).toEqual(["https://example.com/papers/attention.pdf"]);
  expect(r.attached).toHaveLength(1);
});

test("a link that cannot be fetched or read leaves nothing behind", async () => {
  const dead = recorder({});
  await expect(ingestArticleUrl(PAGE_URL, "t1", dead.deps)).rejects.toThrow(/HTTP 404/);

  const empty = recorder({ [PAGE_URL]: ok("<html><head></head></html>", "text/html") });
  await expect(ingestArticleUrl(PAGE_URL, "t1", empty.deps)).rejects.toThrow(/no readable article/);

  expect(disk.files.has(LIBRARY_FILE)).toBe(false);
  expect(dead.attached).toEqual([]);
  expect(empty.attached).toEqual([]);
});

test("only https is ingested", async () => {
  await expect(ingestArticleUrl("http://example.com/x", "t1", recorder({}).deps)).rejects.toThrow(
    /https/,
  );
});
