// The prep timeline's pure half (src/info/meals/timeline): the step reader,
// the scheduler, the running state and what the screen and the voice read.
// Run: scripts/t.sh tests/info/meals/timeline

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { prepMinutes } from "../../../../src/info/meals/planner/prep";
import { planRun, reschedule, startRun, statusesAt } from "../../../../src/info/meals/timeline/run";
import { schedule, type Kitchen } from "../../../../src/info/meals/timeline/schedule";
import { isStepList, PACK_STEP_ID, readPrepSteps, renumber, withPackStep, type PrepStep } from "../../../../src/info/meals/timeline/steps";
import { sayLeft, sayNext, sayNow, timelineMinutes, timelineView } from "../../../../src/info/meals/timeline/view";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

const TWO: Kitchen = { burners: 2 };
const step = (id: string, device: PrepStep["device"], active: number, wait: number, after: string[] = [], pot: string | null = null): PrepStep => ({
  id,
  text: `step ${id} text`,
  device,
  pot,
  active,
  wait,
  after,
});

// A: pressure cooker 10 hands then 30 on its own; B: stove 15 hands; C: counter 5, after both.
const KITCHEN_STEPS = [step("1", "pressure_cooker", 10, 30), step("2", "stove", 15, 0), step("3", "counter", 5, 0, ["1", "2"])];

// --- steps ---------------------------------------------------------------------

const CTX = { devices: new Set(["stove", "pressure_cooker"]), pots: new Set(["chili"]) };
const reply = (steps: unknown[]) => ({ steps });

test("a good reply is read, with the leading number stripped", () => {
  const r = readPrepSteps(reply([{ id: 1, text: "1. Brown the beef", device: "Stove", pot: "chili", active: 10, wait: 5 }]), CTX);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value[0]).toEqual({ id: "1", text: "Brown the beef", device: "stove", pot: "chili", active: 10, wait: 5, after: [] });
});

test("a reply is refused whole when one step does not hold", () => {
  const ok = { id: "1", text: "Brown", device: "stove", pot: "chili", active: 10 };
  expect(readPrepSteps(reply([{ ...ok, device: "oven" }]), CTX).ok).toBe(false);
  expect(readPrepSteps(reply([{ ...ok, pot: "soup" }]), CTX).ok).toBe(false);
  expect(readPrepSteps(reply([{ ...ok, active: 0, wait: 0 }]), CTX).ok).toBe(false);
  expect(readPrepSteps(reply([{ ...ok, active: 500 }]), CTX).ok).toBe(false);
  expect(readPrepSteps(reply([{ ...ok, id: PACK_STEP_ID }]), CTX).ok).toBe(false);
  expect(readPrepSteps(reply([ok, { ...ok, id: "2", pot: null, after: ["3"] }]), CTX).ok).toBe(false);
  expect(readPrepSteps(reply([{ ...ok, after: ["2"] }, { ...ok, id: "2", after: ["1"] }]), CTX).ok).toBe(false);
  expect(readPrepSteps(reply([{ ...ok, pot: null }]), CTX).ok).toBe(false);
  expect(readPrepSteps("steps", CTX).ok).toBe(false);
});

test("renumbering follows the given order and carries the dependencies", () => {
  const out = renumber([step("a", "stove", 5, 0), step("b", "counter", 5, 0, ["a"])], ["b", "a"]);
  const by = (text: string) => out.find((s) => s.text === text)!;
  expect([by("step a text").id, by("step b text").id, by("step b text").after]).toEqual(["2", "1", ["2"]]);
  expect(isStepList(out)).toBe(true);
  expect(isStepList([{ id: "1" }])).toBe(false);
});

// --- schedule ------------------------------------------------------------------

test("hands never overlap, and a waiting step frees them", () => {
  const plan = schedule(KITCHEN_STEPS, TWO);
  expect([plan.placements["1"]!.start, plan.placements["2"]!.start, plan.placements["3"]!.start]).toEqual([0, 10, 40]);
  expect(plan.totalMin).toBe(45);
  expect(plan.activeMin).toBe(30);
  expect(plan.order).toEqual(["1", "2", "3"]);
});

test("the stove holds as many pots as there are burners, a device one", () => {
  const three = [step("1", "stove", 5, 20), step("2", "stove", 5, 20), step("3", "stove", 5, 20)];
  expect(schedule(three, TWO).placements["3"]!.start).toBe(25);
  expect(schedule(three, { burners: 3 }).placements["3"]!.start).toBe(10);
  const ovens = [step("1", "oven", 5, 20), step("2", "oven", 5, 20)];
  expect(schedule(ovens, TWO).placements["2"]!.start).toBe(25);
  expect(schedule(ovens, TWO).lanes.filter((l) => l.device === "oven")).toHaveLength(1);
});

test("the ready step with the longest chain goes first", () => {
  const plan = schedule([step("1", "counter", 5, 0), step("2", "pressure_cooker", 5, 40)], TWO);
  expect(plan.order[0]).toBe("2");
});

