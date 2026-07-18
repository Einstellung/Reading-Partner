// Pure coverage of figure extraction (src/figures/extract): CTM-tracked image
// boxes, caption detection, caption/image pairing (single, multi-panel, unpaired
// -> null), and index assembly. No pdfjs/DOM — operator and text data are
// synthetic, with the OP codes injected. Run with `bun test`.

import { test, expect } from "bun:test";
import {
  assembleIndex,
  captionAnchoredRegion,
  captionLinesFromText,
  clusterBoxes,
  figuresForPage,
  graphicsBoxesFromOps,
  imageBoxesFromOps,
  pairFiguresOnPage,
  type CaptionLine,
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

// --- vector-aware walk ---

// Extended codes with vector fields; the sub-op numbering mirrors pdf.js 4.x but
// is injected, so the values only need to be self-consistent here.
const V: OpCodes = {
  save: 1,
  restore: 2,
  transform: 3,
  image: new Set([10]),
  constructPath: 91,
  paint: new Set([20, 22, 23]), // stroke, fill, eoFill
  clipEnd: new Set([28, 29, 30]), // endPath, clip, eoClip
  path: { moveTo: 13, lineTo: 14, curveTo: 15, curveTo2: 16, curveTo3: 17, rectangle: 19, closePath: 18 },
};
// constructPath op: pdf.js packs [subOpCodes[], flatArgs[], minMax].
function cpath(subOps: number[], flat: number[]): [number, unknown] {
  return [91, [subOps, flat, [0, 0, 0, 0]]];
}
const STROKE: [number, unknown] = [20, undefined];

test("vector path box is the CTM applied to the decoded points; commits on stroke", () => {
  // moveTo/lineTo polyline (0,0)->(100,0)->(100,50) translated up by (50,600).
  const boxes = graphicsBoxesFromOps(
    ops([
      transform([1, 0, 0, 1, 50, 600]),
      cpath([V.path!.moveTo, V.path!.lineTo, V.path!.lineTo], [0, 0, 100, 0, 100, 50]),
      STROKE,
    ]),
    V,
  );
  expect(boxes).toEqual([{ x0: 50, y0: 600, x1: 150, y1: 650 }]);
});

test("rectangle sub-op decodes x,y,w,h (not two points)", () => {
  const boxes = graphicsBoxesFromOps(ops([cpath([V.path!.rectangle], [10, 20, 30, 40]), STROKE]), V);
  expect(boxes).toEqual([{ x0: 10, y0: 20, x1: 40, y1: 60 }]);
});

test("bezier control points bound the curve box", () => {
  // curveTo: 3 points (two controls + end); the high control lifts the top.
  const boxes = graphicsBoxesFromOps(
    ops([cpath([V.path!.moveTo, V.path!.curveTo], [0, 0, 10, 200, 90, 200, 100, 0]), STROKE]),
    V,
  );
  expect(boxes).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 200 }]);
});

test("an unpainted path (clip / endPath) contributes no box", () => {
  const boxes = graphicsBoxesFromOps(
    ops([cpath([V.path!.moveTo, V.path!.lineTo], [0, 0, 100, 100]), [29, undefined]]),
    V,
  );
  expect(boxes).toEqual([]);
});

test("consecutive constructPaths accumulate into one region until painted", () => {
  const boxes = graphicsBoxesFromOps(
    ops([
      cpath([V.path!.moveTo, V.path!.lineTo], [0, 0, 20, 20]),
      cpath([V.path!.moveTo, V.path!.lineTo], [80, 80, 100, 100]),
      [22, undefined], // fill commits the union
    ]),
    V,
  );
  expect(boxes).toEqual([{ x0: 0, y0: 0, x1: 100, y1: 100 }]);
});

test("vector and raster boxes are both collected, save/restore scoped", () => {
  const boxes = graphicsBoxesFromOps(
    ops([
      SAVE,
      transform([100, 0, 0, 80, 50, 500]),
      IMAGE,
      RESTORE,
      cpath([V.path!.moveTo, V.path!.lineTo], [10, 10, 40, 40]),
      STROKE,
    ]),
    V,
  );
  expect(boxes).toEqual([
    { x0: 50, y0: 500, x1: 150, y1: 580 },
    { x0: 10, y0: 10, x1: 40, y1: 40 },
  ]);
});

