// How the pages sit in the reading area: the space around them, the space
// between them, and what fills both. Data, not React, because two of the four
// numbers are plugin configuration that every fit and every placement is
// computed from — so the rules that must hold between them are testable here
// rather than discovered on an iPad.
//
// Two numbers, two different units, and only one of them is a length on screen:
//
//   viewportGap  CSS pixels of padding the viewport plugin gives its own scroll
//                container. It is not decoration: the zoom plugin resolves
//                every fit against `clientWidth - 2 * viewportGap`, and the
//                scroll plugin adds it to every scroll position it computes for
//                a page. A non-zero gap therefore costs twice — a margin of
//                blank around the sheet, and a page that never reaches the edge
//                of the screen because the fit was told the screen is narrower
//                than it is. It is zero here: the paper owns the width.
//
//   pageGap      Unscaled page units between two pages, which the scroll plugin
//                multiplies by the current scale before laying the strip out.
//                So the separator grows with the zoom; it cannot be pinned to a
//                constant number of pixels without the DOM gap disagreeing with
//                the virtual items the scroll model places pages by, and a page
//                whose model position is not its DOM position is a page that
//                scrollToPage lands next to.
//
// Nothing here is inside a page. The sheet's background and edge are painted on
// a box that is exactly the page box (`inset: 0`), so no value in this file can
// move a tile, a selection rectangle or an annotation relative to the page they
// belong to.

export interface PageFrame {
  // Padding around the whole scroll content, in CSS pixels.
  viewportGap: number;
  // Distance between two pages, in unscaled page units.
  pageGap: number;
  // What shows through the gap, and behind the pages when they do not fill the
  // frame (paged mode on a landscape screen, or a pinch below the fit).
  background: string;
  // The sheet itself, visible until the page raster arrives and in the sliver
  // an edge shadow sits on.
  pageBackground: string;
  // The page box's own edge. A CSS box-shadow value, or "none".
  pageEdge: string;
}

// A hairline between two sheets. The gap is barely wider than the two edges
// that meet in it, so what the reader sees is a ruled line rather than a band
// of anything.
export const HAIRLINE_FRAME: PageFrame = {
  viewportGap: 0,
  pageGap: 2,
  background: "#dfe3e8",
  pageBackground: "#ffffff",
  pageEdge: "0 0 0 1px rgba(15, 23, 42, 0.10)",
};

// Sheets lifted off a darker desk. The gap is wide enough for a shadow to read
// as depth instead of as a smudge, and the desk is dark enough that the paper
// is the brightest thing on screen.
export const FLOAT_FRAME: PageFrame = {
  viewportGap: 0,
  pageGap: 8,
  background: "#d5d9de",
  pageBackground: "#ffffff",
  pageEdge: "0 1px 4px rgba(15, 23, 42, 0.22)",
};

export const PAGE_FRAMES = { hairline: HAIRLINE_FRAME, float: FLOAT_FRAME } as const;

export type PageFrameName = keyof typeof PAGE_FRAMES;

// The one in effect. Switching this is the whole of choosing between them.
export const PAGE_FRAME_NAME: PageFrameName = "float";
export const PAGE_FRAME: PageFrame = PAGE_FRAMES[PAGE_FRAME_NAME];

// The separator as the reader sees it: the model's gap taken to the scale the
// document is rendered at. The only place the two units meet.
export function pageGapPx(frame: PageFrame, scale: number): number {
  return frame.pageGap * scale;
}
