// The prep page's Done (src/info/meals/apply.ts markPrepDone): one field on the
// stored plan, the batch-cook entry moved on, and nothing written without a
// planner plan.
// Run: scripts/t.sh tests/info/meals/prep-done.test.ts

import { expect, test } from "bun:test";
import { markPrepDone, type MealsPorts } from "../../../src/info/meals/apply";
import type { MealsState, WeekPlan } from "../../../src/info/meals/plan/types";
import { batchCookEntry } from "../../../src/info/meals/screen/batch-cook";
import { state as weekState } from "./fixtures/week";
import { plannerState, START } from "./screen/batch-cook-fixture";

function harness(current: MealsState, fail = false) {
  const saved: WeekPlan[] = [];
  let reloads = 0;
  const ports: MealsPorts = {
    current: async () => current,
    saveCharter: async () => {},
    savePlan: async (plan) => {
      if (fail) throw new Error("no");
      saved.push(plan);
    },
    saveShopping: async () => {},
    saveMealMethod: async () => {},
    saveDeviation: async () => {},
    region: () => "other",
    now: () => 700,
    today: () => START,
    changed: () => {
      reloads += 1;
    },
  };
  return { ports, saved, reloads: () => reloads };
}

test("Done stores when, bumps the revision, keeps the days, and the entry moves on", async () => {
  const s = plannerState();
  const h = harness(s);
  expect(await markPrepDone(h.ports)).toBe(true);
  expect(h.saved).toHaveLength(1);
  const plan = h.saved[0]!;
  expect(plan.planner?.preppedAt).toBe(700);
  expect(plan.planner?.draft).toEqual(s.plan!.planner!.draft);
  expect(plan.revision).toBe(s.plan!.revision + 1);
  expect(plan.days).toEqual(s.plan!.days);
  expect(h.reloads()).toBe(1);
  expect(batchCookEntry({ ...s, plan }, START, 9)?.kind).toBe("next");
});

test("no planner plan, or a failed write: nothing is marked and the screen is not reloaded", async () => {
  const old = harness(weekState());
  expect(await markPrepDone(old.ports)).toBe(false);
  expect(old.saved).toEqual([]);

  const failing = harness(plannerState(), true);
  expect(await markPrepDone(failing.ports)).toBe(false);
  expect(failing.reloads()).toBe(0);
});
