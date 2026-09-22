// The bottom-edge register (src/ui/components/base/bottom-sheet.ts): a sheet
// says it is standing there and Lumen's corner reads it. Run: bun test.

import { beforeEach, expect, test } from "bun:test";
import {
  bottomSheetOpen,
  pushBottomSheet,
  resetBottomSheets,
  subscribeBottomSheet,
} from "../../../../src/ui/components/base/bottom-sheet";

beforeEach(resetBottomSheets);

test("nothing is on the edge until a sheet says so", () => {
  expect(bottomSheetOpen()).toBe(false);
  const release = pushBottomSheet();
  expect(bottomSheetOpen()).toBe(true);
  release();
  expect(bottomSheetOpen()).toBe(false);
});

test("the edge is clear only once the last one is gone", () => {
  const outer = pushBottomSheet();
  const inner = pushBottomSheet();
  inner();
  expect(bottomSheetOpen()).toBe(true);
  outer();
  expect(bottomSheetOpen()).toBe(false);
});

test("a double release is a no-op", () => {
  const first = pushBottomSheet();
  first();
  first();
  const second = pushBottomSheet();
  expect(bottomSheetOpen()).toBe(true);
  second();
  expect(bottomSheetOpen()).toBe(false);
});

test("every change reaches the watchers, and unsubscribing stops them", () => {
  const seen: boolean[] = [];
  const off = subscribeBottomSheet(() => seen.push(bottomSheetOpen()));
  const release = pushBottomSheet();
  release();
  off();
  pushBottomSheet()();
  expect(seen).toEqual([true, false]);
});
