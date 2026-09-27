import { expect, test } from "bun:test";
import {
  dueJobs,
  jobFiredKey,
  lastAnchor,
  runScheduleTick,
  startScheduleClock,
  type NightlyJob,
} from "../../../src/legion/schedule";
import { createFiredStore } from "../../../src/legion/schedule/fired";

const AT = { daily: { hour: 4 } };

function memFired() {
  let text: string | null = null;
  return createFiredStore({
    read: async () => text,
    write: async (c) => {
      text = c;
    },
  });
}

function job(runs: number[], id = "sweep"): NightlyJob {
  return {
    id,
    at: AT,
    run: async () => {
      runs.push(1);
    },
  };
}

test("a job met for the first time is armed, then runs once per anchor", () => {
  const now = new Date(2026, 8, 27, 10, 0).getTime();
  const anchor = lastAnchor(AT, now) as number;
  const j = job([]);
  expect(dueJobs([j], {}, now)).toEqual([{ job: j, anchor, action: "arm" }]);
  expect(dueJobs([j], { [jobFiredKey("sweep")]: anchor }, now)).toEqual([]);
  expect(dueJobs([j], { [jobFiredKey("sweep")]: anchor - 86_400_000 }, now)).toEqual([
    { job: j, anchor, action: "run" },
  ]);
  // A schedule with the same id does not stand in for the job's stamp.
  expect(dueJobs([j], { sweep: anchor }, now)[0]?.action).toBe("arm");
});

test("the tick runs a due job on every device, once per night", async () => {
  const runs: number[] = [];
  const fired = memFired();
  const day = new Date(2026, 8, 27, 10, 0).getTime();
  const tick = (now: number) =>
    runScheduleTick({ deviceId: "d", now, schedules: [], jobs: [job(runs)], fired });

  await tick(day);
  expect(runs).toHaveLength(0);
  await tick(day + 86_400_000);
  expect(runs).toHaveLength(1);
  await tick(day + 86_400_000 + 60_000);
  expect(runs).toHaveLength(1);
});

test("a job that throws is late by a night, not retried on the next tick", async () => {
  let calls = 0;
  const fired = memFired();
  const failing: NightlyJob = {
    id: "boom",
    at: AT,
    run: async () => {
      calls += 1;
      throw new Error("disk");
    },
  };
  const day = new Date(2026, 8, 27, 10, 0).getTime();
  await fired.record(jobFiredKey("boom"), 0);
  await runScheduleTick({ deviceId: "d", now: day, schedules: [], jobs: [failing], fired });
  await runScheduleTick({ deviceId: "d", now: day + 60_000, schedules: [], jobs: [failing], fired });
  expect(calls).toBe(1);
});

test("the schedule clock asks at start, on every interval and on the way back to the foreground", async () => {
  const listeners = new Map<string, () => void>();
  const target = {
    document: { hidden: false },
    addEventListener: (type: string, fn: () => void) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
  };
  const asked: string[] = [];
  let interval: (() => void) | null = null;
  let cleared = false;
  let id = "";
  const stop = startScheduleClock({
    deviceId: () => id,
    intervalMs: 1_000,
    target,
    tick: async (deps) => {
      asked.push(deps.deviceId);
    },
    setInterval: (fn) => {
      interval = fn;
      return 1;
    },
    clearInterval: () => {
      cleared = true;
    },
  });
  expect(asked).toEqual([""]);
  id = "d-1";
  (interval as unknown as () => void)();
  expect(asked).toEqual(["", "d-1"]);
  listeners.get("blur")?.();
  listeners.get("focus")?.();
  expect(asked).toEqual(["", "d-1", "d-1"]);
  stop();
  expect(cleared).toBe(true);
  expect(listeners.size).toBe(0);
});
