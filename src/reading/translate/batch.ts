// Grouping blocks into model calls. Pure.
//
// Two costs pull against each other. One call per block is the most accurate
// framing a block can get and the most expensive way to translate a page; one
// call for the whole article is the cheapest and the one whose output is
// hardest to line up again. Consecutive blocks in the middle give the model the
// paragraph before as context and keep each response short enough to check
// block by block.
//
// The size is counted in source tokens, estimated rather than measured: a
// tokenizer would have to be the model's own, and the number is only deciding
// where to cut. The estimate is src/budget's, the same one the send path prices
// a context with. Counting by script matters here because the source is whatever
// the article was written in, and an estimate four times too small would send a
// batch four times too large.

import { estimateTextTokens } from "../../budget";
import type { TranslatableBlock } from "./segment";

/** The size a batch aims for, and the size it may not exceed. */
export const BATCH_TARGET_TOKENS = 2000;
export const BATCH_MAX_TOKENS = 2500;

export interface BatchLimits {
  target?: number;
  max?: number;
}

/**
 * Consecutive blocks, cut where the running estimate reaches the target. A
 * block longer than the maximum on its own is a batch on its own rather than a
 * reason to fail: the model is given what there is.
 */
export function planBatches(
  blocks: readonly TranslatableBlock[],
  limits: BatchLimits = {},
): TranslatableBlock[][] {
  const target = limits.target ?? BATCH_TARGET_TOKENS;
  const max = limits.max ?? BATCH_MAX_TOKENS;
  const batches: TranslatableBlock[][] = [];
  let current: TranslatableBlock[] = [];
  let size = 0;

  for (const block of blocks) {
    const cost = estimateTextTokens(block.text);
    if (current.length > 0 && size + cost > max) {
      batches.push(current);
      current = [];
      size = 0;
    }
    current.push(block);
    size += cost;
    if (size >= target) {
      batches.push(current);
      current = [];
      size = 0;
    }
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
