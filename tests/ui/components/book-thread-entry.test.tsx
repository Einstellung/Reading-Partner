// The two AI entries the reader offers (docs/09): the pen rack's AI pen, which is
// about one passage, and the top bar's button, which is about the whole book.
// They wore the same sparkle, so nothing on screen said they were different
// things. The blackboard is the whole book, and the rack keeps the sparkle.
//
// The icons are rendered; the two call sites are read as source, because both
// components measure the viewport at render and neither is what this is about.
// Run: bun test.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { IconReadTogether, IconSparkle } from "../../../src/ui/components/base/icons";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

const topBar = read("ui/components/reader/ReaderTopBar.tsx");
const rack = read("ui/components/reader/PenToolbar.tsx");

test("the entry's mark is the one icon in colour, and the only one", () => {
  const markup = renderToStaticMarkup(<IconReadTogether size={18} />);
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

test("the blackboard and the sparkle are different drawings", () => {
  expect(renderToStaticMarkup(<IconReadTogether size={18} />)).not.toBe(
    renderToStaticMarkup(<IconSparkle size={18} />),
  );
});

test("the top bar's book entry wears the blackboard and says what it opens", () => {
  expect(topBar).toContain("IconReadTogether");
  expect(topBar).not.toContain("IconSparkle");
  // The label is a constant: while the button is dim its title is the line that
  // says why instead, and both readings are rendered in pen-rack-gate.test.tsx.
  expect(topBar).toContain('const BOOK_THREAD = "Learn this book with AI"');
  expect(topBar).not.toContain("Talk about this book");
});

test("the pen rack keeps the sparkle for the passage-level pen", () => {
  expect(rack).toContain("IconSparkle");
  expect(rack).not.toContain("IconReadTogether");
});