// --- clustering ---

test("clustering merges near boxes and keeps far ones apart", () => {
  const merged = clusterBoxes([
    { x0: 0, y0: 0, x1: 10, y1: 10 },
    { x0: 15, y0: 0, x1: 25, y1: 10 }, // 5pt gap -> merges
  ]);
  expect(merged).toEqual([{ x0: 0, y0: 0, x1: 25, y1: 10 }]);

  const apart = clusterBoxes([
    { x0: 0, y0: 0, x1: 10, y1: 10 },
    { x0: 100, y0: 0, x1: 110, y1: 10 }, // 90pt gap -> stays separate
  ]);
  expect(apart).toHaveLength(2);
});

test("one figure's scattered strokes collapse into a single region", () => {
  // Arrowheads / segments each a few points apart, all within the cluster gap.
  const parts = [
    { x0: 0, y0: 0, x1: 8, y1: 8 },
    { x0: 10, y0: 6, x1: 18, y1: 14 },
    { x0: 20, y0: 12, x1: 28, y1: 20 },
    { x0: 26, y0: 18, x1: 34, y1: 26 },
  ];
  expect(clusterBoxes(parts)).toEqual([{ x0: 0, y0: 0, x1: 34, y1: 26 }]);
});

// --- label absorption + sanity floor (via pairFiguresOnPage) ---

function capLine(str: string, x: number, y: number, width: number, height = 10): CaptionLine {
  const [line] = captionLinesFromText([{ str, transform: [1, 0, 0, 1, x, y], width, height }]);
  return line;
}

test("labels inside the region expand the bbox; text outside is left alone", () => {
  const region = { x0: 100, y0: 500, x1: 300, y1: 600 };
  const caption = capLine("Figure 8: labelled", 100, 480, 200);
  const textBoxes = [
    { x0: 150, y0: 580, x1: 260, y1: 605 }, // label straddling the top edge -> absorbed
    { x0: 100, y0: 300, x1: 300, y1: 312 }, // body text far below -> ignored
  ];
  const figs = pairFiguresOnPage([region], [caption], 1, 800, { textBoxes, pageWidth: 600 });
  // Top grew from y1 600 to 605 (page-space y = 800-605 = 195, height 105).
  expect(figs[0].bbox).toEqual({ x: 100, y: 195, width: 200, height: 105 });
});

test("a bbox narrower than the caption triggers the caption-anchored fallback", () => {
  const caption = capLine("Figure 5: a wide caption line", 100, 400, 200);
  const sliver = { x0: 150, y0: 420, x1: 180, y1: 460 }; // width 30 << caption 200
  const textBoxes = [
    { x0: 100, y0: 550, x1: 300, y1: 560 }, // body line above -> caps the region
  ];
  const figs = pairFiguresOnPage([sliver], [caption], 1, 800, { textBoxes });
  // Fallback: caption span (100..300) from caption top (410) up to the body line
  // (550). page-space: y = 800-550 = 250, height = 550-410 = 140.
  expect(figs[0].bbox).toEqual({ x: 100, y: 250, width: 200, height: 140 });
});

// --- caption-anchored fallback geometry ---

test("fallback region spans the caption and caps at 60% page height with no text above", () => {
  const caption = capLine("Figure 6: alone", 100, 90, 200); // yTop = 100
  const r = captionAnchoredRegion(caption, [], 800);
  // No text above -> top capped at 100 + 0.6*800 = 580.
  expect(r).toEqual({ x0: 100, y0: 100, x1: 300, y1: 580 });
});

test("fallback returns null when it can't size the width", () => {
  const caption = capLine("Figure 7: unknown width", 100, 90, 0);
  expect(captionAnchoredRegion(caption, [], 800)).toBeNull();
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
