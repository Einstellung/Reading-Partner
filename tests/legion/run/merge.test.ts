// The run merge is the join of a semilattice, so the three properties that
// makes true are what is tested: commutative, associative, idempotent. Together
// they are the whole of what sync needs — two devices merging the same copies
// in either order, in any grouping, any number of times, land on the same run.
//
// The property tests run over a generator rather than over hand-picked pairs,
// because the cases that break associativity are the ones nobody thinks to
// write down. The generator is a few lines of arithmetic with a fixed seed: no
// library, and a failure is reproducible from the seed printed beside it.

import { expect, test } from "bun:test";
import { asRun, collided, compareRun, joinRunFiles, mergeRun } from "../../../src/legion/run/merge";
import { RUN_STATES, type Run, type RunState } from "../../../src/legion/run/types";
import type { Json } from "../../../src/platform/sync/merge/text";

const ID = "r-0123456789abcdef0123456789abcdef";

// A 32-bit linear congruential generator. Deterministic, and its whole job is
// to be varied enough to hit the corners.
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function runFor(next: () => number): Run {
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const maybe = <T,>(value: T): T | undefined => (next() < 0.5 ? value : undefined);

  const run: Run = {
    id: ID,
    kind: "translate-book",
    tier: "synced",
    delegator: { kind: "soul" },
    brief: "briefs/one.json",
    state: pick(RUN_STATES),
    attempts: Math.floor(next() * 4),
    createdAt: 1_000 + Math.floor(next() * 3),
    revision: 1 + Math.floor(next() * 4),
  };
  const deviceId = maybe(pick(["desk-1", "desk-2", "pad-1"]));
  if (deviceId !== undefined) {
    run.claimant = { deviceId, startedAt: 2_000 + Math.floor(next() * 3) };
  }
  const progress = maybe(pick(["fetched 1/9", "fetched 4/9", "translating"]));
  if (progress !== undefined) {
    run.progress = progress;
    run.lastProgressAt = 3_000 + Math.floor(next() * 3);
  }
  const startedAt = maybe(2_000 + Math.floor(next() * 3));
  if (startedAt !== undefined) run.startedAt = startedAt;
  const endedAt = maybe(4_000 + Math.floor(next() * 3));
  if (endedAt !== undefined) run.endedAt = endedAt;
  const deliveredAt = maybe(5_000 + Math.floor(next() * 3));
  if (deliveredAt !== undefined) run.deliveredAt = deliveredAt;
  const output = maybe(pick(["out/a.json", "out/b.json"]));
  if (output !== undefined) run.output = output;
  if (next() < 0.25) run.cancelRequested = true;
  return run;
}

const SEEDS = Array.from({ length: 400 }, (_, i) => i + 1);

test("merging two copies of a run is commutative", () => {
  for (const seed of SEEDS) {
    const next = rng(seed);
    const a = runFor(next);
    const b = runFor(next);
    expect({ seed, run: mergeRun(a, b) }).toEqual({ seed, run: mergeRun(b, a) });
  }
});

test("merging three copies of a run is associative", () => {
  for (const seed of SEEDS) {
    const next = rng(seed);
    const a = runFor(next);
    const b = runFor(next);
    const c = runFor(next);
    expect({ seed, run: mergeRun(mergeRun(a, b), c) }).toEqual({
      seed,
      run: mergeRun(a, mergeRun(b, c)),
    });
  }
});

test("merging a run with itself, or with a merge it is already in, changes nothing", () => {
  for (const seed of SEEDS) {
    const next = rng(seed);
    const a = runFor(next);
    const b = runFor(next);
    expect({ seed, run: mergeRun(a, a) }).toEqual({ seed, run: a });
    const once = mergeRun(a, b);
    expect({ seed, run: mergeRun(once, b) }).toEqual({ seed, run: once });
    expect({ seed, run: mergeRun(once, once) }).toEqual({ seed, run: once });
  }
});

test("a run merged with copies of itself is the same whatever order they arrive in", () => {
  for (const seed of SEEDS.slice(0, 100)) {
    const next = rng(seed);
    const copies = [runFor(next), runFor(next), runFor(next), runFor(next)];
    const forwards = copies.reduce((acc, run) => mergeRun(acc, run));
    const backwards = [...copies].reverse().reduce((acc, run) => mergeRun(acc, run));
    expect({ seed, run: forwards }).toEqual({ seed, run: backwards });
  }
});

// --- the chain -------------------------------------------------------------

