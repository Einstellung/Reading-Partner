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
//              older than the threshold. Taken over here, one more attempt.
//              The judgement is `lastProgressAt` and never the wall clock: a
//              worker that is slow is not a worker that is stuck.
//   forfeited  a `running` run held by a device whose claim has expired, when
//              this device is the one that has since won its kind. Taken over
//              here, one more attempt.
//
// Nothing goes back to `pending`: a run's state only ever climbs the chain
// (run/types.ts), so a take-over writes `running` again under a new claimant
// with one more revision, and the merge keeps the fresher of the two.
//
// A device's own restart is not in here. That one needs no clock and no other
// device's opinion, and the moment to act on it is startup, not a poll:
// reclaimAfterRestart below.
//
// Re-running is the safety net under all of it: a run that goes twice and has
// its two results merged comes out where one run would have left it.

import { electFor, isCandidate, type DeviceClaim } from "../claim";
import type { Run } from "../run/types";

/**
 * The part of a run this module reads. A type-only import, so reading the rules
 * costs nothing at runtime and this directory still does not import legion/run.
 */
export type ScheduledRun = Pick<
  Run,
  "id" | "kind" | "state" | "claimant" | "lastProgressAt" | "attempts"
>;

/** Why a run is being picked up. */
export type DueReason = "elected" | "stalled" | "forfeited" | "restarted";

export interface DueRun {
  run: ScheduledRun;
  /** `take` a run nobody is executing, or `retake` one from its claimant. */
  action: "take" | "retake";
  reason: DueReason;
}
// Both actions spend an attempt, so there is no field saying whether this one
// does. Under the older model a stuck run went back to `pending` and the count
// moved when somebody later took it; now the take-over is the taking, and a run
// that bounced between devices without the count moving would never reach the
// limit it is supposed to stop at.

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
      if (mine) out.push({ run, action: "take", reason: "elected" });
      continue;
    }
    if (run.state !== "running") continue;
    const holder = heldBy(run);
    if (holder === deviceId) {
      // The later of the last report and the moment this claimant picked the
      // run up: a run taken over a moment ago carries the previous claimant's
      // progress time, and reading that alone would call it stuck immediately.
      const since = Math.max(run.lastProgressAt ?? 0, run.claimant?.startedAt ?? 0);
      if (since > 0 && now - since > opts.stallMs) {
        out.push({ run, action: "retake", reason: "stalled" });
      }
      continue;
    }
    // Somebody else's. Only the device that has since won the kind takes it
    // over, and only once the holder has actually forfeited.
    if (mine && holder !== null && hasForfeited(holder, claims, now)) {
      out.push({ run, action: "retake", reason: "forfeited" });
    }
  }
  return out;
}

/**
 * What this device owes after a restart: everything it left `running` is taken
 * over here again with one more attempt spent, because nothing of its own can
 * be running in a process that has only just started.
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
    .map((run) => ({ run, action: "retake" as const, reason: "restarted" as const }));
}
