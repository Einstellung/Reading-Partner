// The figure card's text label (src/components/FigureCard.figureChipLabel).
// Pure; the card's DOM behavior (lazy raster, click-to-jump) is device-verified.
// Run: bun test.

import { test, expect } from "bun:test";
import { figureChipLabel } from "../../src/components/FigureCard";
import { cardDisplayWidth } from "../../src/figures/render";
import type { Figure } from "../../src/figures/types";

test("chip label reads Fig. <id> · p.<page>", () => {
  const fig: Figure = { id: "3a", page: 12, caption: "x", bbox: null };
  expect(figureChipLabel(fig)).toBe("Fig. 3a · p.12");
});

test("card display width divides natural pixels by the device pixel ratio", () => {
  // A crop rendered at 2x page scale shows at 1x logical size on a 2x screen.
  expect(cardDisplayWidth(800, 2)).toBe(400);
  // On a 1x screen a small crop shows at its natural size, not upscaled.
  expect(cardDisplayWidth(300, 1)).toBe(300);
  // A zero / bogus dpr never divides by less than 1.
  expect(cardDisplayWidth(500, 0)).toBe(500);
});
