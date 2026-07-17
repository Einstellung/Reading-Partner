// Figure catalog formatting + capping (src/figures/catalog). Pure. Run: bun test.

import { test, expect } from "bun:test";
import { buildFigureCatalog, selectCatalogFigures } from "../../src/figures/catalog";
import type { Figure } from "../../src/figures/types";

function fig(id: string, page: number, caption = `Caption for ${id}`): Figure {
  return { id, page, caption, bbox: null };
}

test("empty index yields an empty catalog", () => {
  expect(buildFigureCatalog([])).toBe("");
});

test("catalog lists tag, page, and clipped caption", () => {
  const long = "x".repeat(200);
  const out = buildFigureCatalog([fig("1", 3, long), fig("2", 5, "Short")]);
  expect(out).toContain("[fig:1] p.3 — " + "x".repeat(100) + "…");
  expect(out).toContain("[fig:2] p.5 — Short");
  expect(out.startsWith("Figures in this document")).toBe(true);
});

test("under the cap, figures come out sorted by page", () => {
  const chosen = selectCatalogFigures([fig("2", 9), fig("1", 2), fig("3", 5)], { max: 40 });
  expect(chosen.map((f) => f.page)).toEqual([2, 5, 9]);
});

test("over the cap, keep the figures nearest the current page", () => {
  const figs: Figure[] = [];
  for (let p = 1; p <= 20; p++) figs.push(fig(String(p), p));
  const chosen = selectCatalogFigures(figs, { max: 4, currentPage: 10 });
  // Nearest to page 10: 8,9,10,11 (ties resolved toward the lower page), sorted.
  expect(chosen.map((f) => f.page)).toEqual([8, 9, 10, 11]);
});

test("capping notes how many figures were omitted", () => {
  const figs: Figure[] = [];
  for (let p = 1; p <= 10; p++) figs.push(fig(String(p), p));
  const out = buildFigureCatalog(figs, { max: 3, currentPage: 1 });
  expect(out).toContain("7 more figures elsewhere");
});
