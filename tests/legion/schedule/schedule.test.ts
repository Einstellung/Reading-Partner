// The times of day something is owed (src/legion/schedule, docs/55): which
// anchor has gone by, which machine acts on it, and how one hour makes one
// bell. Run: bun test.

import { expect, test } from "bun:test";
import {
  dueSchedules,
  lastAnchor,
  runScheduleTick,
  wakeBellId,
  type DueSchedule,
  type Schedule,
} from "../../../src/legion/schedule";
import { createFiredStore } from "../../../src/legion/schedule/fired";
import { createBellStore, type Bell } from "../../../src/legion/bell";
import { registerKindCapabilities, type DeviceClaim } from "../../../src/legion/claim";

const KIND = "test-nightly";
registerKindCapabilities(KIND, []);
const NEEDS_GPU = "test-nightly-gpu";
registerKindCapabilities(NEEDS_GPU, []);

// A Tuesday, 09:00 local.
const NOW = new Date(2026, 8, 15, 9, 0, 0, 0).getTime();
const at5 = (day = 0): number => new Date(2026, 8, 15 - day, 5, 0, 0, 0).getTime();

const nightly: Schedule = {
  id: "test-round",
  kind: KIND,
  at: { daily: { hour: 5 } },
  brief: "the morning round is due",
};

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

function ids(due: DueSchedule[]): string[] {
  return due.map((d) => `${d.schedule.id}:${d.action}`);
}

test("the anchor is the most recent time it went by", () => {
  expect(lastAnchor({ daily: { hour: 5 } }, NOW)).toBe(at5());
  // Before the hour, yesterday's is the one that has gone by.
  const three = new Date(2026, 8, 15, 3, 0, 0, 0).getTime();
  expect(lastAnchor({ daily: { hour: 5 } }, three)).toBe(at5(1));
});

test("the cron subset reads, and anything outside it never comes due", () => {
  expect(lastAnchor({ cron: "0 5 * * *" }, NOW)).toBe(at5());
  // A Tuesday asked for on a Tuesday is today; a Monday is yesterday.
  expect(lastAnchor({ cron: "0 5 * * 2" }, NOW)).toBe(at5());
  expect(lastAnchor({ cron: "0 5 * * 1" }, NOW)).toBe(at5(1));
  expect(lastAnchor({ cron: "*/5 5 * * *" }, NOW)).toBeNull();
  expect(lastAnchor({ cron: "0 5 1 * *" }, NOW)).toBeNull();
});

// A machine meeting the schedule for the first time owes nothing for an hour
// that went by before it could know there was one.
test("the first time a device sees a schedule it arms rather than fires", () => {
  const due = dueSchedules([nightly], {}, [claim("desk")], NOW, "desk");
  expect(ids(due)).toEqual(["test-round:arm"]);
  expect(due[0].anchor).toBe(at5());
});

test("only the elected device fires, and the same anchor fires once", () => {
  // desk has been up longer, so it holds the kind.
  const claims = [claim("desk"), claim("laptop", { claimedAt: NOW - 60_000 })];
  const fired = { "test-round": at5(1) };
  expect(ids(dueSchedules([nightly], fired, claims, NOW, "desk"))).toEqual(["test-round:fire"]);
  expect(ids(dueSchedules([nightly], fired, claims, NOW, "laptop"))).toEqual([]);
  // Written down, the same hour is over.
  const after = { "test-round": at5() };
  expect(dueSchedules([nightly], after, claims, NOW, "desk")).toEqual([]);
});

test("the next day comes due again", () => {
  const tomorrow = NOW + 86_400_000;
  const due = dueSchedules([nightly], { "test-round": at5() }, [claim("desk")], tomorrow, "desk");
  expect(ids(due)).toEqual(["test-round:fire"]);
  expect(due[0].anchor).toBe(new Date(2026, 8, 16, 5, 0, 0, 0).getTime());
});

test("a schedule that needs more of a machine than its kind does skips the machine without it", () => {
  const gpu: Schedule = { ...nightly, id: "test-gpu", kind: NEEDS_GPU, requires: ["gpu"] };
  const claims = [claim("desk"), claim("box", { claimedAt: NOW - 60_000, capabilities: ["gpu"] })];
  const fired = { "test-gpu": at5(1) };
  expect(ids(dueSchedules([gpu], fired, claims, NOW, "desk"))).toEqual([]);
  expect(ids(dueSchedules([gpu], fired, claims, NOW, "box"))).toEqual(["test-gpu:fire"]);
});

// --- the tick ---------------------------------------------------------------

function fakes() {
  const bells = new Map<string, string>();
  const bellStore = createBellStore({
    list: async () => [...bells.keys()],
    read: async (name) => bells.get(name) ?? null,
    write: async (name, contents) => {
      bells.set(name, contents);
    },
  });
  let firedText: string | null = null;
  const fired = createFiredStore({
    read: async () => firedText,
    write: async (contents) => {
      firedText = contents;
    },
  });
  return { bells, bellStore, fired, firedState: () => firedText };
}

test("two devices both past the hour ring one bell between them", async () => {
  const claims = [claim("desk"), claim("laptop", { claimedAt: NOW - 60_000 })];
  const anchor = at5();
  const desk = fakes();
  const laptop = fakes();
  // Both have seen the schedule before, so neither is arming.
  await desk.fired.record(nightly.id, at5(1));
  await laptop.fired.record(nightly.id, at5(1));

  const shared = { schedules: [nightly], claims: async () => claims, now: NOW };
  await runScheduleTick({ ...shared, deviceId: "desk", fired: desk.fired, bells: desk.bellStore });
  await runScheduleTick({
    ...shared,
    deviceId: "laptop",
    fired: laptop.fired,
    bells: laptop.bellStore,
  });

  expect([...desk.bells.keys()]).toEqual([`${wakeBellId(nightly.id, anchor)}.json`]);
  expect([...laptop.bells.keys()]).toEqual([]);

  // And the winner ringing again for the same hour leaves the one bell.
  await runScheduleTick({ ...shared, deviceId: "desk", fired: desk.fired, bells: desk.bellStore });
  expect([...desk.bells.keys()]).toHaveLength(1);
});

test("the bell carries the schedule and its brief", async () => {
  const h = fakes();
  await h.fired.record(nightly.id, at5(1));
  await runScheduleTick({
    schedules: [nightly],
    claims: async () => [claim("desk")],
    now: NOW,
    deviceId: "desk",
    fired: h.fired,
    bells: h.bellStore,
  });
  const queued = await h.bellStore.read();
  expect(queued).toHaveLength(1);
  const bell = queued[0] as Extract<Bell, { type: "wake" }>;
  expect(bell.type).toBe("wake");
  expect(bell.payload.scheduleId).toBe(nightly.id);
  expect(bell.payload.brief).toBe(nightly.brief);
  expect(bell.at).toBe(at5());
});

test("arming writes the anchor down and rings nothing", async () => {
  const h = fakes();
  await runScheduleTick({
    schedules: [nightly],
    claims: async () => [claim("desk")],
    now: NOW,
    deviceId: "desk",
    fired: h.fired,
    bells: h.bellStore,
  });
  expect([...h.bells.keys()]).toEqual([]);
  expect(await h.fired.read()).toEqual({ [nightly.id]: at5() });
});
