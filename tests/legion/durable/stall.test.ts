// The silence watch (src/legion/durable/stall.ts), on a virtual clock.
//
// What it has to get right is the iPad case: the app is switched away
// mid-answer, iOS freezes the process, and the stream that was being read is
// dead by the time it thaws — no bytes, no error, no end. Nothing in the turn
// notices, so the run stays open and the thread stays busy. And the other iPad
// case: the connection outlived the freeze and what it kept arrives just after
// the thaw, which must not be cut.
// Run: scripts/t.sh tests/legion/durable/stall.test.ts

import { expect, test } from "bun:test";
import { createStallWatches, STALL_GRACE_MS, type StallTimers } from "../../../src/legion/durable/stall";

// A clock the test moves by hand. Every tick registered on it is called once
// per `advance`, which is enough: the watch reads the wall clock rather than
// counting ticks, so how many landed never changes the answer. `freeze` is the
// process frozen: the wall clock moves on and no tick runs.
function clock(): StallTimers & { advance: (ms: number) => void; freeze: (ms: number) => void; tickers: number } {
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
    freeze(ms) {
      at += ms;
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

test("coming back from a long absence cuts a stream that said nothing while away, once the grace is out", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  watches.away(timers.now());
  timers.freeze(30_000);
  watches.back(timers.now());
  // Not on the spot: what the connection kept through the freeze may still come.
  expect(stalls).toBe(0);
  timers.advance(STALL_GRACE_MS - 1);
  expect(stalls).toBe(0);
  // Then cut, well inside the ordinary window, and only once.
  timers.advance(1);
  expect(stalls).toBe(1);
  timers.advance(200_000);
  expect(stalls).toBe(1);
});

test("bytes that arrive within the grace keep the stream, and the ordinary window runs from them", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  watches.away(timers.now());
  timers.freeze(30_000);
  watches.back(timers.now());
  timers.advance(3_000);
  watch.beat();
  timers.advance(STALL_GRACE_MS);
  expect(stalls).toBe(0);
  timers.advance(80_000);
  expect(stalls).toBe(0);
  timers.advance(10_000);
  expect(stalls).toBe(1);
});

// docs/pitfall/522: away longer than the window, the first tick after the thaw
// can run before the way back is heard and before the bytes the socket kept.
test("the first tick after a freeze longer than the window waits for the grace", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  watches.away(timers.now());
  timers.freeze(120_000);
  timers.advance(0);
  expect(stalls).toBe(0);
  watches.back(timers.now());
  timers.advance(1_000);
  watch.beat();
  timers.advance(STALL_GRACE_MS);
  expect(stalls).toBe(0);
});

test("a freeze longer than the window with nothing after it is cut when the grace is out", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  watches.away(timers.now());
  timers.freeze(120_000);
  timers.advance(0);
  watches.back(timers.now());
  timers.advance(STALL_GRACE_MS - 1);
  expect(stalls).toBe(0);
  timers.advance(1);
  expect(stalls).toBe(1);
});

test("a short trip out of the app leaves a live stream alone", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  watches.away(timers.now());
  timers.freeze(5_000);
  watches.back(timers.now());
  timers.advance(STALL_GRACE_MS);
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
  timers.freeze(20_000);
  watches.back(timers.now());
  timers.advance(STALL_GRACE_MS);
  expect(stalls).toBe(0);
});

test("a tool still running is not cut by the way back either", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.hold();

  watches.away(timers.now());
  timers.freeze(120_000);
  watches.back(timers.now());
  timers.advance(STALL_GRACE_MS);
  expect(stalls).toBe(0);
});

test("the first of the two leaving events is when the app left", () => {
  const timers = clock();
  const watches = createStallWatches({ timers });
  let stalls = 0;
  const watch = watches.watch({ stallMs: 90_000, awayMs: 20_000, onStall: () => (stalls += 1) });
  watch.beat();

  watches.away(timers.now());
  timers.freeze(25_000);
  watches.away(timers.now());
  watches.back(timers.now());
  timers.advance(STALL_GRACE_MS);
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
