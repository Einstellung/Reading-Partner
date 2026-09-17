// Terms, for matching a query against a message.
//
// The tokenizer is fulltext/bm25.ts's; the index is not, because this is term
// presence rather than a ranking over a corpus, and the whole store of
// conversations is small enough to scan. A word run is a token; Chinese and
// Japanese are cut into adjacent-character bigrams, so "注意力" is 注意 + 意力
// and a query for 注意 finds it. The document side also emits one unigram per
// CJK character, so a query that is a single character — 熵, 道 — still lands
// inside a longer run. The query side stays bigram-only, which is what keeps a
// two-character query from matching every text holding either half.

import { tokenize, tokenizeForIndex } from "../fulltext/bm25";

/** What a query asks for: word runs and CJK bigrams, deduplicated. */
export function queryTerms(text: string): string[] {
  return [...new Set(tokenize(text))];
}

/** What a message answers with: the above plus one unigram per CJK character. */
export function messageTerms(text: string): Set<string> {
  return new Set(tokenizeForIndex(text).tokens);
}
