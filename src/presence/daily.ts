// The daily round: what every device — desktop, iPad and phone — asks itself
// every five minutes, on the way up and whenever it comes back to the front.
//
// Two things ride it, both memory's. The nightly dream runs once a night, on
// whichever device finds it owed first (docs/48): each device writes down when
// it ran into the synced folder, so the round waits for this start's or this
// return's first sync pass before it asks, and then for the reader to have
// stopped — no turn running and none started for DREAM_IDLE_MS — so the night
// never competes with a question. The prose conflict sweep (docs/59 §6) runs on
// every check: it only creates pending runs, keyed by content, and whichever
// device's runner sees one first settles it.
//
// Until Intel was removed (2026-11) this was the morning briefing's tick in
// info/program/live.ts, and only a collecting desktop ran it.
//
// The timer, the lifecycle edges, the sync and turn signals and the two passes
// are injected; live.ts binds them.

// How often the round re-asks. Only a hint: the answer comes from the clock and
// the recorded state (memory/dream/schedule.ts), never from the timer having
// fired, so a tick that a suspended process never ran costs lateness and
// nothing else.
export const DAILY_TICK_MS = 5 * 60_000;

// While a night is owed and held back, how soon the round asks again. Sooner
// than the tick, because on a phone the window between the reader stopping and
// the app going away is minutes.
export const DAILY_RETRY_MS = 60_000;

// How long the reader has to have stopped before a night runs: no turn started
// in this long.
export const DREAM_IDLE_MS = 3 * 60_000;

/** What the turn registry says (legion/durable/stall.ts activity). */
export interface TurnActivity {
  live: number;
  lastStartAt: number | null;
}

/** No turn running, and none started in the last `idleMs`. */
export function readerIdle(activity: TurnActivity, now: number, idleMs = DREAM_IDLE_MS): boolean {
  if (activity.live > 0) return false;
  return activity.lastStartAt === null || now - activity.lastStartAt >= idleMs;
}

export interface DailyRoundDeps {
  /** The app came back to the front: the sync pass to wait for starts over. */
  edge(): void;
  /** The first sync pass since the last start or return has finished, or there is no sync. */
  synced(): boolean;
  /** No turn running and none started lately (readerIdle). */
  idle(): boolean;
  /** Whether a night is owed by every device's records as this one has them. Never throws. */
  dreamOwed(): Promise<boolean>;
  /** One night, if one is still owed. Owns its own gate (memory/dream/gate.ts). */
  dream(): Promise<unknown>;
  /** One look for parked prose copies. Never throws, never calls a model. */
  sweep(): Promise<unknown>;
  setTimer(ms: number, cb: () => void): () => void;
  onForeground(cb: () => void): void;
  onExit(cb: () => void): void;
}

export interface DailyRound {
  /** Check now, then on the timer and on every return to the foreground. Idempotent. */
  start(): void;
  /** One check. Never rejects. True when a night is owed and was held back. */
  check(): Promise<boolean>;
}

export function createDailyRound(deps: DailyRoundDeps): DailyRound {
  let started = false;
  let stopped = false;
  let cancelTimer: (() => void) | null = null;

  // Never rejects. A check that throws is a night that is late, and it must not
  // take the schedule down with it.
  async function check(): Promise<boolean> {
    let held = false;
    try {
      if (await deps.dreamOwed()) {
        // The owed answer above may be from before the pull; the dream asks
        // again once it is let through.
        if (deps.synced() && deps.idle()) await deps.dream();
        else held = true;
      }
    } catch (e) {
      console.warn("the nightly memory pass check failed", e);
    }
    await deps.sweep();
    return held;
  }

  // The wake is a hint and nothing more, so a tick a suspended process never ran
  // costs lateness, and coming back to the foreground asks again regardless.
  function schedule(held: boolean): void {
    if (stopped) return;
    cancelTimer?.();
    cancelTimer = deps.setTimer(held ? DAILY_RETRY_MS : DAILY_TICK_MS, () => {
      cancelTimer = null;
      void check().then(schedule);
    });
  }

  function start(): void {
    if (started) return;
    started = true;
    // The edge that catches a device whose timers stopped while it was away — a
    // laptop shut overnight, a phone in a pocket.
    deps.onForeground(() => {
      deps.edge();
      void check().then(schedule);
    });
    // Nothing is in flight to unwind here; what the cancel is for is the tick
    // that would otherwise land in the middle of a quit.
    deps.onExit(() => {
      stopped = true;
      cancelTimer?.();
      cancelTimer = null;
    });
    // The first check runs now rather than at the first wake. The process's own
    // start is the first edge, so nothing is marked here.
    void check().then(schedule);
  }

  return { start, check };
}
