// The prep page's timeline section, the pure half (screen/prep-timeline.ts):
// the phase and the screen lock, the late chips, the minute timer, the
// overview's geometry and scale, and the step rows before and after the start.
// Run: scripts/t.sh tests/info/meals/screen/prep-timeline.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import {
  clockText,
  endsText,
  LATE_CHIPS,
  lateEvent,
  msToNextMinute,
  overviewView,
  prepPhase,
  stepActions,
  stepRows,
  tickMinutes,
  wantsWakeLock,
  writtenMinutes,
} from "../../../../src/info/meals/screen/prep-timeline";
import { MORE_DEFAULT_MIN, startRun } from "../../../../src/info/meals/timeline/run";
import { timelineMinutes, timelineView } from "../../../../src/info/meals/timeline/view";
import { at, CHILI_STEPS, runOnStep2, STEPS_KEY, T0 } from "./prep-timeline-fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

const KITCHEN = { burners: 2 };
const view = (run: ReturnType<typeof runOnStep2> | null, now = T0) =>
  timelineView({ steps: CHILI_STEPS, kitchen: KITCHEN, boxes: true, run, now });

test("the phase: before the start, under way, and over once Done is tapped, started or not", () => {
  expect(prepPhase(null, false)).toBe("before");
  expect(prepPhase({ started: false }, false)).toBe("before");
  expect(prepPhase({ started: true }, false)).toBe("running");
  expect(prepPhase({ started: true }, true)).toBe("finished");
  expect(prepPhase({ started: false }, true)).toBe("finished");
});

test("the screen stays on only while the run is under way", () => {
  expect(wantsWakeLock("before")).toBe(false);
  expect(wantsWakeLock("running")).toBe(true);
  expect(wantsWakeLock("finished")).toBe(false);
});

test("the late chips: the default five first, then ten, each a 'more' event with its minutes", () => {
  expect(LATE_CHIPS).toEqual([MORE_DEFAULT_MIN, 10]);
  expect(LATE_CHIPS.map((m) => lateEvent("3", m))).toEqual([
    { step: "3", event: "more", minutes: 5 },
    { step: "3", event: "more", minutes: 10 },
  ]);
});

test("the timer fires just after the run's next whole minute, and within a minute of a start ahead of the clock", () => {
  expect(msToNextMinute(T0 + 30_000, T0)).toBe(30_050);
  expect(msToNextMinute(T0 + 120_000, T0)).toBe(60_050);
  expect(msToNextMinute(T0 + 119_990, T0)).toBe(60);
  expect(msToNextMinute(T0 - 5_000, T0)).toBe(5_050);
  expect(msToNextMinute(T0 - 3_600_000, T0)).toBe(60_050);
});

test("written minutes are the timeline's once the steps are ready, and nothing before", () => {
  const ready = { kind: "ready" as const, key: STEPS_KEY, at: 1, steps: CHILI_STEPS };
  expect(writtenMinutes(ready, { burners: 2 })).toEqual(timelineMinutes(CHILI_STEPS, KITCHEN));
  expect(writtenMinutes(ready, null)).toEqual({ activeMin: 43, totalMin: 65 });
  for (const kind of ["none", "reading", "writing", "failed"] as const) expect(writtenMinutes({ kind }, null)).toBeNull();
});

test("the scale is round minutes ending on the total, fewer when they are clock times", () => {
  expect(tickMinutes(65, false)).toEqual([0, 15, 30, 45, 65]);
  expect(tickMinutes(65, true)).toEqual([0, 30, 65]);
  expect(tickMinutes(20, false)).toEqual([0, 5, 10, 15, 20]);
  expect(tickMinutes(62, false)).toEqual([0, 15, 30, 45, 62]);
  // A round tick too close to the end gives way to it.
  expect(tickMinutes(42, false)).toEqual([0, 10, 20, 30, 42]);
  expect(tickMinutes(77, true)).toEqual([0, 30, 77]);
  expect(tickMinutes(200, true)).toEqual([0, 120, 200]);
  expect(tickMinutes(20, true)).toEqual([0, 10, 20]);
  expect(tickMinutes(4, true)).toEqual([0, 4]);
});

