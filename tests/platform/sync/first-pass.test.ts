// The first sync pass after a start or a return to the front
// (src/platform/sync/first-pass.ts). Run: bun test.

import { expect, test } from "bun:test";
import { createFirstPassWatch, type PassStatus } from "../../../src/platform/sync/first-pass";
import { RESUME_MIN_INTERVAL_MS } from "../../../src/platform/sync/engine";

const T0 = 1_800_000_000_000;

function world() {
  let clock = T0;
  const watch = createFirstPassWatch(() => clock);
  const base: PassStatus = { graceSince: T0, engineStarted: true, running: false, lastSyncAt: T0 - 86_400_000 };
  return {
    watch,
    at: (ms: number) => {
      clock = T0 + ms;
    },
    feed: (over: Partial<PassStatus> = {}) => watch.status({ ...base, ...over }),
  };
}

test("nothing is settled before sync has read its state", () => {
  const w = world();
  w.feed({ graceSince: null, engineStarted: false });
  expect(w.watch.settled()).toBe(false);
});

test("a device that does not sync has nothing to wait for", () => {
  const w = world();
  w.feed({ engineStarted: false });
  expect(w.watch.settled()).toBe(true);
});

test("settled once the first pass after the start has finished, even in error", () => {
  const w = world();
  w.feed();
  expect(w.watch.settled()).toBe(false);
  w.at(1_000);
  w.feed({ running: true });
  expect(w.watch.settled()).toBe(false);
  w.at(5_000);
  // lastSyncAt does not move on a pass that failed; the pass still ran.
  w.feed({ running: false });
  expect(w.watch.settled()).toBe(true);
});

test("a return to the front waits for the next pass", () => {
  const w = world();
  w.feed({ running: true });
  w.feed({ running: false, lastSyncAt: T0 });
  expect(w.watch.settled()).toBe(true);
  w.at(10 * 60_000);
  w.watch.edge();
  expect(w.watch.settled()).toBe(false);
  w.feed({ running: true });
  w.feed({ running: false, lastSyncAt: T0 + 10 * 60_000 + 3_000 });
  expect(w.watch.settled()).toBe(true);
});

test("a return so soon after a pass that the engine runs none keeps that pass", () => {
  const w = world();
  w.feed({ running: true });
  w.at(2_000);
  w.feed({ running: false, lastSyncAt: T0 + 2_000 });
  w.at(RESUME_MIN_INTERVAL_MS - 1_000);
  w.watch.edge();
  expect(w.watch.settled()).toBe(true);
});

test("an edge marked twice for one return, around the pass starting, still waits for its end", () => {
  const w = world();
  w.feed({ running: true });
  w.feed({ running: false, lastSyncAt: T0 });
  w.at(10 * 60_000);
  w.watch.edge();
  w.feed({ running: true });
  w.watch.edge();
  expect(w.watch.settled()).toBe(false);
  w.feed({ running: false });
  expect(w.watch.settled()).toBe(true);
});
