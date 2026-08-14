// Figure-index cache versioning (src/reading/figures/store.parseFiguresCache). Pure — the
// Tauri fs wrapper (ensureFigures/getFigures) is exercised by the app. Run: bun test.

import { test, expect } from "bun:test";
import { parseFiguresCache } from "../../../src/reading/figures/store";
import { FIGURES_VERSION } from "../../../src/reading/figures/types";

test("accepts a same-version index", () => {
  const idx = {
    version: FIGURES_VERSION,
    status: "ok",
    figures: [{ id: "1", page: 2, caption: "c", bbox: null }],
  };
  expect(parseFiguresCache(idx)).toBe(idx as never);
});

test("rejects a stale version so the caller re-extracts", () => {
  expect(parseFiguresCache({ version: FIGURES_VERSION + 1, status: "ok", figures: [] })).toBeNull();
  expect(parseFiguresCache({ version: 0, status: "ok", figures: [] })).toBeNull();
});

test("rejects malformed caches", () => {
  expect(parseFiguresCache(null)).toBeNull();
  expect(parseFiguresCache("nope")).toBeNull();
  expect(parseFiguresCache({ version: FIGURES_VERSION, status: "ok" })).toBeNull(); // no figures array
  expect(parseFiguresCache({ status: "ok", figures: [] })).toBeNull(); // no version
  // A version-2 file: an empty index that cannot say whether the document has
  // no figures or the extraction failed. Turned down, so it is extracted again.
  expect(parseFiguresCache({ version: FIGURES_VERSION, figures: [] })).toBeNull();
});

test("version can be checked against an explicit target", () => {
  expect(parseFiguresCache({ version: 7, status: "ok", figures: [] }, 7)).not.toBeNull();
  expect(parseFiguresCache({ version: 7, status: "ok", figures: [] }, 8)).toBeNull();
});
