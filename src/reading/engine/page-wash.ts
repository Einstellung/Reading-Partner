// The paper tint: the layer that turns a white page a shade of paper.
//
// The switch is not here and no prop carries it. `--page-wash` is defined once
// in styles.css (`transparent` by default, a paper colour under
// `[data-tint="paper"]` on <html>), so flipping it repaints every open page
// without a re-render, a state read or a reload. The fallback in the var()
// keeps the reader correct on its own: multiplying by a fully transparent
// colour is the identity, so with the tint off this layer is not just invisible
// but arithmetically absent.
//
// Multiply rather than `filter: sepia()` or `invert()`. A filter is evaluated
// over the page raster, so it is recomputed while the page moves — at 2x DPI
// with tiling that is the largest bitmap on screen, re-filtered per frame. A
// solid colour multiplied in is a compositing step: white paper becomes the
// tint, black glyphs stay black (anything x 0 is 0), and the contrast the type
// was set at is untouched. Illustrations only warm slightly.

import type { CSSProperties } from "react";

// The group the tint is allowed to reach. It holds exactly the sheet and what
// the book itself paints on it — a PDF page's raster, an EPUB page's column of
// text; the selection, annotation and quote layers stay outside it.
//
// `isolation: isolate` is load-bearing, not decoration. mix-blend-mode blends
// against the backdrop of the nearest ancestor *stacking context*, and EmbedPDF
// gives a page none: the scroller sizes each page box in pixels
// (`position: relative`, no transform, z-index only on an elevated page), and
// so does PagePointerProvider. Without this the blend group would climb to
// whatever ancestor happens to make one, and the browser would have to keep a
// backdrop for that whole subtree. Isolating here pins the group to one page
// and to the two layers the tint is meant for.
const GROUP_BOX: CSSProperties = {
  position: "absolute",
  inset: 0,
  isolation: "isolate",
};

export const PAGE_WASH_GROUP_STYLE: CSSProperties = {
  ...GROUP_BOX,
  pointerEvents: "none",
};

// Painted last inside the group, so its backdrop is the sheet plus whatever of
// the raster has arrived. Kept out of hit-testing: the layers above it own the
// pointer, and a page with no text yet must still be draggable through here.
export const PAGE_WASH_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  pointerEvents: "none",
  mixBlendMode: "multiply",
  backgroundColor: "var(--page-wash, transparent)",
};

// The same two layers for a tree built by hand. An EPUB sheet is a shadow root
// filled imperatively (epub/page-mount.ts), not JSX, and the tint has to be the
// same tint: one value, written out twice in two spellings, rather than one
// beige hex in each reader.
//
// The group's box only. `pointer-events` is the caller's: a PDF group holds a
// raster nothing is ever read out of, an EPUB group holds the book's own text
// and the pen reads a caret out of it by hit-testing (epub/caret.ts).
export const PAGE_WASH_GROUP_CSS = cssText(GROUP_BOX);
export const PAGE_WASH_CSS = cssText(PAGE_WASH_STYLE);

function cssText(style: CSSProperties): string {
  return Object.entries(style)
    .map(([prop, value]) => `${prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}:${String(value)}`)
    .join(";");
}
