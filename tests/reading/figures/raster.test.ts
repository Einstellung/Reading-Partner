// The decisions behind redrawing an EPUB figure for the view tier: whether to
// redraw at all, at what size, and whether what came back is small enough. The
// drawing itself is the webview's (figures/render.ts owns the canvas), so a
// fake rasterizer stands in for it here and the loop is exercised without a DOM.

import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { openZip } from "../../../src/reading/epub/zip";
import {
  MIN_RASTER_EDGE,
  RASTER_MAX_EDGE,
  SVG_DEFAULT_EDGE,
  VIEW_MAX_BYTES,
  planEpubView,
  rasterSize,
  rasterizeEpubFigure,
  shrinkToFit,
  svgIntrinsicSize,
  withExplicitSize,
  type RasterSize,
  type Rasterizer,
} from "../../../src/reading/figures/raster";

// --- what gets redrawn -------------------------------------------------------

test("an SVG is always redrawn, a bitmap only when it is over the cap", () => {
  expect(planEpubView("image/svg+xml", 4_000)).toEqual({ action: "raster", reason: "vector" });
  expect(planEpubView("image/png", 2_436_158)).toEqual({ action: "raster", reason: "oversize" });
  expect(planEpubView("image/jpeg", 500_000)).toEqual({ action: "send" });
  // Exactly at the cap still goes as the publisher shipped it.
  expect(planEpubView("image/png", VIEW_MAX_BYTES)).toEqual({ action: "send" });
});

// --- the size to draw at -----------------------------------------------------

test("a bitmap keeps its own pixels, capped at the long edge", () => {
  expect(rasterSize(2070, 1594, false)).toEqual({ width: 1568, height: 1207 });
  expect(rasterSize(1594, 2070, false)).toEqual({ width: 1207, height: 1568 });
  // Never upscaled: a small picture is small.
  expect(rasterSize(400, 300, false)).toEqual({ width: 400, height: 300 });
});

test("a vector is drawn to the cap, up or down", () => {
  expect(rasterSize(100, 50, true)).toEqual({ width: RASTER_MAX_EDGE, height: 784 });
  expect(rasterSize(4000, 2000, true)).toEqual({ width: RASTER_MAX_EDGE, height: 784 });
});

test("a pass over the cap comes back smaller, and stops at the floor", () => {
  expect(shrinkToFit({ width: 1568, height: 1207 }, 500_000)).toBeNull();
  const next = shrinkToFit({ width: 1568, height: 1207 }, 2 * VIEW_MAX_BYTES);
  expect(next).not.toBeNull();
  expect(Math.max(next!.width, next!.height)).toBeLessThan(1568);
  // Aspect ratio held.
  expect(next!.width / next!.height).toBeCloseTo(1568 / 1207, 2);
  // A picture already at the floor is not shrunk further, however large it is.
  expect(shrinkToFit({ width: MIN_RASTER_EDGE, height: 200 }, 10 * VIEW_MAX_BYTES)).toBeNull();
  const floored = shrinkToFit({ width: 400, height: 300 }, 100 * VIEW_MAX_BYTES);
  expect(floored).toEqual({ width: 320, height: 240 });
});

// --- what an SVG says it is --------------------------------------------------

