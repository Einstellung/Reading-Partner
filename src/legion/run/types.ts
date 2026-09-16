// What a run is (docs/55). One piece of work that was handed off, happens out of
// the reader's sight, and has to come back with something to show for it.
//
// The whole of a cross-device run's state is in this record, because the two
// devices that may both write it share nothing else: no lock, no server, no
// clock they agree on. So the record is built to be merged rather than to be
// owned — see merge.ts, which is the other half of this file.
//
// Everything a run points at is a reference. The brief and the output are paths
// or ids into the domain's own directory; the run file never holds the content.

/** Where a run has got to. A run only ever moves up this chain. */
export type RunState = "pending" | "running" | "cancelled" | "failed" | "done";

// The chain, lowest first. Two devices that both wrote a run keep the one
// further along it, which converges for any number of devices without anybody
// having to decide who wrote last.
export const RUN_STATES: readonly RunState[] = [
  "pending",
  "running",
  "cancelled",
  "failed",
  "done",
];

/** How far along the chain `state` is. Higher is later. */
export function runRank(state: RunState): number {
  return RUN_STATES.indexOf(state);
}

/** Whether a run has stopped for good. */
export function isTerminal(state: RunState): boolean {
  return state === "cancelled" || state === "failed" || state === "done";
}

// Which of the two tiers a run belongs to, decided by its `kind`. A `local` run
// lives and dies inside one process and never reaches a file; a `synced` run is
// the one this directory is about.
export type RunTier = "local" | "synced";

// Who asked for the work. The soul is the only orchestrator of the model's own
// turns; a program worker fanning a step out names its own run; and a piece of
// domain plumbing nobody spoke to — a schedule that came due, an ask a reader
// left in a file — names itself. The run graph is two levels deep at most and
// the runner enforces that (docs/55).
export type Delegator =
  | { kind: "soul" }
  | { kind: "run"; id: string }
  | { kind: "program"; name: string };

/** The device executing the run, and when it picked the run up. */
export interface RunClaimant {
  deviceId: string;
  startedAt: number;
}

export interface Run {
  /** Globally unique, and the file's name. */
  id: string;
  // What two devices derive the same file name from, so the run they both mean
  // converges into one file rather than two. `batchId` + ":" + `step` on a
  // sub-run a program worker fanned out; otherwise whatever the delegator
  // named, which is how the day's collect round is one run per anchor however
  // many devices and processes ask for it (docs/55).
  idempotencyKey?: string;
  /** The type the domain registered. legion knows nothing else about the work. */
  kind: string;
  tier: RunTier;
  delegator: Delegator;
  /** A reference to the brief, frozen at creation. Changing it means a new run. */
  brief: string;
  state: RunState;
  claimant?: RunClaimant;
  attempts: number;
  /** One line, for a person to read. Only the last one is kept. */
  progress?: string;
  /** Advanced whenever the worker made real headway. The stall test reads this. */
  lastProgressAt?: number;
  /** A reference to what the run produced. A run with none of this failed. */
  output?: string;
  /** Where the result is to be delivered. */
  deliverTo?: string;
  createdAt: number;
  startedAt?: number;
  /** When it reached a terminal state. */
  endedAt?: number;
  /** When the bell about it was acknowledged. A run may be folded after this. */
  deliveredAt?: number;
  // Bumped on every write. It is the casting vote when two devices land on the
  // same state independently — one gave the run up and another finished it,
  // and then the first came back with its own answer.
  revision: number;
  /**
   * Somebody asked for this run to stop. Written rather than shouted: the
   * executing device may be another machine, and it reads this on its next
   * pull and calls the worker's cancel() then (docs/55). It is never unset, so
   * a merge can keep it from whichever side of a collision it arrived on.
   */
  cancelRequested?: true;
  /** The parent run, on a sub-run a program worker fanned out. */
  batchId?: string;
  /** The parent's own stable name for this step. Unique under one `batchId`. */
  step?: string;
}

/**
 * How many times a run is tried before it stops at `failed` for good. A run
 * that has spent them is not retried automatically; replaying it is a new run
 * against the same brief (docs/55).
 */
export const MAX_ATTEMPTS = 3;

/** The key two devices derive independently for the same step of a batch. */
export function idempotencyKey(batchId: string, step: string): string {
  return `${batchId}:${step}`;
}
