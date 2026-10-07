// Which glyphs a finger's selection on a PDF page covers (docs/82): the word a
// hold lands on, the span a drag grows from it, the end a handle moves, and the
// slices it is read back by.

import { expect, test } from "bun:test";
import type { PdfPageGeometry } from "@embedpdf/models";
import {
  glyphNear,
  glyphUnder,
  moveSpanEnd,
  spanRects,
  spanSlices,
  spanToWord,
  wordAround,
  type GlyphSpan,
} from "../../../src/reading/engine/finger-select";

// One line per string, 10 units a glyph, 20 apart; a space is a word boundary
// (flags 1), and every line ends in the empty glyph PDFium generates (flags 2).
function page(lines: string[]): PdfPageGeometry {
  let charStart = 0;
  const runs = lines.map((line, row) => {
    const y = row * 20;
    const glyphs = [...line].map((c, i) => ({
      x: i * 10,
      y,
      width: 10,
      height: 10,
      flags: c === " " ? 1 : 0,
    }));
    glyphs.push({ x: line.length * 10, y, width: 0, height: 0, flags: 2 });
    const run = { rect: { x: 0, y, width: line.length * 10, height: 10 }, charStart, glyphs, fontSize: 10 };
    charStart += glyphs.length;
    return run;
  });
  return { runs } as unknown as PdfPageGeometry;
}

const geo = page(["alpha beta gamma", "delta epsilon"]);
const pages = (p: number) => (p === 0 || p === 1 ? geo : undefined);

test("a hold on a glyph selects its word, and beside the text there is no glyph", () => {
  const g = glyphUnder(geo, 0, 72, 5);
  expect(g).toEqual({ page: 0, index: 7 });
  expect(wordAround(geo, g!)).toEqual({ start: { page: 0, index: 6 }, end: { page: 0, index: 9 } });
  expect(glyphUnder(geo, 0, 300, 5)).toBeNull();
});

test("a drag that has left the words still reaches the nearest glyph", () => {
  expect(glyphNear(geo, 0, 300, 5)).toEqual({ page: 0, index: 15 });
  expect(glyphNear(geo, 0, 5, 200)?.index).toBe(17);
});

test("a drag grows from the held word to the far edge of the word under the finger, either way", () => {
  const held = wordAround(geo, { page: 0, index: 7 }); // beta
  const later = wordAround(geo, { page: 0, index: 19 }); // delta
  expect(spanToWord(held, later)).toEqual({ start: { page: 0, index: 6 }, end: { page: 0, index: 21 } });
  const earlier = wordAround(geo, { page: 0, index: 1 }); // alpha
  expect(spanToWord(held, earlier)).toEqual({ start: { page: 0, index: 0 }, end: { page: 0, index: 9 } });
});

test("a handle moves its own end and leaves the other where it was", () => {
  const span: GlyphSpan = { start: { page: 0, index: 6 }, end: { page: 0, index: 9 } };
  const gamma = wordAround(geo, { page: 0, index: 12 });
  expect(moveSpanEnd(span, "end", gamma)).toEqual({ start: { page: 0, index: 6 }, end: { page: 0, index: 15 } });
  const alpha = wordAround(geo, { page: 0, index: 2 });
  expect(moveSpanEnd(span, "start", alpha)).toEqual({ start: { page: 0, index: 0 }, end: { page: 0, index: 9 } });
});

test("a span across pages is read page by page, to the end of the first and from the start of the next", () => {
  const span: GlyphSpan = { start: { page: 0, index: 17 }, end: { page: 1, index: 4 } };
  expect(spanSlices(span, pages)).toEqual([
    { page: 0, from: 17, to: 30 },
    { page: 1, from: 0, to: 4 },
  ]);
  const rects = spanRects(span, pages);
  expect([...rects.keys()]).toEqual([0, 1]);
});
