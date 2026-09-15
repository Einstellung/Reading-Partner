// The runner: the ring around a worker (docs/55).
//
// Take the run, write `running`, run it, write the terminal state, ring a bell.
// Everything else in this file is one of the three gates around that line — a
// create request that would make the run graph three deep is refused, a create
// carrying `batchId` + `step` finds the step it already did, and cancelling a
// parent cascades one level to its batch.
//
// It is the first thing in src/ to import legion/run, which is what arms the
// run file's merge with sync (run/index.ts). The registry is empty in a build
// that has registered no kinds, and then the poll does nothing at all.
//
// Two tiers. A `local` run is executed here and now and never reaches the
// synced folder — it has a store of its own over a Map, which is the whole of
// the difference, so nothing below branches on the tier again. A `synced` run
// is polled: on every sync tick this device asks legion/schedule what is due for
// it and starts that.
//
// One run of a kind at a time on this device. A second run of the same kind
// waits for the next poll: the kinds that cost anything are the heavy ones, and
// a device that runs two of them at once is a device whose other kinds stop
// getting a turn. Nothing stops two different kinds running side by side.
//
// Nothing is retried on a timer. Every decision here is made on a poll out of
// what the files say, because the other device's copy arrives the same way.

import { appBells, type BellStore } from "../bell";
import { appClaims, type DeviceClaim } from "../claim";
import {
  MAX_ATTEMPTS,
  appRuns,
  createRunStore,
  type Run,
  type RunClaimant,
  type RunIo,
  type RunStore,
} from "../run";
import { dueRuns, reclaimAfterRestart, type DueRun } from "../schedule";
import { currentDeviceId } from "../../platform/app/device";
import {
  registeredWorkerKinds,
  workerFor,
  type DelegateInput,
  type Delegated,
  type WorkerContext,
  type WorkerHandle,
  type WorkerRegistration,
  type WorkerTable,
} from "./worker";

/** One disk write per this long per run. A state change is never throttled. */
export const REPORT_THROTTLE_MS = 30_000;

/** How long one of this device's own runs may go without progress before it is stuck. */
export const DEFAULT_STALL_MS = 15 * 60_000;

/** How many runs of one kind this device executes at once. */
export const DEFAULT_PER_KIND = 1;

export interface RunnerDeps {
  /** Read per poll: the id is resolved after startup. */
  deviceId?: () => string;
  runs?: RunStore;
  bells?: BellStore;
  claims?: () => Promise<DeviceClaim[]>;
  now?: () => number;
  stallMs?: number;
  perKind?: number;
  /** The kind table. The module registry unless a test hands one in. */
  workers?: WorkerTable;
}

export interface Runner {
  /** One look at the runs on disk. Re-entrant calls are dropped, not queued. */
  tick(): Promise<void>;
  /** Ask for a run. The gates are here rather than in the store. */
  delegate(input: DelegateInput): Promise<Delegated>;
  /**
   * Ask a run to stop, and its batch with it. A run executing here has its
   * worker's cancel() called at once; one executing elsewhere is asked in the
   * file and the device holding it acts on its next poll.
   */
  cancel(id: string): Promise<Run | null>;
  /** The runs this device is executing right now. */
  active(): string[];
  /** Settles when everything this device is executing has finished. */
  idle(): Promise<void>;
  /** Stop polling. What is running is left to finish. */
  stop(): void;
}

/** A run store over a Map: what a `local` run has instead of a folder. */
function memoryIo(): RunIo {
  const files = new Map<string, string>();
  return {
    list: async () => [...files.keys()],
    read: async (name) => files.get(name) ?? null,
    write: async (name, contents) => {
      files.set(name, contents);
    },
    remove: async (name) => {
      files.delete(name);
    },
  };
}

interface Reporter {
  report(text: string): Promise<void>;
  /** The last line reported, written or not. The terminal state carries it. */
  last(): string | undefined;
  /** Settles when every write this reporter started has landed. */
  settled(): Promise<void>;
}

