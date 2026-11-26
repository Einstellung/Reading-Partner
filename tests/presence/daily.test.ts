import { describe, expect, test } from "bun:test";
import { createDailyRound, DAILY_TICK_MS, type DailyRoundDeps } from "../../src/presence/daily";

function harness(elected: () => Promise<boolean>) {
  const calls = { dream: 0, sweep: 0, cancelled: 0 };
  const timers: { ms: number; cb: () => void }[] = [];
  let foreground: (() => void) | null = null;
  let exit: (() => void) | null = null;
  const deps: DailyRoundDeps = {
    elected,
    dream: async () => {
      calls.dream += 1;
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

describe("the daily round", () => {
  test("the first check runs the dream on the elected device and the sweep either way", async () => {
    const won = harness(async () => true);
    won.round.start();
    await settle();
    expect(won.calls).toMatchObject({ dream: 1, sweep: 1 });

    const lost = harness(async () => false);
    lost.round.start();
    await settle();
    expect(lost.calls).toMatchObject({ dream: 0, sweep: 1 });
  });

  test("each tick re-asks the election, and sweeps every time", async () => {
    let winning = false;
    const h = harness(async () => winning);
    h.round.start();
    await settle();
    expect(h.timers).toHaveLength(1);
    expect(h.timers[0]!.ms).toBe(DAILY_TICK_MS);

    winning = true;
    h.timers[0]!.cb();
    await settle();
    expect(h.calls).toMatchObject({ dream: 1, sweep: 2 });
    // The tick schedules the next one once its check has settled.
    expect(h.timers).toHaveLength(2);

    winning = false;
    h.timers[1]!.cb();
    await settle();
    expect(h.calls).toMatchObject({ dream: 1, sweep: 3 });
  });

  test("coming back to the foreground asks again", async () => {
    const h = harness(async () => true);
    h.round.start();
    await settle();
    h.foreground();
    await settle();
    expect(h.calls).toMatchObject({ dream: 2, sweep: 2 });
  });

  test("start is idempotent", async () => {
    const h = harness(async () => true);
    h.round.start();
    h.round.start();
    await settle();
    expect(h.calls).toMatchObject({ dream: 1, sweep: 1 });
    expect(h.timers).toHaveLength(1);
  });

  test("leaving the app cancels the pending tick and schedules no other", async () => {
    const h = harness(async () => true);
    h.round.start();
    await settle();
    h.exit();
    expect(h.calls.cancelled).toBe(1);
    h.timers[0]!.cb();
    await settle();
    expect(h.timers).toHaveLength(1);
  });

  test("an election that cannot be read costs the night, not the sweep or the schedule", async () => {
    const h = harness(async () => {
      throw new Error("claims unreadable");
    });
    const warn = console.warn;
    console.warn = () => {};
    try {
      await h.round.check();
      h.round.start();
      await settle();
    } finally {
      console.warn = warn;
    }
    expect(h.calls).toMatchObject({ dream: 0, sweep: 2 });
    expect(h.timers).toHaveLength(1);
  });
});
