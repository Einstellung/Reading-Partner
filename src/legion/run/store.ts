// The run store: one run per file under legion/runs/, and the things anybody
// does to one — create, read, list, move along the chain, cancel, report
// progress, stamp delivery, and take away what the ledger has folded.
//
// Two devices write this directory and neither of them can lock it, so the
// store is deliberately thin: it reads a file, decides, and writes the file
// back whole. What happens when the two of them wrote the same file is not here
// at all — that is merge.ts, and sync runs it. Everything this file writes is
// therefore written to be mergeable: `revision` goes up on every write, a state
// only ever moves up the chain, and a cancellation is a field that is set and
// never cleared.
//
// The file system is injected, the way the bell store beside it takes one. The
// default reads and writes AppData; the tests hand in a Map.

import { contentHash } from "../../platform/app/content-hash";
import {
  appRecordDirIo,
  createRecordReader,
  readRecords,
  recordFileName,
  type RemovableRecordDirIo,
} from "../../platform/app/record-dir";
import {
  idempotencyKey,
  isTerminal,
  runRank,
  type Delegator,
  type Run,
  type RunClaimant,
  type RunState,
  type RunTier,
} from "./types";
import { asRun } from "./merge";

export const RUNS_DIR = "legion/runs";

/**
 * What the store needs of a disk. Removable, unlike the box's or the bell's: a
 * folded run is taken off this device, and the ledger's housekeeping is the only
 * caller — it asks for the remote purge before it asks for this
 * (legion/ledger/housekeeping.ts).
 */
export type RunIo = RemovableRecordDirIo;

// A run id has to be a file name, and it is also what the palace row matches on
// (palace/kinds.ts). Both ways of making one — the hash of kind and key, and
// the random one — land inside this shape.
const ID = /^r-[0-9a-f]{32}$/;

/**
 * The id two devices derive independently for the same step of the same batch.
 * They then write the same path, and sync's merge converges the two copies —
 * which is the whole of the de-duplication protocol (docs/55).
 */