test("before the start: bars as percent of the plan, numbers on the wide ones, minutes on the scale, no now line", () => {
  const o = overviewView(view(null), "before");
  expect(o.lanes.map((l) => l.label)).toEqual(["Counter", "Stove"]);
  for (const lane of o.lanes) for (const b of lane.bars) expect(b.left + b.width).toBeLessThanOrEqual(100.0001);
  const simmer = o.lanes[1]!.bars.filter((b) => b.n === 3);
  expect(simmer.map((b) => b.kind)).toEqual(["active", "wait"]);
  expect(simmer[0]!.showN).toBe(true);
  expect(o.ticks.map((t) => t.label)).toEqual(["0", "15", "30", "45", "65"]);
  expect(o.ticks.map((t) => t.align)).toEqual(["start", "center", "center", "center", "end"]);
  expect(o.now).toBeNull();
});

test("while running: clock times on the scale, the now line at the run's minute, the hands' step outlined", () => {
  const v = view(runOnStep2(), at(15));
  const o = overviewView(v, "running");
  expect(o.ticks[0]!.label).toBe(clockText(T0));
  expect(o.now).toBeCloseTo((15 / v.totalMin) * 100, 5);
  const current = o.lanes.flatMap((l) => l.bars).filter((b) => b.current);
  expect(current.map((b) => b.n)).toEqual([2]);
  expect(o.lanes[0]!.bars.find((b) => b.n === 1)!.state).toBe("done");
});

test("once over, every bar and row reads done and nothing can be tapped", () => {
  const v = view(runOnStep2(), at(15));
  expect(overviewView(v, "finished").lanes.flatMap((l) => l.bars).every((b) => b.state === "done" && !b.current)).toBe(true);
  expect(overviewView(v, "finished").now).toBeNull();
  const rows = stepRows(v, "finished");
  expect(rows.every((r) => r.state === "done" && r.actions.length === 0 && !r.current)).toBe(true);
  expect(endsText(v, "finished")).toBeNull();
});

test("before the start each row says its minutes, hands-on and waiting", () => {
  const rows = stepRows(view(null), "before");
  expect(rows.map((r) => r.n)).toEqual([1, 2, 3, 4, 5]);
  expect(rows[0]!.when).toBe("10 min hands-on");
  expect(rows[2]!.when).toBe("5 min hands-on · wait 30 min");
  expect(rows.every((r) => r.actions.length === 0 && r.label === null)).toBe(true);
  expect(endsText(view(null), "before")).toBeNull();
});

test("while running each row has its clock times, the current step Now, and its taps", () => {
  const v = view(runOnStep2(), at(15));
  const rows = stepRows(v, "running");
  const two = rows.find((r) => r.id === "2")!;
  expect(two.when).toBe(`${clockText(T0 + 9 * 60_000)} – ${clockText(T0 + 19 * 60_000)}`);
  expect([two.current, two.label, two.actions]).toEqual([true, "Now", ["done", "late"]]);
  expect(rows.find((r) => r.id === "1")!.actions).toEqual([]);
  const next = rows.find((r) => r.id === v.next)!;
  expect(next.actions).toEqual(["started"]);
  expect(endsText(v, "running")).toBe(`Ends ${clockText(v.endsAt!)}`);
});

test("a waiting step can be ended early or given longer; a step not next waits for its turn", () => {
  const run = runOnStep2({ "2": { started: 9, handsDone: 19, done: 19 }, "3": { started: 19, handsDone: 24 } });
  const v = view(run, at(30));
  expect(v.steps.find((s) => s.id === "3")!.status).toBe("waiting");
  expect(stepActions({ id: "3", status: "waiting" }, v, "running")).toEqual(["done", "late"]);
  expect(stepActions({ id: "pack", status: "todo" }, { next: "4" }, "running")).toEqual([]);
  expect(stepActions({ id: "4", status: "todo" }, { next: "4" }, "before")).toEqual([]);
});

test("a hands-on step past its estimate stays under way and pushes the steps after it", () => {
  const plan = view(startRun(STEPS_KEY, T0), T0);
  const late = view(runOnStep2(), at(25));
  const two = late.steps.find((s) => s.id === "2")!;
  expect(two.status).toBe("doing");
  expect(two.end).toBe(25);
  expect(late.steps.find((s) => s.id === "3")!.start).toBeGreaterThan(plan.steps.find((s) => s.id === "3")!.start);
  expect(late.endsAt!).toBeGreaterThan(plan.endsAt!);
});
