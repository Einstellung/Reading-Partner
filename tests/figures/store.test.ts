// Figure-index cache versioning (src/figures/store.parseFiguresCache). Pure — the
// Tauri fs wrapper (ensureFigures/getFigures) is exercised by the app. Run: bun test.

import { test, expect } from "bun:test";
import { parseFiguresCache } from "../../src/figures/store";
import { FIGURES_VERSION } from "../../src/figures/types";

test("accepts a same-version index", () => {
  const idx = { version: FIGURES_VERSION, figures: [{ id: "1", page: 2, caption: "c", bbox: null }] };
  expect(parseFiguresCache(idx)).toBe(idx as never);
});

test("rejects a stale version so the caller re-extracts", () => {
  expect(parseFiguresCache({ version: FIGURES_VERSION + 1, figures: [] })).toBeNull();
  expect(parseFiguresCache({ version: 0, figures: [] })).toBeNull();
});

test("rejects malformed caches", () => {
  expect(parseFiguresCache(null)).toBeNull();
  expect(parseFiguresCache("nope")).toBeNull();
  expect(parseFiguresCache({ version: FIGURES_VERSION })).toBeNull(); // no figures array
  expect(parseFiguresCache({ figures: [] })).toBeNull(); // no version
});

test("version can be checked against an explicit target", () => {
  expect(parseFiguresCache({ version: 7, figures: [] }, 7)).not.toBeNull();
  expect(parseFiguresCache({ version: 7, figures: [] }, 8)).toBeNull();
});
