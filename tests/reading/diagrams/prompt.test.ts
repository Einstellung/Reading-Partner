// The visual-aid ladder. The thing worth pinning is that the judgement is stated
// once and completely: the figure list and the drawing rule arrive together, in
// order, and the block never offers a tool that is not mounted.

import { expect, test } from "bun:test";
import { buildVisualAidGuidance } from "../../../src/reading/diagrams/prompt";
import type { Figure } from "../../../src/reading/figures/types";

const figures: Figure[] = [
  { id: "1", page: 3, caption: "Figure 1: The transformer architecture.", bbox: null },
  { id: "2", page: 7, caption: "Figure 2: Attention weights over a sentence.", bbox: null },
];

test("the figure list and the rule for using it arrive as one block, list first", () => {
  const block = buildVisualAidGuidance({ figures, canDraw: true });
  expect(block).toContain("[fig:1] p.3");
  expect(block.indexOf("[fig:1]")).toBeLessThan(block.indexOf("in this order"));
});

test("the ladder puts the book's own figure first and drawing second", () => {
  const block = buildVisualAidGuidance({ figures, canDraw: true });
  const cite = block.indexOf("cite it as [fig:N]");
  const drawIt = block.indexOf("draw_diagram");
  const dont = block.indexOf("don't draw");
  expect(cite).toBeGreaterThan(-1);
  expect(cite).toBeLessThan(drawIt);
  expect(drawIt).toBeLessThan(dont);
});

test("it says what not to draw, so a list does not become a picture", () => {
  const block = buildVisualAidGuidance({ figures, canDraw: true });
  expect(block).toContain("A definition, a comparison");
  expect(block).toContain("Markdown table");
});

test("it says to edit the picture on screen rather than send a second one", () => {
  const block = buildVisualAidGuidance({ figures, canDraw: true });
  expect(block).toContain("update_diagram");
  expect(block).toContain("Never send a second picture");
  expect(block).toContain("focus.path");
});

test("with no drawing tools mounted it never mentions them", () => {
  const block = buildVisualAidGuidance({ figures, canDraw: false });
  expect(block).not.toContain("draw_diagram");
  expect(block).not.toContain("update_diagram");
  expect(block).toContain("describe it in words");
  // The figure half of the ladder still stands on its own.
  expect(block).toContain("[fig:1]");
});

test("a document with no figures still gets the drawing rule", () => {
  const block = buildVisualAidGuidance({ figures: [], canDraw: true });
  expect(block).toContain("no figure index");
  expect(block).toContain("draw_diagram");
});

test("when the list is given up for space the judgement stays and says so", () => {
  const block = buildVisualAidGuidance({ figures, canDraw: true, omitCatalog: true });
  expect(block).not.toContain("[fig:1] p.3");
  expect(block).toContain("did not fit this turn");
  expect(block).toContain("draw_diagram");
});

test("the catalog cap keeps the figures nearest the reader", () => {
  const many: Figure[] = Array.from({ length: 10 }, (_, i) => ({
    id: String(i + 1),
    page: i + 1,
    caption: `Figure ${i + 1}: something.`,
    bbox: null,
  }));
  const block = buildVisualAidGuidance({ figures: many, canDraw: true, max: 2, currentPage: 9 });
  expect(block).toContain("[fig:9]");
  expect(block).not.toContain("[fig:1] ");
});

test("nothing but this block tells the model when to draw", async () => {
  // The rule used to be split between the figure catalog's own heading and the
  // drawing tool's description, and the halves drifted. The catalog's default
  // heading still exists for the prompts that only list figures, but the block
  // overrides it so the judgement is not stated twice in one prompt.
  const block = buildVisualAidGuidance({ figures, canDraw: true });
  expect(block).not.toContain("cite one as [fig:N] when it shows what you explain");
  expect(block.match(/in this order/g)).toHaveLength(1);
});
