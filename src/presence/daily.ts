// The daily round: what a device that takes background work asks itself every
// five minutes, on the way up and whenever it comes back to the foreground.
//
// Two things ride it, both memory's. The nightly dream runs on the one machine
// the election picks (docs/48: two machines would each pay for the night and
// write two readings of the same observations); the prose conflict sweep runs on
// every device that runs this round (docs/59 §6) and only creates pending runs,
// which the election hands to one executor.
//
// Until Intel was removed (2026-11) this was the morning briefing's tick in
// info/program/live.ts, and these two rode it because it was the one place that
// asked who the collector is on a schedule. What is here is that tick without
// the briefing: the same interval, the same three entry points, and the same
// rule that a check never takes the schedule down with it.
//
// The timer, the lifecycle edges and the two passes are injected; live.ts binds
// them.

/**
 * The kind the dream's election is asked for. Device level, like every kind
 * (legion/claim): with no capability required, the winner is the machine that
 * has been claiming longest, which is the machine the `collect` election picked
 * before.
 */
export const DREAM_KIND = "dream";

// How often the round re-asks. Only a hint: the answer comes from the clock and
// the recorded state (memory/dream/schedule.ts), never from the timer having
// fired, so a tick that a suspended process never ran costs lateness and
// nothing else. Five minutes because being a few minutes late is invisible and
// a tick that finds nothing due is a date comparison and a directory listing.
export const DAILY_TICK_MS = 5 * 60_000;

export interface DailyRoundDeps {
  /** Whether this device is the one the dream's election picked. */
  elected(): Promise<boolean>;
  /** One night, if one is due. Owns its own day gate (memory/dream/gate.ts). */
  dream(): Promise<unknown>;
  /** One look for parked prose copies. Never throws, never calls a model. */
  sweep(): Promise<unknown>;
  setTimer(ms: number, cb: () => void): () => void;
  onForeground(cb: () => void): void;
  onExit(cb: () => void): void;
}

export interface DailyRound {
  /** Check now, then every DAILY_TICK_MS and on every return to the foreground. Idempotent. */
  start(): void;
  /** One check. Never rejects. */
  check(): Promise<void>;
}

export function createDailyRound(deps: DailyRoundDeps): DailyRound {
  let started = false;
  let stopped = false;
  let cancelTimer: (() => void) | null = null;

  // Never rejects. A check that throws — a claim file the disk refused — is a
  // night that is late, and it must not take the schedule down with it.
  // runDreamIfDue owns its own 3 a.m. day gate and never throws; the guard here
  // is for the election read.
  async function check(): Promise<void> {
    try {
      if (await deps.elected()) await deps.dream();
    } catch (e) {
      console.warn("the nightly memory pass check failed", e);
    }
    // Every device looks for parked prose copies and asks for a run per copy
    // (docs/59 §6); the run is keyed by content, so the devices' asks meet in one
    // file and the election picks who settles it. Never throws, never calls a model.
    await deps.sweep();
  }

  // The wake is a hint and nothing more, so a tick a suspended process never ran
  // costs lateness, and coming back to the foreground asks again regardless.
  function schedule(): void {
    if (stopped) return;
    cancelTimer = deps.setTimer(DAILY_TICK_MS, () => {
      cancelTimer = null;
      void check().finally(schedule);
    });
  }

  function start(): void {
    if (started) return;
    started = true;
    // The edge that catches a machine whose timers stopped while it was
    // suspended — a laptop shut overnight.
    deps.onForeground(() => void check());
    // Nothing is in flight to unwind here; what the cancel is for is the tick
    // that would otherwise land in the middle of a quit.
    deps.onExit(() => {
      stopped = true;
      cancelTimer?.();
      cancelTimer = null;
    });
    // The first check runs now rather than at the first wake: a machine started
    // at nine in the morning has a night behind it already.
    void check().finally(schedule);
  }

  return { start, check };
}
