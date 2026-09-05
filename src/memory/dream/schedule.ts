// When a night runs, and what is remembered between nights.
//
// 3 a.m. on the reader's own clock (docs/48: the CPU is idle and the end of a
// day is a natural boundary — no claim about sleep is being made). The app is
// not always up at 3, so the rule is "today's 3 has passed and today has not
// run yet" rather than a timer that has to fire on time: a machine that was
// asleep runs at the first opportunity after. Missed days are not made up.
// Nothing is owed per day; what is owed is a look at the current store, and one
// look answers for however many days were skipped.

import { localDate } from "../observations/files";
import type { DreamOutcome } from "./run";

// The file lives at the root of AppData and is deliberately NOT in sync range
// (platform/sync/syncFs.ts matches nothing by this name). Dream runs on the
// collector alone (docs/36's election), so this is one machine's own
// bookkeeping; a copy arriving from another device would say a night had run
// that this machine has no statements from. Losing it costs one extra run.
export const DREAM_STATE_FILE = "dream-state.json";

export interface DreamState {
  // The local day the last run happened on, "YYYY-MM-DD". The day rather than
  // the timestamp because the gate is a day boundary, and a timestamp would
  // have to be converted back to one at every comparison.
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

export function isDreamDue(state: DreamState, now: number): boolean {
  const at = new Date(now);
  // Before 3 a.m. the night that is due is still the one that has not arrived;
  // yesterday's already ran or was missed, and running it now would put two
  // runs into one calendar day for the reader.
  if (at.getHours() < DREAM_HOUR) return false;
  return state.lastRunDay !== localDate(now);
}
