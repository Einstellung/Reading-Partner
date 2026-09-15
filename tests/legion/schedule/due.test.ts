// Which runs this device should act on (src/legion/schedule/due.ts, docs/55).
// Pure: no worker is started here and nothing touches a disk, which is the
// point — "two machines ran the same run" and "a stuck run was never picked up"
// are not reproducible by hand. Run: bun test.

import { expect, test } from "bun:test";
import {
  dueRuns,
  reclaimAfterRestart,
  type ScheduledRun,
} from "../../../src/legion/schedule";
import { registerKindCapabilities, type DeviceClaim } from "../../../src/legion/claim";

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const STALL = { stallMs: 15 * MIN };

// Registered at import and never cleared: the registry is one map for the
// process (tests/legion/claim/elect.test.ts says the same).
const KIND = "test-translate-book";
registerKindCapabilities(KIND, []);

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

function run(over: Partial<ScheduledRun> = {}): ScheduledRun {
  return { id: "r1", kind: KIND, state: "pending", attempts: 0, ...over };
}

test("the elected device takes a pending run", () => {
  const due = dueRuns([run()], [claim("desk")], NOW, "desk", STALL);
  expect(due).toEqual([
    { run: run(), action: "take", reason: "elected", bumpAttempts: false },
  ]);
});

test("a device that did not win the kind takes nothing", () => {
  const claims = [claim("desk", { claimedAt: NOW - 86_400_000 }), claim("laptop", { claimedAt: NOW })];
  expect(dueRuns([run()], claims, NOW, "laptop", STALL)).toEqual([]);
  expect(dueRuns([run()], claims, NOW, "desk", STALL)).toHaveLength(1);
});

test("a run of this device's own that has stopped reporting goes back to pending", () => {
  const stuck = run({
    state: "running",
    claimant: { deviceId: "desk", at: NOW - 60 * MIN },
    lastProgressAt: NOW - 20 * MIN,
    attempts: 1,
  });
  const due = dueRuns([stuck], [claim("desk")], NOW, "desk", STALL);
  expect(due).toEqual([{ run: stuck, action: "back", reason: "stalled", bumpAttempts: true }]);
});

// Slow is not stuck: the judgement is the last report, and a worker that
// reported a minute ago is working.
test("a run that is still reporting is left alone", () => {
  const busy = run({
    state: "running",
    claimant: { deviceId: "desk", at: NOW - 60 * MIN },
    lastProgressAt: NOW - MIN,
  });
  expect(dueRuns([busy], [claim("desk")], NOW, "desk", STALL)).toEqual([]);
});

test("a run held by a device that forfeited is taken over by the one that won the kind", () => {
  const theirs = run({
    state: "running",
    claimant: { deviceId: "laptop", at: NOW - 2 * 86_400_000 },
    lastProgressAt: NOW - 2 * 86_400_000,
  });
  const claims = [
    claim("desk", { claimedAt: NOW - MIN }),
    claim("laptop", { heartbeatAt: NOW - 2 * 86_400_000 }),
  ];
  const due = dueRuns([theirs], claims, NOW, "desk", STALL);
  // Handed back, not taken: the next pass over the files picks it up as pending
  // like any other. Nobody failed at anything this device can see, so the
  // attempt count does not move.
  expect(due).toEqual([{ run: theirs, action: "back", reason: "forfeited", bumpAttempts: false }]);
});

test("a run held by a device that is still alive is left where it is", () => {
  const theirs = run({
    state: "running",
    claimant: { deviceId: "laptop", at: NOW - MIN },
    lastProgressAt: NOW - MIN,
  });
  const claims = [claim("desk", { claimedAt: NOW - MIN }), claim("laptop")];
  // laptop has been up longer, so it holds the kind and desk stands by.
  expect(dueRuns([theirs], claims, NOW, "desk", STALL)).toEqual([]);
});

test("terminal runs are nobody's business", () => {
  const runs: ScheduledRun[] = [
    run({ id: "a", state: "done" }),
    run({ id: "b", state: "failed" }),
    run({ id: "c", state: "cancelled" }),
  ];
  expect(dueRuns(runs, [claim("desk")], NOW, "desk", STALL)).toEqual([]);
});

test("a restart hands this device's own running runs back, and nobody else's", () => {
  const mine = run({ id: "a", state: "running", claimant: { deviceId: "desk", at: NOW - MIN } });
  const theirs = run({ id: "b", state: "running", claimant: { deviceId: "laptop", at: NOW - MIN } });
  const pending = run({ id: "c" });
  expect(reclaimAfterRestart([mine, theirs, pending], "desk")).toEqual([
    { run: mine, action: "back", reason: "restarted", bumpAttempts: true },
  ]);
});
