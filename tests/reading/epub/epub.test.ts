// Reading an EPUB, end to end on a book built in memory (fixture.ts): unpack,
// sanitize, paginate, outline, figures, and the Fulltext it all comes out as.
// Run: bash scripts/t.sh tests/reading/epub

import { expect, test } from "bun:test";
import { buildEpub, PNG, prose } from "./fixture";
import { isEpub, looksLikeZip } from "../../../src/reading/epub/sniff";
import { openZip, resolveZipPath } from "../../../src/reading/epub/zip";
import { sanitize, sanitizeDocument } from "../../../src/reading/epub/sanitize";
import { parseEpub } from "../../../src/reading/epub/parse";
import { BLOCK_CHARS, blockTexts, paginate } from "../../../src/reading/epub/paginate";
import { fulltextFrom } from "../../../src/reading/epub/fulltext";
import { epubCfi, parseEpubCfi } from "../../../src/reading/epub/cfi";
import { decodeEpubLocator, encodeEpubLocator } from "../../../src/reading/locator";
import { epubFigures } from "../../../src/reading/figures/epub";
import { renderEpubFigure } from "../../../src/reading/figures/render";
import { sniffContentType } from "../../../src/reading/sources/url";

const IMAGES = { "OEBPS/images/a.png": PNG };

function simpleBook() {
  return buildEpub({
    docs: [
      { name: "c1.xhtml", body: `<h1 id="h1">First</h1>${prose(3)}` },
      {
        name: "c2.xhtml",
        body:
          `<h1 id="h2">Second</h1>${prose(2)}` +
          `<figure><img src="images/a.png" alt="a picture"/>` +
          `<figcaption>Figure 1: the loop</figcaption></figure>` +
          `<p><img src="images/a.png"/></p><p>A short line under it.</p>`,
      },
    ],
    toc: [
      { label: "First", href: "c1.xhtml#h1" },
      { label: "Second", href: "c2.xhtml#h2" },
    ],
    images: IMAGES,
  });
}

// --- sniffing ----------------------------------------------------------------

test("an EPUB is recognised from its zip magic and its mimetype entry", () => {
  const bytes = simpleBook();
  expect(looksLikeZip(bytes)).toBe(true);
  expect(isEpub(bytes)).toBe(true);
  expect(sniffContentType(bytes.subarray(0, 200), null)).toBe("epub");
});

test("a zip that is not an EPUB, and a PDF, are not EPUBs", () => {
  expect(isEpub(buildEpub({ docs: [{ name: "c1.xhtml", body: "<p>x</p>" }], mimetype: null }))).toBe(
    false,
  );
  expect(
    isEpub(buildEpub({ docs: [{ name: "c1.xhtml", body: "<p>x</p>" }], mimetype: "application/zip" })),
  ).toBe(false);
  expect(isEpub(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(false);
});

test("the mimetype entry is found by name, not by being first", () => {
  // The fixture writes mimetype first; the reader looks it up in the central
  // directory either way, which is what a repacked book depends on.
  const zip = openZip(simpleBook());
  expect(zip.entries.some((e) => e.name === "mimetype")).toBe(true);
  expect(zip.text("mimetype")).toBe("application/epub+zip");
});

test("archive paths resolve relative to the entry that named them", () => {
  expect(resolveZipPath("OEBPS/text/c1.xhtml", "../images/a.png")).toBe("OEBPS/images/a.png");
  expect(resolveZipPath("OEBPS/c1.xhtml", "images/a.png#frag")).toBe("OEBPS/images/a.png");
  expect(resolveZipPath("OEBPS/c1.xhtml", "/other/x.png")).toBe("other/x.png");
});

// --- sanitizing --------------------------------------------------------------

const HOSTILE = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>t</title><base href="https://evil.example/"/></head>
<body>
  <script>alert(1)</script>
  <p onclick="steal()" id="keep">text</p>
  <a href="javascript:alert(1)">a</a>
  <a href="data:text/html,&lt;script&gt;">b</a>
  <a href="chapter2.xhtml#top">c</a>
  <img src="images/a.png" alt="A" onerror="steal()"/>
  <iframe src="https://evil.example/"></iframe>
  <form><input name="pw"/></form>
  <span epub:type="pagebreak" id="pb1" title="7"></span>
</body></html>`;

test("scripts, handlers and script-bearing URLs do not survive", () => {
  const out = sanitize(HOSTILE, "OEBPS/c1.xhtml");
  expect(out).not.toContain("alert(1)");
  expect(out).not.toContain("onclick");
  expect(out).not.toContain("onerror");
  expect(out).not.toContain("javascript:");
  expect(out).not.toContain("data:text/html");
  expect(out).not.toContain("<iframe");
  expect(out).not.toContain("<form");
  expect(out).not.toContain("<base");
  // What a book legitimately needs is still there.
  expect(out).toContain('id="keep"');
  expect(out).toContain('src="images/a.png"');
  expect(out).toContain('epub:type="pagebreak"');
  expect(out).toContain('href="chapter2.xhtml#top"');
});

// The tag a regex sanitizer lets through: `[^>]*>` ends the tag at the ">"
// inside the quoted title, so the handler after it reads as text (pitfall 125).
test("a tag hiding a > inside a quoted value is still parsed as a tag", () => {
  const source = `<html xmlns="http://www.w3.org/1999/xhtml"><body>` +
    `<marquee title="a>" onstart="steal()">boo</marquee></body></html>`;
  const out = sanitize(source, "OEBPS/c1.xhtml");
  expect(out).not.toContain("onstart");
  expect(out).not.toContain("steal");
  expect(out).not.toContain("marquee");
});

test("sanitizing twice is byte for byte the same as sanitizing once", () => {
  const cases = [
    HOSTILE,
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><pre>

code</pre></body></html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>a&#13;b</p></body></html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>1 &amp;amp; 2 &lt; 3</p></body></html>`,
    `<html xmlns="http://www.w3.org/1999/xhtml"><body><div><custom-x><p>a</p></custom-x></div></body></html>`,
    // Not well-formed: this one goes through the text/html fallback.
    `<html><body><p>a<br><ul><li>x<li>y</ul></body></html>`,
  ];
  for (const source of cases) {
    const once = sanitize(source, "OEBPS/c1.xhtml");
    expect(sanitize(once, "OEBPS/c1.xhtml")).toBe(once);
  }
});

