// The pure half of carrying PDF marks onto a new version
// (src/reading/engine/carry-pdf.ts): which hit wins, what is searched for, and
// what a carried mark looks like. The search itself is PDFium's.
// Run: bash scripts/t.sh tests/reading/engine/carry-pdf.test.ts

import { expect, test } from "bun:test";
import {
  carriedPdfMark,
  nearestHit,
  pageOfMark,
  searchPhraseOf,
} from "../../../src/reading/engine/carry-pdf";
import { makeSortIndex } from "../../../src/reading/engine/convert";

const rect = (x: number, y: number) => ({ origin: { x, y }, size: { width: 50, height: 10 } });

test("of several hits the one nearest the old page wins, the earlier on a tie", () => {
  const hits = [
    { pageIndex: 1, rects: [rect(0, 0)] },
    { pageIndex: 6, rects: [rect(0, 0)] },
    { pageIndex: 9, rects: [rect(0, 0)] },
  ];
  expect(nearestHit(hits, 7)?.pageIndex).toBe(6);
  expect(nearestHit(hits, 0)?.pageIndex).toBe(1);
  expect(nearestHit([{ pageIndex: 3, rects: [] }], 3)).toBeNull();
  expect(nearestHit([], 3)).toBeNull();
});

test("only a text mark with words is searched for, spacing folded", () => {
  expect(searchPhraseOf({ type: "highlight", text: "a  line\nbroken" })).toBe("a line broken");
  expect(searchPhraseOf({ type: "underline", text: "x" })).toBeNull();
  expect(searchPhraseOf({ type: "ink", text: "words" })).toBeNull();
  expect(searchPhraseOf({ type: "highlight" })).toBeNull();
  expect(pageOfMark({ position: { pageIndex: 4 } })).toBe(4);
  expect(pageOfMark({})).toBe(0);
});

test("a carried mark keeps everything but its place", () => {
  const mark = {
    id: "m1",
    type: "highlight",
    color: "#ffd400",
    text: "the words",
    comment: "note",
    pageLabel: "3",
    position: { pageIndex: 2, rects: [[1, 2, 3, 4]] },
    sortIndex: "old",
  };
  const carried = carriedPdfMark(mark, { pageIndex: 5, rects: [rect(10, 100), rect(10, 112)] }, 800);
  expect(carried).toMatchObject({ id: "m1", color: "#ffd400", text: "the words", comment: "note", pageLabel: "6" });
  // Bottom-left PDF points, as every stored PDF mark is.
  expect(carried.position).toEqual({
    pageIndex: 5,
    rects: [
      [10, 690, 60, 700],
      [10, 678, 60, 688],
    ],
  });
  expect(carried.sortIndex).toBe(makeSortIndex(5, 100, 10));
});
