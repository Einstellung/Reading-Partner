// Building an EPUB out of a web article (docs/67), and reading the result back
// through the pipeline a book goes through: unpack, parse, paginate.
// Run: bash scripts/t.sh tests/reading/epub/build-article.test.ts

import { expect, test } from "bun:test";
import { buildArticleEpub, MISSING_IMAGE_HEIGHT } from "../../../src/reading/epub/build-article";
import { isEpub } from "../../../src/reading/epub/sniff";
import { openZip } from "../../../src/reading/epub/zip";
import { parseEpub } from "../../../src/reading/epub/parse";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { fulltextFrom } from "../../../src/reading/epub/fulltext";
import { PNG } from "./fixture";

const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 0, 1, 0, 0x80, 0, 0]);

const PROSE = "the quick brown fox jumps over the lazy dog. ".repeat(8);

const BODY = `<div id="readability-page-1">
  <p>${PROSE}</p>
  <h2 id="first-section">The first section</h2>
  <p>${PROSE}</p>
  <figure>
    <img src="https://cdn.example.com/a.png" alt="a diagram"/>
    <figcaption>Figure 1</figcaption>
  </figure>
  <h3>A sub-heading</h3>
  <p>${PROSE}</p>
  <p><img src="https://cdn.example.com/gone.jpg" alt="the one that failed"/></p>
  <h2>The second section</h2>
  <p>Read <a href="https://example.com/other">the other one</a> too.</p>
  <script>alert(1)</script>
  <p onclick="steal()">${PROSE}</p>
  <iframe src="https://evil.example/"></iframe>
  <link rel="stylesheet" href="https://cdn.example.com/site.css"/>
  <style>body { background: url(https://cdn.example.com/bg.png); }</style>
</div>`;

const INPUT = {
  title: "How a web page becomes a book",
  byline: "A Writer",
  sourceUrl: "https://example.com/posts/how-a-web-page-becomes-a-book",
  publishedAt: "2026-09-12T08:30:00Z",
  html: BODY,
  images: [{ src: "https://cdn.example.com/a.png", bytes: PNG, mediaType: "image/png" }],
};

function article(bytes: Uint8Array): string {
  const text = openZip(bytes).text("text/article.xhtml");
  expect(text).not.toBeNull();
  return text as string;
}

// --- the container -----------------------------------------------------------

test("the article is an EPUB: mimetype first and stored, and the fixed parts present", async () => {
  const bytes = await buildArticleEpub(INPUT);
  expect(isEpub(bytes)).toBe(true);
  const zip = openZip(bytes);
  expect(zip.entries[0].name).toBe("mimetype");
  // Stored, not deflated: the local header sits at a fixed offset and the entry
  // is its own literal bytes, which is what a sniffer reading the head finds.
  const mimetype = "application/epub+zip";
  expect(new TextDecoder().decode(bytes.subarray(38, 38 + mimetype.length))).toBe(mimetype);
  for (const name of ["META-INF/container.xml", "package.opf", "nav.xhtml", "text/article.xhtml"]) {
    expect(zip.has(name)).toBe(true);
  }
});

test("the same article built twice is the same bytes", async () => {
  const first = await buildArticleEpub(INPUT);
  const second = await buildArticleEpub({ ...INPUT, images: [...INPUT.images] });
  expect(second).toEqual(first);
  // And the entries are in a fixed order whatever order the images arrived in.
  const twoImages = {
    ...INPUT,
    html: BODY.replace("gone.jpg", "b.gif"),
    images: [
      { src: "https://cdn.example.com/a.png", bytes: PNG, mediaType: "image/png" },
      { src: "https://cdn.example.com/b.gif", bytes: GIF, mediaType: "image/gif" },
    ],
  };
  const forward = await buildArticleEpub(twoImages);
  const reversed = await buildArticleEpub({ ...twoImages, images: [...twoImages.images].reverse() });
  expect(reversed).toEqual(forward);
});

test("a different article is different bytes", async () => {
  const a = await buildArticleEpub(INPUT);
  const b = await buildArticleEpub({ ...INPUT, title: "Another title" });
  expect(b).not.toEqual(a);
});

