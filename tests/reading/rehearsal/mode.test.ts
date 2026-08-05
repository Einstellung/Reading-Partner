// The book-level chat's three postures and the one rule that governs them: never
// two at once (src/reading/rehearsal/mode.ts). Pure. Run: bun test.

import { expect, test } from "bun:test";
import { flagsOf, modeOf, pressMode } from "../../../src/reading/rehearsal/mode";

test("absent flags mean the plain companion", () => {
  expect(modeOf(null)).toBe("companion");
  expect(modeOf({})).toBe("companion");
  expect(modeOf({ classroom: false, rehearsal: false })).toBe("companion");
});

test("each flag names its mode", () => {
  expect(modeOf({ classroom: true })).toBe("classroom");
  expect(modeOf({ rehearsal: true })).toBe("rehearsal");
});

// This build cannot write both, but a hand-edited file could; the reader with a
// decision file gets the mode that shows it.
test("a file claiming both modes restores as rehearsal", () => {
  expect(modeOf({ classroom: true, rehearsal: true })).toBe("rehearsal");
});

test("flags round-trip through the mode", () => {
  for (const mode of ["companion", "classroom", "rehearsal"] as const) {
    expect(modeOf(flagsOf(mode))).toBe(mode);
  }
  expect(flagsOf("rehearsal")).toEqual({ classroom: false, rehearsal: true });
});

test("pressing a mode's own button turns it off", () => {
  expect(pressMode("classroom", "classroom")).toBe("companion");
  expect(pressMode("rehearsal", "rehearsal")).toBe("companion");
});

test("pressing the other button switches, never stacks", () => {
  expect(pressMode("companion", "rehearsal")).toBe("rehearsal");
  expect(pressMode("classroom", "rehearsal")).toBe("rehearsal");
  expect(pressMode("rehearsal", "classroom")).toBe("classroom");
});

test("no press can leave both flags on", () => {
  for (const from of ["companion", "classroom", "rehearsal"] as const) {
    for (const pressed of ["classroom", "rehearsal"] as const) {
      const flags = flagsOf(pressMode(from, pressed));
      expect(flags.classroom && flags.rehearsal).toBe(false);
    }
  }
});
