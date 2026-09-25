// What the glossary pass is shown. Pure.
//
// The batches of one article are translated at the same time and know nothing
// about each other, so nothing that happens in one can reach another. What they
// share has to be decided before any of them starts, and that is the glossary:
// one pass over the title, every heading and the opening sentence of the
// paragraphs, which is enough of the document for a model to fix how its
// recurring terms are rendered without reading all of it.
//
// Opening sentences rather than whole paragraphs because the terms are what is
// wanted, not the prose: a first sentence introduces what its paragraph is
// about, and the same budget buys five times as many paragraphs.

import { estimateTextTokens } from "../../budget";
import { firstSentence } from "../../platform/std/text";
import type { GlossaryRequest } from "./prompt";
import type { TranslatableBlock } from "./segment";

/** How many source tokens of sample the glossary pass is shown. */
export const GLOSSARY_SAMPLE_TOKENS = 2000;

const HEADING = /^h[1-6]$/;

/**
 * The glossary pass's request: the title, every heading, and opening sentences
 * in document order until the budget is spent. The headings come out of the
 * budget first, because they are the document's own vocabulary and the sample is
 * what gives way when there is a lot of it.
 */
export function glossaryRequestFor(
  title: string,
  blocks: readonly TranslatableBlock[],
  budget = GLOSSARY_SAMPLE_TOKENS,
): GlossaryRequest {
  const headings: string[] = [];
  const rest: TranslatableBlock[] = [];
  for (const block of blocks) {
    if (HEADING.test(block.element.localName.toLowerCase())) headings.push(block.text);
    else rest.push(block);
  }
  let left = budget - headings.reduce((n, h) => n + estimateTextTokens(h), 0);
  const sample: string[] = [];
  for (const block of rest) {
    if (left <= 0) break;
    const sentence = firstSentence(block.text);
    sample.push(sentence);
    left -= estimateTextTokens(sentence);
  }
  return { title, headings, sample };
}
