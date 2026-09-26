// What the meals screen reads off the state (src/info/meals/screen/view.ts): the
// words, the targets card, a day's four meals in eating order with every food
// at its solved grams, and which days are ahead.
// Run: scripts/t.sh tests/info/meals/screen/view.test.ts

import { expect, test } from "bun:test";
import {
  categoryLabel,
  dayViewOn,
  dayWord,
  dishThumbnails,
  keepsLabel,
  mealLabel,
  mealName,
  mealsView,
  modeWord,
  shoppingNote,
  targetsSummary,
  weekdayName,
} from "../../../../src/info/meals/screen/view";
import type { TemplateItem } from "../../../../src/info/meals/nutrition/solve";
import { computeTargets } from "../../../../src/info/meals/nutrition/targets";
import type { ShoppingItem } from "../../../../src/info/meals/plan/types";
import { solvePlan, targetsOf } from "../../../../src/info/meals/plan/solve-week";
import { MON, charter, draftWeek, profile, state } from "../fixtures/week";

test("every mode has a plain word and none of them apologises", () => {
  expect(modeWord("make")).toBe("Make");
  expect(modeWord("out")).toBe("Eat out");
  expect(modeWord("delivery")).toBe("Delivery");
  expect(modeWord("bought")).toBe("Bought");
  expect(modeWord("skip")).toBe("Skip");
  expect(mealLabel("breakfast")).toBe("Breakfast");
  expect(mealLabel("snack")).toBe("Snack");
  expect(keepsLabel("d1-2")).toBe("1–2 days");
  expect(categoryLabel("produce")).toBe("Produce");
});

test("a shopping row's second line is how it keeps, never its quantity", () => {
  const item: ShoppingItem = {
    name: "三文鱼",
    en: "salmon",
    qty: "500 g",
    category: "protein",
    keeps: "d1-2",
    freezeOnArrival: true,
    neededBy: MON,
  };
  expect(shoppingNote(item)).toBe("1–2 days · freeze on arrival");
  expect(shoppingNote({ ...item, freezeOnArrival: false })).toBe("1–2 days");
  // The quantity is set on the right of the row instead, so it must not also
  // be in the line under the name.
  expect(shoppingNote(item)).not.toContain("500 g");
});

test("a date is Today, Tomorrow, or its weekday", () => {
  expect(weekdayName(MON)).toBe("Monday");
  expect(dayWord(MON, MON)).toBe("Today");
  expect(dayWord("2026-09-22", MON)).toBe("Tomorrow");
  expect(dayWord("2026-09-23", MON)).toBe("Wednesday");
});

test("a made meal's totals are its rows added up, and a day's are its meals", () => {
  const day = dayViewOn(state(), MON, MON, "other")!;
  expect(day.word).toBe("Today");
  const made = day.meals.filter((m) => m.mode === "make");
  expect(made).toHaveLength(4);
  for (const m of made) {
    expect(m.rows.length).toBe(m.meal.solved!.length);
    expect(m.rows.map((r) => r.grams)).toEqual(m.meal.solved!.map((s) => s.grams));
    expect(m.totals!.kcal).toBeCloseTo(m.rows.reduce((s, r) => s + r.kcal, 0), 6);
    expect(m.totals!.protein).toBeCloseTo(m.rows.reduce((s, r) => s + r.protein, 0), 6);
    expect(m.cells).not.toBeNull();
  }
  expect(day.totals.kcal).toBeCloseTo(made.reduce((s, m) => s + m.totals!.kcal, 0), 6);
  expect(day.totals.protein).toBeCloseTo(made.reduce((s, m) => s + m.totals!.protein, 0), 6);
});

test("a row shows the food table's name, and an egg in whole eggs", () => {
  const tue = dayViewOn(state(), "2026-09-22", MON, "other")!;
  const breakfast = tue.meals.find((m) => m.key === "breakfast")!;
  const egg = breakfast.rows.find((r) => r.foodId === "egg")!;
  expect(egg.name).toBe("鸡蛋");
  expect(egg.units).toBe(`${egg.grams / 50} 个`);
  expect(breakfast.rows.find((r) => r.foodId === "cherry_tomato")!.units).toBeNull();
  expect(mealName(breakfast)).toBe("鸡蛋全麦吐司 · 原味");
});

test("a meal that is not made has no grams, and shows its place", () => {
  const wed = dayViewOn(state(), "2026-09-23", MON, "other")!;
  const dinner = wed.meals.find((m) => m.key === "dinner")!;
  expect(dinner.word).toBe("Delivery");
  expect(dinner.name).toBe("the usual place");
  expect(dinner.totals).toBeNull();
  expect(dinner.rows).toEqual([]);
  expect(mealName(dinner)).toBe("the usual place");
});

test("a training day has the training targets and a post-workout meal; a rest day has neither", () => {
  const s = state();
  const targets = targetsOf(s.charter, "other")!;
  const mon = dayViewOn(s, MON, MON, "other")!;
  expect(mon.training).toBe(true);
  expect(mon.kindLabel).toBe("Training day");
  expect(mon.targets!.kcal).toBe(targets.training.kcal);
  // Evening training: dinner is the meal after it, and the snack comes before.
  expect(mon.meals.map((m) => m.key)).toEqual(["breakfast", "lunch", "snack", "dinner"]);
  expect(mon.meals.filter((m) => m.postWorkout).map((m) => m.key)).toEqual(["dinner"]);
  expect(mon.meals.find((m) => m.key === "dinner")!.target).toEqual(targets.training.meals.dinner);

  const tue = dayViewOn(s, "2026-09-22", MON, "other")!;
  expect(tue.training).toBe(false);
  expect(tue.kindLabel).toBe("Rest day");
  expect(tue.targets!.kcal).toBe(targets.rest.kcal);
  expect(tue.meals.some((m) => m.postWorkout)).toBe(false);
  expect(targets.training.kcal).toBeGreaterThan(targets.rest.kcal);
});

