// The silence watch (src/legion/execute/stall.ts), on a virtual clock.
//
// What it has to get right is the iPad case: the app is switched away
// mid-answer, iOS freezes the process, and the stream that was being read is
// dead by the time it thaws — no bytes, no error, no end. Nothing in the turn
// notices, so the run stays open and the lane stays held.
// Run: scripts/t.sh tests/legion/execute/stall.test.ts

import { expect, test } from "bun:test";
import {
  createStallWatches,
  isStall,
  StallError,
  type StallTimers,
} from "../../../src/legion/execute/stall";

// A clock the test moves by hand. Every tick registered on it is called once
// per `advance`, which is enough: the watch reads the wall clock rather than
// counting ticks, so how many landed never changes the answer.
function clock(): StallTimers & { advance: (ms: number) => void; tickers: number } {
  let at = 1_000_000;
  const ticks = new Set<() => void>();
  return {
    now: () => at,
    every(_ms, tick) {
      ticks.add(tick);
      return () => ticks.delete(tick);
    },
    advance(ms) {
      at += ms;
      for (const tick of [...ticks]) tick();
    },
    get tickers() {
      return ticks.size;
    },
  };
}

test("silence past the window ends the watch, once", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  watches.watch({ stallMs: 90_000, onStall: () => (stalls += 1) });

  timers.advance(89_000);
  expect(stalls).toBe(0);
  timers.advance(2_000);
  expect(stalls).toBe(1);
  timers.advance(200_000);
  expect(stalls).toBe(1);
});

test("a beat puts the window back", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, onStall: () => (stalls += 1) });

  timers.advance(80_000);
  watch.beat();
  timers.advance(80_000);
  expect(stalls).toBe(0);
  timers.advance(20_000);
  expect(stalls).toBe(1);
});

test("a running tool is not the provider being silent", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, onStall: () => (stalls += 1) });

  watch.hold();
  timers.advance(600_000);
  expect(stalls).toBe(0);
  watch.unhold();
  timers.advance(80_000);
  expect(stalls).toBe(0);
  timers.advance(20_000);
  expect(stalls).toBe(1);
});

test("a stopped watch is neither fired nor left ticking", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, onStall: () => (stalls += 1) });
  watch.stop();
  watch.stop();
  expect(timers.tickers).toBe(0);
  timers.advance(200_000);
  expect(stalls).toBe(0);
});

test("coming back from a long absence cuts a stream that said nothing while away", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  watches.away(timers.now());
  // The process is frozen: no tick runs, and the wall clock moves on anyway.
  timers.advance(0);
  const back = timers.now() + 30_000;
  watches.back(back);
  // Cut at once, well inside the ordinary window.
  expect(stalls).toBe(1);
});

test("a short trip out of the app leaves a live stream alone", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  watches.away(timers.now());
  watches.back(timers.now() + 5_000);
  expect(stalls).toBe(0);
});

test("a stream that spoke while the app was away is left alone", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });

  const left = timers.now();
  watches.away(left);
  timers.advance(10_000);
  watch.beat();
  watches.back(timers.now() + 20_000);
  expect(stalls).toBe(0);
});

test("a tool still running is not cut by the way back either", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.hold();

  watches.away(timers.now());
  watches.back(timers.now() + 120_000);
  expect(stalls).toBe(0);
});

test("the first of the two leaving events is when the app left", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  const left = timers.now();
  watches.away(left);
  watches.away(left + 25_000);
  watches.back(left + 25_000);
  expect(stalls).toBe(1);
});

test("a way back with no absence behind it decides nothing", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watches.back(timers.now() + 600_000);
  expect(stalls).toBe(0);
});

test("a stall is told apart from every other failure", () => {
  expect(isStall(new StallError())).toBe(true);
  expect(isStall(new Error("Couldn't reach the model"))).toBe(false);
  expect(isStall(undefined)).toBe(false);
});

// How TURN_STALL_MS is re-checked: the worst gap a real turn produces has to
// sit under the window, and a gap is only visible from inside the watch
// (turn.ts logs it in development builds).
test("the watch keeps the longest silence it saw, and tool time is not in it", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  const watch = watches.watch({ stallMs: 900_000, onStall: () => {} });

  timers.advance(3_000);
  watch.beat();
  timers.advance(12_000);
  watch.beat();
  expect(watch.longestSilence()).toBe(12_000);

  // The wait before a tool starts is the provider's, and counts.
  timers.advance(7_000);
  watch.hold();
  expect(watch.longestSilence()).toBe(12_000);

  // The tool itself does not, however long it runs.
  timers.advance(300_000);
  watch.unhold();
  expect(watch.longestSilence()).toBe(12_000);

  timers.advance(4_000);
  watch.beat();
  expect(watch.longestSilence()).toBe(12_000);

  // Silence that has not ended yet still counts: a turn read at the moment it
  // is cut has its worst gap running.
  timers.advance(20_000);
  expect(watch.longestSilence()).toBe(20_000);
  watch.stop();
});
