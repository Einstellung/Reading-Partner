import { describe, expect, test } from "bun:test";
import {
  createDailyRound,
  DAILY_RETRY_MS,
  DAILY_TICK_MS,
  DREAM_IDLE_MS,
  readerIdle,
  type DailyRoundDeps,
} from "../../src/presence/daily";
import { createFirstPassWatch } from "../../src/platform/sync/first-pass";

interface World {
  owed: boolean;
  synced: boolean;
  idle: boolean;
}

function harness(world: World) {
  const calls = { dream: 0, sweep: 0, edge: 0, cancelled: 0 };
  const timers: { ms: number; cb: () => void }[] = [];
  let foreground: (() => void) | null = null;
  let exit: (() => void) | null = null;
  const deps: DailyRoundDeps = {
    edge: () => {
      calls.edge += 1;
    },
    synced: () => world.synced,
    idle: () => world.idle,
    dreamOwed: async () => world.owed,
    dream: async () => {
      calls.dream += 1;
      world.owed = false;
    },
    sweep: async () => {
      calls.sweep += 1;
    },
    setTimer: (ms, cb) => {
      timers.push({ ms, cb });
      return () => {
        calls.cancelled += 1;
      };
    },
    onForeground: (cb) => {
      foreground = cb;
    },
    onExit: (cb) => {
      exit = cb;
    },
  };
  return {
    round: createDailyRound(deps),
    calls,
    timers,
    foreground: () => foreground!(),
    exit: () => exit!(),
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const last = <T,>(xs: T[]): T => xs[xs.length - 1];

describe("the daily round", () => {
  test("an owed night waits for the first sync pass and then for the reader to stop", async () => {
    const world = { owed: true, synced: false, idle: true };
    const h = harness(world);
    h.round.start();
    await settle();
    expect(h.calls.dream).toBe(0);
    // Held back, so the next look is the short one.
    expect(last(h.timers).ms).toBe(DAILY_RETRY_MS);

    world.synced = true;
    world.idle = false;
    last(h.timers).cb();
    await settle();
    expect(h.calls.dream).toBe(0);
    expect(last(h.timers).ms).toBe(DAILY_RETRY_MS);

    world.idle = true;
    last(h.timers).cb();
    await settle();
    expect(h.calls.dream).toBe(1);
    expect(last(h.timers).ms).toBe(DAILY_TICK_MS);
  });

  test("a night another device already ran is not run here", async () => {
    // dreamOwed reads every device's record; one from today answers false.
    const h = harness({ owed: false, synced: true, idle: true });
    expect(await h.round.check()).toBe(false);
    expect(h.calls.dream).toBe(0);
    expect(h.calls.sweep).toBe(1);
  });

  test("the conflict sweep runs on every check, synced or not", async () => {
    const h = harness({ owed: true, synced: false, idle: false });
    expect(await h.round.check()).toBe(true);
    expect(h.calls.sweep).toBe(1);
  });

  test("a return to the front marks the sync edge before it checks", async () => {
    const h = harness({ owed: false, synced: true, idle: true });
    h.round.start();
    await settle();
    h.foreground();
    expect(h.calls.edge).toBe(1);
    await settle();
    expect(h.calls.sweep).toBe(2);
  });

  test("start is idempotent and exit cancels the pending tick", async () => {
    const h = harness({ owed: false, synced: true, idle: true });
    h.round.start();
    h.round.start();
    await settle();
    expect(h.calls.sweep).toBe(1);
    h.exit();
    expect(h.calls.cancelled).toBe(1);
  });
});

// Most readers never sign in to sync. initSync still sets graceSince and
// announces a status with no engine (platform/sync/index.ts), and the
// first-pass watch reads that as nothing to wait for — on the way up and on
// every return to the front — so the night is held only by the reader.
describe("a device that does not sync", () => {
  test("runs the night once the reader has stopped", async () => {
    let clock = 1_800_000_000_000;
    const watch = createFirstPassWatch(() => clock);
    let lastStartAt: number | null = clock;
    let owed = true;
    let dreams = 0;
    const timers: (() => void)[] = [];
    let foreground: (() => void) | null = null;
    const round = createDailyRound({
      edge: () => watch.edge(),
      synced: () => watch.settled(),
      idle: () => readerIdle({ live: 0, lastStartAt }, clock),
      dreamOwed: async () => owed,
      dream: async () => {
        dreams += 1;
        owed = false;
      },
      sweep: async () => {},
      setTimer: (_ms, cb) => {
        timers.push(cb);
        return () => {};
      },
      onForeground: (cb) => {
        foreground = cb;
      },
      onExit: () => {},
    });

    // The round's first check can land before initSync has read its state.
    watch.status({ graceSince: null, engineStarted: false, running: false, lastSyncAt: null });
    round.start();
    await settle();
    expect(dreams).toBe(0);

    // initSync, signed out: no engine, nothing to wait for.
    watch.status({ graceSince: clock, engineStarted: false, running: false, lastSyncAt: null });
    expect(watch.settled()).toBe(true);
    // The reader asked something a minute ago.
    clock += 60_000;
    last(timers)();
    await settle();
    expect(dreams).toBe(0);

    clock += DREAM_IDLE_MS;
    last(timers)();
    await settle();
    expect(dreams).toBe(1);

    // The next night, after a return to the front: the edge does not hold it.
    owed = true;
    lastStartAt = null;
    clock += 24 * 3_600_000;
    foreground!();
    await settle();
    expect(dreams).toBe(2);
  });
});

describe("readerIdle", () => {
  const NOW = 1_800_000_000_000;
  test("a turn streaming is never idle", () => {
    expect(readerIdle({ live: 1, lastStartAt: NOW - 10 * DREAM_IDLE_MS }, NOW)).toBe(false);
  });
  test("idle once no turn has started for DREAM_IDLE_MS", () => {
    expect(readerIdle({ live: 0, lastStartAt: null }, NOW)).toBe(true);
    expect(readerIdle({ live: 0, lastStartAt: NOW - DREAM_IDLE_MS + 1 }, NOW)).toBe(false);
    expect(readerIdle({ live: 0, lastStartAt: NOW - DREAM_IDLE_MS }, NOW)).toBe(true);
  });
});
