// The arithmetic of the phone's paged view (docs/79): a column strip, a window
// of spine documents side by side, and where a box or a touch falls on them.

import { describe, expect, test } from "bun:test";
import { FLOW_DISPLAY_DEFAULT, FLOW_PAD_Y } from "../../../../src/reading/epub/flow/flow-display";
import {
  columnAt,
  columnCount,
  inBackEdge,
  inkOnPage,
  isInkAt,
  layoutWindow,
  locateInWindow,
  neighbourSpines,
  pageProbePoints,
  strokeProbePoints,
  pagedColumnCss,
  windowPageOf,
} from "../../../../src/reading/epub/flow/paged-logic";

describe("the column rules", () => {
  test("one column a screen wide, the gap twice the margin, the paper exactly one screen", () => {
    const css = pagedColumnCss(393, 715, { ...FLOW_DISPLAY_DEFAULT, padX: 36 });
    expect(css).toContain("width: 393px;");
    expect(css).toContain("height: 715px;");
    expect(css).toContain("column-width: 321px;");
    expect(css).toContain("column-gap: 72px;");
    expect(css).toContain("column-fill: auto;");
    expect(css).toContain(`padding: ${FLOW_PAD_Y}px 36px;`);
  });

  test("a picture is never taller than the text block and never cut in two", () => {
    const css = pagedColumnCss(375, 600, FLOW_DISPLAY_DEFAULT);
    expect(css).toContain(`max-height: ${600 - 2 * FLOW_PAD_Y}px`);
    expect(css).toContain("object-fit: contain");
    expect(css).toContain("break-inside: avoid");
  });

  test("the wash inside the multi-column box is off: the view paints it over the strip", () => {
    expect(pagedColumnCss(393, 715, FLOW_DISPLAY_DEFAULT)).toContain(".rp-wash { display: none; }");
  });
});

describe("counting and finding columns", () => {
  test("a strip is a whole number of screens, at least one", () => {
    expect(columnCount(393 * 12, 393)).toBe(12);
    expect(columnCount(393 * 12 + 1, 393)).toBe(12);
    expect(columnCount(0, 393)).toBe(1);
    expect(columnCount(1000, 0)).toBe(1);
  });

  test("a box is on the column its left edge falls in, measured from the strip's origin", () => {
    // Column k's text starts at padX + k * W.
    expect(columnAt(20, 0, 393, 10)).toBe(0);
    expect(columnAt(393 + 20, 0, 393, 10)).toBe(1);
    expect(columnAt(5 * 393 + 20 - 1000, -1000, 393, 10)).toBe(5);
    // Sub-pixel rounding at a column's very start still counts as that column.
    expect(columnAt(393 - 0.3, 0, 393, 10)).toBe(1);
  });

  test("a box past either end is on the nearest column", () => {
    expect(columnAt(-50, 0, 393, 10)).toBe(0);
    expect(columnAt(393 * 40, 0, 393, 10)).toBe(9);
    expect(columnAt(9999, 0, 393, 1)).toBe(0);
  });
});

describe("the window of documents", () => {
  const win = layoutWindow([
    { spine: 5, pages: 3 },
    { spine: 4, pages: 2 },
    { spine: 6, pages: 7 },
  ]);

  test("documents are laid side by side in spine order", () => {
    expect(win.slots.map((s) => [s.spine, s.first])).toEqual([
      [4, 0],
      [5, 2],
      [6, 5],
    ]);
    expect(win.total).toBe(12);
  });

  test("a window page is a document and a column in it, and back", () => {
    expect(locateInWindow(win, 0)).toEqual({ spine: 4, column: 0 });
    expect(locateInWindow(win, 1)).toEqual({ spine: 4, column: 1 });
    expect(locateInWindow(win, 2)).toEqual({ spine: 5, column: 0 });
    expect(locateInWindow(win, 11)).toEqual({ spine: 6, column: 6 });
    for (let p = 0; p < win.total; p++) {
      const at = locateInWindow(win, p)!;
      expect(windowPageOf(win, at.spine, at.column)).toBe(p);
    }
  });

  test("out of range is clamped, and a document not in the window has no page", () => {
    expect(locateInWindow(win, -3)).toEqual({ spine: 4, column: 0 });
    expect(locateInWindow(win, 99)).toEqual({ spine: 6, column: 6 });
    expect(windowPageOf(win, 5, 99)).toBe(4);
    expect(windowPageOf(win, 9, 0)).toBeNull();
    expect(locateInWindow(layoutWindow([]), 0)).toBeNull();
  });

  test("the document read and its two neighbours are kept, inside the book", () => {
    expect(neighbourSpines(0, 10)).toEqual([0, 1]);
    expect(neighbourSpines(4, 10)).toEqual([3, 4, 5]);
    expect(neighbourSpines(9, 10)).toEqual([8, 9]);
    expect(neighbourSpines(0, 1)).toEqual([0]);
  });
});

