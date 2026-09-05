// When a night is due (src/memory/dream/schedule.ts). Run: bun test.

import { expect, test } from "bun:test";
import {
  DREAM_HOUR,
  EMPTY_DREAM_STATE,
  isDreamDue,
  type DreamState,
} from "../../src/memory/dream/schedule";

// Local time, because the gate is local: 3 a.m. is 3 a.m. where the reader is.
function at(day: string, hour: number, minute = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
}

function state(over: Partial<DreamState> = {}): DreamState {
  return { ...EMPTY_DREAM_STATE, ...over };
}

test("a machine that has never run is due once 3 has passed", () => {
  expect(isDreamDue(state(), at("2026-09-05", DREAM_HOUR))).toBe(true);
});

test("before 3 nothing is due, however long it has been", () => {
  expect(isDreamDue(state(), at("2026-09-05", 2, 59))).toBe(false);
  expect(isDreamDue(state({ lastRunDay: "2026-08-01" }), at("2026-09-05", 0, 1))).toBe(false);
});

test("having run yesterday does not stop today's night", () => {
  expect(isDreamDue(state({ lastRunDay: "2026-09-04" }), at("2026-09-05", 3, 1))).toBe(true);
});

test("having run today stops it for the rest of the day", () => {
  expect(isDreamDue(state({ lastRunDay: "2026-09-05" }), at("2026-09-05", 3, 1))).toBe(false);
  expect(isDreamDue(state({ lastRunDay: "2026-09-05" }), at("2026-09-05", 23, 59))).toBe(false);
});

test("a night missed at 3 runs at the first opportunity after it", () => {
  expect(isDreamDue(state({ lastRunDay: "2026-09-04" }), at("2026-09-05", 14))).toBe(true);
});

test("days the machine was off are not made up one by one", () => {
  const missed = state({ lastRunDay: "2026-08-20" });
  expect(isDreamDue(missed, at("2026-09-05", 9))).toBe(true);
  // One run answers for all of them: the run stamps today, and today is then
  // done whatever happened before it.
  expect(isDreamDue(state({ lastRunDay: "2026-09-05" }), at("2026-09-05", 9))).toBe(false);
});

test("the small hours after a run belong to the day that ran, not to the next night", () => {
  // 00:30 on the 6th, having run on the 5th: the 6th's 3 a.m. has not arrived.
  expect(isDreamDue(state({ lastRunDay: "2026-09-05" }), at("2026-09-06", 0, 30))).toBe(false);
  expect(isDreamDue(state({ lastRunDay: "2026-09-05" }), at("2026-09-06", 3, 0))).toBe(true);
});
