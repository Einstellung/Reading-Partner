// The morning round's anchor (src/info/program/daily.ts): which day's five
// o'clock has most recently gone by. Whether it has been collected for is the
// run store's answer now, not a rule here (docs/55 step 12) — that half is
// tested in tests/info/program/collect-run.test.ts. Every timestamp is built
// from local-time components so the assertions hold in whatever timezone the
// test runs in. Run: bun test.

import { expect, test } from "bun:test";
import { DAILY_ANCHOR_HOUR, lastAnchorDate } from "../../../src/info/program/daily";

// Local wall-clock time as an epoch, the way the machine reads its own clock.
function at(y: number, m: number, d: number, h: number, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime();
}

test("the anchor that has gone by is yesterday's until the hour is up", () => {
  expect(lastAnchorDate(at(2026, 8, 19, 0, 1))).toBe("2026-08-18");
  expect(lastAnchorDate(at(2026, 8, 19, DAILY_ANCHOR_HOUR - 1, 59))).toBe("2026-08-18");
  expect(lastAnchorDate(at(2026, 8, 19, DAILY_ANCHOR_HOUR))).toBe("2026-08-19");
  expect(lastAnchorDate(at(2026, 8, 19, 23, 59))).toBe("2026-08-19");
});

test("the anchor crosses month and year boundaries", () => {
  expect(lastAnchorDate(at(2026, 3, 1, 2))).toBe("2026-02-28");
  expect(lastAnchorDate(at(2026, 1, 1, 2))).toBe("2025-12-31");
});