// --- the header --------------------------------------------------------------

test("the spine document opens with the title, the byline, the date and the source", async () => {
  const xhtml = article(await buildArticleEpub(INPUT));
  expect(xhtml).toContain("How a web page becomes a book");
  expect(xhtml).toContain("A Writer");
  expect(xhtml).toContain("2026-09-12");
  // The URL as text, so a page read offline still says where it came from.
  expect(xhtml).toContain(
    '<p class="rp-source">https://example.com/posts/how-a-web-page-becomes-a-book</p>',
  );
});

test("what the article does not carry is not invented", async () => {
  const xhtml = article(
    await buildArticleEpub({ ...INPUT, byline: undefined, publishedAt: undefined }),
  );
  expect(xhtml).not.toContain('<p class="rp-byline"');
  expect(xhtml).not.toContain('<p class="rp-published"');
});

// --- nothing remote ----------------------------------------------------------

// Every http(s) the document is allowed to contain: the namespace declarations
// the XHTML needs, the source line in the header, and the hrefs of the article's
// own links, which are somewhere to go rather than something to load.
function withoutAllowedUrls(xhtml: string): string {
  return xhtml
    .replace(/xmlns(:[a-z]+)?="[^"]*"/g, "")
    .replace(/<p class="rp-source">[^<]*<\/p>/, "")
    .replace(/<a [^>]*>/g, "<a>");
}

test("no remote reference survives in the spine document", async () => {
  const xhtml = article(await buildArticleEpub(INPUT));
  expect(withoutAllowedUrls(xhtml)).not.toContain("http");
  expect(xhtml).not.toContain("<script");
  expect(xhtml).not.toContain("<iframe");
  expect(xhtml).not.toContain("<link");
  expect(xhtml).not.toContain("alert(1)");
  expect(xhtml).not.toContain("onclick");
  expect(xhtml).not.toContain("cdn.example.com");
  // A link in the prose keeps its destination.
  expect(xhtml).toContain('href="https://example.com/other"');
});

test("a remote reference hidden in markup the sanitizer keeps is removed too", async () => {
  const bytes = await buildArticleEpub({
    ...INPUT,
    html:
      `<p>${PROSE}</p>` +
      `<svg width="10" height="10"><image xlink:href="https://cdn.example.com/x.png"/></svg>` +
      `<p><img src="//cdn.example.com/protocol-relative.png" alt="p"/></p>`,
    images: [],
  });
  const xhtml = article(bytes);
  expect(withoutAllowedUrls(xhtml)).not.toContain("http");
  expect(xhtml).not.toContain("cdn.example.com");
});

// --- images ------------------------------------------------------------------

test("a fetched image is packed under its content hash and pointed at from the text", async () => {
  const bytes = await buildArticleEpub(INPUT);
  const zip = openZip(bytes);
  const images = zip.entries.filter((e) => e.name.startsWith("images/"));
  expect(images).toHaveLength(1);
  expect(images[0].name).toMatch(/^images\/[0-9a-f]{32}\.png$/);
  expect(zip.bytes(images[0].name)).toEqual(PNG);
  const xhtml = article(bytes);
  expect(xhtml).toContain(`src="../${images[0].name}"`);
  // The manifest declares it, which is what makes it part of the publication.
  expect(zip.text("package.opf")).toContain(`href="${images[0].name}"`);
});

test("one picture served from two URLs is packed once", async () => {
  const bytes = await buildArticleEpub({
    ...INPUT,
    html: `<p><img src="https://cdn.example.com/a.png" alt="a"/></p>` +
      `<p><img src="https://cdn.example.com/copy.png" alt="b"/></p>`,
    images: [
      { src: "https://cdn.example.com/a.png", bytes: PNG, mediaType: "image/png" },
      { src: "https://cdn.example.com/copy.png", bytes: PNG, mediaType: "image/png" },
    ],
  });
  const zip = openZip(bytes);
  expect(zip.entries.filter((e) => e.name.startsWith("images/"))).toHaveLength(1);
});

