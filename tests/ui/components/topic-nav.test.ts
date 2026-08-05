// Unit tests for the topic sidebar's non-React half
// (src/ui/components/library/topic/topic-nav.ts): which devices start it
// expanded, and how the remembered choice is read back. Run: bun test.

import { expect, test } from "bun:test";
import {
  defaultNavOpen,
  isTopicSection,
  NAV_OPEN_KEY,
  readNavEnv,
  readNavOpen,
  writeNavOpen,
  TOPIC_SECTIONS,
  type NavStore,
} from "../../../src/ui/components/library/topic/topic-nav";

test("the sidebar has exactly the three sections, Materials first", () => {
  expect(TOPIC_SECTIONS.map((s) => s.id)).toEqual(["materials", "talks", "memory"]);
  expect(TOPIC_SECTIONS.map((s) => s.label)).toEqual(["Materials", "Talks", "Memory"]);
});

test("a section name is validated, not trusted", () => {
  expect(isTopicSection("talks")).toBe(true);
  expect(isTopicSection("Talks")).toBe(false);
  expect(isTopicSection(undefined)).toBe(false);
});

test("a desktop starts expanded at any width, because it has a mouse", () => {
  expect(defaultNavOpen({ width: 1440, coarsePointer: false })).toBe(true);
  expect(defaultNavOpen({ width: 800, coarsePointer: false })).toBe(true);
});

test("an iPad in portrait starts collapsed, in landscape expanded", () => {
  expect(defaultNavOpen({ width: 834, coarsePointer: true })).toBe(false);
  expect(defaultNavOpen({ width: 1194, coarsePointer: true })).toBe(true);
});

test("the touch boundary is Tailwind's lg: 1024 is already expanded", () => {
  expect(defaultNavOpen({ width: 1023, coarsePointer: true })).toBe(false);
  expect(defaultNavOpen({ width: 1024, coarsePointer: true })).toBe(true);
});

function fakeStore(initial?: string): NavStore & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(key: string) {
      return key === NAV_OPEN_KEY ? this.value : null;
    },
    setItem(key: string, value: string) {
      if (key === NAV_OPEN_KEY) this.value = value;
    },
  };
}

const IPAD_PORTRAIT = { width: 834, coarsePointer: true };

test("the remembered choice wins over the device default, in both directions", () => {
  expect(readNavOpen(fakeStore("1"), IPAD_PORTRAIT)).toBe(true);
  expect(readNavOpen(fakeStore("0"), { width: 1440, coarsePointer: false })).toBe(false);
});

test("nothing stored falls back to the device default", () => {
  expect(readNavOpen(fakeStore(), IPAD_PORTRAIT)).toBe(false);
  expect(readNavOpen(null, IPAD_PORTRAIT)).toBe(false);
});

// A junk value must not be able to hide the sidebar permanently.
test("an unrecognised stored value reads as absent", () => {
  expect(readNavOpen(fakeStore("false"), { width: 1440, coarsePointer: false })).toBe(true);
  expect(readNavOpen(fakeStore(""), IPAD_PORTRAIT)).toBe(false);
});

test("a storage that throws is a storage that is not there", () => {
  const hostile: NavStore = {
    getItem() {
      throw new Error("denied");
    },
    setItem() {
      throw new Error("denied");
    },
  };
  expect(readNavOpen(hostile, { width: 1440, coarsePointer: false })).toBe(true);
  expect(() => writeNavOpen(hostile, false)).not.toThrow();
});

test("the choice round-trips through the store", () => {
  const store = fakeStore();
  writeNavOpen(store, false);
  expect(readNavOpen(store, { width: 1440, coarsePointer: false })).toBe(false);
  writeNavOpen(store, true);
  expect(readNavOpen(store, IPAD_PORTRAIT)).toBe(true);
});

// A window object with only the parts this reads.
function fakeWindow(width: number, coarse?: boolean): Window {
  return {
    innerWidth: width,
    matchMedia:
      coarse === undefined
        ? undefined
        : (q: string) => ({ matches: q === "(pointer: coarse)" ? coarse : false }),
  } as unknown as Window;
}

test("the environment comes off the window; a missing matchMedia is a fine pointer", () => {
  expect(readNavEnv(fakeWindow(834, true))).toEqual({ width: 834, coarsePointer: true });
  expect(readNavEnv(fakeWindow(834))).toEqual({ width: 834, coarsePointer: false });
});
