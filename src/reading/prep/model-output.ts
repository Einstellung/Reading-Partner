// The two things every prep-side model call does with text: hand the model a
// document page by page, and cut the JSON object back out of its answer. Both
// are format, not policy — the prompts and the parsing that use them stay in
// papers/, chapters/ and translate/.

import type { Fulltext } from "../../fulltext/types";
import { extractJson as extractJsonOrNull } from "../../platform/std/json";

// A document as page-marked blocks, so a model's answer can be grounded in page
// numbers (startPage, citedInChapters). `count` caps how many leading pages are
// shown; the default is the whole document.
export function pageBlocks(ft: Fulltext, count: number = ft.pages.length): string[] {
  const blocks: string[] = [];
  for (let i = 0; i < count; i++) blocks.push(`=== Page ${i + 1} ===\n${ft.pages[i]}`);
  return blocks;
}

// Models wrap JSON in fences or preamble despite instructions; cut from the
// first "{" to the last "}" before parsing (platform/std/json's extractJson,
// which also drops a markdown fence first). `fail` builds the error a caller
// wants to see when there is no object at all.
export function extractJson(
  text: string,
  fail: (message: string) => Error = (m) => new Error(m),
): string {
  const json = extractJsonOrNull(text);
  if (json === null) throw fail("no JSON object in the model output");
  return json;
}
