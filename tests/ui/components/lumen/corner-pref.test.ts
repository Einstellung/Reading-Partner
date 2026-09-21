// The logo's switch, per device (docs/68).
//
// Run: bun test.

import { expect, test } from "bun:test";

import type { PrefStore } from "../../../../src/ui/components/base/pref-store";
import {
  LUMEN_CORNER_KEY,
  LUMEN_CORNER_SPOT_KEY,
  lumenToggleTitle,
  readLumenCornerShown,
  readLumenCornerSpot,
  writeLumenCornerShown,
  writeLumenCornerSpot,
} from "../../../../src/ui/components/lumen/corner-pref";
import { CORNER_SPOT_DEFAULT } from "../../../../src/ui/components/lumen/corner-drag";

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
  expect(readLumenCornerShown(store())).toBe(true);
  expect(readLumenCornerShown(null)).toBe(true);
  expect(readLumenCornerShown(store({ [LUMEN_CORNER_KEY]: "banana" }))).toBe(true);
});

test("the marker for hidden is the only thing that hides it", () => {
  expect(readLumenCornerShown(store({ [LUMEN_CORNER_KEY]: "0" }))).toBe(false);
  expect(readLumenCornerShown(store({ [LUMEN_CORNER_KEY]: "1" }))).toBe(true);
});

test("the choice survives the read that follows it", () => {
  const slot = store();
  writeLumenCornerShown(slot, false);
  expect(slot.slots[LUMEN_CORNER_KEY]).toBe("0");
  expect(readLumenCornerShown(slot)).toBe(false);
  writeLumenCornerShown(slot, true);
  expect(readLumenCornerShown(slot)).toBe(true);
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
  expect(readLumenCornerShown(broken)).toBe(true);
  expect(() => writeLumenCornerShown(broken, false)).not.toThrow();
  expect(() => writeLumenCornerShown(null, false)).not.toThrow();
});

// And where it stands, in the slot beside it (docs/68).

test("the corner is the bottom right until this device says otherwise", () => {
  expect(readLumenCornerSpot(store())).toEqual(CORNER_SPOT_DEFAULT);
  expect(readLumenCornerSpot(null)).toEqual(CORNER_SPOT_DEFAULT);
  expect(readLumenCornerSpot(store({ [LUMEN_CORNER_SPOT_KEY]: "banana" }))).toEqual(
    CORNER_SPOT_DEFAULT,
  );
});

test("the spot survives the read that follows it", () => {
  const slot = store();
  writeLumenCornerSpot(slot, { side: "left", lift: 0.42 });
  expect(slot.slots[LUMEN_CORNER_SPOT_KEY]).toBe('{"side":"left","lift":0.42}');
  expect(readLumenCornerSpot(slot)).toEqual({ side: "left", lift: 0.42 });
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
  expect(readLumenCornerSpot(broken)).toEqual(CORNER_SPOT_DEFAULT);
  expect(() => writeLumenCornerSpot(broken, { side: "left", lift: 0.5 })).not.toThrow();
  expect(() => writeLumenCornerSpot(null, { side: "left", lift: 0.5 })).not.toThrow();
});

test("the label says what the press will do", () => {
  expect(lumenToggleTitle(true)).toBe("Hide Lumen");
  expect(lumenToggleTitle(false)).toBe("Show Lumen");
});
