import { expect, test } from "bun:test";
import { PAGE_FRAME, PAGE_FRAMES, pageGapPx, type PageFrame } from "./page-frame";
import { fitScale } from "./layout-settle";

const FRAMES = Object.entries(PAGE_FRAMES) as [string, PageFrame][];

// Letter-size pages on the two iPad orientations the reader is used in.
const PAGE = { width: 612, height: 792 };
const PORTRAIT = { clientWidth: 834, clientHeight: 1194 };
const LANDSCAPE = { clientWidth: 1194, clientHeight: 834 };

test("no frame puts space around the pages", () => {
  for (const [name, f] of FRAMES) expect([name, f.viewportGap]).toEqual([name, 0]);
});

test("a zero viewport gap makes fit-width exactly the viewport width", () => {
  for (const [name, f] of FRAMES) {
    for (const vp of [PORTRAIT, LANDSCAPE]) {
      const scale = fitScale("fit-width", PAGE, vp, f.viewportGap);
      expect([name, PAGE.width * scale]).toEqual([name, vp.clientWidth]);
    }
  }
});

// The paged strip packs pages side by side and centres the current one, so the
// only thing keeping the next page off a screen it exactly fills is the gap.
test("every frame keeps a separator, so a full-width page never leaks its neighbour", () => {
  for (const [name, f] of FRAMES) {
    expect([name, f.pageGap > 0]).toEqual([name, true]);
    const scale = fitScale("fit-page", PAGE, PORTRAIT, f.viewportGap);
    expect([name, pageGapPx(f, scale) >= 2]).toEqual([name, true]);
  }
});

test("the separator is measured at the scale the document is rendered at", () => {
  expect(pageGapPx({ ...PAGE_FRAME, pageGap: 8 }, 1.5)).toBe(12);
  expect(pageGapPx({ ...PAGE_FRAME, pageGap: 8 }, 1)).toBe(8);
});

test("the sheet is lighter than what surrounds it", () => {
  const luma = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  };
  for (const [name, f] of FRAMES) {
    expect([name, luma(f.pageBackground) > luma(f.background)]).toEqual([name, true]);
  }
});
