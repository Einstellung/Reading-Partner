// The one invariant the two halves of EPUB support stand on: a position block's
// CFI, computed by the ingestion against the sanitized tree, resolves in the
// renderer's document to the same place in the same text.
//
// It can break in two ways and both are silent. The renderer could be handed a
// different document than the one the offsets were counted on — which is why
// render-book.ts feeds it the sanitized markup and not the archive's. And the
// journey from that markup to the frame's document is not a copy: foliate parses
// it, rewrites every href to a blob URL and serializes it again (epub.js
// loadReplaced), and a parse/serialize round trip is free to move nodes around.
// So the assertion is made against a document put through that same round trip,
// resolved with foliate's own epubcfi.js rather than with ours.

import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { blockNumberAt, paginate } from "../../../src/reading/epub/paginate";
import { parseEpub, type EpubBook } from "../../../src/reading/epub/parse";
import { indexRuns, offsetOfPoint } from "../../../src/reading/epub/reader-logic";
import { renderLoader } from "../../../src/reading/epub/render-book";
import { extractDocumentText } from "../../../src/reading/epub/text";
import { buildEpub, prose } from "./fixture";

// The vendored parser, by path rather than by the `foliate-js` alias: that
// alias is vite's, and this runs under bun. The specifier is a variable because
// a literal one would be resolved by the compiler, which has only the ambient
// declarations for the app's side of it (src/reading/epub/foliate-js.d.ts).
const EPUBCFI = "../../../vendor/foliate-js/epubcfi.js";
const CFI = (await import(EPUBCFI)) as {
  parse(cfi: string): unknown;
  toRange(doc: Document, parts: unknown): Range;
};

// The preload puts a DOMParser on globalThis but not a serializer; this half of
// the round trip needs one, and it comes from the same place (tests/support).
const { JSDOM } = createRequire(import.meta.url)("jsdom") as typeof import("jsdom");
const XMLSerializer = new JSDOM("").window.XMLSerializer;

// What the frame ends up holding: foliate parses the text it is given, rewrites
// resource references, and serializes the result into the blob it loads.
function frameDocument(source: string): Document {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(source, "application/xhtml+xml");
  expect(parsed.querySelector("parsererror")).toBeNull();
  const serialized = new XMLSerializer().serializeToString(parsed);
  const frame = parser.parseFromString(serialized, "application/xhtml+xml");
  expect(frame.querySelector("parsererror")).toBeNull();
  return frame;
}

// The renderer's side of the map, spelled the way view.js spells it: parse the
// CFI, drop the package step that named the spine item, resolve what is left
// against the document in the frame.
function rangeOf(doc: Document, cfi: string): Range {
  const parts = CFI.parse(cfi) as { parent?: unknown[] } & unknown[];
  const top = (parts.parent ?? parts) as unknown[];
  top.shift();
  return CFI.toRange(doc, parts);
}

function framesOf(book: EpubBook): Document[] {
  const loader = renderLoader(book);
  return book.docs.map((d) => {
    const text = loader.loadText(d.entry);
    expect(text).toBe(d.html);
    return frameDocument(text!);
  });
}

describe("a block's CFI resolves in the renderer's document", () => {
  test("every block of a synthetic book lands in that block", () => {
    const book = parseEpub(
      buildEpub({
        docs: [
          { name: "c1.xhtml", body: `<h1>One</h1>${prose(12, 350)}` },
          {
            name: "c2.xhtml",
            body: `<h1>Two</h1><figure><img src="i.png" alt="a"/><figcaption>Fig</figcaption></figure>${prose(9, 420)}`,
          },
        ],
        images: { "OEBPS/i.png": new Uint8Array([1, 2, 3]) },
      }),
    );
    const pagination = paginate(book);
    const frames = framesOf(book);
    expect(pagination.blocks.length).toBeGreaterThan(3);

    for (const [i, block] of pagination.blocks.entries()) {
      const frame = frames[block.spine];
      const range = rangeOf(frame, block.cfi);
      const text = extractDocumentText(frame);
      const at = offsetOfPoint(
        text,
        indexRuns(text),
        range.startContainer,
        range.startOffset,
      );
      expect(blockNumberAt(pagination, block.spine, at) - 1).toBe(i);
      // And the same characters: the block starts here in both readings.
      const ingested = book.docs[block.spine].text.text.slice(block.charOffset).trim();
      const rendered = text.text.slice(at).trim();
      expect(rendered.slice(0, 24)).toBe(ingested.slice(0, 24));
    }
  });

  test("a book with printed page numbers resolves those anchors too", () => {
    const book = parseEpub(
      buildEpub({
        docs: [
          {
            name: "c1.xhtml",
            body:
              `<p>front</p>` +
              [1, 2, 3, 4]
                .map(
                  (n) =>
                    `<span epub:type="pagebreak" id="p${n}"/><p>Page ${n} says ${prose(1, 90)}</p>`,
                )
                .join(""),
          },
        ],
        pageList: [1, 2, 3, 4].map((n) => ({ label: String(n), href: `c1.xhtml#p${n}` })),
      }),
    );
    const pagination = paginate(book);
    expect(pagination.source).toBe("page-list");
    const frames = framesOf(book);

    for (const [i, block] of pagination.blocks.entries()) {
      const frame = frames[block.spine];
      const text = extractDocumentText(frame);
      const range = rangeOf(frame, block.cfi);
      const at = offsetOfPoint(text, indexRuns(text), range.startContainer, range.startOffset);
      expect(blockNumberAt(pagination, block.spine, at) - 1).toBe(i);
    }
    // The labels are the numbers the book printed, front matter aside.
    expect(pagination.blocks.map((b) => b.label)).toEqual([null, "1", "2", "3", "4"]);
  });

  test("the loader hands the renderer the sanitized document, never the archive's", () => {
    const book = parseEpub(
      buildEpub({
        docs: [
          {
            name: "c1.xhtml",
            body: `<p onclick="alert(1)">hi</p><script>window.x=1</script><p>bye</p>`,
          },
        ],
      }),
    );
    const text = renderLoader(book).loadText(book.docs[0].entry)!;
    expect(text).not.toContain("onclick");
    expect(text).not.toContain("<script");
    expect(text).toContain("bye");
  });

  test("an image comes out of the archive as a blob of the right type", () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const book = parseEpub(
      buildEpub({
        docs: [{ name: "c1.xhtml", body: `<p><img src="i.png" alt="a"/></p>` }],
        images: { "OEBPS/i.png": png },
      }),
    );
    const loader = renderLoader(book);
    const blob = loader.loadBlob("OEBPS/i.png");
    expect(blob?.type).toBe("image/png");
    expect(blob?.size).toBe(png.length);
    expect(loader.getSize("OEBPS/i.png")).toBe(png.length);
    expect(loader.loadBlob("OEBPS/nothing.png")).toBeNull();
  });
});
