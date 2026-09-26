// The rules a drafted week is held to (docs/73 每顿怎么搭), and the grams it
// comes back with. Run: scripts/t.sh tests/info/meals/plan/checks.test.ts

import { expect, test } from "bun:test";
import { checkPlan, fishMeals } from "../../../../src/info/meals/plan/checks";
import { targetsOf } from "../../../../src/info/meals/plan/solve-week";
import type { Meal, WeekPlan } from "../../../../src/info/meals/plan/types";
import { MEAL_KEYS } from "../../../../src/info/meals/plan/types";
import { charter, draftWeek, eggToast, MON, profile, shrimpRice } from "../fixtures/week";

const targets = targetsOf(charter(), "other")!;

function withMeal(plan: WeekPlan, dayIndex: number, key: "breakfast" | "lunch" | "dinner" | "snack", meal: Meal): WeekPlan {
  return { ...plan, days: plan.days.map((d, i) => (i === dayIndex ? { ...d, [key]: meal } : d)) };
}

test("the fixture week passes and every made meal comes back with grams", () => {
  const { plan, problems } = checkPlan({ plan: draftWeek(), profile: profile(), targets });
  expect(problems).toEqual([]);
  for (const day of plan.days) {
    for (const key of MEAL_KEYS) {
      const meal = day[key];
      if (meal.mode !== "make") continue;
      expect(meal.solved?.length).toBeGreaterThan(0);
      expect(meal.solved?.every((r) => r.grams > 0)).toBe(true);
    }
  }
});

test("a food the table does not have is named back, and nothing is solved", () => {
  const bad = { ...shrimpRice(), items: [...(shrimpRice().items ?? []), { foodId: "dragon_meat", role: "fixed" as const, grams: 50 }] };
  const { plan, problems } = checkPlan({ plan: withMeal(draftWeek(), 1, "lunch", bad), profile: profile(), targets });
  expect(problems).toEqual(['Day 2 lunch: "dragon_meat" is not in the food table. Use ids from the list only.']);
  expect(plan.days[0]?.lunch.solved).toBeUndefined();
});

test("a template the solver cannot take is refused in words", () => {
  const two = { ...eggToast(), items: [{ foodId: "egg", role: "protein" as const }, { foodId: "tofu_skin", role: "protein" as const }, { foodId: "oats", role: "staple" as const }] };
  const { problems } = checkPlan({ plan: withMeal(draftWeek(), 1, "breakfast", two), profile: profile(), targets });
  expect(problems).toContain("Day 2 breakfast needs exactly one protein item; it has 2.");
});

test("minutes over the reader's limit, and a disliked food, come back", () => {
  const slow = { ...shrimpRice(), minutes: 25 };
  const { problems } = checkPlan({
    plan: withMeal(draftWeek(), 1, "lunch", slow),
    profile: profile({ dislikes: ["poultry"] }),
    targets,
  });
  expect(problems).toContain("Day 2 lunch takes 25 minutes; they allow 10.");
  expect(problems.filter((p) => p.includes("ready_chicken_breast, which they do not eat"))).toHaveLength(3);
});

test("two main meals in a row with one flavour are refused, across the night too", () => {
  const plan = withMeal(draftWeek(), 1, "breakfast", { ...eggToast(), flavour: "teriyaki" });
  const { problems } = checkPlan({ plan, profile: profile(), targets });
  expect(problems).toEqual(["Day 1 dinner and Day 2 breakfast are both teriyaki; change one."]);
});

test("a protein food that cannot reach the meal's target is sent back", () => {
  const thin: Meal = { ...shrimpRice(), items: [{ foodId: "quail_egg", role: "protein" }, { foodId: "rice_noodles_dry", role: "staple" }] };
  const { problems } = checkPlan({ plan: withMeal(draftWeek(), 1, "dinner", thin), profile: profile(), targets });
  expect(problems.length).toBe(1);
  expect(problems[0]).toStartWith("Day 2 dinner: protein reaches only");
});

test("fish at least twice, unless an adjustment inherited fewer", () => {
  let plan = draftWeek();
  for (let i = 0; i < 7; i++) {
    const d = plan.days[i]!;
    for (const key of MEAL_KEYS) {
      if (d[key].mode === "make" && fishMeals({ ...plan, days: [d] }) > 0) {
        plan = withMeal(plan, i, key, key === "breakfast" ? eggToast() : { mode: "out", place: "canteen" });
      }
    }
  }
  plan = withMeal(plan, 0, "lunch", shrimpRice());
  expect(fishMeals(plan)).toBe(1);
  const fresh = checkPlan({ plan, profile: profile(), targets });
  expect(fresh.problems).toContain("The week has 1 fish or seafood meal; it needs at least two.");
  const adjusted = checkPlan({
    plan,
    profile: profile(),
    targets,
    changed: [{ date: MON, meal: "lunch" }],
    previous: plan,
  });
  expect(adjusted.problems).toEqual([]);
  expect(checkPlan({ plan, profile: profile({ dislikes: ["seafood"] }), targets, changed: [] }).problems).toEqual([]);
});
