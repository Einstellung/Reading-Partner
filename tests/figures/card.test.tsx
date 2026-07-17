// The figure card's text label (src/components/FigureCard.figureChipLabel).
// Pure; the card's DOM behavior (lazy raster, click-to-jump) is device-verified.
// Run: bun test.

import { test, expect } from "bun:test";
import { figureChipLabel } from "../../src/components/FigureCard";
import type { Figure } from "../../src/figures/types";

test("chip label reads Fig. <id> · p.<page>", () => {
  const fig: Figure = { id: "3a", page: 12, caption: "x", bbox: null };
  expect(figureChipLabel(fig)).toBe("Fig. 3a · p.12");
});
