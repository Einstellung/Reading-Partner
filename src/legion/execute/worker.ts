// What a worker is, and the table legion looks a kind up in (docs/55).
//
// A worker is the code that executes one run. The domain that owns a kind hands
// one over at startup and legion never learns anything else about the work:
// `run(brief, ctx) → { cancel, done }`, the same signature whether there is a
// model inside it or not. An agent worker opens a lane on the harness; a
// program worker is ordinary code. The difference legion cares about is one
// field: a program worker may fan a run out into child runs, an agent worker may
// not — the model inside it has no delegate tool, and the run graph is two
// levels deep (docs/55).
//
// The table is a plain Map in this process. There is no file: a kind whose
// worker is not registered on this device is a kind this device cannot run, and
// that is the correct answer rather than a state to migrate.
//
// Registering a worker also declares what the kind needs of a machine, in the
// same call, because the two are never separately true: the device holding the
// worker is the device that would run it, and whether it may is the election's
// answer over the tags (claim/capabilities.ts). Both devices ship the same
// bundle and so register the same kinds; the tags are what tell them apart.

import { registerKindCapabilities } from "../claim";
import type { Delegator, Run, RunTier } from "../run/types";

/** What a worker says when it is finished. Everything in it is a reference. */
export interface WorkerOutcome {
  /** Where the run put what it produced. A run with nothing to show for it failed. */
  output?: string;
  /** A last line for a person to read. Otherwise the last `report` stands. */
  progress?: string;
}

/**
 * A worker that has been started. `cancel` asks it to stop — the runner calls it
 * when the run file says somebody asked — and `done` settles when it has. A
 * throw is a failed attempt; the runner decides whether that is a retry or the
 * end of the run.
 */
export interface WorkerHandle {
  cancel(): void;
  done: Promise<WorkerOutcome | void>;
}

/** A child run a program worker wants fanned out under its own. */
export interface ChildRun {
  kind: string;
  /** This parent's own stable name for the step. Unique under one parent. */
  step: string;
  /** A reference to the child's brief. */
  brief: string;
  deliverTo?: string;
}

/** What the runner hands a worker besides its brief. */
export interface WorkerContext {
  /** The run as it stood when the worker was started. */
  run: Run;
  /**
   * One line saying where it has got to. Every call advances the line and the
   * moment the stall test reads; the disk sees at most one write per thirty
   * seconds, and the terminal state flushes whatever is pending. Program
   * workers call this themselves.
   */
  report(text: string): Promise<void>;
  /**
   * The same, worded for an agent worker: the tool that just returned and the
   * round it was in. The worker wires this into the turn's tool callback — the
   * turn is the worker's to run, the wording is the runner's.
   */
  reportTool(tool: string, round: number): Promise<void>;
  /**
   * Fan a step out into a child run. Program workers only. The child carries
   * this run's id as its `batchId` and the step's name, so a re-run of the
   * parent finds a step it already finished instead of doing it again.
   */
  delegate(child: ChildRun): Promise<Delegated>;
}

export type Worker = (brief: string, ctx: WorkerContext) => WorkerHandle;

export interface WorkerRegistration {
  kind: string;
  run: Worker;
  /** `local` runs in this process and never reaches a file. Defaults to `synced`. */
  tier?: RunTier;
  /** The capability tags a machine needs to run this kind. Declared to claim/. */
  requires?: readonly string[];
  /** There is a model inside it. An agent worker may not delegate. */
  agent?: boolean;
  /**
   * Whether the soul may hand this kind a brief of its own writing. Defaults to
   * true. A kind whose brief is a structured task book a program writes says
   * false: the model would send prose, the worker could not read it, and the
   * run would fail for a reason nobody could act on (translate, docs/55).
   */
  delegable?: boolean;
}

/** What anybody asks the runner to start. */
export interface DelegateInput {
  kind: string;
  delegator: Delegator;
  /** A reference to the brief, frozen here. Changing it means another run. */
  brief: string;
  deliverTo?: string;
  /** Set by the runner on a child; a caller outside a worker leaves both alone. */
  batchId?: string;
  step?: string;
  /**
   * A name for the run this is a request for, when two devices or two processes
   * may ask for the same one: the file name is derived from it, so the second
   * ask reaches the first ask's run and gets it back with `existing: true`. The
   * day's collect round is keyed by its anchor date this way, which is the whole
   * of "today's round has been run" across devices (docs/55).
   */
  idempotencyKey?: string;
  /** Overrides the kind's own tier. Tests use it; nothing else should. */
  tier?: RunTier;
}

/**
 * What came of asking. `ok: false` is a request that was refused — a run too
 * deep, a step of this batch that already failed for good — and never a run
 * that merely has not finished yet.
 */
export type Delegated =
  | {
      ok: true;
      run: Run;
      /** The run was already there and this call did not touch it. */
      existing: boolean;
      /** Set when the step was already `done`: its output, without a new run. */
      output?: string;
      /** Settles when this device has finished it. Absent when another device will. */
      done?: Promise<Run>;
    }
  | { ok: false; reason: string; run?: Run };

/** A kind's worker, or null. The runner reads the table through this shape. */
export type WorkerTable = (kind: string) => WorkerRegistration | null;

const workers = new Map<string, WorkerRegistration>();

/**
 * Hand legion a kind. Registering the same kind twice replaces it, so a module
 * loaded again is not an error.
 */
export function registerWorker(registration: WorkerRegistration): void {
  workers.set(registration.kind, { ...registration });
  registerKindCapabilities(registration.kind, registration.requires ?? []);
}

export const workerFor: WorkerTable = (kind) => workers.get(kind) ?? null;

/** Every kind this device has a worker for. */
export function registeredWorkerKinds(): string[] {
  return [...workers.keys()];
}

/** The kinds of those a model may be offered as something to delegate. */
export function delegableWorkerKinds(): string[] {
  return [...workers.values()].filter((one) => one.delegable !== false).map((one) => one.kind);
}