export async function deriveRunId(kind: string, key: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${kind}\u0000${key}`);
  return `r-${await contentHash(bytes)}`;
}

/** A run with no key of its own: nothing to derive from, so it is random. */
export function randomRunId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `r-${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export interface CreateRunInput {
  kind: string;
  delegator: Delegator;
  /** A reference to the brief. The run file never holds its content. */
  brief: string;
  tier?: RunTier;
  deliverTo?: string;
  /** The parent run, on a sub-run a program worker fanned out. */
  batchId?: string;
  /** The parent's own stable name for this step. */
  step?: string;
  /**
   * A key of the caller's own to derive the file name from, for a run that is
   * not a step of a batch: two devices — or the same device twice — asking for
   * the same thing under the same key reach the one file. `batchId` + `step`
   * win when both are given, since a step's identity is the batch's to decide.
   */
  idempotencyKey?: string;
  /** Defaults to now. */
  at?: number;
  /** An id the caller has already derived. Otherwise one is made here. */
  id?: string;
}

export interface CreateRunResult {
  run: Run;
  /**
   * There was already a run under this id and this call did not touch it. The
   * caller reads `run.state` to know what that means: `done` and it takes
   * `run.output` and skips the step, `running` or `pending` and it waits on the
   * run it already has, `failed` with `attempts` spent and it is that step's
   * failure (docs/55).
   */
  existing: boolean;
}

export interface RunFilter {
  state?: RunState | readonly RunState[];
  kind?: string;
  batchId?: string;
  /** The device executing it, as `claimant.deviceId`. */
  deviceId?: string;
}

/** What a transition may carry with it. */
export interface TransitionPatch {
  /** Required on the way into `running`: somebody has to be doing the work. */
  claimant?: RunClaimant;
  output?: string;
  progress?: string;
  deliverTo?: string;
  attempts?: number;
  /** The moment to stamp. Defaults to now. */
  at?: number;
}

export type TransitionResult = { ok: true; run: Run } | { ok: false; reason: string };


export interface RunStore {
  /**
   * Write a pending run. With `batchId` and `step` — or an `idempotencyKey` of
   * the caller's own — the id is derived from it, so two devices meaning the
   * same run write one file; a run reached under an id that is already taken is
   * handed back untouched.
   */
  create(input: CreateRunInput): Promise<CreateRunResult>;
  get(id: string): Promise<Run | null>;
  list(filter?: RunFilter): Promise<Run[]>;
  /** Move a run along the chain. A move that is not forward is refused. */
  transition(id: string, next: RunState, patch?: TransitionPatch): Promise<TransitionResult>;
  /**
   * Take a `running` run over: the same state, a new claimant, one more
   * revision. Nothing ever goes back to `pending` (docs/55) — a device that
   * restarted, a device that forfeited its claim and a worker that stalled all
   * leave a run that is running somewhere, and this is how it becomes running
   * here. Both copies are then `running`, the chain ties, and `revision`
   * decides, so the fresher claimant wins the merge.
   *
   * Separate from `transition` because transition's refusal to move sideways is
   * the whole of its contract, and one operation that may is easier to reason
   * about than a flag that sometimes lets it.
   */
  retake(id: string, claimant: RunClaimant): Promise<TransitionResult>;
  /**
   * Ask for a run to stop. A pending run has nobody doing anything, so it goes
   * straight to `cancelled`; a running one gets `cancelRequested` written on it
   * and the device executing it calls the worker's cancel() when it next reads
   * the file. A run that has already stopped is returned as it is.
   */
  cancel(id: string, at?: number): Promise<Run | null>;
  /**
   * One line saying how it is getting on. Every call writes: the thirty-second
   * throttle is the runner's (docs/55), because it is the runner that knows a
   * state change must go to disk regardless.
   */
  report(id: string, progress: string, at?: number): Promise<Run | null>;
  /**
   * The bell about this run was acked, so the result has been read and the run
   * may be folded once its grace is up (legion/ledger). Stamped once: the field
   * only ever moves earlier in a merge, and a second ack says nothing new.
   */
  markDelivered(id: string, at?: number): Promise<Run | null>;
  /**
   * Take the hot file away, having written the ledger line that replaces it.
   * Only the ledger's housekeeping calls this, and only for a run the ledger
   * accounts for (docs/55): a run file deleted without a line is one the other
   * device pushes straight back.
   */
  remove(id: string): Promise<void>;
}

function matches(run: Run, filter: RunFilter): boolean {
  if (filter.kind !== undefined && run.kind !== filter.kind) return false;
  if (filter.batchId !== undefined && run.batchId !== filter.batchId) return false;
  if (filter.deviceId !== undefined && run.claimant?.deviceId !== filter.deviceId) return false;
  if (filter.state !== undefined) {
    const want = typeof filter.state === "string" ? [filter.state] : filter.state;
    if (!want.includes(run.state)) return false;
  }
  return true;
}

export function createRunStore(io: RunIo): RunStore {
  const get = createRecordReader(io, ID, asRun);

  async function put(run: Run): Promise<Run> {
    await io.write(recordFileName(run.id), JSON.stringify(run, null, 2));
    return run;
  }

  return {
    async create(input) {
      const at = input.at ?? Date.now();
      const { batchId, step } = input;
      const key =
        batchId !== undefined && step !== undefined
          ? idempotencyKey(batchId, step)
          : input.idempotencyKey;
      const id =
        input.id ?? (key === undefined ? randomRunId() : await deriveRunId(input.kind, key));
      if (!ID.test(id)) throw new Error(`run: "${id}" is not a usable run id`);

      const already = await get(id);
      if (already) return { run: already, existing: true };

      const run: Run = {
        id,
        kind: input.kind,
        tier: input.tier ?? "synced",
        delegator: input.delegator,
        brief: input.brief,
        state: "pending",
        attempts: 0,
        createdAt: at,
        revision: 1,
      };
      if (key !== undefined) run.idempotencyKey = key;
      if (input.batchId !== undefined) run.batchId = input.batchId;
      if (input.step !== undefined) run.step = input.step;
      if (input.deliverTo !== undefined) run.deliverTo = input.deliverTo;
      return { run: await put(run), existing: false };
    },

    get,

    async list(filter = {}) {
      const runs = (await readRecords(io, ID, get)).filter((run) => matches(run, filter));
      runs.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
      return runs;
    },

    async transition(id, next, patch = {}) {
      const run = await get(id);
      if (!run) return { ok: false, reason: `no run ${id}` };
      if (runRank(next) <= runRank(run.state)) {
        return {
          ok: false,
          reason: `a run only moves up the chain, and ${run.state} is not below ${next}`,
        };
      }
      if (next === "running" && patch.claimant === undefined && run.claimant === undefined) {
        return { ok: false, reason: "a running run needs a claimant" };
      }

      const at = patch.at ?? Date.now();
      const moved: Run = { ...run, state: next, revision: run.revision + 1 };
      if (patch.claimant !== undefined) moved.claimant = patch.claimant;
      if (patch.output !== undefined) moved.output = patch.output;
      if (patch.deliverTo !== undefined) moved.deliverTo = patch.deliverTo;
      if (patch.progress !== undefined) {
        moved.progress = patch.progress;
        moved.lastProgressAt = at;
      }
      if (next === "running") {
        moved.startedAt = moved.claimant?.startedAt ?? at;
        // A try begins here, and attempts is what tells a spent run from one
        // that may be picked up again.
        moved.attempts = patch.attempts ?? run.attempts + 1;
      } else if (patch.attempts !== undefined) {
        moved.attempts = patch.attempts;
      }
      if (isTerminal(next)) moved.endedAt = at;
      return { ok: true, run: await put(moved) };
    },

    async retake(id, claimant) {
      const run = await get(id);
      if (!run) return { ok: false, reason: `no run ${id}` };
      if (run.state !== "running") {
        return { ok: false, reason: `only a running run is taken over, and ${id} is ${run.state}` };
      }
      // A take-over is the beginning of a try, the same as the move out of
      // `pending` is, so it spends one. A run that bounced between devices
      // without the count moving would never reach the limit it stops at.
      //
      // `lastProgressAt` is left where it is: nothing has been reported. The
      // stall test reads it against the claimant's own start (schedule/due.ts),
      // so a run taken over a moment ago is not stuck a moment later.
      const taken: Run = {
        ...run,
        claimant,
        attempts: run.attempts + 1,
        revision: run.revision + 1,
      };
      return { ok: true, run: await put(taken) };
    },

    async cancel(id, at) {
      const run = await get(id);
      if (!run) return null;
      if (isTerminal(run.state)) return run;
      const when = at ?? Date.now();
      if (run.state === "pending") {
        return put({
          ...run,
          state: "cancelled",
          endedAt: when,
          cancelRequested: true,
          revision: run.revision + 1,
        });
      }
      // Running somewhere, possibly on the other machine. The request is
      // written and the executing device acts on it when it reads the file.
      if (run.cancelRequested) return run;
      return put({ ...run, cancelRequested: true, revision: run.revision + 1 });
    },

    async markDelivered(id, at) {
      const run = await get(id);
      if (!run) return null;
      if (run.deliveredAt !== undefined) return run;
      return put({ ...run, deliveredAt: at ?? Date.now(), revision: run.revision + 1 });
    },

    async remove(id) {
      if (!ID.test(id)) return;
      await io.remove(recordFileName(id));
    },

    async report(id, progress, at) {
      const run = await get(id);
      if (!run) return null;
      return put({
        ...run,
        progress,
        lastProgressAt: at ?? Date.now(),
        revision: run.revision + 1,
      });
    },
  };
}

/** The runs directory on this device. */
export const appRunIo: RunIo = appRecordDirIo(RUNS_DIR);

let live: RunStore | undefined;

/** The store the app delegates into and the runner works out of. */
export function appRuns(): RunStore {
  live ??= createRunStore(appRunIo);
  return live;
}
