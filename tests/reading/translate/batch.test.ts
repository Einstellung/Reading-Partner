// Cutting the blocks into requests.
// Run: bash scripts/t.sh tests/reading/translate/batch.test.ts

import { expect, test } from "bun:test";
import { estimateTokens, planBatches } from "../../../src/reading/translate/batch";
import type { TranslatableBlock } from "../../../src/reading/translate/segment";

function block(id: string, text: string): TranslatableBlock {
  return { id, element: null as unknown as Element, mode: "sibling", text, masks: [] };
}

test("the estimate counts CJK by the character and Latin by the four", () => {
  expect(estimateTokens("abcd")).toBe(1);
  expect(estimateTokens("中文")).toBe(2);
  expect(estimateTokens("")).toBe(0);
});

test("blocks are grouped consecutively and cut at the target", () => {
  // 100 tokens each: 400 characters of Latin.
  const blocks = Array.from({ length: 60 }, (_, i) => block(`b${i + 1}`, "x".repeat(400)));
  const batches = planBatches(blocks, { target: 500, max: 600 });
  expect(batches.flat().map((b) => b.id)).toEqual(blocks.map((b) => b.id));
  for (const batch of batches.slice(0, -1)) {
    const size = batch.reduce((n, b) => n + estimateTokens(b.text), 0);
    expect(size).toBeGreaterThanOrEqual(500);
    expect(size).toBeLessThanOrEqual(600);
  }
});

test("a block longer than the maximum is a batch on its own", () => {
  const batches = planBatches(
    [block("b1", "x".repeat(40)), block("b2", "x".repeat(8000)), block("b3", "x".repeat(40))],
    { target: 500, max: 600 },
  );
  expect(batches.map((b) => b.map((x) => x.id))).toEqual([["b1"], ["b2"], ["b3"]]);
});

test("nothing in, nothing out", () => {
  expect(planBatches([])).toEqual([]);
});
