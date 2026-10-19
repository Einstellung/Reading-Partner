// The Hugging Face half of a run's paper reading (docs/info/88 「取材 / Hugging
// Face」): each query's Hub paper search (hf-ladder.ts), one query after
// another, beside arXiv and X in the run's `read` phase. A source of its own:
// it runs whether arXiv answers, is rate limited or is cooling down, and its
// failure stops neither of the others.
//
// The queries are the ones with arXiv words, searched with those words. What it
// found is kept in the run directory (`hf-read.json`, the arXiv read's shape),
// written after every query, so a resumed run searches only what is not on file
// and the build reads the file. A failed or rate-limited query is on file with
// that outcome and is not searched again in the same run; a retry reads it again
// (retry.ts).

import { readPaperQueries, paperProgressLine, type ArxivRead, type ArxivReadPlan, type PaperReadFiles } from "./arxiv-read";
import { runHfLadder, type HfSearch } from "./hf-ladder";
import type { TopicSearch } from "./types";

export const HF_NAME = "Hugging Face";

export interface HfReadDeps extends PaperReadFiles {
  search: HfSearch;
}

/** Search what is left of the run's Hugging Face queries and return everything on file. */
export function readHf(topic: TopicSearch, plan: ArxivReadPlan, deps: HfReadDeps, signal: AbortSignal): Promise<ArxivRead> {
  return readPaperQueries(topic, plan, (query, window, kind, s) => runHfLadder(query, window, kind, deps.search, s), deps, signal);
}

/** One line on how far the Hugging Face half has got: counts and outcomes only. */
export function hfProgressLine(read: ArxivRead | null): string {
  return paperProgressLine(HF_NAME, read);
}
