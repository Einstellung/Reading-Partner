// The phone's door sheet pulled down to close (src/ui/components/companion/door-sheet.ts).
// Run: scripts/t.sh tests/ui/components/companion/door-sheet.test.ts

import { expect, test } from "bun:test";

import {
  SHEET_CLOSE_PX,
  SHEET_FLICK_MIN_PX,
  sheetCloses,
  sheetOffset,
} from "../../../../src/ui/components/companion/door-sheet";

test("the sheet follows the finger down and never up past where it stands", () => {
  expect(sheetOffset(40)).toBe(40);
  expect(sheetOffset(-30)).toBe(0);
});

test("pulled far enough it goes, however slowly", () => {
  expect(sheetCloses(SHEET_CLOSE_PX, 0)).toBe(true);
  expect(sheetCloses(SHEET_CLOSE_PX - 1, 0)).toBe(false);
});

test("a flick down closes it, a tap's jitter does not", () => {
  expect(sheetCloses(SHEET_FLICK_MIN_PX, 0.8)).toBe(true);
  expect(sheetCloses(SHEET_FLICK_MIN_PX - 1, 2)).toBe(false);
  expect(sheetCloses(60, 0.2)).toBe(false);
});

test("pulled up it stays", () => {
  expect(sheetCloses(-200, -3)).toBe(false);
});
