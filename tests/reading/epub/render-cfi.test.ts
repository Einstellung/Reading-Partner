// The one invariant the two halves of EPUB support stand on: a page's CFI,
// computed by the ingestion against the sanitized tree, resolves in the page
// card's tree to the same place in the same text (docs/63).
//
// The card's tree is a deep clone of the sanitized document's <html> element
// hung under a div in a shadow root, and it is resolved with the app's own
// cfi.ts. Foliate's epubcfi.js resolves the same strings against the parsed
// document as a second reading of the grammar: a CFI this app writes must be
// one every other EPUB reader reads.

import { describe, expect, test } from "bun:test";
import { parseCfiStart, parseEpubCfi, resolvePoint } from "../../../src/reading/epub/cfi";
import { blockNumberAt, characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { parseEpub, type EpubBook } from "../../../src/reading/epub/parse";
import { indexRuns, offsetOfPoint } from "../../../src/reading/epub/reader-logic";
import { extractDocumentText } from "../../../src/reading/epub/text";
import { buildEpub, prose } from "./fixture";

// The vendored parser, by path rather than by the `foliate-js` alias: that
// alias is vite's, and this runs under bun.
const EPUBCFI = "../../../vendor/foliate-js/epubcfi.js";
const CFI = (await import(EPUBCFI)) as {
  parse(cfi: string): unknown;
  toRange(doc: Document, parts: unknown): Range;
};

const ruler = characterRuler(500);

// What a page card holds: the sanitized <html> cloned whole under a plain
// element, the way page-mount.ts hangs it inside the multi-column box.
function cardTree(book: EpubBook, spine: number): Element {
  const doc = book.docs[spine].doc;
  const holder = doc.createElement("div");
  holder.append(doc.documentElement.cloneNode(true));
  return holder.firstElementChild!;
}

function foliateRange(doc: Document, cfi: string): Range {
  const parts = CFI.parse(cfi) as { parent?: unknown[] } & unknown[];
  const top = (parts.parent ?? parts) as unknown[];
  top.shift();
  return CFI.toRange(doc, parts);
}

describe("a page's CFI resolves in the card's tree", () => {
  test("every page of a book lands in that page, in both resolvers", async () => {
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
    const pagination = await paginate(book, ruler);
    expect(pagination.blocks.length).toBeGreaterThan(3);
    const roots = book.docs.map((_, i) => cardTree(book, i));

    for (const [i, block] of pagination.blocks.entries()) {
      const root = roots[block.spine];
      const parsed = parseCfiStart(block.cfi)!;
      expect(parsed.spineIndex).toBe(block.spine);
      const at = resolvePoint(root, parsed)!;
      expect(at).not.toBeNull();
      const text = extractDocumentText(root);
      const offset = offsetOfPoint(text, indexRuns(text), at.node, at.offset);
      expect(blockNumberAt(pagination, block.spine, offset) - 1).toBe(i);
      // And the same characters: the page starts here in both readings.
      const ingested = book.docs[block.spine].text.text.slice(block.charOffset).trim();
      const rendered = text.text.slice(offset).trim();
      expect(rendered.slice(0, 24)).toBe(ingested.slice(0, 24));

      // Foliate reads the same string to the same node of the parsed document.
      const range = foliateRange(book.docs[block.spine].doc, block.cfi);
      const docText = book.docs[block.spine].text;
      const theirs = offsetOfPoint(docText, indexRuns(docText), range.startContainer, range.startOffset);
      expect(theirs).toBe(block.charOffset);
    }
  });

  test("a book with printed page numbers resolves those anchors too", async () => {
    const book = parseEpub(
      buildEpub({
        docs: [
          {
            name: "c1.xhtml",
            body:
              `<p>front</p>` +
              [1, 2, 3, 4]
                .map((n) => `<span epub:type="pagebreak" id="p${n}"/><p>Page ${n} says ${prose(1, 90)}</p>`)
                .join(""),
          },
        ],
        pageList: [1, 2, 3, 4].map((n) => ({ label: String(n), href: `c1.xhtml#p${n}` })),
      }),
    );
    const pagination = await paginate(book, characterRuler(100));
    const root = cardTree(book, 0);
    for (const [i, block] of pagination.blocks.entries()) {
      const at = resolvePoint(root, parseEpubCfi(block.cfi)!)!;
      const text = extractDocumentText(root);
      const offset = offsetOfPoint(text, indexRuns(text), at.node, at.offset);
      expect(blockNumberAt(pagination, block.spine, offset) - 1).toBe(i);
    }
    // The labels are the numbers the book printed, front matter aside.
    expect(pagination.blocks[0].label).toBeNull();
    expect(pagination.blocks.slice(1).map((b) => b.label)).toEqual(["1", "2", "3", "4"]);
  });

  test("the sanitized document is what the card clones, never the archive's", () => {
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
    const html = book.docs[0].html;
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
    expect(html).toContain("bye");
    const root = cardTree(book, 0);
    expect(root.querySelector("script")).toBeNull();
  });
});
