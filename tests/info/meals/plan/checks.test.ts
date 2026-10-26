// The fish count the week summary shows (src/info/meals/plan/checks.ts), and a
// stored week's fruit staple as the weekly solver reads it.
// Run: scripts/t.sh tests/info/meals/plan/checks.test.ts

import { expect, test } from "bun:test";
import { fishMeals } from "../../../../src/info/meals/plan/checks";
import { solvePlan, targetsOf } from "../../../../src/info/meals/plan/solve-week";
import type { Meal, WeekPlan } from "../../../../src/info/meals/plan/types";
import { MEAL_KEYS } from "../../../../src/info/meals/plan/types";
import { charter, draftWeek, eggToast, profile, shrimpRice } from "../fixtures/week";

const targets = targetsOf(charter(), "other")!;

function withMeal(plan: WeekPlan, dayIndex: number, key: "breakfast" | "lunch" | "dinner" | "snack", meal: Meal): WeekPlan {
  return { ...plan, days: plan.days.map((d, i) => (i === dayIndex ? { ...d, [key]: meal } : d)) };
}

test("fish and seafood meals are counted across the week, made meals only", () => {
  let plan = draftWeek();
  for (let i = 0; i < plan.days.length; i++) {
    const d = plan.days[i]!;
    for (const key of MEAL_KEYS) {
      if (d[key].mode === "make" && fishMeals({ ...plan, days: [d] }) > 0) {
        plan = withMeal(plan, i, key, key === "breakfast" ? eggToast() : { mode: "out", place: "canteen" });
      }
    }
  }
  expect(fishMeals(plan)).toBe(0);
  plan = withMeal(plan, 0, "lunch", shrimpRice());
  expect(fishMeals(plan)).toBe(1);
  plan = withMeal(plan, 1, "lunch", { mode: "out", place: "sushi" });
  expect(fishMeals(plan)).toBe(1);
});

test("a stored week's fruit staple is solved as 200 g of fixed fruit", () => {
  const stored = withMeal(draftWeek(), 1, "snack", {
    mode: "make",
    name: "测试",
    searchName: "test dish",
    flavour: "sweet",
    minutes: 10,
    method: "Assemble.",
    items: [
      { foodId: "greek_yogurt", role: "protein" },
      { foodId: "orange", role: "staple" },
    ],
  });
  expect(solvePlan(stored, targets, profile()).days[1]?.snack.solved).toEqual([
    { foodId: "greek_yogurt", role: "protein", grams: 100 },
    { foodId: "orange", role: "fixed", grams: 200 },
  ]);
});
