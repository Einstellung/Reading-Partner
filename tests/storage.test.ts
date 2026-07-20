// Unit tests for the pure classroom-flag merge (src/storage.ts withClassroom):
// the per-book sticky Classroom mode (docs/09). Run: bun test.

import { expect, test } from "bun:test";
import { withClassroom } from "../src/storage";
import type { ViewState } from "../src/reader-contract";

const base: ViewState = {
  pageIndex: 7,
  scale: 1.25,
  scrollMode: 0,
  spreadMode: 0,
  pageX: 10,
  pageY: 20,
};

test("sets the flag while preserving reader-owned position fields", () => {
  const on = withClassroom(base, true);
  expect(on.classroom).toBe(true);
  expect(on.pageIndex).toBe(7);
  expect(on.scale).toBe(1.25);
  expect(on.pageX).toBe(10);
  expect(on.pageY).toBe(20);
});

test("clears the flag to false (off, but explicit)", () => {
  const off = withClassroom({ ...base, classroom: true }, false);
  expect(off.classroom).toBe(false);
  expect(off.pageIndex).toBe(7);
});

test("falls back to a default base when the book has no saved state", () => {
  const on = withClassroom(null, true);
  expect(on.classroom).toBe(true);
  expect(on.pageIndex).toBe(0);
  expect(on.scrollMode).toBe(0);
  expect(on.spreadMode).toBe(0);
});

test("does not mutate the input state", () => {
  const input: ViewState = { ...base };
  withClassroom(input, true);
  expect("classroom" in input).toBe(false);
});
