// Unit tests for the pure mode-flag merge (src/platform/app/storage.ts withModes):
// the per-book sticky Classroom mode (docs/09), written alongside the reader's
// own position fields without disturbing them. Run: bun test.

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

const OFF = { classroom: false };

test("sets the flag while preserving reader-owned position fields", () => {
  const on = withModes(base, { classroom: true });
  expect(on.classroom).toBe(true);
  expect(on.pageIndex).toBe(7);
  expect(on.scale).toBe(1.25);
  expect(on.pageX).toBe(10);
  expect(on.pageY).toBe(20);
});

test("clears the flag to false (off, but explicit)", () => {
  const off = withModes({ ...base, classroom: true }, OFF);
  expect(off.classroom).toBe(false);
  expect(off.pageIndex).toBe(7);
});

test("falls back to a default base when the book has no saved state", () => {
  const on = withModes(null, { classroom: true });
  expect(on.classroom).toBe(true);
  expect(on.pageIndex).toBe(0);
  expect(on.scrollMode).toBe(0);
  // The removed spread is not written into new state.
  expect(on.spreadMode).toBeUndefined();
});

test("keeps a legacy spreadMode from an old file untouched", () => {
  expect(withModes(base, OFF).spreadMode).toBe(0);
});

// A file written while rehearsal was briefly a mode of a book still carries the
// key. Nothing reads it, and the merge neither writes nor removes it.
test("leaves a stale rehearsal flag from an older build alone", () => {
  const stale = { ...base, rehearsal: true } as ViewState & { rehearsal?: boolean };
  const merged = withModes(stale, { classroom: true }) as ViewState & { rehearsal?: boolean };
  expect(merged.rehearsal).toBe(true);
  expect(merged.classroom).toBe(true);
});

test("does not mutate the input state", () => {
  const input: ViewState = { ...base };
  withModes(input, { classroom: true });
  expect("classroom" in input).toBe(false);
});