function run(over: Partial<Run>): Run {
  return {
    id: ID,
    kind: "translate-book",
    tier: "synced",
    delegator: { kind: "soul" },
    brief: "briefs/one.json",
    state: "pending",
    attempts: 0,
    createdAt: 1_000,
    revision: 1,
    ...over,
  };
}

test("running beats pending, whatever the revisions say", () => {
  const pending = run({ state: "pending", revision: 9 });
  const running = run({
    state: "running",
    revision: 1,
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
  });
  expect(mergeRun(pending, running).state).toBe("running");
  expect(mergeRun(running, pending).state).toBe("running");
  expect(mergeRun(pending, running).claimant).toEqual({ deviceId: "desk-1", startedAt: 2_000 });
});

test("a terminal state beats every state below it on the chain", () => {
  const below: RunState[] = ["pending", "running"];
  const terminal: RunState[] = ["cancelled", "failed", "done"];
  for (const low of below) {
    for (const high of terminal) {
      const a = run({ state: low, revision: 7 });
      const b = run({ state: high, revision: 1 });
      expect(`${low} + ${high}: ${mergeRun(a, b).state}`).toBe(`${low} + ${high}: ${high}`);
    }
  }
});

test("two terminal states are settled by the chain, then by revision", () => {
  const terminal: RunState[] = ["cancelled", "failed", "done"];
  // Every ordered pair, at equal revisions and at unequal ones. The chain puts
  // done above failed above cancelled, and revision only speaks when two
  // devices landed on the same state.
  for (const a of terminal) {
    for (const b of terminal) {
      const later = RUN_STATES.indexOf(a) >= RUN_STATES.indexOf(b) ? a : b;
      const equal = mergeRun(run({ state: a, revision: 4 }), run({ state: b, revision: 4 }));
      expect(`${a}/${b} equal: ${equal.state}`).toBe(`${a}/${b} equal: ${later}`);

      // The lower state at the higher revision still loses: the chain is read
      // first, and revision is only the tie-break inside one state.
      const uneven = mergeRun(run({ state: a, revision: 9 }), run({ state: b, revision: 2 }));
      expect(`${a}/${b} uneven: ${uneven.state}`).toBe(`${a}/${b} uneven: ${later}`);
    }
  }
});

test("two devices that both finished the run keep the higher revision's answer", () => {
  const first = run({ state: "done", revision: 2, output: "out/first.json", endedAt: 4_000 });
  const second = run({ state: "done", revision: 5, output: "out/second.json", endedAt: 4_400 });
  for (const merged of [mergeRun(first, second), mergeRun(second, first)]) {
    expect(merged.output).toBe("out/second.json");
    expect(merged.revision).toBe(5);
    expect(merged.endedAt).toBe(4_400);
  }
});

test("at the same revision the smaller deviceId wins, and a claimed side beats an unclaimed one", () => {
  const pad = run({
    state: "done",
    revision: 3,
    output: "out/pad.json",
    claimant: { deviceId: "pad-1", startedAt: 2_000 },
  });
  const desk = run({
    state: "done",
    revision: 3,
    output: "out/desk.json",
    claimant: { deviceId: "desk-1", startedAt: 2_100 },
  });
  for (const merged of [mergeRun(pad, desk), mergeRun(desk, pad)]) {
    expect(merged.output).toBe("out/desk.json");
    expect(merged.claimant?.deviceId).toBe("desk-1");
  }

  const unclaimed = run({ state: "done", revision: 3, output: "out/nobody.json" });
  for (const merged of [mergeRun(unclaimed, pad), mergeRun(pad, unclaimed)]) {
    expect(merged.output).toBe("out/pad.json");
  }
});

test("neither side ever claimed: the tie is broken by content, not by chance", () => {
  const a = run({ state: "failed", revision: 3, output: "out/a.json" });
  const b = run({ state: "failed", revision: 3, output: "out/b.json" });
  expect(mergeRun(a, b)).toEqual(mergeRun(b, a));
  // Deterministic and the same on both devices, which is the whole requirement;
  // canonical order happens to keep the first.
  expect(mergeRun(a, b).output).toBe("out/a.json");
  expect(compareRun(a, b)).toBeLessThan(0);
});

test("progress comes from the copy at the higher revision", () => {
  const stale = run({
    state: "running",
    revision: 2,
    progress: "fetched 1/9",
    lastProgressAt: 3_000,
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
  });
  const fresh = run({
    state: "running",
    revision: 6,
    progress: "fetched 7/9",
    lastProgressAt: 3_600,
    claimant: { deviceId: "desk-1", startedAt: 2_000 },
  });
  for (const merged of [mergeRun(stale, fresh), mergeRun(fresh, stale)]) {
    expect(merged.progress).toBe("fetched 7/9");
    expect(merged.lastProgressAt).toBe(3_600);
  }
});

