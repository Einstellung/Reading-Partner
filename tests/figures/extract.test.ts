// Pure coverage of figure extraction (src/figures/extract): CTM-tracked image
// boxes, caption detection, caption/image pairing (single, multi-panel, unpaired
// -> null), and index assembly. No pdfjs/DOM — operator and text data are
// synthetic, with the OP codes injected. Run with `bun test`.

import { test, expect } from "bun:test";
import {
  assembleIndex,
  captionLinesFromText,
  figuresForPage,
  imageBoxesFromOps,
  pairFiguresOnPage,
  type OpCodes,
  type OpList,
  type TextItem,
} from "../../src/figures/extract";

// Synthetic op numbering (the real pdfjs codes differ; injected either way).
const CODES: OpCodes = { save: 1, restore: 2, transform: 3, image: new Set([10]) };

function ops(rows: [number, unknown][]): OpList {
  return { fnArray: rows.map((r) => r[0]), argsArray: rows.map((r) => r[1]) };
}
function transform(m: number[]): [number, unknown] {
  return [CODES.transform, m];
}
const SAVE: [number, unknown] = [CODES.save, undefined];
const RESTORE: [number, unknown] = [CODES.restore, undefined];
const IMAGE: [number, unknown] = [CODES.image.values().next().value as number, undefined];

function caption(str: string, x: number, y: number, height = 10): TextItem {
  return { str, transform: [1, 0, 0, 1, x, y], height };
}

test("image box is the CTM applied to the unit square", () => {
  const boxes = imageBoxesFromOps(ops([SAVE, transform([200, 0, 0, 150, 100, 500]), IMAGE, RESTORE]), CODES);
  expect(boxes).toEqual([{ x0: 100, y0: 500, x1: 300, y1: 650 }]);
});

test("save/restore isolates the CTM; nested transforms compose", () => {
  // Outer scale x2, saved; inner translate; image; restore drops the translate,
  // a second image sees only the outer scale.
  const boxes = imageBoxesFromOps(
    ops([
      transform([40, 0, 0, 40, 0, 0]), // base scale
      SAVE,
      transform([1, 0, 0, 1, 5, 5]), // inner translate (in scaled space)
      IMAGE,
      RESTORE,
      IMAGE,
    ]),
    CODES,
  );
  // First image: CTM = translate ∘ scale => unit square (5,5)->(45,45) scaled:
  // point (0,0)->(40*5?, ...) — compose gives origin (200,200), size 40.
  expect(boxes[0]).toEqual({ x0: 200, y0: 200, x1: 240, y1: 240 });
  // Second image: only the scale => unit square (0,0)->(40,40).
  expect(boxes[1]).toEqual({ x0: 0, y0: 0, x1: 40, y1: 40 });
});

test("hairline-thin images are dropped as decorations", () => {
  const boxes = imageBoxesFromOps(ops([transform([5, 0, 0, 5, 10, 10]), IMAGE]), CODES);
  expect(boxes).toEqual([]);
});

test("caption lines are detected across Figure/Fig variants with ids", () => {
  const items: TextItem[] = [
    caption("Figure 1: A schematic", 100, 480),
    caption("Fig. 2: details", 100, 300),
    caption("FIG 3a left panel", 100, 200),
    caption("Ordinary sentence about figure 9", 100, 100),
  ];
  const lines = captionLinesFromText(items);
  expect(lines.map((l) => l.id)).toEqual(["1", "2", "3a"]);
  expect(lines[0].caption).toBe("Figure 1: A schematic");
});

test("pairs a caption with the image directly above it", () => {
  const boxes = imageBoxesFromOps(ops([transform([200, 0, 0, 150, 100, 500]), IMAGE]), CODES);
  const captions = captionLinesFromText([caption("Figure 1: x", 110, 485)]);
  const figs = pairFiguresOnPage(boxes, captions, 3, 800);
  expect(figs).toEqual([{ id: "1", page: 3, caption: "Figure 1: x", bbox: { x: 100, y: 150, width: 200, height: 150 } }]);
});

test("multi-panel images sharing one caption merge into a single bbox", () => {
  const boxes = imageBoxesFromOps(
    ops([
      SAVE, transform([80, 0, 0, 120, 50, 600]), IMAGE, RESTORE,
      SAVE, transform([80, 0, 0, 120, 180, 600]), IMAGE, RESTORE,
    ]),
    CODES,
  );
  // Two panels above one caption.
  const captions = captionLinesFromText([caption("Figure 2: two panels", 60, 585)]);
  const figs = pairFiguresOnPage(boxes, captions, 1, 800);
  expect(figs).toHaveLength(1);
  // Union spans both panels: x 50..260, y (top-left) 800-720=80, height 120.
  expect(figs[0].bbox).toEqual({ x: 50, y: 80, width: 210, height: 120 });
});

test("a caption with no image nearby keeps bbox null", () => {
  // Image sits far above the caption (caption above the art / other column).
  const boxes = imageBoxesFromOps(ops([transform([100, 0, 0, 100, 50, 50]), IMAGE]), CODES);
  const captions = captionLinesFromText([caption("Figure 3: unreachable", 60, 700)]);
  const figs = pairFiguresOnPage(boxes, captions, 1, 800);
  expect(figs).toEqual([{ id: "3", page: 1, caption: "Figure 3: unreachable", bbox: null }]);
});

test("separately-captioned sub-figures become distinct figures", () => {
  // Two stacked figures, each with its own caption below its art.
  const items = [caption("Figure 4a: upper", 60, 585), caption("Figure 4b: lower", 60, 285)];
  const boxes = imageBoxesFromOps(
    ops([
      SAVE, transform([100, 0, 0, 100, 50, 600]), IMAGE, RESTORE,
      SAVE, transform([100, 0, 0, 100, 50, 300]), IMAGE, RESTORE,
    ]),
    CODES,
  );
  const figs = pairFiguresOnPage(boxes, captionLinesFromText(items), 2, 800);
  expect(figs.map((f) => f.id).sort()).toEqual(["4a", "4b"]);
  expect(figs.every((f) => f.bbox !== null)).toBe(true);
});

test("figuresForPage ties boxes and captions together", () => {
  const page = {
    page: 5,
    pageHeight: 800,
    ops: ops([transform([200, 0, 0, 150, 100, 500]), IMAGE]),
    textItems: [caption("Figure 7: end to end", 110, 485)],
  };
  const figs = figuresForPage(page, CODES);
  expect(figs).toEqual([
    { id: "7", page: 5, caption: "Figure 7: end to end", bbox: { x: 100, y: 150, width: 200, height: 150 } },
  ]);
});

test("assembleIndex dedups by id, preferring the occurrence with a bbox", () => {
  const withBox = { id: "1", page: 4, caption: "Figure 1", bbox: { x: 0, y: 0, width: 10, height: 10 } };
  const noBox = { id: "1", page: 2, caption: "Figure 1 (running header)", bbox: null };
  const other = { id: "2", page: 3, caption: "Figure 2", bbox: null };
  const idx = assembleIndex([[noBox], [other], [withBox]]);
  expect(idx.figures).toHaveLength(2);
  expect(idx.figures.find((f) => f.id === "1")).toEqual(withBox);
  // Sorted by page.
  expect(idx.figures.map((f) => f.id)).toEqual(["2", "1"]);
});
