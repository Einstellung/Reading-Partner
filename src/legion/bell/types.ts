// What a bell is (docs/55). The soul has one inbox, and this is its vocabulary.
//
// Every turn the soul takes that the reader did not open comes in through here:
// a run finished, a run failed, a schedule came due. Cancellation and progress
// are not bells — they are written in the run file and read when somebody asks.
//
// Three states and one direction: queued < delivered < acked. `delivered` is the
// soul saying it has the message written down somewhere durable, `acked` is the
// soul saying it is done with it. The folding of a run into the ledger waits on
// `acked`, so the order may not be reversed.

export type BellType = "run-done" | "run-failed" | "wake";

export type BellState = "queued" | "delivered" | "acked";

// A bell only ever moves up this list.
export const BELL_STATES: readonly BellState[] = ["queued", "delivered", "acked"];

/** How far along `state` is. Higher is later. */
export function bellRank(state: BellState): number {
  return BELL_STATES.indexOf(state);
}

/**
 * The most brief a bell will carry. What the worker wrote in full is in the
 * output reference; this is the part that goes to the model, so it is capped
 * where a turn can afford it rather than where the worker stopped writing.
 */
export const BRIEF_MAX = 2000;

/** A run reached a terminal state with something to show for it. */
export interface RunDonePayload {
  runId: string;
  kind: string;
  /** At most BRIEF_MAX characters. */
  brief: string;
  /** Set when the brief was cut to fit. The rest is at `output`. */
  truncated?: boolean;
  /** Where the whole of what the run produced was put, if it put it anywhere. */
  output?: string;
  /**
   * The run's own `deliverTo`, copied onto the bell. Carried rather than looked
   * up because a `local` run never reaches a file: it lives in the runner's own
   * store and there is nothing on disk for the soul to read it back off.
   */
  deliverTo?: string;
}

/** A run gave up: a premise did not hold, or its attempts ran out. */
export interface RunFailedPayload {
  runId: string;
  kind: string;
  reason: string;
  /** The run's own `deliverTo`, for the same reason RunDonePayload carries it. */
  deliverTo?: string;
}

/** A schedule came due. What to do about it is the soul's to decide. */
export interface WakePayload {
  scheduleId: string;
  /** The brief the schedule was registered with. At most BRIEF_MAX characters. */
  brief: string;
  truncated?: boolean;
}

export interface BellPayloads {
  "run-done": RunDonePayload;
  "run-failed": RunFailedPayload;
  wake: WakePayload;
}

/** One bell, as it is written to its file. */
export type Bell = {
  [T in BellType]: {
    id: string;
    type: T;
    /** When it was rung, unix milliseconds. Bells are read in this order. */
    at: number;
    state: BellState;
    payload: BellPayloads[T];
  };
}[BellType];

// `truncated` is the store's answer, not the caller's: whoever rings hands over
// the brief it has and the store says whether it all fit.
export type RingPayload<T extends BellType> = Omit<BellPayloads[T], "truncated">;

export interface RingOptions {
  /**
   * The bell's identity. Ringing twice with one id leaves one bell — which is
   * what makes a runner that is re-entered after a crash safe to re-ring.
   * Defaults to the run or schedule the bell is about.
   */
  id?: string;
  /** When it was rung. Defaults to now. */
  at?: number;
}