test("a document says which archive entries it points at, and does not rewrite them", () => {
  const out = sanitizeDocument(HOSTILE, "OEBPS/text/c1.xhtml");
  expect(out?.refs.entries).toEqual(["OEBPS/text/images/a.png"]);
  expect(out?.refs.links).toEqual(["OEBPS/text/chapter2.xhtml"]);
  // The href in the markup is untouched; resolving it is the renderer's job.
  expect(out?.html).toContain('src="images/a.png"');
});

// --- parsing -----------------------------------------------------------------

test("the package, the spine and the navigation come out of the archive", () => {
  const book = parseEpub(simpleBook());
  expect(book.pkg.title).toBe("A Synthetic Book");
  expect(book.pkg.language).toBe("en");
  expect(book.docs.map((d) => d.entry)).toEqual(["OEBPS/c1.xhtml", "OEBPS/c2.xhtml"]);
  expect(book.nav.toc.map((t) => t.title)).toEqual(["First", "Second"]);
  expect(book.docs[0].text.text).toContain("the quick brown fox");
});

// --- pagination --------------------------------------------------------------

test("a book with no page list is cut into blocks of a fixed size", () => {
  const book = parseEpub(simpleBook());
  const pagination = paginate(book);
  expect(pagination.source).toBe("synthetic");
  expect(pagination.blockChars).toBe(1800);
  expect(pagination.blocks.length).toBeGreaterThan(1);
  const pages = blockTexts(book, pagination);
  expect(pages.length).toBe(pagination.blocks.length);
  for (const page of pages) expect(page.length).toBeLessThanOrEqual(BLOCK_CHARS);
  // Nothing is lost and nothing is duplicated: the blocks are the documents.
  const joined = pages.join("").replace(/\s+/g, "");
  const whole = book.docs.map((d) => d.text.text).join("").replace(/\s+/g, "");
  expect(joined).toBe(whole);
});

test("a book with a page list is cut at its printed pages", () => {
  const bytes = buildEpub({
    docs: [
      {
        name: "c1.xhtml",
        body:
          `<span epub:type="pagebreak" id="pg1" title="1"></span>${prose(1)}` +
          `<span epub:type="pagebreak" id="pg2" title="2"></span>${prose(1)}` +
          `<span epub:type="pagebreak" id="pg3" title="3"></span>${prose(1)}`,
      },
    ],
    pageList: [
      { label: "1", href: "c1.xhtml#pg1" },
      { label: "2", href: "c1.xhtml#pg2" },
      { label: "3", href: "c1.xhtml#pg3" },
    ],
  });
  const book = parseEpub(bytes);
  const pagination = paginate(book);
  expect(pagination.source).toBe("page-list");
  expect(pagination.blocks.map((b) => b.label)).toEqual(["1", "2", "3"]);
  const ft = fulltextFrom(book, pagination);
  expect(ft.pageLabels).toEqual(["1", "2", "3"]);
  expect(ft.pages).toHaveLength(3);
});

