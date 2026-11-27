// The times of day something is owed (src/legion/schedule, docs/55): which
// anchor has gone by, and how one hour makes one bell on a device. Run: bun test.

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

// A Tuesday, 09:00 local.
const NOW = new Date(2026, 8, 15, 9, 0, 0, 0).getTime();
const at5 = (day = 0): number => new Date(2026, 8, 15 - day, 5, 0, 0, 0).getTime();

const nightly: Schedule = {
  id: "test-round",
  at: { daily: { hour: 5 } },
  brief: "the morning round is due",
};


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
  const due = dueSchedules([nightly], {}, NOW);
  expect(ids(due)).toEqual(["test-round:arm"]);
  expect(due[0].anchor).toBe(at5());
});

test("a device that has fired for an earlier hour fires, and the same anchor fires once", () => {
  const fired = { "test-round": at5(1) };
  expect(ids(dueSchedules([nightly], fired, NOW))).toEqual(["test-round:fire"]);
  // Written down, the same hour is over.
  const after = { "test-round": at5() };
  expect(dueSchedules([nightly], after, NOW)).toEqual([]);
});

test("the next day comes due again", () => {
  const tomorrow = NOW + 86_400_000;
  const due = dueSchedules([nightly], { "test-round": at5() }, tomorrow);
  expect(ids(due)).toEqual(["test-round:fire"]);
  expect(due[0].anchor).toBe(new Date(2026, 8, 16, 5, 0, 0, 0).getTime());
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

test("each device past the hour rings under the same bell id, and once", async () => {
  const anchor = at5();
  const desk = fakes();
  const laptop = fakes();
  // Both have seen the schedule before, so neither is arming.
  await desk.fired.record(nightly.id, at5(1));
  await laptop.fired.record(nightly.id, at5(1));

  const shared = { schedules: [nightly], jobs: [], now: NOW };
  await runScheduleTick({ ...shared, fired: desk.fired, bells: desk.bellStore });
  await runScheduleTick({ ...shared, fired: laptop.fired, bells: laptop.bellStore });

  expect([...desk.bells.keys()]).toEqual([`${wakeBellId(nightly.id, anchor)}.json`]);
  expect([...laptop.bells.keys()]).toEqual([`${wakeBellId(nightly.id, anchor)}.json`]);

  // Ringing again for the same hour leaves the one bell.
  await runScheduleTick({ ...shared, fired: desk.fired, bells: desk.bellStore });
  expect([...desk.bells.keys()]).toHaveLength(1);
});

test("the bell carries the schedule and its brief", async () => {
  const h = fakes();
  await h.fired.record(nightly.id, at5(1));
  await runScheduleTick({
    schedules: [nightly],
    // Only the schedules: the shell tests register the real nightly jobs globally.
    jobs: [],
    now: NOW,
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
    jobs: [],
    now: NOW,
    fired: h.fired,
    bells: h.bellStore,
  });
  expect([...h.bells.keys()]).toEqual([]);
  expect(await h.fired.read()).toEqual({ [nightly.id]: at5() });
});
