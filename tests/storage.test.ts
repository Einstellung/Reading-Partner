// Unit tests for the pure mode-flag merge (src/platform/app/storage.ts withModes):
// the per-book sticky Classroom (docs/09) and Rehearsal (docs/31) modes, which are
// mutually exclusive and therefore always written together. Run: bun test.

import { expect, test } from "bun:test";
import { withModes } from "../src/platform/app/storage";
import type { ViewState } from "../src/platform/app/reader-contract";

const base: ViewState = {
  pageIndex: 7,
  scale: 1.25,
  scrollMode: 0,
  // Legacy field from the removed two-page spread: old files still carry it.
  spreadMode: 0,
  pageX: 10,
  pageY: 20,
};

const OFF = { classroom: false, rehearsal: false };

test("sets the flags while preserving reader-owned position fields", () => {
  const on = withModes(base, { classroom: true, rehearsal: false });
  expect(on.classroom).toBe(true);
  expect(on.rehearsal).toBe(false);
  expect(on.pageIndex).toBe(7);
  expect(on.scale).toBe(1.25);
  expect(on.pageX).toBe(10);
  expect(on.pageY).toBe(20);
});

test("clears the flags to false (off, but explicit)", () => {
  const off = withModes({ ...base, classroom: true }, OFF);
  expect(off.classroom).toBe(false);
  expect(off.rehearsal).toBe(false);
  expect(off.pageIndex).toBe(7);
});

// The reason both flags are always written: a switch that only set the pressed
// one would leave a file claiming both modes are on.
test("switching modes turns the other one off in the same write", () => {
  const switched = withModes({ ...base, classroom: true }, { classroom: false, rehearsal: true });
  expect(switched.classroom).toBe(false);
  expect(switched.rehearsal).toBe(true);
});

test("falls back to a default base when the book has no saved state", () => {
  const on = withModes(null, { classroom: false, rehearsal: true });
  expect(on.rehearsal).toBe(true);
  expect(on.pageIndex).toBe(0);
  expect(on.scrollMode).toBe(0);
  // The removed spread is not written into new state.
  expect(on.spreadMode).toBeUndefined();
});

test("keeps a legacy spreadMode from an old file untouched", () => {
  expect(withModes(base, OFF).spreadMode).toBe(0);
});

test("does not mutate the input state", () => {
  const input: ViewState = { ...base };
  withModes(input, { classroom: true, rehearsal: false });
  expect("classroom" in input).toBe(false);
});
