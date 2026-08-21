// The visual-aid block. The thing worth pinning is that the judgement is stated
// once and completely: the figure list and the rule for using it arrive
// together, in order, and the block never offers a picture the model cannot make.

import { expect, test } from "bun:test";
import { buildVisualAidGuidance } from "../../../src/reading/figures/prompt";
import type { Figure } from "../../../src/reading/figures/types";

const figures: Figure[] = [
  { id: "1", page: 3, caption: "Figure 1: The transformer architecture.", bbox: null },
  { id: "2", page: 7, caption: "Figure 2: Attention weights over a sentence.", bbox: null },
];

test("the figure list and the rule for using it arrive as one block, list first", () => {
  const block = buildVisualAidGuidance({ figures });
  expect(block).toContain("[fig:1] p.3");
  expect(block.indexOf("[fig:1]")).toBeLessThan(block.indexOf("in this order"));
});

test("the book's own figure comes first and words are the only other answer", () => {
  const block = buildVisualAidGuidance({ figures });
  const cite = block.indexOf("cite it as [fig:N]");
  const words = block.indexOf("describe it in words");
  expect(cite).toBeGreaterThan(-1);
  expect(cite).toBeLessThan(words);
});

test("it never offers to draw", () => {
  const block = buildVisualAidGuidance({ figures });
  expect(block).not.toContain("draw_diagram");
  expect(block).not.toContain("update_diagram");
  expect(block).toContain("cannot draw");
});

test("a document with no figures still gets the rule", () => {
  const block = buildVisualAidGuidance({ figures: [] });
  expect(block).toContain("no figure index");
  expect(block).toContain("describe it in words");
});

test("when the list is given up for space the judgement stays and says so", () => {
  const block = buildVisualAidGuidance({ figures, omitCatalog: true });
  expect(block).not.toContain("[fig:1] p.3");
  expect(block).toContain("did not fit this turn");
  expect(block).toContain("describe it in words");
});

test("the catalog cap keeps the figures nearest the reader", () => {
  const many: Figure[] = Array.from({ length: 10 }, (_, i) => ({
    id: String(i + 1),
    page: i + 1,
    caption: `Figure ${i + 1}: something.`,
    bbox: null,
  }));
  const block = buildVisualAidGuidance({ figures: many, max: 2, currentPage: 9 });
  expect(block).toContain("[fig:9]");
  expect(block).not.toContain("[fig:1] ");
});

test("nothing but this block tells the model when to reach for a figure", () => {
  // The rule used to be split between the figure catalog's own heading and the
  // drawing tool's description, and the halves drifted. The catalog's default
  // heading still exists for the prompts that only list figures, but the block
  // overrides it so the judgement is not stated twice in one prompt.
  const block = buildVisualAidGuidance({ figures });
  expect(block).not.toContain("cite one as [fig:N] when it shows what you explain");
  expect(block.match(/in this order/g)).toHaveLength(1);
});