test("the coarse estimate is the scheduler over one step per pot", () => {
  expect(prepMinutes([])).toEqual({ activeMin: 0, totalMin: 0 });
  expect(prepMinutes([{ activeMin: 10, totalMin: 70 }, { activeMin: 15, totalMin: 120 }])).toEqual({ activeMin: 25, totalMin: 120 });
  // Two pots in the one oven no longer overlap.
  expect(prepMinutes([
    { activeMin: 10, totalMin: 40, equipment: ["oven"] },
    { activeMin: 10, totalMin: 40, equipment: ["oven"] },
  ])).toEqual({ activeMin: 20, totalMin: 80 });
});

test("written steps' minutes include the packing step", () => {
  expect(timelineMinutes(KITCHEN_STEPS, TWO)).toEqual({ activeMin: 40, totalMin: 55 });
});

// --- run -----------------------------------------------------------------------

const STEPS = withPackStep(KITCHEN_STEPS);
const T0 = Date.UTC(2026, 9, 25, 14, 0);

test("a hands-on part running over is not taken as done", () => {
  const run = reschedule(STEPS, TWO, startRun("k", T0), { step: "1", event: "started" }, 0).run;
  const at = 20;
  const plan = planRun(STEPS, TWO, run, at);
  expect(statusesAt(STEPS, run, plan, at)["1"]).toBe("doing");
  expect(plan.placements["2"]!.start).toBeGreaterThanOrEqual(20);
});

test("done ends the hands-on part and times the waiting from then", () => {
  let run = reschedule(STEPS, TWO, startRun("k", T0), { step: "1", event: "started" }, 0).run;
  const r = reschedule(STEPS, TWO, run, { step: "1", event: "done" }, 12);
  expect(r.applied).toBe(true);
  run = r.run;
  expect(run.steps["1"]).toEqual({ started: 0, handsDone: 12 });
  expect(r.timeline.placements["1"]!.end).toBe(42);
  expect(r.timeline.placements["2"]!.start).toBe(12);
  const at = 30;
  expect(statusesAt(STEPS, run, planRun(STEPS, TWO, run, at), at)["1"]).toBe("waiting");
});

test("more adds minutes to the part under way", () => {
  let run = startRun("k", T0);
  run = reschedule(STEPS, TWO, run, { step: "1", event: "done" }, 10).run;
  run = reschedule(STEPS, TWO, run, { step: "2", event: "done" }, 25).run;
  const r = reschedule(STEPS, TWO, run, { step: "1", event: "more" }, 40);
  expect(r.run.steps["1"]!.waitUntil).toBe(45);
  expect(r.timeline.placements["1"]!.end).toBe(45);
  expect(r.timeline.placements["3"]!.start).toBe(45);
});

test("a hands-on step nobody said is done waits for the reader, not the plan", () => {
  const run = reschedule(STEPS, TWO, startRun("k", T0), { step: "1", event: "done" }, 10).run;
  expect(planRun(STEPS, TWO, run, 40).placements["2"]!.start).toBe(40);
});

test("an event on no step or on a finished one changes nothing", () => {
  const run = startRun("k", T0);
  expect(reschedule(STEPS, TWO, run, { step: "9", event: "done" }, 1).applied).toBe(false);
  const done = reschedule(STEPS, TWO, run, { step: "2", event: "done" }, 5).run;
  const again = reschedule(STEPS, TWO, done, { step: "2", event: "done" }, 6);
  expect(again.applied).toBe(false);
  expect(again.run).toBe(done);
});

test("starting a step closes the steps it waits for", () => {
  const r = reschedule(STEPS, TWO, startRun("k", T0), { step: "3", event: "started" }, 30);
  expect(r.run.steps["1"]!.done).toBeDefined();
  expect(r.run.steps["2"]!.done).toBeDefined();
  expect(r.timeline.placements["3"]!.start).toBe(30);
});

// --- view and spoken -----------------------------------------------------------

test("before the start there are minutes and no clock times", () => {
  const v = timelineView({ steps: KITCHEN_STEPS, kitchen: TWO, boxes: true, run: null, now: T0 });
  expect(v.started).toBe(false);
  expect(v.endsAt).toBeNull();
  expect(v.steps.every((s) => s.startAt === null)).toBe(true);
  const last = v.steps[v.steps.length - 1]!;
  expect([last.id, last.n, last.program]).toEqual([PACK_STEP_ID, 4, true]);
  expect(last.text.length).toBeGreaterThan(0);
  expect(v.lanes[0]!.device).toBe("counter");
  expect(sayLeft(v)).toContain("55");
  expect(sayNext(v)).toContain("step 1 text");
});

test("after the start every step has a clock time off the start", () => {
  const run = startRun("k", T0);
  const v = timelineView({ steps: KITCHEN_STEPS, kitchen: TWO, boxes: false, run, now: T0 + 3 * 60_000 });
  expect(v.minute).toBe(3);
  const second = v.steps.find((s) => s.id === "2")!;
  expect(second.startAt).toBe(T0 + second.start * 60_000);
  expect(v.endsAt).toBe(T0 + v.totalMin * 60_000);
  expect(v.current).toBe("1");
  expect(sayNow(v)).toContain("step 1 text");
});
