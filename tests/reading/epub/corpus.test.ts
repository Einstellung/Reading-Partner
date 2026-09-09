// The same pipeline against real books, when this machine has some. The
// directory holds copyrighted EPUBs and nothing from it is in this repository;
// a machine without it skips these cases rather than failing them.
//
// What is asserted is what has to hold for every book, not what any one book
// contains: the parse succeeds, there is at least one position block, no block
// is larger than the cut allows, the outline is inside the book and never goes
// backwards, and every figure names an entry the archive really has.
//
// Point it somewhere else with EPUB_CORPUS=/path/to/books.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEpub } from "../../../src/reading/epub/parse";
import { BLOCK_CHARS, paginate } from "../../../src/reading/epub/paginate";
import { fulltextFrom } from "../../../src/reading/epub/fulltext";
import { parseEpubCfi } from "../../../src/reading/epub/cfi";
import { isEpub } from "../../../src/reading/epub/sniff";
import { epubFigures } from "../../../src/reading/figures/epub";

const CORPUS =
  process.env.EPUB_CORPUS ?? "/home/xinyuan/Documents/Github/epub-translator/output";

const books = existsSync(CORPUS)
  ? readdirSync(CORPUS)
      .filter((f) => f.toLowerCase().endsWith(".epub"))
      .sort()
  : [];

// A block cut at a printed page boundary is as long as the printed page was, so
// only the synthetic cut has a size to hold to. The slack is one snap window:
// the cut moves back to the nearest line break, never forward.
const SYNTHETIC_MAX = BLOCK_CHARS;

describe.skipIf(books.length === 0)("real books", () => {
  for (const name of books) {
    test(name, () => {
      const bytes = new Uint8Array(readFileSync(join(CORPUS, name)));
      expect(isEpub(bytes)).toBe(true);

      const started = Date.now();
      const book = parseEpub(bytes);
      const pagination = paginate(book);
      const ft = fulltextFrom(book, pagination);
      const figures = epubFigures(book, pagination);
      const elapsed = Date.now() - started;

      expect(book.docs.length).toBeGreaterThan(0);
      expect(ft.pages.length).toBeGreaterThan(0);
      expect(ft.pages.length).toBe(pagination.blocks.length);
      expect(ft.status).toBe("ok");

      if (pagination.source === "synthetic") {
        for (const page of ft.pages) expect(page.length).toBeLessThanOrEqual(SYNTHETIC_MAX);
      }

      // Every block's locator is a CFI naming the spine item it starts in.
      expect(ft.pageLocators).toHaveLength(ft.pages.length);
      for (const block of pagination.blocks) {
        expect(parseEpubCfi(block.cfi)?.spineIndex).toBe(block.spine);
      }

      // The outline is inside the book, and a later position in the book is
      // never an earlier page. Not "the outline reads forwards": a book's own
      // table of contents need not be in spine order, and several of these are
      // not (docs/pitfall/240).
      const byEntry = new Map(book.docs.map((d) => [d.entry, d]));
      let previous = -1;
      const positions = book.nav.toc.map((nav) => {
        const doc = byEntry.get(nav.entry);
        if (!doc) return null;
        const el = nav.fragment ? doc.text.ids.get(nav.fragment) : undefined;
        return { spine: doc.index, offset: el ? (doc.text.offsets.get(el) ?? 0) : 0 };
      });
      const ordered = ft.outline
        .map((item, i) => ({ item, at: positions.filter((p) => p !== null)[i]! }))
        .sort((a, b) => a.at.spine - b.at.spine || a.at.offset - b.at.offset);
      for (const { item } of ordered) {
        expect(item.page).toBeGreaterThan(0);
        expect(item.page).toBeLessThanOrEqual(ft.pages.length);
        expect(item.page).toBeGreaterThanOrEqual(previous);
        previous = item.page;
      }

      // Every figure names an entry the archive has, and is on a page the book
      // has. Three of them are actually inflated: one lookup walks the central
      // directory, and the largest book here has 2283 figures.
      const hrefs: string[] = [];
      for (const figure of figures.figures) {
        expect(figure.source.kind).toBe("epub");
        const href = figure.source.kind === "epub" ? figure.source.href : "";
        expect(`${figure.id}: ${book.zip.has(href)}`).toBe(`${figure.id}: true`);
        expect(figure.page).toBeGreaterThan(0);
        expect(figure.page).toBeLessThanOrEqual(ft.pages.length);
        hrefs.push(href);
      }
      for (const at of [0, hrefs.length >> 1, hrefs.length - 1]) {
        if (at < 0) continue;
        expect(book.zip.bytes(hrefs[at])?.length ?? 0).toBeGreaterThan(0);
      }

      console.log(
        `${name}: ${(bytes.length / 1e6).toFixed(1)} MB, ${book.docs.length} spine, ` +
          `${ft.pages.length} blocks (${pagination.source}), ${ft.outline.length} outline, ` +
          `${figures.figures.length} figures, ${elapsed} ms`,
      );
      // The 71 MB book reads in about 2.6 s here. The default 5 s is not enough
      // room for that plus the assertions when the whole suite is running.
    }, 30000);
  }
});
