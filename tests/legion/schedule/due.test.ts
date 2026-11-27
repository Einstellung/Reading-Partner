// Which runs this device should act on (src/legion/schedule/due.ts, docs/55).
// Pure: no worker is started here and nothing touches a disk, which is the
// point — "two machines ran the same run" and "a stuck run was never picked up"
// are not reproducible by hand. Run: bun test.

import { expect, test } from "bun:test";
import {
  ABANDONED_MS,
  dueRuns,
  reclaimAfterRestart,
  type ScheduledRun,
} from "../../../src/legion/schedule";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const KIND = "test-translate-book";
const OPTS = { stallMs: 15 * MIN, canRun: (kind: string) => kind === KIND };

function run(over: Partial<ScheduledRun> = {}): ScheduledRun {
  return { id: "r1", kind: KIND, state: "pending", attempts: 0, ...over };
}

function running(holder: string, quietFor: number, over: Partial<ScheduledRun> = {}): ScheduledRun {
  return run({
    state: "running",
    claimant: { deviceId: holder, startedAt: NOW - quietFor },
    lastProgressAt: NOW - quietFor,
    ...over,
  });
}

test("a pending run goes to whichever device looks, with no election", () => {
  expect(dueRuns([run()], NOW, "ipad", OPTS)).toEqual([{ run: run(), action: "take", reason: "pending" }]);
  expect(dueRuns([run()], NOW, "phone", OPTS)).toHaveLength(1);
});

test("a run of a kind this device has no worker for is left alone", () => {
  expect(dueRuns([run({ kind: "nobody-here" })], NOW, "ipad", OPTS)).toEqual([]);
  expect(dueRuns([running("desk", ABANDONED_MS + MIN, { kind: "nobody-here" })], NOW, "ipad", OPTS)).toEqual([]);
});

test("a run another device already took is left alone while it is making progress", () => {
  expect(dueRuns([running("desk", 5 * MIN)], NOW, "ipad", OPTS)).toEqual([]);
  // Quiet for longer than this device's own stall threshold, but somebody else's.
  expect(dueRuns([running("desk", 60 * MIN)], NOW, "ipad", OPTS)).toEqual([]);
});

test("another device's run that has said nothing for a day is taken over", () => {
  const stale = running("desk", ABANDONED_MS + MIN);
  expect(dueRuns([stale], NOW, "ipad", OPTS)).toEqual([{ run: stale, action: "retake", reason: "abandoned" }]);
});

test("a take-over a moment ago is not abandoned because of the previous claimant's progress time", () => {
  const taken = run({
    state: "running",
    claimant: { deviceId: "desk", startedAt: NOW - MIN },
    lastProgressAt: NOW - 2 * ABANDONED_MS,
  });
  expect(dueRuns([taken], NOW, "ipad", OPTS)).toEqual([]);
});

test("this device's own run is retaken once it stalls", () => {
  expect(dueRuns([running("ipad", 10 * MIN)], NOW, "ipad", OPTS)).toEqual([]);
  const stuck = running("ipad", 20 * MIN);
  expect(dueRuns([stuck], NOW, "ipad", OPTS)).toEqual([{ run: stuck, action: "retake", reason: "stalled" }]);
});

test("terminal runs are never picked up", () => {
  for (const state of ["done", "failed", "cancelled"] as const) {
    expect(dueRuns([run({ state })], NOW, "ipad", OPTS)).toEqual([]);
  }
});

test("a restart takes back exactly this device's running runs", () => {
  const mine = running("ipad", MIN, { id: "a" });
  const theirs = running("desk", MIN, { id: "b" });
  expect(reclaimAfterRestart([mine, theirs, run({ id: "c" })], "ipad")).toEqual([
    { run: mine, action: "retake", reason: "restarted" },
  ]);
});
