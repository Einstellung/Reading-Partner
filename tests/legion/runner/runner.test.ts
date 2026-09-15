// The runner (src/legion/execute/runner.ts, docs/55): take the run, write
// `running`, run it, write the terminal state, ring a bell — and the three
// gates around that line.
//
// Headless and in memory. Both stores are Maps, the clock is a variable, and no
// test waits on a timer: a worker is a deferred promise this file settles when
// it wants the run to finish. Run: bun test.

import { expect, test } from "bun:test";
import { createRunner } from "../../../src/legion/execute/runner";
import { registerWorker, type WorkerHandle } from "../../../src/legion/execute/worker";
import { createBellStore, type Bell, type BellIo } from "../../../src/legion/bell";
import { createRunStore, mergeRun, type Run, type RunIo } from "../../../src/legion/run";
import type { DeviceClaim } from "../../../src/legion/claim";

const NOW = 1_800_000_000_000;
const ME = "desk";

interface Disk extends RunIo, BellIo {
  files: Map<string, string>;
  writes: number;
}

function disk(): Disk {
  const files = new Map<string, string>();
  return {
    files,
    writes: 0,
    async list() {
      return [...files.keys()];
    },
    async read(name) {
      return files.get(name) ?? null;
    },
    async write(name, contents) {
      this.writes += 1;
      files.set(name, contents);
    },
    async remove(name) {
      files.delete(name);
    },
  };
}

