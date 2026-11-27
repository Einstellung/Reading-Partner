// When a night is owed, and which device's record answers it
// (src/memory/dream/schedule.ts, runs.ts). Run: bun test.

import { expect, test } from "bun:test";
import { isDreamDue, lastDreamAnchor, dreamNight } from "../../src/memory/dream/schedule";
import { latestDreamRun, parseDreamRun } from "../../src/memory/dream/runs";

// Local time, because the gate is local: 3 a.m. is 3 a.m. where the reader is.
function at(day: string, hour: number, minute = 0): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute).getTime();
}

test("a device that has never run, with no other device's record, owes a night", () => {
  expect(isDreamDue(null, at("2026-09-05", 3))).toBe(true);
  expect(isDreamDue(null, at("2026-09-05", 1))).toBe(true);
});

test("a run since the most recent 3 a.m. answers for the rest of that night", () => {
  expect(isDreamDue(at("2026-09-05", 3, 1), at("2026-09-05", 23, 59))).toBe(false);
  expect(isDreamDue(at("2026-09-05", 3, 1), at("2026-09-06", 2, 59))).toBe(false);
  expect(isDreamDue(at("2026-09-05", 3, 1), at("2026-09-06", 3, 0))).toBe(true);
});

test("a reader who only opens the app between midnight and 3 still gets a night", () => {
  // Last ran at 01:00 on the 5th, for the night of the 4th. Opened again at 01:00
  // on the 6th: the 5th's 3 a.m. has gone by since, so one is owed.
  expect(isDreamDue(at("2026-09-05", 1), at("2026-09-06", 1))).toBe(true);
  // And the run at 01:00 on the 6th answers until the 6th's 3 a.m.
  expect(isDreamDue(at("2026-09-06", 1), at("2026-09-06", 2, 30))).toBe(false);
});

test("a night missed for weeks is one run, not one per day", () => {
  expect(isDreamDue(at("2026-08-20", 9), at("2026-09-05", 9))).toBe(true);
  expect(isDreamDue(at("2026-09-05", 9), at("2026-09-05", 9, 1))).toBe(false);
});

test("the night is named for the day of the 3 a.m. it answers", () => {
  expect(lastDreamAnchor(at("2026-09-06", 1))).toBe(at("2026-09-05", 3));
  expect(lastDreamAnchor(at("2026-09-06", 3))).toBe(at("2026-09-06", 3));
  expect(dreamNight(at("2026-09-06", 1))).toBe("2026-09-05");
  expect(dreamNight(at("2026-09-06", 14))).toBe("2026-09-06");
});

test("another device's record from tonight means this device does not run", () => {
  const records = [
    { deviceId: "desk", lastRunAt: at("2026-09-04", 9) },
    { deviceId: "ipad", lastRunAt: at("2026-09-05", 8) },
  ];
  // This phone last ran two days ago; the iPad ran this morning.
  const latest = latestDreamRun(at("2026-09-03", 9), records);
  expect(latest).toBe(at("2026-09-05", 8));
  expect(isDreamDue(latest, at("2026-09-05", 12))).toBe(false);
  // With only yesterday's records the night is still owed.
  expect(isDreamDue(latestDreamRun(null, records.slice(0, 1)), at("2026-09-05", 12))).toBe(true);
});

test("a record file that is not one reads as nothing", () => {
  expect(parseDreamRun('{"deviceId":"d","lastRunAt":5}')).toEqual({ deviceId: "d", lastRunAt: 5 });
  expect(parseDreamRun('{"deviceId":"d"}')).toBeNull();
  expect(parseDreamRun("not json")).toBeNull();
});
