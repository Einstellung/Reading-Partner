// The top bar's position text: the block number always, the book's own printed
// page beside it when the book has one.

import { expect, test } from "bun:test";
import type { ViewStats } from "../../../../src/platform/app/reader-contract";
import { readerPageText } from "../../../../src/ui/components/reader/reader-page-text";

const stats = (over: Partial<ViewStats>): ViewStats => ({
  pageIndex: 36,
  pageLabel: "52",
  printedLabel: "52",
  pagesCount: 385,
  canZoomIn: true,
  canZoomOut: true,
  canZoomReset: true,
  layout: "vertical",
  ...over,
});

test("a book with a page-list prints its own number beside the block number", () => {
  expect(readerPageText(stats({}))).toEqual({ blocks: "37 / 385", printed: "printed 52" });
});

test("a book without a printed number shows the block number alone", () => {
  // pageLabel falls back to the block number; that fallback must not be shown
  // twice as if the book had printed it.
  expect(readerPageText(stats({ pageLabel: "37", printedLabel: null }))).toEqual({
    blocks: "37 / 385",
    printed: null,
  });
});

test("a PDF shows the block number alone", () => {
  const pdf = stats({ pageIndex: 0, pageLabel: "1", printedLabel: null, pagesCount: 12 });
  expect(readerPageText(pdf)).toEqual({ blocks: "1 / 12", printed: null });
});

test("no book open yet", () => {
  expect(readerPageText(null)).toEqual({ blocks: "— / —", printed: null });
});

test("a roman-numbered front matter page is printed as the book prints it", () => {
  expect(readerPageText(stats({ printedLabel: "xii" })).printed).toBe("printed xii");
});
