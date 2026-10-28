// The prep page's timeline section, the pure half (screen/prep-timeline.ts):
// the phase and the screen lock, the late chips, the minute timer, a step's
// minutes and taps. The graph is prep-graph.test.ts.
// Run: scripts/t.sh tests/info/meals/screen/prep-timeline.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import {
  clockText,
  endsText,
  LATE_CHIPS,
  lateEvent,
  minutesText,
  msToNextMinute,
  prepPhase,
  stepActions,
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

test("before the start a step says its minutes, hands-on and waiting, and nothing can be tapped", () => {
  const v = view(null);
  expect(minutesText(v.steps[0]!)).toBe("10 min hands-on");
  expect(minutesText(v.steps.find((s) => s.id === "3")!)).toBe("5 min hands-on · wait 30 min");
  expect(v.steps.every((s) => stepActions(s, v, "before").length === 0)).toBe(true);
  expect(endsText(v, "before")).toBeNull();
});

test("while running the step under way can be finished or stretched, the next one started; once over, nothing", () => {
  const v = view(runOnStep2(), at(15));
  expect(stepActions(v.steps.find((s) => s.id === "2")!, v, "running")).toEqual(["done", "late"]);
  expect(stepActions(v.steps.find((s) => s.id === "1")!, v, "running")).toEqual([]);
  expect(stepActions(v.steps.find((s) => s.id === v.next)!, v, "running")).toEqual(["started"]);
  expect(endsText(v, "running")).toBe(`Ends ${clockText(v.endsAt!)}`);
  expect(v.steps.every((s) => stepActions(s, v, "finished").length === 0)).toBe(true);
  expect(endsText(v, "finished")).toBeNull();
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
