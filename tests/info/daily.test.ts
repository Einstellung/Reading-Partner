// The morning round's rule (src/info/briefing/daily.ts): which anchor has gone
// by, and whether it has been run for. Every timestamp is built from local-time
// components so the assertions hold in whatever timezone the test runs in.
// Run: bun test.

import { expect, test } from "bun:test";
import { dailyAction, DAILY_ANCHOR_HOUR, lastAnchorDate } from "../../src/info/briefing/daily";

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

test("before the anchor the round is not owed", () => {
  expect(dailyAction(at(2026, 8, 19, 4, 59), "2026-08-18")).toBe("none");
});

test("after the anchor the round is owed", () => {
  expect(dailyAction(at(2026, 8, 19, 5, 0), "2026-08-18")).toBe("run");
});

test("running it settles the day, whatever else happens that day", () => {
  const ran = lastAnchorDate(at(2026, 8, 19, 5, 2));
  expect(ran).toBe("2026-08-19");
  expect(dailyAction(at(2026, 8, 19, 5, 7), ran)).toBe("none");
  expect(dailyAction(at(2026, 8, 19, 23, 59), ran)).toBe("none");
  // Past midnight is still the same anchor: the next one has not arrived.
  expect(dailyAction(at(2026, 8, 20, 4, 30), ran)).toBe("none");
});

test("a machine that was asleep at five catches the round up when it wakes", () => {
  // Suspended at midnight with yesterday's round behind it, back at two in the
  // afternoon. The anchor it slept through is the one it now owes.
  expect(dailyAction(at(2026, 8, 19, 14, 0), "2026-08-18")).toBe("run");
});

test("a machine asleep for days runs one round on the way out, not four", () => {
  const wake = at(2026, 8, 19, 11, 0);
  expect(dailyAction(wake, "2026-08-15")).toBe("run");
  expect(dailyAction(wake, lastAnchorDate(wake))).toBe("none");
});

test("the next morning owes a new round", () => {
  expect(dailyAction(at(2026, 8, 20, 5, 1), "2026-08-19")).toBe("run");
});

test("a round the pipeline refused leaves the morning still owed", () => {
  // live.ts records the anchor only once generate() reports it started one. A
  // run already in flight is answered with "busy" and nothing is recorded, so
  // the next tick has to come back to the same answer — one collision must not
  // cost the day its round.
  const refusedAt = at(2026, 8, 19, 5, 0);
  const last = "2026-08-18";
  expect(dailyAction(refusedAt, last)).toBe("run");
  expect(dailyAction(refusedAt + 5 * 60_000, last)).toBe("run");
});

test("a machine that has never run one arms rather than runs", () => {
  expect(dailyAction(at(2026, 8, 19, 9, 0), null)).toBe("arm");
  expect(dailyAction(at(2026, 8, 19, 3, 0), null)).toBe("arm");
});

test("arming after the anchor gives up that morning and keeps the next", () => {
  // Installed (or upgraded to this build) at nine: the morning went by before
  // this machine could know there was one, so it costs nothing.
  const armedAt = at(2026, 8, 19, 9, 0);
  const armed = lastAnchorDate(armedAt);
  expect(dailyAction(armedAt, armed)).toBe("none");
  expect(dailyAction(at(2026, 8, 20, 5, 0), armed)).toBe("run");
});

test("arming before the anchor keeps this morning owed", () => {
  // Started at three: the anchor it adopts is yesterday's, so five o'clock two
  // hours later is still a round it has not run.
  const armed = lastAnchorDate(at(2026, 8, 19, 3, 0));
  expect(armed).toBe("2026-08-18");
  expect(dailyAction(at(2026, 8, 19, 5, 0), armed)).toBe("run");
});

test("a clock corrected backwards past a recorded round runs once at the new time", () => {
  const now = at(2026, 8, 19, 10, 0);
  expect(dailyAction(now, "2026-08-21")).toBe("run");
  expect(dailyAction(now, lastAnchorDate(now))).toBe("none");
});
