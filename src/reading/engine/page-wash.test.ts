import { expect, test } from "bun:test";
import { PAGE_WASH_GROUP_STYLE, PAGE_WASH_STYLE } from "./page-wash";

// The tint is off by default and must cost nothing then. `transparent` is
// rgba(0,0,0,0), and multiplying by a fully transparent colour leaves the
// backdrop as it was — so an undefined `--page-wash` is a no-op, not a black
// page. Anything else in that fallback slot would darken every reader that has
// not loaded the stylesheet defining the variable.
test("the wash reads a variable that falls back to transparent", () => {
  expect(PAGE_WASH_STYLE.backgroundColor).toBe("var(--page-wash, transparent)");
});

// Multiply keeps black type black and turns white paper the tint. A filter
// would recompute over the whole page raster while it scrolls.
test("the wash tints by compositing, not by filtering", () => {
  expect(PAGE_WASH_STYLE.mixBlendMode).toBe("multiply");
  expect(PAGE_WASH_STYLE).not.toHaveProperty("filter");
});

// Every layer under the tint is already non-interactive; the tint must not be
// the one that starts swallowing taps meant for selection or annotation.
test("nothing in the group takes pointer events", () => {
  expect(PAGE_WASH_STYLE.pointerEvents).toBe("none");
  expect(PAGE_WASH_GROUP_STYLE.pointerEvents).toBe("none");
});

// The blend group has to be a stacking context of its own. EmbedPDF's page box
// is not one (pixel-sized, `position: relative`, no transform), so without this
// the blend would climb to some ancestor and drag its whole subtree into the
// backdrop.
test("the group isolates so the blend cannot leave the page", () => {
  expect(PAGE_WASH_GROUP_STYLE.isolation).toBe("isolate");
});

// Both boxes are the page box, like the sheet: the tint covers the paper
// exactly and cannot displace a tile, a selection rect or an annotation.
test("the group and the wash are the page box", () => {
  for (const s of [PAGE_WASH_GROUP_STYLE, PAGE_WASH_STYLE]) {
    expect(s.position).toBe("absolute");
    expect(s.inset).toBe(0);
  }
});

// The layers the reader adds — selection, annotation, quote highlight — are
// siblings that follow the group in EmbedPdfView's page tree, and none of them
// is inside it. The group carries no z-index, so tree order alone keeps them
// above the tint; giving it one would only invite a fight with the z-indices
// the annotation plugin puts on its own children.
test("the group claims no stacking order of its own", () => {
  expect(PAGE_WASH_GROUP_STYLE).not.toHaveProperty("zIndex");
});
