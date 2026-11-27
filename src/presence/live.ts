// Live wiring of the daily round (daily.ts): the real clock, sync's first pass,
// the turn registry, the window's lifecycle, and memory's two passes.

import { realTimers } from "../legion/durable/observable-run";
import { stallWatches } from "../legion/durable/stall";
import { dreamOwedNow, runDreamIfDue } from "../memory/dream/live";
import { sweepProseConflictsNow } from "../memory/adjudicate/live";
import { observeAppExit, observeAppLifecycle } from "../platform/app/lifecycle";
import { firstSyncPassSettled, markSyncEdge } from "../platform/sync";
import { createDailyRound, readerIdle, type DailyRound } from "./daily";

let round: DailyRound | null = null;

/**
 * Start this device's daily round. Both shells call it once on the way up
 * (useBackgroundServices); every device runs it.
 */
export function startDailyRound(): void {
  round ??= createDailyRound({
    edge: markSyncEdge,
    synced: firstSyncPassSettled,
    idle: () => readerIdle(stallWatches().activity(), Date.now()),
    dreamOwed: () => dreamOwedNow(),
    dream: () => runDreamIfDue(),
    sweep: () => sweepProseConflictsNow(),
    setTimer: realTimers.setTimer,
    onForeground: (cb) => {
      observeAppLifecycle(window, { onForeground: cb, onBackground: () => {} });
    },
    onExit: (cb) => observeAppExit(window, cb),
  });
  round.start();
}
