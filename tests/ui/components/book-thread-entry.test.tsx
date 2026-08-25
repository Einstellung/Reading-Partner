// The two AI entries the reader offers (docs/09): the pen rack's AI pen, which is
// about one passage, and the top bar's button, which is about the whole book.
// Each now has its own drawing: the top bar carries a lesson path threading
// through the book, start to finish; the rack carries a speech bubble asking
// about the line it just marked. Neither borrows the other's glyph.
//
// The icons are rendered; the two call sites are read as source, because both
// components measure the viewport at render and neither is what this is about.
// Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { IconAskHere, IconLessonPath } from "../../../src/ui/components/base/icons";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

const topBar = read("ui/components/reader/ReaderTopBar.tsx");
const rack = read("ui/components/reader/PenToolbar.tsx");

test("the entry's mark is the one icon in colour, and the only one", () => {
  const markup = renderToStaticMarkup(<IconLessonPath size={18} />);
  expect(markup).toContain('viewBox="0 0 24 24"');
  expect(markup).toContain('width="18"');
  expect(markup).toContain('height="18"');
  // Colour is the point: three monochrome glyphs were tried and failed at 18px
  // (see the comment on the icon). Nothing in it falls back to currentColor.
  expect(markup).toContain("#2F4F39");
  expect(markup).not.toContain("currentColor");

  // The rest of the tray stays one system. Every other icon in the file draws in
  // currentColor, so a stray hex outside the mark's own palette is a regression.
  const icons = read("ui/components/base/icons.tsx");
  const from = icons.indexOf("const MARK");
  const mark = icons.slice(from, icons.indexOf("} as const;", from));
  const strays = icons.replace(mark, "").match(/#[0-9A-Fa-f]{6}/g) ?? [];
  expect(strays).toEqual([]);
});

test("the lesson path and the ask-here bubble are different drawings", () => {
  expect(renderToStaticMarkup(<IconLessonPath size={18} />)).not.toBe(
    renderToStaticMarkup(<IconAskHere size={18} />),
  );
});

test("the top bar's book entry wears the lesson path and says what it opens", () => {
  expect(topBar).toContain("IconLessonPath");
  expect(topBar).not.toContain("IconAskHere");
  // The label is a constant: while the button is dim its title is the line that
  // says why instead, and both readings are rendered in pen-rack-gate.test.tsx.
  expect(topBar).toContain('const BOOK_THREAD = "Learn this book with AI"');
  expect(topBar).not.toContain("Retell about this book");
});

test("the pen rack wears the ask-here bubble for the passage-level pen", () => {
  expect(rack).toContain("IconAskHere");
  expect(rack).not.toContain("IconLessonPath");
});