test("a page-list entry pointing at nothing is dropped, not guessed at", () => {
  const bytes = buildEpub({
    docs: [{ name: "c1.xhtml", body: `<span epub:type="pagebreak" id="pg1" title="1"></span>${prose(4)}` }],
    pageList: [
      { label: "1", href: "c1.xhtml#pg1" },
      { label: "2", href: "c1.xhtml#missing" },
    ],
  });
  const pagination = paginate(parseEpub(bytes));
  // One anchor left is not a page list; the book falls back to fixed blocks.
  expect(pagination.source).toBe("synthetic");
});

// --- the Fulltext ------------------------------------------------------------

test("an EPUB produces the Fulltext shape a PDF produces", () => {
  const book = parseEpub(simpleBook());
  const pagination = paginate(book);
  const ft = fulltextFrom(book, pagination);
  expect(ft.kind).toBe("epub");
  expect(ft.status).toBe("ok");
  expect(ft.pages.length).toBeGreaterThan(0);
  expect(ft.pageLocators).toHaveLength(ft.pages.length);
  // No printed page numbers in this book, so no labels at all rather than a
  // list of blanks.
  expect(ft.pageLabels).toBeUndefined();
  expect(ft.outline.map((o) => o.title)).toEqual(["First", "Second"]);
  for (const item of ft.outline) {
    expect(item.page).toBeGreaterThan(0);
    expect(item.page).toBeLessThanOrEqual(ft.pages.length);
  }
  // The outline never goes backwards: chapter two is not before chapter one.
  const pages = ft.outline.map((o) => o.page);
  expect([...pages].sort((a, b) => a - b)).toEqual(pages);
});

// --- locators ----------------------------------------------------------------

test("a locator round-trips through its string form", () => {
  const cfi = epubCfi(2, "c2", "/4/6/1:12");
  expect(cfi).toBe("epubcfi(/6/6[c2]!/4/6/1:12)");
  const parsed = parseEpubCfi(cfi);
  expect(parsed).toEqual({ spineIndex: 2, idref: "c2", steps: [4, 6, 1], offset: 12 });
  const locator = decodeEpubLocator(cfi);
  expect(locator).toEqual({ kind: "epub", cfi });
  expect(encodeEpubLocator(locator!)).toBe(cfi);
  expect(decodeEpubLocator("not a cfi")).toBeNull();
  // A range is not a position this app writes, so it is refused rather than
  // half-understood.
  expect(decodeEpubLocator("epubcfi(/6/4!/4/2,/1:0,/1:5)")).toBeNull();
});

test("every position block's locator is a CFI naming that block's spine item", () => {
  const book = parseEpub(simpleBook());
  for (const block of paginate(book).blocks) {
    const parsed = parseEpubCfi(block.cfi);
    expect(parsed?.spineIndex).toBe(block.spine);
    expect(parsed?.idref).toBe(book.docs[block.spine].idref);
  }
});

// --- figures -----------------------------------------------------------------

test("figures come off the markup, with the caption ladder and the printed id", () => {
  const book = parseEpub(simpleBook());
  const index = epubFigures(book, paginate(book));
  expect(index.status).toBe("ok");
  expect(index.figures).toHaveLength(2);

  const [figcap, nearby] = index.figures;
  // A caption that prints a number keeps the number the book printed.
  expect(figcap.id).toBe("1");
  expect(figcap.caption).toBe("Figure 1: the loop");
  expect(figcap.captionSource).toBe("figcaption");
  expect(figcap.source).toEqual({ kind: "epub", href: "OEBPS/images/a.png" });

  // No caption of its own: the short paragraph beside it, and an issued id.
  expect(nearby.id).toBe("c2-1");
  expect(nearby.caption).toBe("A short line under it.");
  expect(nearby.captionSource).toBe("nearby");
});

test("the alt text is the caption when there is no figcaption", () => {
  const bytes = buildEpub({
    docs: [{ name: "c1.xhtml", body: `<p><img src="images/a.png" alt="A diagram"/></p>` }],
    images: IMAGES,
  });
  const book = parseEpub(bytes);
  const [figure] = epubFigures(book, paginate(book)).figures;
  expect(figure.caption).toBe("A diagram");
  expect(figure.captionSource).toBe("alt");
});

test("a figure's bytes come straight out of the archive", () => {
  const bytes = simpleBook();
  const book = parseEpub(bytes);
  const [figure] = epubFigures(book, paginate(book)).figures;
  const rendered = renderEpubFigure(bytes.buffer.slice(0) as ArrayBuffer, "OEBPS/images/a.png");
  expect(rendered?.mimeType).toBe("image/png");
  expect(rendered?.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
  expect(figure.source.kind).toBe("epub");
});
