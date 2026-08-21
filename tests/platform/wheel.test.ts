// A wheel delta's unit (src/platform/app/wheel.ts). Read as pixels, a line-mode
// engine's three-per-notch is a fourteenth of what the same notch reports on a
// pixel-mode one, and every gesture tuned on the latter feels dead on the
// former. Run: bun test.

import { expect, test } from "bun:test";
import { wheelDeltaPixels } from "../../src/platform/app/wheel";

test("pixels pass through, and so does a mode nobody defined", () => {
  expect(wheelDeltaPixels(-40, 0)).toBe(-40);
  expect(wheelDeltaPixels(-40, 7)).toBe(-40);
});

test("lines and pages are converted", () => {
  expect(wheelDeltaPixels(-3, 1)).toBe(-48);
  expect(wheelDeltaPixels(1, 2)).toBe(800);
});
