// Whether this device has heard from the others since it last came up or came
// back to the front: the first sync pass after that edge has finished.
//
// Work that has to know what the other devices already did waits for it. The
// dream asks whether another device ran tonight (presence/daily.ts), the runner
// asks whether another device already took a run (legion/runner), and the
// nightly jobs would otherwise race the reader's first question for the
// network (legion/schedule).
//
// A pass that ended in an error still counts: what is waited for is the look,
// and a device that is offline would otherwise wait for good. Pure but for the
// clock; platform/sync/index.ts feeds it every status and marks the edges.

import { RESUME_MIN_INTERVAL_MS } from "./engine";

/** The part of SyncStatus this reads. */
export interface PassStatus {
  /** Null until initSync has read the state file; nothing is known before. */
  graceSince: number | null;
  engineStarted: boolean;
  running: boolean;
  lastSyncAt: number | null;
}

export interface FirstPassWatch {
  /** Every status sync announces. */
  status(s: PassStatus): void;
  /** The app came back to the front: the pass to wait for starts over. Idempotent. */
  edge(): void;
  /** The first pass since the last edge has finished, or there is no sync to wait for. */
  settled(): boolean;
}

/** Created at the process's own start, which is the first edge. */
export function createFirstPassWatch(now: () => number): FirstPassWatch {
  let last: PassStatus | null = null;
  let edgeAt = now();
  let waiting = true;
  let sawRun = false;
  let lastStartAt: number | null = null;

  function status(s: PassStatus): void {
    if (s.running && !last?.running) lastStartAt = now();
    last = s;
    if (!waiting || s.graceSince === null) return;
    if (!s.engineStarted) {
      waiting = false;
      return;
    }
    if (s.running) {
      sawRun = true;
      return;
    }
    if (sawRun || (s.lastSyncAt !== null && s.lastSyncAt >= edgeAt)) waiting = false;
  }

  function edge(): void {
    edgeAt = now();
    // The engine runs no pass on a return this soon after the last one started
    // (engine.ts onForeground), so that pass is the one this edge waits for.
    if (last?.engineStarted && lastStartAt !== null && edgeAt - lastStartAt < RESUME_MIN_INTERVAL_MS) {
      if (last.running) {
        waiting = true;
        sawRun = true;
      }
      return;
    }
    waiting = true;
    sawRun = last?.running ?? false;
    if (last) status(last);
  }

  return { status, edge, settled: () => !waiting };
}
