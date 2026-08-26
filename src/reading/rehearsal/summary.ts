// What a rehearsal looks like from outside: one row per run, how long it took
// and how much was said. Pure, so a list can be drawn from a log without
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
  // Wall-clock length, rounded to whole minutes. What the pass is talked about
  // in — "about twelve minutes" — and what the coach is told (handoff.ts).
  minutes: number;
  // The same length to the second, which is what a list of passes shows: the
  // question there is whether this one ran longer than the last, and two passes
  // of "3 min" can be a minute apart.
  elapsedMs: number;
  wordsSpoken: number;
}

// The segment a stretch of a run belongs to. The id rides in on the event's
// `slideKind` and buildRun copies it to the page's `kind` (types.ts); reading it
// through a name is what keeps that one indirection in one place.
export function segmentIdOf(page: RehearsalPage): string {
  return page.kind;
}

// Which segments a pass covered, and which of them were spoken to, in the order
// buildRun left them. A page with no id belongs to no segment and is left out of
// both — which is every pass given from the note, since the note does not say
// which block is up and its one page carries no id (docs/44). It is still
// computed rather than assumed empty: the migration that lifts an old log's
// transcripts out of it (store.ts) rebuilds those entries through here, and two
// devices on two builds have to rebuild them the same way or the merged log
// disagrees with itself.
export function coverageOf(pages: readonly RehearsalPage[]): {
  segmentIds: string[];
  spokenSegmentIds: string[];
} {
  const segmentIds: string[] = [];
  const spokenSegmentIds: string[] = [];
  for (const page of pages) {
    const id = segmentIdOf(page);
    if (!id || segmentIds.includes(id)) continue;
    segmentIds.push(id);
    if (page.transcript.trim()) spokenSegmentIds.push(id);
  }
  return { segmentIds, spokenSegmentIds };
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
  return {
    id: run.id,
    ordinal: run.ordinal,
    rehearsalId: run.rehearsalId,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    lastMomentAt: lastMoment(run),
    // Empty for every pass this build records, and not empty for the entries an
    // older one left behind. The fields stay on the entry for those (types.ts:
    // RUN_LOG_VERSION is deliberately unchanged), and nothing reads them.
    ...coverageOf(run.pages),
    wordsSpoken: countPages(run.pages),
  };
}

function countPages(pages: readonly RehearsalPage[]): number {
  let wordsSpoken = 0;
  for (const page of pages) wordsSpoken += countWords(page.transcript);
  return wordsSpoken;
}

export function runSummary(entry: RehearsalRunEntry): RunSummary {
  // An entry that still carries its pages predates the split, and its counts
  // were never written down. Counting them here rather than repairing the file
  // keeps a list draw free of writes; the split (store.ts) is what settles it.
  const lastAt = entry.pages
    ? lastMoment({ ...entry, pages: entry.pages })
    : entry.lastMomentAt;
  return {
    ordinal: entry.ordinal,
    startedAt: entry.startedAt,
    minutes: Math.max(0, Math.round((lastAt - entry.startedAt) / 60_000)),
    elapsedMs: Math.max(0, lastAt - entry.startedAt),
    wordsSpoken: entry.pages ? countPages(entry.pages) : entry.wordsSpoken,
  };
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
