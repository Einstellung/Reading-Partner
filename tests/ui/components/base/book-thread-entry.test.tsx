// The two AI entries the reader offers (docs/09): the pen rack's AI pen, which is
// about one passage, and the top bar's button, which is about the whole book.
// Each now has its own drawing: the top bar carries an open book with a sparkle
// over it; the rack carries a speech bubble asking about the line it just
// marked. Neither borrows the other's glyph.
//
// The icons are rendered; the two call sites are read as source, because both
// components measure the viewport at render and neither is what this is about.
// Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { IconAskHere, IconBookSparkle } from "../../../../src/ui/components/base/icons";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../../src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

const topBar = read("ui/components/reader/ReaderTopBar.tsx");
const rack = read("ui/components/reader/PenToolbar.tsx");

test("the entry is a book drawn in the house system, with one green sparkle", () => {
  const markup = renderToStaticMarkup(<IconBookSparkle size={18} />);
  expect(markup).toContain('viewBox="0 0 24 24"');
  expect(markup).toContain('width="18"');
  expect(markup).toContain('height="18"');
  // The book is the same line as IconSidebar and IconGear beside it.
  expect(markup).toContain('stroke="currentColor"');
  expect(markup).toContain('stroke-width="1.5"');
  // The sparkle is the only coloured part, and it takes the green from the
  // token rather than from a hex (docs/42).
  expect(markup).toContain('class="stroke-accent-line"');

  // Every icon in the file draws in currentColor or in a token, so a hex
  // anywhere in it is a regression.
  const icons = read("ui/components/base/icons.tsx");
  expect(icons.match(/#[0-9A-Fa-f]{6}/g) ?? []).toEqual([]);
});

test("the book sparkle and the ask-here bubble are different drawings", () => {
  expect(renderToStaticMarkup(<IconBookSparkle size={18} />)).not.toBe(
    renderToStaticMarkup(<IconAskHere size={18} />),
  );
});

test("the top bar's book entry wears the book sparkle and says what it opens", () => {
  expect(topBar).toContain("IconBookSparkle");
  expect(topBar).not.toContain("IconAskHere");
  // The label is a constant: while the button is dim its title is the line that
  // says why instead, and both readings are rendered in pen-rack-gate.test.tsx.
  expect(topBar).toContain('const BOOK_THREAD = "Learn this book with AI"');
  expect(topBar).not.toContain("Retell about this book");
});

test("the pen rack wears the ask-here bubble for the passage-level pen", () => {
  expect(rack).toContain("IconAskHere");
  expect(rack).not.toContain("IconBookSparkle");
});
