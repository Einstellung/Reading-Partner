// A finger's hold and the line boxes of a mark, on geometry the real PDFium
// reads out of cjk-lines.pdf (make-cjk-lines.py): a Chinese paragraph whose
// loose glyph boxes are twice the line pitch (docs/pitfall/embedpdf/678), then
// an English one whose boxes keep to their lines.

import { beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { init } from "@embedpdf/pdfium";
import { PdfiumNative } from "@embedpdf/engines/pdfium";
import { rectsWithinSlice } from "@embedpdf/plugin-selection";
import type { PdfPageGeometry, Rect } from "@embedpdf/models";

import { glyphUnder, spanRects, wordAround } from "../../../src/reading/engine/finger-select";
import { markupSegments } from "../../../src/reading/engine/markup-select";
import { isUnspaced } from "../../../src/reading/words/unspaced";

const ROOT = join(import.meta.dir, "../../..");

let geo: PdfPageGeometry;
let text: string;

interface Line {
  run: PdfPageGeometry["runs"][number];
  cjk: boolean;
  inkTop: number;
  inkBottom: number;
}
let lines: Line[];

beforeAll(async () => {
  const mod = await init({ wasmBinary: readFileSync(join(ROOT, "node_modules/@embedpdf/pdfium/dist/pdfium.wasm")) });
  const engine = new PdfiumNative(mod as any);
  const buf = readFileSync(join(import.meta.dir, "cjk-lines.pdf"));
  const content = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const doc = await engine.openDocumentBuffer({ id: "cjk-lines", content }).toPromise();
  geo = await engine.getPageGeometry(doc, doc.pages[0]).toPromise();
  const last = geo.runs[geo.runs.length - 1];
  [text] = await engine
    .getTextSlices(doc, [{ pageIndex: 0, charIndex: 0, charCount: last.charStart + last.glyphs.length }])
    .toPromise();
  lines = geo.runs
    .filter((run) => run.glyphs.some((g) => g.flags === 0))
    .map((run) => {
      const ink = run.glyphs.filter((g) => g.flags === 0);
      return {
        run,
        cjk: isUnspaced(text[run.charStart]),
        inkTop: Math.min(...ink.map((g) => g.tightY!)),
        inkBottom: Math.max(...ink.map((g) => g.tightY! + g.tightHeight!)),
      };
    });
});

test("the fixture is what the tests below are about", () => {
  const zh = lines.filter((l) => l.cjk);
  const en = lines.filter((l) => !l.cjk);
  expect(zh.length).toBe(5);
  expect(en.length).toBeGreaterThanOrEqual(3);
  // A CJK glyph's loose box is taller than the pitch to the next line.
  expect(zh[0].run.glyphs[0].height).toBeGreaterThan(zh[1].run.rect.y - zh[0].run.rect.y);
});

test("a hold at the middle of any line, on any glyph, is on that glyph (punctuation and 一 included)", () => {
  const missed: string[] = [];
  for (const line of lines) {
    const y = (line.inkTop + line.inkBottom) / 2;
    line.run.glyphs.forEach((g, i) => {
      if (g.flags !== 0) return;
      const index = line.run.charStart + i;
      const hit = glyphUnder(geo, 0, g.x + g.width / 2, y);
      if (hit?.index !== index) missed.push(text[index]);
    });
  }
  expect(missed.join("")).toBe("");
});

test("a hold on a CJK character selects that character; on an English word, the word", () => {
  const zh = lines[0];
  const at = { page: 0, index: zh.run.charStart + 3 };
  expect(wordAround(geo, at, text)).toEqual({ start: at, end: at });
  const p = text.indexOf("paragraph");
  const w = wordAround(geo, { page: 0, index: p + 2 }, text);
  expect(text.slice(w.start.index, w.end.index + 1)).toBe("paragraph");
});

function lineOf(r: Rect): Line {
  const mid = (r.origin.x + r.size.width / 2) as number;
  const found = lines.find(
    (l) =>
      l.inkTop >= r.origin.y - 0.5 &&
      l.inkBottom <= r.origin.y + r.size.height + 0.5 &&
      mid >= l.run.rect.x &&
      mid <= l.run.rect.x + l.run.rect.width,
  );
  if (!found) throw new Error(`no line's ink inside ${JSON.stringify(r)}`);
  return found;
}

function checkLines(rects: Rect[]): void {
  expect(rects.length).toBe(lines.filter((l) => l.run.rect.width > 40).length);
  for (const r of rects) {
    const line = lineOf(r);
    // Holds its line's ink, and is not much more than it.
    expect(r.size.height).toBeLessThanOrEqual((line.inkBottom - line.inkTop) * 1.5);
  }
  for (let k = 1; k < rects.length; k++) {
    expect(rects[k].origin.y).toBeGreaterThanOrEqual(rects[k - 1].origin.y + rects[k - 1].size.height - 0.01);
  }
}

test("a finger's selection over the whole page is one box per line, each on its own line's ink", () => {
  const last = geo.runs[geo.runs.length - 1];
  const rects = spanRects({ start: { page: 0, index: 0 }, end: { page: 0, index: last.charStart + last.glyphs.length - 1 } }, () => geo).get(0)!;
  checkLines(rects.filter((r) => r.size.width > 40));
});

test("an English line's box is no taller than the plugin's and holds the same ink", () => {
  for (const line of lines.filter((l) => !l.cjk)) {
    const from = line.run.charStart;
    const to = from + line.run.glyphs.length - 1;
    const [loose] = rectsWithinSlice(geo, from, to);
    const [box] = spanRects({ start: { page: 0, index: from }, end: { page: 0, index: to } }, () => geo).get(0)!;
    expect(box.origin.x).toBe(loose.origin.x);
    expect(box.size.width).toBe(loose.size.width);
    expect(box.origin.y).toBeGreaterThanOrEqual(loose.origin.y - 0.01);
    expect(box.origin.y + box.size.height).toBeLessThanOrEqual(loose.origin.y + loose.size.height + 0.01);
    expect(box.origin.y).toBeLessThanOrEqual(line.inkTop);
    expect(box.origin.y + box.size.height).toBeGreaterThanOrEqual(line.inkBottom);
  }
});

test("a pen's selection becomes the same line boxes a finger's does", () => {
  const last = geo.runs[geo.runs.length - 1];
  const end = last.charStart + last.glyphs.length - 1;
  const loose = rectsWithinSlice(geo, 0, end);
  const plugin = [{ pageIndex: 0, rect: loose[0], segmentRects: loose }];
  const [made] = markupSegments(plugin, { selection: { start: { page: 0, index: 0 }, end: { page: 0, index: end } }, geometry: { 0: geo } });
  expect(made.segmentRects).toEqual(spanRects({ start: { page: 0, index: 0 }, end: { page: 0, index: end } }, () => geo).get(0)!);
  checkLines(made.segmentRects.filter((r) => r.size.width > 40));
});