test("an SVG's size comes off width/height, then the viewBox, then a default", () => {
  expect(svgIntrinsicSize(`<svg width="200" height="100"></svg>`)).toEqual({
    width: 200,
    height: 100,
  });
  expect(svgIntrinsicSize(`<svg width="200px" height="100px"></svg>`)).toEqual({
    width: 200,
    height: 100,
  });
  expect(svgIntrinsicSize(`<svg viewBox="0 0 640 480"></svg>`)).toEqual({ width: 640, height: 480 });
  // A relative width says nothing about the drawing; the box does.
  expect(svgIntrinsicSize(`<svg width="100%" viewBox="0 0 640 480"></svg>`)).toEqual({
    width: 640,
    height: 480,
  });
  // One absolute side plus the box's ratio still pins it.
  expect(svgIntrinsicSize(`<svg width="300" viewBox="0 0 600 300"></svg>`)).toEqual({
    width: 300,
    height: 150,
  });
  expect(svgIntrinsicSize(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`)).toEqual({
    width: SVG_DEFAULT_EDGE,
    height: SVG_DEFAULT_EDGE,
  });
});

test("the root tag is found past a declaration and across lines", () => {
  const svg = `<?xml version="1.0"?>\n<!-- a drawing -->\n<svg\n  xmlns="http://www.w3.org/2000/svg"\n  viewBox="0 0 100 200">\n<rect/></svg>`;
  expect(svgIntrinsicSize(svg)).toEqual({ width: 100, height: 200 });
});

test("an explicit size is written onto the root and nothing else is touched", () => {
  const out = withExplicitSize(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 60 30"><rect width="10"/></svg>`,
    { width: 1568, height: 784 },
  );
  expect(out).toContain(`width="1568"`);
  expect(out).toContain(`height="784"`);
  expect(out).not.toContain(`100%`);
  expect(out).toContain(`viewBox="0 0 60 30"`);
  // The body's own width attribute is left alone.
  expect(out).toContain(`<rect width="10"/>`);
});

test("a self-closing root keeps its slash", () => {
  expect(withExplicitSize(`<svg viewBox="0 0 10 10"/>`, { width: 8, height: 8 })).toBe(
    `<svg viewBox="0 0 10 10" width="8" height="8"/>`,
  );
});

// --- the redraw loop ---------------------------------------------------------

interface Fake {
  rasterizer: Rasterizer;
  sizes: RasterSize[];
  decoded: Array<{ bytes: Uint8Array; mimeType: string }>;
  released: () => number;
}

// A rasterizer that reports a natural size and produces `bytesPerPixel` bytes of
// JPEG for whatever size it is asked to draw at — the one property of a real
// encoder the shrink loop depends on.
function fakeRasterizer(
  natural: RasterSize | null,
  bytesPerPixel: number,
  decodes = true,
): Fake {
  const sizes: RasterSize[] = [];
  const decoded: Array<{ bytes: Uint8Array; mimeType: string }> = [];
  let releases = 0;
  return {
    sizes,
    decoded,
    released: () => releases,
    rasterizer: {
      decode: async (bytes, mimeType) => {
        decoded.push({ bytes, mimeType });
        if (!decodes) return null;
        return {
          width: natural?.width ?? 0,
          height: natural?.height ?? 0,
          encode: async (size) => {
            sizes.push(size);
            const wanted = Math.round(size.width * size.height * bytesPerPixel);
            return "a".repeat(Math.ceil((wanted * 4) / 3));
          },
          release: () => {
            releases += 1;
          },
        };
      },
    },
  };
}

test("an oversized bitmap is redrawn until it fits, close to the cap", async () => {
  const fake = fakeRasterizer({ width: 2070, height: 1594 }, 1);
  const out = await rasterizeEpubFigure(new Uint8Array(8), "image/png", fake.rasterizer);
  expect(out?.mimeType).toBe("image/jpeg");
  const bytes = Math.floor((out!.base64.length * 3) / 4);
  expect(bytes).toBeLessThanOrEqual(VIEW_MAX_BYTES);
  // Approaching the cap, not falling far under it.
  expect(bytes).toBeGreaterThan(VIEW_MAX_BYTES * 0.8);
  expect(out!.width * out!.height).toBe(bytes);
  // Two passes: the capped size, then the one the overshoot implied.
  expect(fake.sizes).toHaveLength(2);
  expect(fake.sizes[0]).toEqual({ width: 1568, height: 1207 });
  expect(fake.released()).toBe(1);
});

test("a bitmap that already fits at the capped size is drawn once", async () => {
  const fake = fakeRasterizer({ width: 2070, height: 1594 }, 0.3);
  const out = await rasterizeEpubFigure(new Uint8Array(8), "image/png", fake.rasterizer);
  expect(fake.sizes).toHaveLength(1);
  expect(out).toMatchObject({ width: 1568, height: 1207 });
});

test("an SVG is handed over with a size on it, and drawn at the size it declares", async () => {
  const fake = fakeRasterizer(null, 0.1); // a decoder that will not size an SVG
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect/></svg>`;
  const out = await rasterizeEpubFigure(
    new TextEncoder().encode(svg),
    "image/svg+xml",
    fake.rasterizer,
  );
  const handed = new TextDecoder().decode(fake.decoded[0].bytes);
  expect(handed).toContain(`width="200"`);
  expect(handed).toContain(`height="100"`);
  expect(fake.decoded[0].mimeType).toBe("image/svg+xml");
  // Vector: drawn to the cap, keeping the box's ratio.
  expect(out).toMatchObject({ width: RASTER_MAX_EDGE, height: 784, mimeType: "image/jpeg" });
});

test("a picture that will not decode renders nothing", async () => {
  const fake = fakeRasterizer({ width: 100, height: 100 }, 1, false);
  expect(await rasterizeEpubFigure(new Uint8Array(8), "image/png", fake.rasterizer)).toBeNull();
  expect(fake.sizes).toHaveLength(0);
});

// --- against a real book -----------------------------------------------------

// The corpus holds copyrighted books and nothing from it is in this repository;
// a machine without it skips this. Same directory and same override as
// tests/reading/epub/corpus.test.ts.
const CORPUS = process.env.EPUB_CORPUS ?? "/home/xinyuan/Documents/Github/epub-translator/output";

// The largest PNG any of those books ships over the cap, with its real pixel
// size read off the IHDR header. A JPEG's size would have to be walked out of
// its segments; one honest oversized picture is what this case needs.
function largestOversizedPng(): { name: string; bytes: number; width: number; height: number } | null {
  if (!existsSync(CORPUS)) return null;
  let best: { name: string; bytes: number; width: number; height: number } | null = null;
  for (const file of readdirSync(CORPUS).filter((f) => f.toLowerCase().endsWith(".epub"))) {
    const zip = openZip(new Uint8Array(readFileSync(join(CORPUS, file))));
    for (const entry of zip.entries) {
      if (!entry.name.toLowerCase().endsWith(".png")) continue;
      if (entry.size <= VIEW_MAX_BYTES) continue;
      if (best && entry.size <= best.bytes) continue;
      const png = zip.bytes(entry.name);
      if (!png || png.length < 24) continue;
      const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
      best = {
        name: `${file}:${entry.name}`,
        bytes: png.length,
        width: view.getUint32(16),
        height: view.getUint32(20),
      };
    }
  }
  return best;
}

const oversized = largestOversizedPng();

test.skipIf(oversized === null)("a real oversized PNG is planned down inside the cap", async () => {
  const png = oversized!;
  expect(planEpubView("image/png", png.bytes)).toEqual({ action: "raster", reason: "oversize" });

  const target = rasterSize(png.width, png.height, false);
  expect(Math.max(target.width, target.height)).toBe(RASTER_MAX_EDGE);

  // A canvas is the webview's, so the encoder here is a model of one: half a
  // byte per pixel is what q0.82 costs on a photograph, and the point of the
  // case is that the decision function's target is a size the loop settles at.
  const fake = fakeRasterizer({ width: png.width, height: png.height }, 0.5);
  const out = await rasterizeEpubFigure(new Uint8Array(8), "image/png", fake.rasterizer);
  const bytes = Math.floor((out!.base64.length * 3) / 4);
  expect(bytes).toBeLessThanOrEqual(VIEW_MAX_BYTES);
  expect(fake.sizes[0]).toEqual(target);
  console.log(
    `${png.name}: ${png.width}x${png.height}, ${(png.bytes / 1e6).toFixed(2)} MB -> ` +
      `${out!.width}x${out!.height}, ${(bytes / 1e6).toFixed(2)} MB in ${fake.sizes.length} pass(es)`,
  );
}, 30000);
