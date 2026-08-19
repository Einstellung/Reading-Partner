// What a run-through looks like from outside: one row per run, and the pages it
// went past without a word. Pure, so a list can be drawn from a log without
// re-reading anything.

import type { RunthroughPage, RunthroughRun } from "./types";

export interface RunSummary {
  ordinal: number;
  startedAt: number;
  // Wall-clock length, rounded to whole minutes. The exact timestamps are on
  // the run itself for anything that needs them; this is the number a list
  // shows and the number two runs are compared on.
  minutes: number;
  pagesTotal: number;
  pagesSpoken: number;
  wordsSpoken: number;
}

// A run cut short — the app was closed, the process died — has no endedAt. The
// last thing that happened is still on the pages, so the length is measured to
// there rather than reported as zero.
function lastMoment(run: RunthroughRun): number {
  if (run.endedAt !== null) return run.endedAt;
  let last = run.startedAt;
  for (const p of run.pages) {
    last = Math.max(last, p.enteredAt, p.leftAt ?? p.enteredAt);
  }
  return last;
}

export function runSummary(run: RunthroughRun): RunSummary {
  let pagesSpoken = 0;
  let wordsSpoken = 0;
  for (const page of run.pages) {
    if (!spoken(page)) continue;
    pagesSpoken++;
    wordsSpoken += countWords(page.transcript);
  }
  return {
    ordinal: run.ordinal,
    startedAt: run.startedAt,
    minutes: Math.max(0, Math.round((lastMoment(run) - run.startedAt) / 60_000)),
    pagesTotal: run.pages.length,
    pagesSpoken,
    wordsSpoken,
  };
}

function spoken(page: RunthroughPage): boolean {
  return page.transcript.trim().length > 0;
}

/**
 * The pages of a deck of `totalSlides` that this run went past in silence.
 * A page that was never reached counts as missed too — the reader did not
 * speak to it either way, and a run that stopped halfway is exactly the case
 * this is asked about.
 */
export function pagesMissed(run: RunthroughRun, totalSlides: number): number[] {
  const said = new Set<number>();
  for (const page of run.pages) if (spoken(page)) said.add(page.index);
  const out: number[] = [];
  for (let i = 0; i < totalSlides; i++) if (!said.has(i)) out.push(i);
  // A page the run visited past the end of the deck it was given (the deck was
  // rebuilt shorter since) is still a page that was there and got nothing said
  // to it.
  for (const page of run.pages) {
    if (page.index >= totalSlides && !said.has(page.index)) out.push(page.index);
  }
  return out.sort((a, b) => a - b);
}

// Ideographs, kana and hangul syllables. Their punctuation is deliberately out:
// a full stop is not a word in either script.
const CJK_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7a3]/gu;

/**
 * Words in a mixed Chinese/English transcript: every CJK character counts as
 * one, and what is left over is split on whitespace. A run of Latin that ends
 * up glued to a full-width comma still counts as one word, which is a rounding
 * error nobody reads a word count closely enough to see.
 */
export function countWords(text: string): number {
  const cjk = text.match(CJK_CHAR)?.length ?? 0;
  const latin = text
    .replace(CJK_CHAR, " ")
    .split(/\s+/)
    // A token of pure punctuation is not a word.
    .filter((token) => /[\p{L}\p{N}]/u.test(token)).length;
  return cjk + latin;
}
