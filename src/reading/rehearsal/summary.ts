// What a rehearsal looks like from outside: one row per run, and the pages it
// went past without a word. Pure, so a list can be drawn from a log without
// re-reading anything — which is now literal, since the transcripts are files of
// their own (store.ts) and a row must be drawable without opening one.
//
// So the counting happens twice over: runEntryOf does it once, when the run is
// written, and runSummary reads what it left. The second path is for an entry
// that still carries its pages — one written before the split, or synced from a
// device still on that build.

import type { BuiltRun, RehearsalPage, RehearsalRunEntry } from "./types";

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
function lastMoment(run: { startedAt: number; endedAt: number | null; pages: RehearsalPage[] }) {
  if (run.endedAt !== null) return run.endedAt;
  let last = run.startedAt;
  for (const p of run.pages) {
    last = Math.max(last, p.enteredAt, p.leftAt ?? p.enteredAt);
  }
  return last;
}

// The log entry for a run that has just been built: the times and the counts,
// with the pages left out because they are about to become a file of their own.
export function runEntryOf(run: BuiltRun): RehearsalRunEntry {
  const counts = countPages(run.pages);
  return {
    id: run.id,
    ordinal: run.ordinal,
    rehearsalId: run.rehearsalId,
    deckFile: run.deckFile,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    lastMomentAt: lastMoment(run),
    pagesTotal: run.pages.length,
    pagesSpoken: counts.pagesSpoken,
    wordsSpoken: counts.wordsSpoken,
  };
}

function countPages(pages: readonly RehearsalPage[]): { pagesSpoken: number; wordsSpoken: number } {
  let pagesSpoken = 0;
  let wordsSpoken = 0;
  for (const page of pages) {
    if (!spoken(page)) continue;
    pagesSpoken++;
    wordsSpoken += countWords(page.transcript);
  }
  return { pagesSpoken, wordsSpoken };
}

export function runSummary(entry: RehearsalRunEntry): RunSummary {
  // An entry that still carries its pages predates the split, and its counts
  // were never written down. Counting them here rather than repairing the file
  // keeps a list draw free of writes; the split (store.ts) is what settles it.
  if (entry.pages) {
    const counts = countPages(entry.pages);
    return {
      ordinal: entry.ordinal,
      startedAt: entry.startedAt,
      minutes: minutes(entry.startedAt, lastMoment({ ...entry, pages: entry.pages })),
      pagesTotal: entry.pages.length,
      pagesSpoken: counts.pagesSpoken,
      wordsSpoken: counts.wordsSpoken,
    };
  }
  return {
    ordinal: entry.ordinal,
    startedAt: entry.startedAt,
    minutes: minutes(entry.startedAt, entry.lastMomentAt),
    pagesTotal: entry.pagesTotal,
    pagesSpoken: entry.pagesSpoken,
    wordsSpoken: entry.wordsSpoken,
  };
}

function minutes(startedAt: number, lastAt: number): number {
  return Math.max(0, Math.round((lastAt - startedAt) / 60_000));
}

function spoken(page: RehearsalPage): boolean {
  return page.transcript.trim().length > 0;
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
