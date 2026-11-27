import { describe, expect, test } from "bun:test";
import {
  createDailyRound,
  DAILY_RETRY_MS,
  DAILY_TICK_MS,
  DREAM_IDLE_MS,
  readerIdle,
  type DailyRoundDeps,
} from "../../src/presence/daily";

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
