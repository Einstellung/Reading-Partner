// The logo's switch, per device (docs/68).
//
// Run: bun test.

import { expect, test } from "bun:test";

import type { PrefStore } from "../../../../src/ui/components/base/pref-store";
import {
  COMPANION_CORNER_KEY,
  COMPANION_CORNER_SPOT_KEY,
  readCompanionCornerShown,
  readCompanionCornerSpot,
  writeCompanionCornerShown,
  writeCompanionCornerSpot,
} from "../../../../src/ui/components/companion/corner-pref";
import { CORNER_SPOT_DEFAULT } from "../../../../src/ui/components/companion/corner-drag";
import { companionToggleTitle } from "../../../../src/ui/components/base/companion-toggle";

function store(initial: Record<string, string> = {}): PrefStore & { slots: Record<string, string> } {
  const slots = { ...initial };
  return {
    slots,
    getItem: (key) => slots[key] ?? null,
    setItem: (key, value) => {
      slots[key] = value;
    },
  };
}

test("shown until this device says otherwise", () => {
  expect(readCompanionCornerShown(store())).toBe(true);
  expect(readCompanionCornerShown(null)).toBe(true);
  expect(readCompanionCornerShown(store({ [COMPANION_CORNER_KEY]: "banana" }))).toBe(true);
});

test("the marker for hidden is the only thing that hides it", () => {
  expect(readCompanionCornerShown(store({ [COMPANION_CORNER_KEY]: "0" }))).toBe(false);
  expect(readCompanionCornerShown(store({ [COMPANION_CORNER_KEY]: "1" }))).toBe(true);
});

test("the choice survives the read that follows it", () => {
  const slot = store();
  writeCompanionCornerShown(slot, false);
  expect(slot.slots[COMPANION_CORNER_KEY]).toBe("0");
  expect(readCompanionCornerShown(slot)).toBe(false);
  writeCompanionCornerShown(slot, true);
  expect(readCompanionCornerShown(slot)).toBe(true);
});

test("a storage that is not there is not an error", () => {
  const broken: PrefStore = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  expect(readCompanionCornerShown(broken)).toBe(true);
  expect(() => writeCompanionCornerShown(broken, false)).not.toThrow();
  expect(() => writeCompanionCornerShown(null, false)).not.toThrow();
});

// And where it stands, in the slot beside it (docs/68).

test("the corner is the bottom right until this device says otherwise", () => {
  expect(readCompanionCornerSpot(store())).toEqual(CORNER_SPOT_DEFAULT);
  expect(readCompanionCornerSpot(null)).toEqual(CORNER_SPOT_DEFAULT);
  expect(readCompanionCornerSpot(store({ [COMPANION_CORNER_SPOT_KEY]: "banana" }))).toEqual(
    CORNER_SPOT_DEFAULT,
  );
});

test("the spot survives the read that follows it", () => {
  const slot = store();
  writeCompanionCornerSpot(slot, { side: "left", lift: 0.42 });
  expect(slot.slots[COMPANION_CORNER_SPOT_KEY]).toBe('{"side":"left","lift":0.42}');
  expect(readCompanionCornerSpot(slot)).toEqual({ side: "left", lift: 0.42 });
});

test("a storage that refuses leaves the corner where it has always been", () => {
  const broken: PrefStore = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("denied");
    },
  };
  expect(readCompanionCornerSpot(broken)).toEqual(CORNER_SPOT_DEFAULT);
  expect(() => writeCompanionCornerSpot(broken, { side: "left", lift: 0.5 })).not.toThrow();
  expect(() => writeCompanionCornerSpot(null, { side: "left", lift: 0.5 })).not.toThrow();
});

test("the label says what the press will do", () => {
  expect(companionToggleTitle(true, "Kris")).toBe("Hide Kris");
  expect(companionToggleTitle(false, "Kris")).toBe("Show Kris");
  expect(companionToggleTitle(false, "Mira")).toBe("Show Mira");
});