test("morning training eats the snack first and makes breakfast the meal after it", () => {
  const c = charter({ trainTime: "morning" });
  const plan = solvePlan(draftWeek(), targetsOf(c, "other")!, c.profile);
  const mon = dayViewOn(state({ charter: c, plan }), MON, MON, "other")!;
  expect(mon.meals.map((m) => m.key)).toEqual(["snack", "breakfast", "lunch", "dinner"]);
  expect(mon.meals.find((m) => m.postWorkout)?.key).toBe("breakfast");
});

test("a day by its date, and nothing outside the week or without one", () => {
  expect(dayViewOn(state(), "2026-10-01", MON, "other")).toBeNull();
  expect(dayViewOn(state({ plan: null }), MON, MON, "other")).toBeNull();
});

test("no charter, or body data withheld, draws the meals without targets or grams", () => {
  const none = mealsView(state({ charter: null }), MON, "other");
  expect(none.targets).toBeNull();
  expect(none.summary).toBeNull();
  const mon = none.week[0]!;
  expect(mon.targets).toBeNull();
  expect(mon.meals.every((m) => m.totals === null)).toBe(true);
  expect(mealsView(state({ charter: charter({ consent: "no" }) }), MON, "other").targets).toBeNull();
});

test("a day already eaten leaves the screen: today and tomorrow lead, the rest follow", () => {
  const view = mealsView(state(), MON, "other");
  expect(view.week).toHaveLength(7);
  expect(view.headline.map((d) => d.date)).toEqual([MON, "2026-09-22"]);
  expect(view.later).toHaveLength(5);
  expect(view.exhausted).toBe(false);
  expect(mealsView(state(), "2026-09-25", "other").upcoming).toHaveLength(3);
  const empty = mealsView(state({ plan: null }), MON, "other");
  expect(empty.upcoming).toEqual([]);
  expect(empty.exhausted).toBe(true);
  expect(empty.weekSummary).toBeNull();
  expect(mealsView(state(), "2026-09-28", "other").exhausted).toBe(true);
});

test("the week in one line counts the made meals and the fish", () => {
  const summary = mealsView(state(), MON, "other").weekSummary!;
  // 28 meals less the delivery, the bought breakfast and two skips.
  expect(summary.madeMeals).toBe(24);
  // Salmon three dinners, tuna two lunches, and the four shrimp meals as seafood.
  expect(summary.fishMeals).toBe(9);
  expect(summary.averageKcal).toBeGreaterThan(0);
});

test("the targets card has both kinds of day and says where the week sits against maintenance", () => {
  const p = profile({ goal: "cut" });
  const t = computeTargets(p, "other");
  const card = targetsSummary(t, p);
  expect(card.goal).toBe("Lose fat");
  expect(card.columns.map((c) => [c.kind, c.kcal, c.protein])).toEqual([
    ["training", t.training.kcal, t.protein],
    ["rest", t.rest.kcal, t.protein],
  ]);
  expect(card.line).toContain("under maintenance");
  // Never training has no training column.
  const rest = profile({ trainingDays: [] });
  expect(targetsSummary(computeTargets(rest, "other"), rest).columns.map((c) => c.kind)).toEqual(["rest"]);
  // Building muscle at an overweight BMI is warned about.
  const heavy = profile({ goal: "gain", weightKg: 80 });
  expect(targetsSummary(computeTargets(heavy, "other"), heavy).warning).toContain("overweight");
});

test("a meal with no photograph is drawn from its foods: protein, staple and produce before oil and sauce", () => {
  const items: TemplateItem[] = [
    { foodId: "olive_oil", role: "fat" },
    { foodId: "light_soy_sauce", role: "fixed", grams: 15 },
    { foodId: "salmon", role: "protein" },
    { foodId: "bok_choy", role: "fixed", grams: 150 },
  ];
  const resolve = (en: string) => (en ? `${en}.png` : null);
  expect(dishThumbnails(items, resolve)).toEqual(["salmon.png", "bok choy.png", "olive oil.png", "soy sauce.png"]);
  // A food no bank has a picture of is skipped, not drawn as a gap.
  expect(dishThumbnails(items, (en) => (en === "salmon" ? "salmon.png" : null))).toEqual(["salmon.png"]);
  expect(dishThumbnails(undefined)).toEqual([]);
});

test("a strip is four cut-outs at most, the jars last and the repeats gone", () => {
  const items: TemplateItem[] = [
    { foodId: "teriyaki_sauce", role: "fixed", grams: 20 },
    { foodId: "olive_oil", role: "fat" },
    { foodId: "salmon", role: "protein" },
    { foodId: "microwave_grain_rice", role: "staple" },
    { foodId: "bok_choy", role: "fixed", grams: 100 },
    // The same cut-out as the bok choy, under the other name.
    { foodId: "romaine", role: "fixed", grams: 50 },
    { foodId: "cucumber", role: "fixed", grams: 50 },
    { foodId: "no_such_food", role: "fixed", grams: 50 },
  ];
  const resolve = (en: string) => (en === "lettuce" ? "bok choy.png" : en ? `${en}.png` : null);
  expect(dishThumbnails(items, resolve)).toEqual(["salmon.png", "rice.png", "bok choy.png", "cucumber.png"]);
});
