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
import { IconBlackboard, IconSparkle } from "../../../src/ui/components/base/icons";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../../../src");
const read = (path: string): string => readFileSync(join(SRC, path), "utf8");

const topBar = read("ui/components/reader/ReaderTopBar.tsx");
const rack = read("ui/components/reader/PenToolbar.tsx");

test("the blackboard is drawn in the same system as the other icons", () => {
  const markup = renderToStaticMarkup(<IconBlackboard size={18} />);
  expect(markup).toContain('viewBox="0 0 20 20"');
  expect(markup).toContain('stroke="currentColor"');
  expect(markup).toContain('width="18"');
  expect(markup).toContain('height="18"');
  // A board, two chalk lines and two legs — no fills, and few enough shapes to
  // read at 18px.
  expect(markup.match(/<path/g)?.length).toBe(5);
  expect(markup).not.toContain('fill="#');
});

test("the blackboard and the sparkle are different drawings", () => {
  expect(renderToStaticMarkup(<IconBlackboard size={18} />)).not.toBe(
    renderToStaticMarkup(<IconSparkle size={18} />),
  );
});

test("the top bar's book entry wears the blackboard and says what it opens", () => {
  expect(topBar).toContain("IconBlackboard");
  expect(topBar).not.toContain("IconSparkle");
  expect(topBar).toContain('title="Learn this book with AI"');
  expect(topBar).toContain('aria-label="Learn this book with AI"');
  expect(topBar).not.toContain("Talk about this book");
});

test("the pen rack keeps the sparkle for the passage-level pen", () => {
  expect(rack).toContain("IconSparkle");
  expect(rack).not.toContain("IconBlackboard");
});
