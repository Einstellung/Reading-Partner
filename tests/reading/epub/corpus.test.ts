// The same pipeline against real books, when this machine has some. The
// directory holds copyrighted EPUBs and nothing from it is in this repository;
// a machine without it skips these cases rather than failing them.
//
// The ruler here cuts by characters (there is no webview under bun), so what
// is asserted is what has to hold for every book whatever the ruler: the parse
// succeeds, the table has the shape the app reads, every page's CFI resolves
// back to its own text, the outline is inside the book and never goes
// backwards, and every figure names an entry the archive really has.
//
// Point it somewhere else with EPUB_CORPUS=/path/to/books.

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEpub } from "../../../src/reading/epub/parse";
import { characterRuler, paginate } from "../../../src/reading/epub/paginate";
import { fulltextFrom } from "../../../src/reading/epub/fulltext";
import { parseCfiStart, resolvePoint } from "../../../src/reading/epub/cfi";
import { isEpub } from "../../../src/reading/epub/sniff";
import { indexRuns, offsetOfPoint } from "../../../src/reading/epub/text";
import { epubFigures } from "../../../src/reading/figures/epub";

const CORPUS =
  process.env.EPUB_CORPUS ?? "/home/xinyuan/Documents/Github/epub-translator/output";

const books = existsSync(CORPUS)
  ? readdirSync(CORPUS)
      .filter((f) => f.toLowerCase().endsWith(".epub"))
      .sort()
  : [];

// About what a 6x9 page of 16px serif holds; the real number is the webview's.
const PAGE_CHARS = 1500;

describe.skipIf(books.length === 0)("real books", () => {
  for (const name of books) {
    test(name, async () => {
      const bytes = new Uint8Array(readFileSync(join(CORPUS, name)));
      expect(isEpub(bytes)).toBe(true);

      const started = Date.now();
      const book = parseEpub(bytes);
      const pagination = await paginate(book, characterRuler(PAGE_CHARS));
      const ft = fulltextFrom(book, pagination);
      const figures = epubFigures(book, pagination);
      const elapsed = Date.now() - started;

      expect(book.docs.length).toBeGreaterThan(0);
      expect(ft.pages.length).toBeGreaterThan(0);
      expect(ft.pages.length).toBe(pagination.blocks.length);
      expect(ft.status).toBe("ok");
      for (const page of ft.pages) expect(page.length).toBeLessThanOrEqual(PAGE_CHARS);

      // Every page's locator is a CFI naming the spine item it starts in and
      // resolving, in that document, to the offset the table recorded.
      expect(ft.pageLocators).toHaveLength(ft.pages.length);
      const runs = new Map<number, ReturnType<typeof indexRuns>>();
      for (const block of pagination.blocks) {
        const parsed = parseCfiStart(block.cfi);
        expect(parsed?.spineIndex).toBe(block.spine);
        const doc = book.docs[block.spine];
        const at = resolvePoint(doc.doc.documentElement, parsed!);
        expect(at).not.toBeNull();
        let index = runs.get(doc.index);
        if (!index) {
          index = indexRuns(doc.text);
          runs.set(doc.index, index);
        }
        expect(offsetOfPoint(doc.text, index, at!.node, at!.offset)).toBe(block.charOffset);
      }

      // The book's CSS survived the sanitizer somewhere, if the book had any.
      const styled = book.docs.filter((d) => d.html.includes("<style>") || d.html.includes("<link ")).length;

      // The outline is inside the book, and a later position in the book is
      // never an earlier page (docs/pitfall/240).
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
          `${ft.pages.length} pages (character ruler), ${styled} styled docs, ${ft.outline.length} outline, ` +
          `${figures.figures.length} figures, ${elapsed} ms`,
      );
    }, 60000);
  }
});
