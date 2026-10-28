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

// A CJK page shaped like the one PDFium reads out of Noto Sans CJK
// (docs/pitfall/embedpdf/678): every glyph's loose box is 53 tall on a 27
// pitch, its ink 17; a "一"'s ink is one unit tall, a comma's a dot at the
// baseline. Each line is followed by the break PDFium generates.
function cjkPage(lines: string[]): { geo: PdfPageGeometry; text: string } {
  let charStart = 0;
  let text = "";
  const runs: unknown[] = [];
  lines.forEach((line, row) => {
    const y = 18 + row * 27;
    const glyphs = [...line].map((c, i) => {
      const x = 30 + i * 19;
      const ink =
        c === "一" ? { tightY: y + 26, tightHeight: 1 } : c === "，" ? { tightY: y + 31, tightHeight: 4 } : { tightY: y + 18, tightHeight: 17 };
      return { x, y, width: 19, height: 53, flags: c === " " ? 1 : 0, tightX: x + 1, tightWidth: c === "，" ? 4 : 17, ...ink };
    });
    runs.push({ rect: { x: 30, y, width: line.length * 19, height: 53 }, charStart, glyphs, fontSize: 1 });
    charStart += glyphs.length;
    runs.push({
      rect: { x: 0, y: 0, width: 0, height: 0 },
      charStart,
      glyphs: [0, 1].map(() => ({ x: 0, y: 0, width: 0, height: 0, flags: 2 })),
      fontSize: 1,
    });
    charStart += 2;
    text += line + "\r\n";
  });
  return { geo: { runs } as unknown as PdfPageGeometry, text };
}

const zh = cjkPage(["人工智能的历史可以", "像人一样思考，然而", "AI的历史"]);
const midline = (row: number) => 18 + row * 27 + 18 + 8.5;

test("a hold on a comma or a 一 at the middle of its line is on the words", () => {
  // 一 is index 13, the comma 17: their ink misses the line's middle.
  expect(glyphUnder(zh.geo, 0, 30 + 2 * 19 + 9, midline(1))).toEqual({ page: 0, index: 13 });
  expect(glyphUnder(zh.geo, 0, 30 + 6 * 19 + 9, midline(1))).toEqual({ page: 0, index: 17 });
  // Between two lines' ink, and beside the line, is still off the words.
  expect(glyphUnder(zh.geo, 0, 60, 58)).toBeNull();
  expect(glyphUnder(zh.geo, 0, 300, midline(0))).toBeNull();
});

test("with the page's text a hold on a CJK character selects that character, and a Latin word stops at one", () => {
  expect(wordAround(zh.geo, { page: 0, index: 3 }, zh.text)).toEqual({ start: { page: 0, index: 3 }, end: { page: 0, index: 3 } });
  // "AI的历史" starts at 22: the word is "AI".
  expect(wordAround(zh.geo, { page: 0, index: 22 }, zh.text)).toEqual({ start: { page: 0, index: 22 }, end: { page: 0, index: 23 } });
  // Without the text the engine's spaces are all there is: the whole line.
  expect(wordAround(zh.geo, { page: 0, index: 3 })).toEqual({ start: { page: 0, index: 0 }, end: { page: 0, index: 8 } });
  // A spaced script is unchanged by the text.
  expect(wordAround(geo, { page: 0, index: 7 }, "alpha beta gamma")).toEqual({ start: { page: 0, index: 6 }, end: { page: 0, index: 9 } });
});

test("a CJK selection's line boxes keep to their lines", () => {
  const rects = spanRects({ start: { page: 0, index: 2 }, end: { page: 0, index: 26 } }, () => zh.geo).get(0)!;
  expect(rects.length).toBe(3);
  for (const r of rects) expect(r.size.height).toBeLessThanOrEqual(17 * 1.5);
  for (let k = 1; k < rects.length; k++) {
    expect(rects[k].origin.y).toBeGreaterThanOrEqual(rects[k - 1].origin.y + rects[k - 1].size.height);
  }
  // Across, the loose extent: the first line from its third glyph to its end.
  expect(rects[0].origin.x).toBe(30 + 2 * 19);
  expect(rects[0].origin.x + rects[0].size.width).toBe(30 + 9 * 19);
  // Up and down, the ink with room around it.
  expect(rects[0].origin.y).toBeLessThan(18 + 18);
  expect(rects[0].origin.y + rects[0].size.height).toBeGreaterThan(18 + 35);
});
