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

// The group the tint is allowed to reach. It holds exactly the sheet and the
// page raster; the selection, annotation and quote layers stay outside it.
//
// `isolation: isolate` is load-bearing, not decoration. mix-blend-mode blends
// against the backdrop of the nearest ancestor *stacking context*, and EmbedPDF
// gives a page none: the scroller sizes each page box in pixels
// (`position: relative`, no transform, z-index only on an elevated page), and
// so does PagePointerProvider. Without this the blend group would climb to
// whatever ancestor happens to make one, and the browser would have to keep a
// backdrop for that whole subtree. Isolating here pins the group to one page
// and to the two layers the tint is meant for.
export const PAGE_WASH_GROUP_STYLE: CSSProperties = {
  position: "absolute",
  inset: 0,
  isolation: "isolate",
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