test("an image that did not arrive becomes a block of fixed height that keeps its alt", async () => {
  const xhtml = article(await buildArticleEpub(INPUT));
  expect(xhtml).toContain(
    `<div class="rp-missing-image" style="height: ${MISSING_IMAGE_HEIGHT}px">` +
      `the one that failed</div>`,
  );
});

test("an image type the archive cannot carry is a placeholder, not an entry", async () => {
  const bytes = await buildArticleEpub({
    ...INPUT,
    html: `<p><img src="https://cdn.example.com/a.svg" alt="vector"/></p>`,
    images: [
      { src: "https://cdn.example.com/a.svg", bytes: PNG, mediaType: "image/svg+xml" },
    ],
  });
  expect(openZip(bytes).entries.filter((e) => e.name.startsWith("images/"))).toHaveLength(0);
  expect(article(bytes)).toContain("rp-missing-image");
});

// --- read back through the pipeline -----------------------------------------

test("the product opens as a book: one spine document, the outline, the pages", async () => {
  const bytes = await buildArticleEpub(INPUT);
  const book = parseEpub(bytes);
  expect(book.docs).toHaveLength(1);
  expect(book.docs[0].entry).toBe("text/article.xhtml");
  expect(book.pkg.title).toBe("How a web page becomes a book");
  expect(book.pkg.creator).toBe("A Writer");
  expect(book.pkg.language).toBe("en");

  // The navigation is the headings of the body, the article's own title first.
  expect(book.nav.toc.map((t) => t.title)).toEqual([
    "How a web page becomes a book",
    "The first section",
    "A sub-heading",
    "The second section",
  ]);
  expect(book.nav.toc.map((t) => t.level)).toEqual([0, 1, 2, 1]);
  for (const entry of book.nav.toc) {
    expect(entry.entry).toBe("text/article.xhtml");
    expect(entry.fragment).not.toBeNull();
    expect(book.docs[0].doc.getElementById(entry.fragment as string)).not.toBeNull();
  }

  // Every resource the document names is an entry of this archive, and the only
  // absolute URLs left in it are the destinations of its own links.
  expect(book.docs[0].refs.entries.length).toBeGreaterThan(0);
  for (const entry of book.docs[0].refs.entries) expect(book.zip.has(entry)).toBe(true);
  expect(book.docs[0].refs.external).toEqual(["https://example.com/other"]);
  for (const url of book.docs[0].refs.external) {
    expect(book.docs[0].doc.querySelector(`a[href="${url}"]`)).not.toBeNull();
  }

  expect(book.docs[0].text.text).toContain("the quick brown fox");
  expect(book.docs[0].text.text).toContain("How a web page becomes a book");

  const pagination = await paginate(book, characterRuler(700));
  expect(pagination.blocks.length).toBeGreaterThanOrEqual(1);
  const ft = fulltextFrom(book, pagination);
  expect(ft.kind).toBe("epub");
  expect(ft.status).toBe("ok");
  expect(ft.outline.map((o) => o.title)).toContain("The first section");
});

test("two headings the article gave the same id still get one nav entry each", async () => {
  const bytes = await buildArticleEpub({
    ...INPUT,
    html: `<h2 id="s">One</h2><p>${PROSE}</p><h2 id="s">Two</h2><p>${PROSE}</p>`,
    images: [],
  });
  const book = parseEpub(bytes);
  const fragments = book.nav.toc.map((t) => t.fragment);
  expect(new Set(fragments).size).toBe(fragments.length);
  for (const fragment of fragments) {
    expect(book.docs[0].doc.getElementById(fragment as string)).not.toBeNull();
  }
});

test("an article with no headings still has a table of contents", async () => {
  const bytes = await buildArticleEpub({ ...INPUT, title: "", html: `<p>${PROSE}</p>`, images: [] });
  const book = parseEpub(bytes);
  expect(book.nav.toc.map((t) => t.title)).toEqual(["Untitled"]);
  expect(book.pkg.title).toBe("Untitled");
});