describe("the first character of a page", () => {
  test("probed down the text block from its first line, at the line start and a little in", () => {
    const pts = pageProbePoints({ left: 10, top: 100, height: 200 }, 20);
    expect(pts[0]).toEqual({ x: 32, y: 100 + FLOW_PAD_Y + 4 });
    expect(pts.slice(0, 3).map((p) => p.x)).toEqual([32, 72, 152]);
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(100 + FLOW_PAD_Y);
      expect(p.y).toBeLessThan(300 - FLOW_PAD_Y);
    }
    // Top to bottom: the first point that lands on ink wins.
    const ys = pts.map((p) => p.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  });

  test("space is not a place to anchor on", () => {
    expect(isInkAt("  word", 0)).toBe(false);
    expect(isInkAt("  word", 2)).toBe(true);
    expect(isInkAt(" x", 0)).toBe(false);
    expect(isInkAt("abc", 3)).toBe(false);
    expect(isInkAt("字", 0)).toBe(true);
  });
});

describe("the back band", () => {
  test("a touch that starts in it is the shell's, anywhere else is the page's", () => {
    expect(inBackEdge(5, 0, 24)).toBe(true);
    expect(inBackEdge(23.9, 0, 24)).toBe(true);
    expect(inBackEdge(24, 0, 24)).toBe(false);
    expect(inBackEdge(110, 100, 24)).toBe(true);
    expect(inBackEdge(90, 100, 24)).toBe(false);
    expect(inBackEdge(5, 0, 0)).toBe(false);
  });
});

describe("the first ink on a page", () => {
  test("a caret on the line before, a word broken across pages, moves onto this page", () => {
    // "Librari-" ends the page before; "an)." starts this one at offset 7.
    expect(inkOnPage("Librarian).", 6, (o) => o >= 7)).toBe(7);
  });

  test("a caret already on this page is kept; space and other pages are not", () => {
    expect(inkOnPage("the whale", 4, () => true)).toBe(4);
    expect(inkOnPage("a  b", 1, () => true)).toBeNull();
    expect(inkOnPage("whale", 0, () => false)).toBeNull();
  });
});

describe("a stroke that runs off the words", () => {
  const box = { left: 0, top: 100, width: 393, height: 600 };

  test("a finger in the right margin is looked for inside the column, at its own height first", () => {
    const pts = strokeProbePoints({ x: 390, y: 400 }, box, 36);
    expect(pts[0]).toEqual({ x: 393 - 36 - 1, y: 400 });
    for (const p of pts) expect(p.x).toBe(356);
  });

  test("below the last line it walks up first, then down, and never leaves the text area", () => {
    const pts = strokeProbePoints({ x: 200, y: 900 }, box, 36, 10);
    const bottom = 100 + 600 - FLOW_PAD_Y - 1;
    expect(pts[0]).toEqual({ x: 200, y: bottom });
    expect(pts[1].y).toBe(bottom - 10);
    for (const p of pts) {
      expect(p.y).toBeGreaterThanOrEqual(100 + FLOW_PAD_Y);
      expect(p.y).toBeLessThanOrEqual(bottom);
    }
  });

  test("from the middle: every point above before any below", () => {
    const pts = strokeProbePoints({ x: 10, y: 400 }, box, 36, 50);
    expect(pts[0]).toEqual({ x: 37, y: 400 });
    const firstBelow = pts.findIndex((p) => p.y > 400);
    expect(firstBelow).toBeGreaterThan(1);
    expect(pts.slice(1, firstBelow).every((p) => p.y < 400)).toBe(true);
    expect(pts.slice(firstBelow).every((p) => p.y > 400)).toBe(true);
  });
});
