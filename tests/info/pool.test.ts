// Bounded concurrency for the collection engine (src/info/sources/pool.ts): the
// per-call limit, the shared Gate across calls, order preservation, per-task
// isolation, and what an abort does to the queue. Pure — no fetch, no clock.
// Run: bun test.

import { expect, test } from "bun:test";
import { Gate, mapSettled } from "../../src/info/sources/pool";

// A task that resolves only when the test says so, so "how many ran at once" is
// observable without leaning on timers.
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

test("no more than `limit` tasks run at once", async () => {
  let active = 0;
  let peak = 0;
  const inputs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const results = await mapSettled(
    inputs,
    async (n) => {
      active++;
      peak = Math.max(peak, active);
      await tick();
      active--;
      return n * 2;
    },
    { limit: 3 },
  );
  expect(peak).toBe(3);
  expect(results.map((r) => (r.ok ? r.value : null))).toEqual(inputs.map((n) => n * 2));
});

test("results keep input order however the tasks finish", async () => {
  // Later inputs settle first: the third resolves immediately, the first last.
  const delays = [30, 20, 0, 10];
  const finished: number[] = [];
  const results = await mapSettled(
    delays,
    async (ms, i) => {
      await new Promise<void>((r) => setTimeout(r, ms));
      finished.push(i);
      return i;
    },
    { limit: 4 },
  );
  expect(finished).toEqual([2, 3, 1, 0]); // completion order
  expect(results.map((r) => (r.ok ? r.value : null))).toEqual([0, 1, 2, 3]); // input order
});

test("one task throwing costs only its own slot", async () => {
  const results = await mapSettled(
    [1, 2, 3, 4],
    async (n) => {
      if (n === 2) throw new Error(`no ${n}`);
      return n;
    },
    { limit: 2 },
  );
  expect(results[0]).toEqual({ ok: true, value: 1 });
  expect(results[1].ok).toBe(false);
  expect(results[1].ok === false && (results[1].error as Error).message).toBe("no 2");
  expect(results[2]).toEqual({ ok: true, value: 3 });
  expect(results[3]).toEqual({ ok: true, value: 4 });
});

test("an abort mid-flight stops the queue and leaves the unstarted slots as failures", async () => {
  const controller = new AbortController();
  const started: number[] = [];
  const gates = [deferred(), deferred()];
  const run = mapSettled(
    [0, 1, 2, 3, 4, 5],
    async (n) => {
      started.push(n);
      if (n < 2) await gates[n].promise;
      return n;
    },
    { limit: 2, signal: controller.signal },
  );
  await tick();
  expect(started).toEqual([0, 1]);
  controller.abort();
  gates[0].resolve();
  gates[1].resolve();
  const results = await run;
  // The two that were already running kept their values; nothing else was sent.
  expect(started).toEqual([0, 1]);
  expect(results[0]).toEqual({ ok: true, value: 0 });
  expect(results[1]).toEqual({ ok: true, value: 1 });
  for (const r of results.slice(2)) {
    expect(r.ok).toBe(false);
    expect(r.ok === false && (r.error as Error).name).toBe("AbortError");
  }
});

test("a signal already aborted sends nothing at all", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const results = await mapSettled(
    [1, 2, 3],
    async () => {
      calls++;
      return 1;
    },
    { limit: 2, signal: controller.signal },
  );
  expect(calls).toBe(0);
  expect(results.every((r) => !r.ok)).toBe(true);
});

test("the gate caps concurrency across separate calls", async () => {
  const gate = new Gate(3);
  let active = 0;
  let peak = 0;
  const task = async () => {
    active++;
    peak = Math.max(peak, active);
    await tick();
    active--;
    return 1;
  };
  // Three calls of two each: 6 tasks would run at once on their own limits.
  await Promise.all([
    mapSettled([1, 2], task, { limit: 2, gate }),
    mapSettled([3, 4], task, { limit: 2, gate }),
    mapSettled([5, 6], task, { limit: 2, gate }),
  ]);
  expect(peak).toBe(3);
  expect(gate.inFlight).toBe(0);
});

test("a task queued behind the gate does not start once the run is aborted", async () => {
  const gate = new Gate(1);
  const controller = new AbortController();
  const held = deferred();
  const ran: string[] = [];
  const holder = gate.run(async () => {
    ran.push("holder");
    await held.promise;
  });
  const queued = mapSettled(
    ["a", "b"],
    async (name) => {
      ran.push(name);
      return name;
    },
    { limit: 2, gate, signal: controller.signal },
  );
  await tick();
  expect(ran).toEqual(["holder"]);
  controller.abort();
  held.resolve();
  await holder;
  const results = await queued;
  expect(ran).toEqual(["holder"]);
  expect(results.every((r) => !r.ok)).toBe(true);
});

test("a rejecting task releases its gate slot", async () => {
  const gate = new Gate(1);
  await expect(
    gate.run(async () => {
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(gate.inFlight).toBe(0);
  expect(await gate.run(async () => "next")).toBe("next");
});

test("an empty input list is a no-op", async () => {
  expect(await mapSettled([], async () => 1, { limit: 4 })).toEqual([]);
});