function claim(deviceId: string, over: Partial<DeviceClaim> = {}): DeviceClaim {
  return {
    deviceId,
    deviceName: deviceId,
    platform: "linux",
    claimedAt: NOW - 86_400_000,
    heartbeatAt: NOW,
    capabilities: [],
    ...over,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// One test's world: two Maps, a clock that only moves when a test moves it, and
// a runner over both. The device holds every kind, so what is due is decided by
// the rules rather than by the election.
function world(over: { perKind?: number; stallMs?: number } = {}) {
  const runDisk = disk();
  const bellDisk = disk();
  const runs = createRunStore(runDisk);
  const bells = createBellStore(bellDisk);
  let clock = NOW;
  const claims: DeviceClaim[] = [claim(ME)];
  const runner = createRunner({
    deviceId: () => ME,
    runs,
    bells,
    claims: async () => claims,
    now: () => clock,
    ...over,
  });
  return {
    runs,
    bells,
    runner,
    claims,
    runDisk,
    at: () => clock,
    tick: (ms: number) => {
      clock += ms;
    },
    async finished(id: string): Promise<Run> {
      await runner.idle();
      const run = await runs.get(id);
      if (!run) throw new Error(`run ${id} is not on the disk`);
      return run;
    },
    async rung(): Promise<Bell[]> {
      return bells.read();
    },
  };
}

let nth = 0;
/** A kind nobody else in this file uses: the worker table is one map per process. */
function kind(name: string): string {
  nth += 1;
  return `test-${name}-${nth}`;
}

test("a run goes the whole way and leaves a run-done bell behind it", async () => {
  const w = world();
  const done = deferred<{ output: string }>();
  const k = kind("whole-way");
  registerWorker({ kind: k, run: () => ({ cancel: () => {}, done: done.promise }) });

  const asked = await w.runner.delegate({
    kind: k,
    delegator: { kind: "soul" },
    brief: "briefs/whole-way.json",
  });
  expect(asked.ok).toBe(true);
  const id = asked.ok ? asked.run.id : "";

  await w.runner.tick();
  expect((await w.runs.get(id))?.state).toBe("running");
  expect((await w.runs.get(id))?.claimant?.deviceId).toBe(ME);

  done.resolve({ output: "translations/whole-way.md" });
  const run = await w.finished(id);
  expect(run.state).toBe("done");
  expect(run.output).toBe("translations/whole-way.md");
  expect(run.attempts).toBe(1);

  const bells = await w.rung();
  expect(bells).toHaveLength(1);
  expect(bells[0]?.type).toBe("run-done");
  expect(bells[0]?.payload).toMatchObject({ runId: id, kind: k, output: "translations/whole-way.md" });
});

test("ten reports in a second are one write, and the terminal state carries the last line", async () => {
  const w = world();
  const done = deferred<void>();
  const reported = deferred<void>();
  const k = kind("throttle");
  registerWorker({
    kind: k,
    run: (_brief, ctx) => {
      void (async () => {
        for (let i = 1; i <= 10; i += 1) {
          await ctx.report(`page ${i}/10`);
          w.tick(100);
        }
        reported.resolve();
      })();
      return { cancel: () => {}, done: done.promise };
    },
  });

  const asked = await w.runner.delegate({
    kind: k,
    delegator: { kind: "soul" },
    brief: "briefs/throttle.json",
  });
  const id = asked.ok ? asked.run.id : "";
  await w.runner.tick();
  await reported.promise;

  const before = w.runDisk.writes;
  const written = await w.runs.get(id);
  expect(written?.progress).toBe("page 1/10");

  // Thirty seconds and a bit: the next report is a write again, so the throttle
  // is a window and not a one-off.
  w.tick(31_000);
  const now = w.at();
  await w.runs.report(id, "page 11/11", now);
  expect(w.runDisk.writes).toBe(before + 1);

  done.resolve();
  const run = await w.finished(id);
  expect(run.state).toBe("done");
  expect(run.progress).toBe("page 10/10");
  expect(run.lastProgressAt).toBe(w.at());
});

test("a create request whose delegator is already a child run is refused", async () => {
  const w = world();
  const parent = kind("parent");
  const child = kind("child");
  const grandchild = kind("grandchild");
  const parentDone = deferred<void>();
  const childDone = deferred<void>();
  const delegated = deferred<void>();
  let refused = "";

  registerWorker({
    kind: parent,
    run: (_brief, ctx) => {
      void ctx
        .delegate({ kind: child, step: "one", brief: "briefs/child.json" })
        .then(() => delegated.resolve());
      return { cancel: () => {}, done: parentDone.promise };
    },
  });
  registerWorker({
    kind: child,
    run: (_brief, ctx) => {
      void ctx
        .delegate({ kind: grandchild, step: "deeper", brief: "briefs/deeper.json" })
        .then((result) => {
          if (!result.ok) refused = result.reason;
          childDone.resolve();
        });
      return { cancel: () => {}, done: childDone.promise };
    },
  });
  registerWorker({ kind: grandchild, run: () => ({ cancel: () => {}, done: Promise.resolve() }) });

  const asked = await w.runner.delegate({
    kind: parent,
    delegator: { kind: "soul" },
    brief: "briefs/parent.json",
  });
  const parentId = asked.ok ? asked.run.id : "";
  await w.runner.tick(); // starts the parent, which delegates the child
  await delegated.promise;
  await w.runner.tick(); // starts the child, which asks for a grandchild
  await childDone.promise;
  parentDone.resolve();
  await w.runner.idle();

  expect(refused).toContain("two levels deep");
  const runs = await w.runs.list();
  expect(runs.map((r) => r.kind).sort()).toEqual([child, parent].sort());
  expect(runs.every((r) => r.delegator.kind === "soul" || r.delegator.id === parentId)).toBe(true);
});

test("a step of this batch that is already done comes back without a new run", async () => {
  const w = world();
  const k = kind("resumed-step");
  registerWorker({ kind: k, run: () => ({ cancel: () => {}, done: Promise.resolve() }) });
  const batchId = "r-00000000000000000000000000000001";

  const first = await w.runner.delegate({
    kind: k,
    delegator: { kind: "soul" },
    brief: "briefs/step.json",
    batchId,
    step: "collect",
  });
  const id = first.ok ? first.run.id : "";
  const moved = await w.runs.transition(id, "running", {
    claimant: { deviceId: ME, startedAt: NOW },
    at: NOW,
  });
  expect(moved.ok).toBe(true);
  await w.runs.transition(id, "done", { output: "cables/one.json", at: NOW });

  const before = (await w.runs.list()).length;
  const again = await w.runner.delegate({
    kind: k,
    delegator: { kind: "soul" },
    brief: "briefs/step.json",
    batchId,
    step: "collect",
  });
  expect(again.ok).toBe(true);
  expect(again.ok && again.existing).toBe(true);
  expect(again.ok && again.output).toBe("cables/one.json");
  expect((await w.runs.list()).length).toBe(before);
});

test("cancelling a parent cascades to its batch", async () => {
  const w = world();
  const parent = kind("cancel-parent");
  const child = kind("cancel-child");
  const parentDone = deferred<void>();
  const childDone = deferred<void>();
  let childCancels = 0;
  const delegated = deferred<void>();

  registerWorker({
    kind: parent,
    run: (_brief, ctx) => {
      void ctx
        .delegate({ kind: child, step: "one", brief: "briefs/child.json" })
        .then(() => delegated.resolve());
      return { cancel: () => parentDone.resolve(), done: parentDone.promise };
    },
  });
  const childStarted = deferred<void>();
  registerWorker({
    kind: child,
    run: (): WorkerHandle => {
      childStarted.resolve();
      return {
        cancel: () => {
          childCancels += 1;
          childDone.resolve();
        },
        done: childDone.promise,
      };
    },
  });

  const asked = await w.runner.delegate({
    kind: parent,
    delegator: { kind: "soul" },
    brief: "briefs/parent.json",
  });
  const parentId = asked.ok ? asked.run.id : "";
  await w.runner.tick();
  await delegated.promise;
  await w.runner.tick();
  await childStarted.promise;
  expect(w.runner.active()).toHaveLength(2);

  await w.runner.cancel(parentId);
  await w.runner.idle();

  expect(childCancels).toBe(1);
  const runs = await w.runs.list();
  expect(runs.map((r) => r.state)).toEqual(["cancelled", "cancelled"]);
  // A cancellation is not news the soul is woken for (docs/55).
  expect(await w.rung()).toHaveLength(0);
});

test("a run under a forfeited claimant is taken over, and the stale copy merges away", async () => {
  const w = world();
  const k = kind("forfeited");
  const done = deferred<{ output: string }>();
  registerWorker({ kind: k, run: () => ({ cancel: () => {}, done: done.promise }) });
  w.claims.push(claim("laptop", { heartbeatAt: NOW - 2 * 86_400_000 }));

  const asked = await w.runner.delegate({
    kind: k,
    delegator: { kind: "soul" },
    brief: "briefs/forfeited.json",
  });
  const id = asked.ok ? asked.run.id : "";
  const theirs = await w.runs.transition(id, "running", {
    claimant: { deviceId: "laptop", startedAt: NOW - 3 * 86_400_000 },
    at: NOW - 3 * 86_400_000,
  });
  expect(theirs.ok).toBe(true);
  const stale = theirs.ok ? theirs.run : (null as never);

  await w.runner.tick();
  const mine = await w.runs.get(id);
  expect(mine?.state).toBe("running");
  expect(mine?.claimant?.deviceId).toBe(ME);
  expect(mine?.attempts).toBe(stale.attempts + 1);
  expect(mine?.revision).toBe(stale.revision + 1);

  // The other device's copy arrives on the next pull. Both are `running`, so
  // the chain ties and `revision` decides: the device that took it over holds it.
  const merged = mergeRun(stale, mine as Run);
  expect(merged.claimant?.deviceId).toBe(ME);
  expect(mergeRun(mine as Run, stale)).toEqual(merged);

  done.resolve({ output: "translations/forfeited.md" });
  expect((await w.finished(id)).state).toBe("done");
});

test("a worker that throws is tried again in place, and gives up at the limit", async () => {
  const w = world();
  const k = kind("throws");
  let starts = 0;
  registerWorker({
    kind: k,
    run: () => {
      starts += 1;
      return { cancel: () => {}, done: Promise.reject(new Error("the premise did not hold")) };
    },
  });

  const asked = await w.runner.delegate({
    kind: k,
    delegator: { kind: "soul" },
    brief: "briefs/throws.json",
  });
  const id = asked.ok ? asked.run.id : "";
  await w.runner.tick();
  const run = await w.finished(id);

  // Three tries, all on this device, without the run ever leaving `running`
  // until the last one gave up.
  expect(starts).toBe(3);
  expect(run.state).toBe("failed");
  expect(run.attempts).toBe(3);
  expect(run.claimant?.deviceId).toBe(ME);

  const bells = await w.rung();
  expect(bells).toHaveLength(1);
  expect(bells[0]?.type).toBe("run-failed");
  expect(bells[0]?.payload).toMatchObject({ runId: id, reason: "the premise did not hold" });
});

test("a local run never reaches the folder and finishes at once", async () => {
  const w = world();
  const k = kind("local");
  registerWorker({
    kind: k,
    tier: "local",
    run: () => ({ cancel: () => {}, done: Promise.resolve({ output: "pages/12.json" }) }),
  });

  const asked = await w.runner.delegate({
    kind: k,
    delegator: { kind: "soul" },
    brief: "briefs/local.json",
  });
  expect(asked.ok).toBe(true);
  const finished = asked.ok ? await asked.done : null;
  expect(finished?.state).toBe("done");
  expect(finished?.output).toBe("pages/12.json");
  expect(await w.runs.list()).toEqual([]);
  expect(w.runDisk.files.size).toBe(0);
});
