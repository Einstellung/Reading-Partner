// The host's local date, "YYYY-MM-DD": the meals week and its days are the
// reader's own, so day boundaries are local.

import { localDate } from "../platform/std/day";

export function todayLocal(now: Date = new Date()): string {
  return localDate(now.getTime());
}