test("attempts, the two early stamps and a cancellation survive whichever side lost", () => {
  const loser = run({
    state: "pending",
    revision: 1,
    attempts: 2,
    createdAt: 900,
    startedAt: 1_900,
    deliveredAt: 5_000,
    cancelRequested: true,
  });
  const winner = run({
    state: "done",
    revision: 4,
    attempts: 1,
    createdAt: 1_000,
    startedAt: 2_000,
    endedAt: 4_000,
  });
  for (const merged of [mergeRun(loser, winner), mergeRun(winner, loser)]) {
    expect(merged.state).toBe("done");
    expect(merged.attempts).toBe(2);
    expect(merged.createdAt).toBe(900);
    expect(merged.startedAt).toBe(1_900);
    expect(merged.deliveredAt).toBe(5_000);
    expect(merged.cancelRequested).toBe(true);
    expect(merged.endedAt).toBe(4_000);
  }
});

test("two copies of different runs are a programming error, not a merge", () => {
  expect(() => mergeRun(run({}), run({ id: "r-ffffffffffffffffffffffffffffffff" }))).toThrow();
});

test("a stamp only one side ever wrote is not a collision, and is not lost", () => {
  const bare = run({ state: "running", revision: 2 });
  const stamped = run({
    state: "running",
    revision: 2,
    attempts: 2,
    startedAt: 2_000,
    deliveredAt: 5_000,
    cancelRequested: true,
  });
  // The folded fields are left out of the content comparison, so a side that
  // only carries more of them is not a second write of the same generation.
  expect(collided(bare, stamped)).toBe(false);
  for (const merged of [mergeRun(bare, stamped), mergeRun(stamped, bare)]) {
    expect(merged.attempts).toBe(2);
    expect(merged.startedAt).toBe(2_000);
    expect(merged.deliveredAt).toBe(5_000);
    expect(merged.cancelRequested).toBe(true);
  }
});

test("a run that is only further along did not collide; two writes of one generation did", () => {
  const stale = run({ state: "running", revision: 2, progress: "fetched 1/9" });
  const fresh = run({ state: "running", revision: 6, progress: "fetched 7/9" });
  expect(collided(stale, fresh)).toBe(false);

  const desk = run({ state: "done", revision: 3, output: "out/desk.json" });
  const pad = run({ state: "done", revision: 3, output: "out/pad.json" });
  expect(collided(desk, pad)).toBe(true);
  expect(collided(desk, desk)).toBe(false);

  // Two states at one revision are two generations and not one: one device is
  // further along the chain, and nothing of the other's was written over.
  expect(collided(run({ state: "failed", revision: 3 }), run({ state: "done", revision: 3 }))).toBe(
    false,
  );
});

// --- the shape sync hands in ----------------------------------------------

test("a file that is not a run is left to the opaque strategy", () => {
  expect(asRun(null)).toBeNull();
  expect(asRun([run({})])).toBeNull();
  expect(asRun({ ...run({}), state: "paused" })).toBeNull();
  expect(asRun({ ...run({}), revision: "2" })).toBeNull();
  expect(asRun({ ...run({}), attempts: undefined })).toBeNull();
  expect(asRun(run({}))).not.toBeNull();
});

test("the join reports a loser only when the two sides collided", () => {
  const ahead = joinRunFiles(
    run({ state: "running", revision: 2 }) as unknown as Json,
    run({ state: "done", revision: 3, output: "out/done.json" }) as unknown as Json,
  );
  expect(ahead?.loser).toBeNull();
  expect((ahead?.merged as unknown as Run).state).toBe("done");

  const left = run({ state: "done", revision: 3, output: "out/desk.json" }) as unknown as Json;
  const right = run({ state: "done", revision: 3, output: "out/pad.json" }) as unknown as Json;
  const clash = joinRunFiles(left, right);
  expect((clash?.merged as unknown as Run).output).toBe("out/desk.json");
  expect(clash?.loser).toEqual(right);

  expect(joinRunFiles(left, { hello: "world" } as unknown as Json)).toBeNull();
  expect(
    joinRunFiles(left, run({ id: "r-ffffffffffffffffffffffffffffffff" }) as unknown as Json),
  ).toBeNull();
});
