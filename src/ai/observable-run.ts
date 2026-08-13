// The observable shell the long-running pipelines (lesson prep, book notes,
// slides) share: subscribe/snapshot for useSyncExternalStore, a throttled
// liveness counter for the in-flight AI call, and one call under the stall
// watchdog. Only the shell is common — each pipeline's state machine (lazy
// queue with cooldowns, ordered chapters, hard/best-effort stages) stays its
// own.

import {
  resolveWatchdogConfig,
  runWithWatchdog,
  type AiCallOptions,
  type WatchdogConfig,
} from "./watchdog";

// Cap on how often streaming progress re-renders React (~4/s).
const ACTIVITY_NOTIFY_MS = 250;

// The liveness fields every pipeline's activity carries; each adds its own
// `kind` and target (a paper slug, a chapter index, a slide number).
export interface RunActivity {
  startedAt: number;
  chars: number;
  // 1-based attempt and the total allowed; attempt > 1 means a retry is in
  // flight after a stall or stream error.
  attempt: number;
  attempts: number;
}

export interface RunSnapshot<TState, TActivity> {
  state: TState;
  running: boolean;
  activity: TActivity | null;
}

// Injected clock/timers so tests never touch real time; every pipeline's deps
// satisfy this.
export interface RunTimers {
  now(): number;
  sleep(ms: number): Promise<void>;
  setTimer(ms: number, cb: () => void): () => void;
}

// The production wiring, spread into every pipeline's deps. Injection exists for
// the tests' virtual clock; outside them there is one answer, and it should not
// be retyped per pipeline.
export const realTimers: RunTimers = {
  now: () => Date.now(),
  sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
  setTimer: (ms, cb) => {
    const id = setTimeout(cb, ms);
    return () => clearTimeout(id);
  },
};

export abstract class ObservableRun<TState, TActivity extends RunActivity> {
  protected state: TState;
  protected running = false;
  protected activity: TActivity | null = null;
  protected readonly config: WatchdogConfig;
  // Aborts the in-flight AI call when the user presses Stop; recreated per run.
  // A pipeline with no Stop leaves it null and the watchdog gets no stop signal.
  protected stopController: AbortController | null = null;

  private listeners = new Set<() => void>();
  private snap: RunSnapshot<TState, TActivity>;
  private lastActivityNotify = 0;

  constructor(
    initialState: TState,
    private readonly timers: RunTimers,
    config: Partial<WatchdogConfig> = {},
  ) {
    this.state = initialState;
    this.config = resolveWatchdogConfig(config);
    this.snap = { state: initialState, running: false, activity: null };
  }

  // A copy deep enough that React sees fresh identities without the pipeline's
  // in-place mutations leaking into rendered state.
  protected abstract copyState(state: TState): TState;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Stable between notifications so useSyncExternalStore doesn't loop.
  snapshot(): RunSnapshot<TState, TActivity> {
    return this.snap;
  }

  protected notify(): void {
    this.snap = {
      state: this.copyState(this.state),
      running: this.running,
      activity: this.activity,
    };
    for (const fn of this.listeners) fn();
  }

  // Start (or clear) the live counter for a long call. Always notifies. Public
  // to subclasses for the stages that run outside the watchdog (image
  // generation, assembly) and still want a counter.
  protected setActivity(activity: TActivity | null): void {
    this.activity = activity;
    this.lastActivityNotify = activity ? this.timers.now() : 0;
    this.notify();
  }

  // A streamed delta arrived: update the char count and notify, throttled so a
  // token stream doesn't re-render React on every chunk.
  private bumpActivity(chars: number): void {
    if (!this.activity) return;
    this.activity = { ...this.activity, chars };
    const now = this.timers.now();
    if (now - this.lastActivityNotify >= ACTIVITY_NOTIFY_MS) {
      this.lastActivityNotify = now;
      this.notify();
    }
  }

  // Run one long AI call under the shared stall watchdog (src/ai/watchdog),
  // publishing its liveness as this run's activity and clearing it on the way
  // out. `info` is the activity minus the liveness fields the watchdog fills in.
  protected async callWithWatchdog<T>(
    info: Omit<TActivity, keyof RunActivity>,
    invoke: (opts: AiCallOptions) => Promise<T>,
  ): Promise<T> {
    try {
      return await runWithWatchdog(
        invoke,
        this.config,
        this.timers,
        {
          onAttempt: ({ attempt, attempts, startedAt }) =>
            this.setActivity({ ...info, startedAt, chars: 0, attempt, attempts } as TActivity),
          onProgress: (chars) => this.bumpActivity(chars),
        },
        this.stopController?.signal,
      );
    } finally {
      this.setActivity(null);
    }
  }
}
