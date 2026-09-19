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

import type { Delegator } from "../run/types";

export type BellType = "run-done" | "run-failed" | "wake";

export type BellState = "queued" | "delivered" | "acked";

// A bell only ever moves up this list.
export const BELL_STATES: readonly BellState[] = ["queued", "delivered", "acked"];

/** How far along `state` is. Higher is later. */
export function bellRank(state: BellState): number {
  return BELL_STATES.indexOf(state);
}

/**
 * The most brief a bell will carry, and the same cap the soul applies to a
 * brief it read off a file (src/soul/bell.ts). A brief says what was asked, not
 * what came of it, so it is capped where a turn can afford it rather than where
 * whoever wrote it stopped writing.
 */
export const BRIEF_MAX = 2000;

/** A run reached a terminal state with something to show for it. */
export interface RunDonePayload {
  runId: string;
  kind: string;
  /**
   * Whatever the delegator handed the runner, at most BRIEF_MAX characters: the
   * soul writes its briefs to a file and delegates the path (soul/delegate.ts),
   * a delegator with the words in hand rings with the text. The soul opens the
   * one and reads the other as it stands (soul/bell.ts).
   */
  brief: string;
  /** Set when the brief as it was rung was cut to fit. */
  truncated?: boolean;
  /**
   * The path what the run produced was written to, if it produced anything
   * (legion/execute/outputs.ts). A reference, like everything else on a run
   * record; whoever answers the bell reads it.
   */
  output?: string;
  /**
   * The run's own `deliverTo`, copied onto the bell. Carried rather than looked
   * up because a `local` run never reaches a file: it lives in the runner's own
   * store and there is nothing on disk for the soul to read it back off.
   */
  deliverTo?: string;
  /**
   * Who asked for the run, copied on for the same reason `deliverTo` is. The
   * soul answers a program's bell without a turn (src/soul/bell.ts), so it has
   * to know that much before it decides to open one.
   */
  delegator?: Delegator;
}

/** A run gave up: a premise did not hold, or its attempts ran out. */
export interface RunFailedPayload {
  runId: string;
  kind: string;
  reason: string;
  /** The run's own `deliverTo`, for the same reason RunDonePayload carries it. */
  deliverTo?: string;
  /** The run's own `delegator`, for the same reason RunDonePayload carries it. */
  delegator?: Delegator;
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