// One write per throttle window per run, and the writes are chained so two
// reports in the same tick cannot read-modify-write over each other. The first
// report always writes: a worker that says what it is doing and then goes quiet
// for an hour must not look like a worker that never started.
function createReporter(store: RunStore, id: string, now: () => number, throttleMs: number): Reporter {
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let line: string | undefined;
  let chain: Promise<void> = Promise.resolve();
  return {
    report(text) {
      line = text;
      const at = now();
      if (at - lastWriteAt < throttleMs) return chain;
      lastWriteAt = at;
      chain = chain.then(() => store.report(id, text, at)).then(() => {});
      return chain;
    },
    last: () => line,
    settled: () => chain,
  };
}

function why(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Active {
  id: string;
  kind: string;
  store: RunStore;
  handle: WorkerHandle;
  /** Somebody asked it to stop and the worker has been told. */
  cancelling: boolean;
}

export function createRunner(deps: RunnerDeps = {}): Runner {
  const runs = deps.runs ?? appRuns();
  const locals = createRunStore(memoryIo());
  const bells = deps.bells ?? appBells();
  const now = deps.now ?? (() => Date.now());
  const table = deps.workers ?? workerFor;
  const stallMs = deps.stallMs ?? DEFAULT_STALL_MS;
  const perKind = deps.perKind ?? DEFAULT_PER_KIND;
  const deviceId = deps.deviceId ?? currentDeviceId;
  const readClaims = deps.claims ?? (() => appClaims().readAll());
  // A registry nobody filled means there is nothing this device could run, and
  // the poll should not cost a directory listing to find that out again.
  const idle = deps.workers ? () => false : () => registeredWorkerKinds().length === 0;

  const active = new Map<string, Active>();
  const inFlight = new Set<Promise<void>>();
  let ticking = false;
  let reclaimed = false;
  let stopped = false;

  function track(work: Promise<void>): Promise<void> {
    const tracked = work.finally(() => inFlight.delete(tracked));
    inFlight.add(tracked);
    return tracked;
  }

  async function storeOf(id: string): Promise<RunStore> {
    return (await locals.get(id)) ? locals : runs;
  }

  // The worker ran and either produced something, gave up, or was stopped. The
  // run is `running` and claimed by this device when this is entered, and it
  // leaves it in a terminal state.
  async function execute(store: RunStore, id: string, reg: WorkerRegistration): Promise<void> {
    for (;;) {
      const run = await store.get(id);
      if (!run || run.state !== "running") return;
      const reporter = createReporter(store, id, now, REPORT_THROTTLE_MS);
      const ctx: WorkerContext = {
        run,
        report: (text) => reporter.report(text),
        reportTool: (tool, round) => reporter.report(`${tool} (round ${round})`),
        delegate: async (child) =>
          reg.agent === true
            ? { ok: false, reason: "an agent worker has no delegate: the run graph is two deep" }
            : delegate({
                kind: child.kind,
                delegator: { kind: "run", id },
                brief: child.brief,
                batchId: id,
                step: child.step,
                ...(child.deliverTo === undefined ? {} : { deliverTo: child.deliverTo }),
              }),
      };

      let handle: WorkerHandle;
      try {
        handle = reg.run(run.brief, ctx);
      } catch (error) {
        // A worker that threw on the way in never ran; treat it as the attempt
        // it was, the same as one that threw a second later.
        handle = { cancel: () => {}, done: Promise.reject(error) };
      }
      const entry: Active = { id, kind: run.kind, store, handle, cancelling: false };
      active.set(id, entry);

      let outcome: Awaited<WorkerHandle["done"]> | undefined;
      let failure: unknown;
      let failed = false;
      try {
        outcome = await handle.done;
      } catch (error) {
        failed = true;
        failure = error;
      } finally {
        active.delete(id);
      }
      await reporter.settled();

      const at = now();
      const current = (await store.get(id)) ?? run;
      const progress = outcome?.progress ?? reporter.last();
      const carry = progress === undefined ? {} : { progress };

      if (entry.cancelling || current.cancelRequested) {
        await store.transition(id, "cancelled", { at, ...carry });
        return;
      }

      if (!failed) {
        const output = outcome?.output;
        const moved = await store.transition(id, "done", {
          at,
          ...carry,
          ...(output === undefined ? {} : { output }),
        });
        const final = moved.ok ? moved.run : current;
        await bells
          .ring("run-done", {
            runId: id,
            kind: final.kind,
            brief: final.brief,
            ...(final.output === undefined ? {} : { output: final.output }),
          })
          .catch((e) => console.warn(`run ${id} finished but its bell would not ring`, e));
        return;
      }

      // A try that failed. Below the limit the same device goes again in place:
      // a new claimant stamp, one more attempt, one more revision, and the run
      // never leaves `running`.
      if (current.attempts >= MAX_ATTEMPTS) {
        await store.transition(id, "failed", { at, ...carry });
        await bells
          .ring("run-failed", { runId: id, kind: current.kind, reason: why(failure) })
          .catch((e) => console.warn(`run ${id} failed and its bell would not ring`, e));
        return;
      }
      const again = await store.retake(id, { deviceId: deviceId(), startedAt: at });
      if (!again.ok) return;
    }
  }

  // Start a run this device has decided is its own to execute.
  async function start(due: DueRun, me: string): Promise<void> {
    const { run } = due;
    if (stopped || active.has(run.id)) return;
    const reg = table(run.kind);
    if (!reg) return;
    let ofKind = 0;
    for (const entry of active.values()) if (entry.kind === run.kind) ofKind += 1;
    if (ofKind >= perKind) return;

    const at = now();
    const claimant: RunClaimant = { deviceId: me, startedAt: at };
    const taken =
      due.action === "take"
        ? await runs.transition(run.id, "running", { claimant, at })
        : await runs.retake(run.id, claimant);
    if (!taken.ok) return;
    void track(
      execute(runs, run.id, reg).catch((e) => console.warn(`run ${run.id} came apart`, e)),
    );
  }

  // A run executing here whose file says somebody asked it to stop. The worker
  // is told once; what it does about it decides when the terminal state lands.
  function tellWorkerToStop(entry: Active): void {
    if (entry.cancelling) return;
    entry.cancelling = true;
    try {
      entry.handle.cancel();
    } catch (e) {
      console.warn(`the worker of run ${entry.id} threw on cancel`, e);
    }
  }

  async function noticeCancellations(): Promise<void> {
    for (const entry of [...active.values()]) {
      if (entry.cancelling) continue;
      const run = await entry.store.get(entry.id);
      if (run?.cancelRequested) tellWorkerToStop(entry);
    }
  }

  async function cancelOne(id: string): Promise<Run | null> {
    const store = await storeOf(id);
    const run = await store.cancel(id, now());
    const entry = active.get(id);
    if (entry) tellWorkerToStop(entry);
    return run;
  }

  async function delegate(input: DelegateInput): Promise<Delegated> {
    // The run graph is two levels deep. A child that wants a child of its own
    // is refused here rather than in the store: it is the delegator's shape
    // that is wrong, not the file's.
    if (input.delegator.kind === "run") {
      const parentId = input.delegator.id;
      const parent = (await runs.get(parentId)) ?? (await locals.get(parentId));
      if (!parent) return { ok: false, reason: `no run ${parentId} to delegate from` };
      if (parent.delegator.kind === "run") {
        return {
          ok: false,
          reason: `run ${parentId} is itself a child run: the run graph is two levels deep`,
        };
      }
    }

    const reg = table(input.kind);
    const tier = input.tier ?? reg?.tier ?? "synced";
    const store = tier === "local" ? locals : runs;
    const { run, existing } = await store.create({
      kind: input.kind,
      delegator: input.delegator,
      brief: input.brief,
      tier,
      at: now(),
      ...(input.deliverTo === undefined ? {} : { deliverTo: input.deliverTo }),
      ...(input.batchId === undefined ? {} : { batchId: input.batchId }),
      ...(input.step === undefined ? {} : { step: input.step }),
    });

    if (existing) {
      // The step was already taken. What that means is the state's to say
      // (docs/55): done hands back its output and nothing new is started,
      // pending or running is the same handle, and a spent failure is this
      // step's failure.
      if (run.state === "done") {
        return { ok: true, run, existing: true, ...(run.output === undefined ? {} : { output: run.output }) };
      }
      if (run.state === "failed" || run.state === "cancelled") {
        return { ok: false, reason: `run ${run.id} is already ${run.state}`, run };
      }
      return { ok: true, run, existing: true };
    }

    // A local run never waits for a poll: it is in this process, it is quick,
    // and there is no other device that could take it.
    if (tier === "local") {
      if (!reg) return { ok: false, reason: `no worker is registered for the kind ${input.kind}` };
      const at = now();
      const started = await locals.transition(run.id, "running", {
        claimant: { deviceId: deviceId(), startedAt: at },
        at,
      });
      if (!started.ok) return { ok: false, reason: started.reason, run };
      const done = track(execute(locals, run.id, reg)).then(
        async () => (await locals.get(run.id)) ?? started.run,
      );
      return { ok: true, run: started.run, existing: false, done };
    }
    return { ok: true, run, existing: false };
  }

  return {
    async tick() {
      if (stopped || ticking || idle()) return;
      const me = deviceId();
      if (!me) return;
      ticking = true;
      try {
        await noticeCancellations();
        const all = await runs.list();
        const claims = await readClaims().catch(() => [] as DeviceClaim[]);
        const at = now();
        const due: DueRun[] = [];
        const seen = new Set<string>(active.keys());
        const add = (item: DueRun): void => {
          if (seen.has(item.run.id)) return;
          seen.add(item.run.id);
          due.push(item);
        };
        // Once, on the way up: a process that has only just started holds none
        // of the runs its last life left `running`.
        if (!reclaimed) {
          reclaimed = true;
          for (const item of reclaimAfterRestart(all, me)) add(item);
        }
        for (const item of dueRuns(all, claims, at, me, { stallMs })) add(item);
        for (const item of due) await start(item, me);
      } finally {
        ticking = false;
      }
    },

    delegate,

    async cancel(id) {
      const run = await cancelOne(id);
      // One level down, and no further: the graph has no third level to reach.
      for (const store of [runs, locals]) {
        for (const child of await store.list({ batchId: id })) await cancelOne(child.id);
      }
      return run;
    },

    active: () => [...active.keys()],

    async idle() {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },

    stop() {
      stopped = true;
    },
  };
}

export interface StartRunnerDeps extends RunnerDeps {
  /** How often to look. The shells pass sync's tick, so there is one heartbeat. */
  intervalMs: number;
}

let live: Runner | undefined;

/**
 * Poll now and every interval after. Returns the undo.
 *
 * The runs on disk are read on the same beat as the pull, so a run another
 * device delegated is picked up at most one tick after it lands here.
 */
export function startRunner(deps: StartRunnerDeps): () => void {
  const runner = createRunner(deps);
  live = runner;
  const look = (): void => {
    void runner.tick().catch((e) => console.warn("runner poll failed", e));
  };
  look();
  const timer = setInterval(look, deps.intervalMs);
  return () => {
    clearInterval(timer);
    runner.stop();
    if (live === runner) live = undefined;
  };
}

/** The runner this device is polling on, for whoever wants to delegate to it. */
export function appRunner(): Runner {
  live ??= createRunner();
  return live;
}
