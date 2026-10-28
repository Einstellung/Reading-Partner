// A solved draft written as the stored plan (src/info/meals/planner/to-week.ts):
// the made meals at their solved grams, the old plan's days before today kept,
// and the draft solved again for a changed profile.
// Run: scripts/t.sh tests/info/meals/planner/to-week.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { computeTargets } from "../../../../src/info/meals/nutrition/targets";
import { MEAL_KEYS, type WeekPlan } from "../../../../src/info/meals/plan/types";
import { addDays } from "../../../../src/info/meals/plan/week";
import { resolvePlannerWeek, weekFromDraft } from "../../../../src/info/meals/planner/to-week";
import { checked, LIB } from "./card-fixture";
import { goodDraft, PROFILE, START } from "./fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("zh-CN");
});
afterEach(() => setLocale(before));

const planAt = (start: string, previous: WeekPlan | null = null, now = 9, today = start) =>
  weekFromDraft({ result: checked(), lib: LIB, start, now, today, previous });

test("a first plan is its draft's days, every meal made at its solved grams, the draft kept beside it", () => {
  const plan = planAt(START);
  expect(plan).toMatchObject({ id: `week-${START}`, startDate: START, createdAt: 9, revision: 1 });
  expect(plan.days.map((d) => d.date)).toEqual([START, addDays(START, 1), addDays(START, 2)]);
  expect(plan.planner).toEqual({ start: START, draft: checked().draft });
  for (const day of plan.days) {
    for (const key of ["breakfast", "lunch", "dinner"] as const) {
      const meal = day[key];
      expect(meal.mode).toBe("make");
      expect(meal.solved?.length).toBeGreaterThan(0);
      expect(meal.solved?.find((i) => i.role === "protein")?.grams).toBeGreaterThan(0);
      expect(meal.items).toEqual(meal.solved);
    }
  }
  // Day 3 is short of kcal, so the program's snack is stored as one made meal.
  expect(plan.days[2]!.snack.mode).toBe("make");
});

test("meals are named in the reader's language, a pot meal by its way", () => {
  const zh = planAt(START);
  expect(zh.days[0]!.lunch.name).toBe("宫保鸡丁");
  expect(zh.days[0]!.lunch.searchName).toBe("kung pao chicken");
  expect(zh.days[0]!.dinner.name).toBe("鸡丁豆子炖菜盖糙米饭配菠菜");
  setLocale("en");
  expect(planAt(START).days[0]!.lunch.name).toBe("Kung pao chicken");
});

test("applied on the day the new plan starts, the old plan's days before it stay and the rest are replaced", () => {
  const old = planAt(addDays(START, -2), null, 1);
  const plan = planAt(START, old);
  expect(plan.id).toBe(old.id);
  expect(plan.startDate).toBe(addDays(START, -2));
  expect(plan.days.map((d) => d.date)).toEqual([0, 1, 2, 3, 4].map((i) => addDays(START, i - 2)));
  expect(plan.days.slice(0, 2)).toEqual(old.days.slice(0, 2));
  expect(plan.days[2]).toEqual(planAt(START).days[0]);
  expect(plan.revision).toBe(old.revision + 1);
  expect(plan.planner?.start).toBe(START);
});

test("an old plan that ended before yesterday is replaced whole", () => {
  const old = planAt(addDays(START, -5), null, 1);
  const plan = planAt(START, old);
  expect(plan.id).toBe(`week-${START}`);
  expect(plan.startDate).toBe(START);
  expect(plan.days).toHaveLength(3);
});

test("a solved draft is required", () => {
  expect(() => weekFromDraft({ result: { ...checked(), plan: null }, lib: LIB, start: START, now: 0, today: START, previous: null })).toThrow();
});

test("a changed profile solves the draft again and keeps the meals that went differently", () => {
  const plan = planAt(START);
  plan.days[1]!.lunch = { mode: "out", place: "canteen" };
  const heavier = { ...PROFILE, weightKg: 80 };
  const again = resolvePlannerWeek(plan, heavier, computeTargets(heavier, "other"));
  expect(again.days.map((d) => d.date)).toEqual(plan.days.map((d) => d.date));
  expect(again.days[1]!.lunch).toEqual({ mode: "out", place: "canteen" });
  const grams = (p: WeekPlan) =>
    p.days.flatMap((d) => MEAL_KEYS.flatMap((k) => (d[k].solved ?? []).map((i) => i.grams))).reduce((a, b) => a + b, 0);
  expect(grams(again)).toBeGreaterThan(grams(plan));
  expect(again.planner).toEqual(plan.planner);
});

test("a plan without a draft, or a draft that no longer solves, comes back as it was", () => {
  const plan = planAt(START);
  const { planner: _drop, ...older } = plan;
  expect(resolvePlannerWeek(older, PROFILE, computeTargets(PROFILE, "other"))).toBe(older);
  // Day 3's lunch is pork; a reader who stops eating pork gets the next plan from other dishes.
  const noPork = { ...PROFILE, dislikes: ["pork"] };
  expect(goodDraft().days[2]!.lunch.main).toEqual({ dish: "green_pepper_pork_strips", staple: "steamed_sweet_potato" });
  expect(resolvePlannerWeek(plan, noPork, computeTargets(noPork, "other"))).toBe(plan);
});
