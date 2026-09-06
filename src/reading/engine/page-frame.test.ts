import { expect, test } from "bun:test";
import { DESK, DESK_DEFAULT_HEX, PAGE_FRAMES, type PageFrame } from "./page-frame";
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
  }
});

const luma = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
};

// The ground is a CSS variable so the paper tint can reach it; what it resolves
// to still has to be a colour these tests can weigh.
const groundHex = (f: PageFrame) => (f.background === DESK ? DESK_DEFAULT_HEX : f.background);

test("the sheet is lighter than what surrounds it", () => {
  for (const [name, f] of FRAMES) {
    expect([name, luma(f.pageBackground) > luma(groundHex(f))]).toEqual([name, true]);
  }
});

// page-frame.ts cannot import the stylesheet, so the value it documents is a
// copy. Both places are read at once here: a token that moved in styles.css and
// nowhere else would otherwise only show up on screen.
test("the desk default matches the token styles.css declares", async () => {
  const css = await Bun.file(new URL("../../styles.css", import.meta.url)).text();
  const declared = /^\s*--desk:\s*(#[0-9a-f]{6});/im.exec(css);
  expect(declared?.[1]).toBe(DESK_DEFAULT_HEX);
});

// The tint warms every ground it touches; the desk is one of them, and it has
// to stay under the tinted paper the way the default desk stays under white.
test("the paper tint gives the desk a warmer ground of its own", async () => {
  const css = await Bun.file(new URL("../../styles.css", import.meta.url)).text();
  const tinted = /\[data-tint="paper"\][^}]*?--desk:\s*(#[0-9a-f]{6});/is.exec(css);
  const wash = /--page-wash:\s*(#[0-9a-f]{6});/i.exec(css);
  expect(tinted).not.toBeNull();
  expect(luma(tinted![1])).toBeLessThan(luma(DESK_DEFAULT_HEX));
  expect(luma(wash![1])).toBeGreaterThan(luma(tinted![1]));
});
