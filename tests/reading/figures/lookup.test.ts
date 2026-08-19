// Figure id semantics (src/reading/figures/lookup): what an id normalizes to,
// how two are ordered, and which forms of a citation still find the figure.
// Pure — run with `bun test`.

import { test, expect } from "bun:test";
import {
  canonicalFigureId,
  compareFigureIds,
  findFigureById,
  normalizeFigureId,
  FIGURE_ID_RE,
} from "../../../src/reading/figures/lookup";
import type { Figure } from "../../../src/reading/figures/types";

function fig(id: string, page = 1): Figure {
  return { id, page, caption: `Figure ${id}`, bbox: null };
}

test("the label, spacing and trailing punctuation come off an id", () => {
  expect(normalizeFigureId("3")).toBe("3");
  expect(normalizeFigureId("Figure 3.8")).toBe("3.8");
  expect(normalizeFigureId("fig.3-1")).toBe("3-1");
  expect(normalizeFigureId("FIG: 3A")).toBe("3a");
  expect(normalizeFigureId("图 3.8")).toBe("3.8");
  expect(normalizeFigureId("图表　2-3")).toBe("2-3");
  expect(normalizeFigureId(" 3.8. ")).toBe("3.8");
});

test("every separator folds to one canonical form", () => {
  expect(canonicalFigureId("3-1")).toBe("3.1");
  expect(canonicalFigureId("3.1")).toBe("3.1");
  expect(canonicalFigureId("3—1")).toBe("3.1");
  expect(canonicalFigureId("图 3–1a")).toBe("3.1a");
});

test("ids are ordered by number, not by string", () => {
  expect(compareFigureIds("3.8", "3.10")).toBeLessThan(0);
  expect(compareFigureIds("3.8", "3.8a")).toBeLessThan(0);
  expect(compareFigureIds("3-2", "3.10")).toBeLessThan(0);
  expect(compareFigureIds("10", "9")).toBeGreaterThan(0);
  expect(compareFigureIds("3.1", "3-1")).toBe(0);
});

test("a citation finds the figure whichever separator it picked", () => {
  const figures = [fig("3-1"), fig("3-2"), fig("10-1")];
  expect(findFigureById(figures, "3-2")?.id).toBe("3-2");
  expect(findFigureById(figures, "3.2")?.id).toBe("3-2");
  expect(findFigureById(figures, "Figure 3.2")?.id).toBe("3-2");
  expect(findFigureById(figures, "图 3.2")?.id).toBe("3-2");
  expect(findFigureById(figures, "3-3")).toBeNull();
  expect(findFigureById(figures, "")).toBeNull();
  expect(findFigureById(figures, "figure")).toBeNull();
});

test("an exact match on the printed form wins over a folded one", () => {
  const figures = [fig("3.1", 4), fig("3-1", 9)];
  expect(findFigureById(figures, "3-1")?.page).toBe(9);
  expect(findFigureById(figures, "3.1")?.page).toBe(4);
});

test("the id shape gate accepts printed numbers and rejects prose", () => {
  for (const ok of ["3", "3a", "3.8", "3-1", "3-1a", "2.1.3", "10"]) {
    expect(FIGURE_ID_RE.test(ok)).toBe(true);
  }
  for (const no of ["", "xyz", "3.", "-1", "3 1", "3.8.9.10.11", "1234", "3ab"]) {
    expect(FIGURE_ID_RE.test(no)).toBe(false);
  }
});
