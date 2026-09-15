// What this device should do about the runs on disk, right now (docs/55).
//
// A pure function of the run files, the claims and the clock: no worker is
// started here, nothing is written, and nothing is read. The caller acts on
// what comes back — which is what makes the three handover rules testable at
// all, since none of them can be reproduced by hand.
//
// The rules (docs/55, "指派、接手与取消"):
//
//   take       a `pending` run of a kind this device won the election for.
//   stalled    a `running` run of this device's own whose last progress is
//              older than the threshold. Back to `pending`, one more attempt.
//              The judgement is `lastProgressAt` and never the wall clock: a
//              worker that is slow is not a worker that is stuck.
//   forfeited  a `running` run held by a device whose claim has expired, when
//              this device is the one that has since won its kind. Back to
//              `pending` so this device can take it. Not a failed attempt by
//              anyone, so the count does not move.
//
// A device's own restart is not in here. That one needs no clock and no other
// device's opinion, and the moment to act on it is startup, not a poll:
// reclaimAfterRestart below.
//
// Re-running is the safety net under all of it: a run that goes twice and has
// its two results merged comes out where one run would have left it.

import { electFor, isCandidate, type DeviceClaim } from "../claim";

/**
 * The part of a run this module reads. src/legion/run owns the whole of it;
 * what is written here is only what the assignment rules touch.
 */
export interface ScheduledRun {
  id: string;
  kind: string;
  state: "pending" | "running" | "cancelled" | "failed" | "done";
  /** The device executing it, and when it started. Absent on a `pending` run. */
  claimant?: { deviceId: string; at?: number } | null;
  /** When the worker last reported real progress. */
  lastProgressAt?: number | null;
  attempts?: number;
}

/** Why a run is being handed back or picked up. */
export type DueReason = "elected" | "stalled" | "forfeited" | "restarted";

export interface DueRun {
  run: ScheduledRun;
  /** `take` it and start working, or hand it `back` to `pending` first. */
  action: "take" | "back";
  reason: DueReason;
  /**
   * Whether this counts as an attempt that was spent. A stall and a restart do;
   * a device that forfeited did not fail at anything this device can see.
   */
  bumpAttempts: boolean;
}

/** How long a `running` run may go without progress before it is stuck. */
export interface DueOptions {
  stallMs: number;
}

function heldBy(run: ScheduledRun): string | null {
  return run.claimant?.deviceId ?? null;
}

// Whether the device holding this run has given its claim up: either its claim
// file has gone, or its heartbeat stopped long enough ago to count as forfeit.
function hasForfeited(deviceId: string, claims: readonly DeviceClaim[], now: number): boolean {
  const claim = claims.find((c) => c.deviceId === deviceId);
  return !claim || !isCandidate(claim, now);
}

/**
 * The runs this device should act on. Runs in a terminal state, runs of a kind
 * another device won, and runs still making progress are all left alone.
 */
export function dueRuns(
  runs: readonly ScheduledRun[],
  claims: readonly DeviceClaim[],
  now: number,
  deviceId: string,
  opts: DueOptions,
): DueRun[] {
  const out: DueRun[] = [];
  // One election per kind, not per run: the answer is the same for every run of
  // a kind and reading it again per run would only cost time.
  const winners = new Map<string, string | null>();
  const winner = (kind: string): string | null => {
    if (!winners.has(kind)) winners.set(kind, electFor(kind, claims, now));
    return winners.get(kind) ?? null;
  };

  for (const run of runs) {
    const mine = winner(run.kind) === deviceId;
    if (run.state === "pending") {
      if (mine) out.push({ run, action: "take", reason: "elected", bumpAttempts: false });
      continue;
    }
    if (run.state !== "running") continue;
    const holder = heldBy(run);
    if (holder === deviceId) {
      // A run with no progress recorded at all is judged from when it started,
      // which is what the claimant wrote down.
      const since = run.lastProgressAt ?? run.claimant?.at ?? null;
      if (since !== null && now - since > opts.stallMs) {
        out.push({ run, action: "back", reason: "stalled", bumpAttempts: true });
      }
      continue;
    }
    // Somebody else's. Only the device that has since won the kind takes it
    // over, and only once the holder has actually forfeited.
    if (mine && holder !== null && hasForfeited(holder, claims, now)) {
      out.push({ run, action: "back", reason: "forfeited", bumpAttempts: false });
    }
  }
  return out;
}

/**
 * What this device owes after a restart: everything it left `running` is back
 * to `pending` with one more attempt spent, because nothing of its own can be
 * running in a process that has only just started.
 *
 * This device's own judgement, made without a clock and without reading anybody
 * else's claim — a machine whose clock is wrong still knows it restarted.
 */
export function reclaimAfterRestart(
  runs: readonly ScheduledRun[],
  deviceId: string,
): DueRun[] {
  return runs
    .filter((run) => run.state === "running" && heldBy(run) === deviceId)
    .map((run) => ({ run, action: "back" as const, reason: "restarted" as const, bumpAttempts: true }));
}
