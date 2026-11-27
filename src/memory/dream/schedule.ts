// When a night is owed, and what one device remembers between nights.
//
// The night belongs to 3 a.m. on the reader's own clock (docs/48: the CPU is
// idle and the end of a day is a natural boundary — no claim about sleep is
// being made). The app is not always up at 3, so the rule is "no device has
// run since the most recent 3 a.m. that has gone by" rather than a timer that
// has to fire on time: a device opened at nine runs that morning, and one only
// ever opened at one in the morning runs then, for the night before. Missed
// days are not made up. Nothing is owed per day; what is owed is a look at the
// current store, and one look answers for however many days were skipped.

import { localDate } from "../observations/files";
import type { DreamOutcome } from "./run";

// The file lives at the root of AppData and is deliberately NOT in sync range.
// It is this device's own waterline: the input hash is what this device last
// finished on, and a copy from another device would say an input had been seen
// that this one may not have pulled yet. Who ran tonight, across devices, is
// dream-runs/ (runs.ts). Losing this file costs one extra run.
export const DREAM_STATE_FILE = "dream-state.json";

export interface DreamState {
  // The night the last run on this device was for, "YYYY-MM-DD": the local day
  // of the 3 a.m. it answered. For a person reading the file; the gate reads
  // lastRunAt.
  lastRunDay: string | null;
  // The materialized input the last run finished on (run.ts). Only an outcome
  // that advances the waterline writes it.
  lastInputHash: string | null;
  lastOutcome: DreamOutcome | null;
  lastRunAt: number | null;
}

export const EMPTY_DREAM_STATE: DreamState = {
  lastRunDay: null,
  lastInputHash: null,
  lastOutcome: null,
  lastRunAt: null,
};

// The hour a night belongs to, local.
export const DREAM_HOUR = 3;

/** The most recent 3 a.m. at or before `now`, local. */
export function lastDreamAnchor(now: number): number {
  const at = new Date(now);
  const anchor = new Date(at.getFullYear(), at.getMonth(), at.getDate(), DREAM_HOUR);
  if (anchor.getTime() > now) anchor.setDate(anchor.getDate() - 1);
  return anchor.getTime();
}

/** The night a run at `now` answers, "YYYY-MM-DD". */
export function dreamNight(now: number): string {
  return localDate(lastDreamAnchor(now));
}

/**
 * Whether a night is owed: no device has started one since the most recent
 * 3 a.m. `lastRunAt` is the latest across devices (runs.ts latestDreamRun).
 */
export function isDreamDue(lastRunAt: number | null, now: number): boolean {
  return lastRunAt === null || lastRunAt < lastDreamAnchor(now);
}
