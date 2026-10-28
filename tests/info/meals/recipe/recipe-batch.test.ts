// A planner plan's batch meals on the recipe page (docs/671 做法页): the prep
// session cooks the pot, so every batch meal's recipe takes its box and heats
// it, the request keyed on that pot; the sweep asks under the page's key; the
// week's old pots are read as before.
// Run: scripts/t.sh tests/info/meals/recipe/recipe-batch.test.ts

import { expect, test } from "bun:test";
import { potPortions, refKey } from "../../../../src/info/meals/plan/pots";
import { targetsOf } from "../../../../src/info/meals/plan/solve-week";
import type { MealsState } from "../../../../src/info/meals/plan/types";
import { addDays } from "../../../../src/info/meals/plan/week";
import { recipeKey, recipeRequest, recipeUserText, type RecipeRequest } from "../../../../src/info/meals/recipe/recipe";
import { recipesToWrite } from "../../../../src/info/meals/recipe/recipe-sweep";
import { dayViewOn, mealPortions, mealsView, type MealView } from "../../../../src/info/meals/screen/view";
import { eveningBefore, plannerState, START } from "../screen/batch-cook-fixture";
import { potWeek, state as weekState } from "../fixtures/week";

const REGION = "other" as const;

function meal(state: MealsState, date: string, key: MealView["key"]): MealView {
  const view = dayViewOn(state, date, START, REGION)?.meals.find((m) => m.key === key);
  if (!view) throw new Error(`no ${key} on ${date}`);
  return view;
}

function request(state: MealsState, view: MealView): RecipeRequest {
  const r = recipeRequest(view, state.charter!.profile, "en");
  if (!r) throw new Error("no request");
  return r;
}

// The good draft's chili pot: eaten Day 1 dinner and Day 2 lunch.
const DINNER_1 = { date: START, key: "dinner" as const };
const LUNCH_2 = { date: addDays(START, 1), key: "lunch" as const };

test("a batch meal eats a box of the pot the prep session cooked", () => {
  const state = plannerState({ draft: eveningBefore() });
  for (const at of [DINNER_1, LUNCH_2]) {
    const view = meal(state, at.date, at.key);
    const r = request(state, view);
    expect(r.pot).toMatchObject({ cooks: false, storage: "fridge", count: 2 });
    expect(r.pot!.rawG).toBeGreaterThan(0);
    expect(recipeUserText(r)).toContain("This meal eats one box from a pot cooked earlier");
    expect(recipeUserText(r)).not.toContain("This meal cooks a pot");
    // The old request had no pot: the key is a new one.
    expect(r.key).not.toBe(recipeKey(r.name, r.rows, r.kitchen, r.language, null));
    // The day card keeps the food's name: the meal's grams are its share already.
    expect(view.rows.every((row) => row.potLabel === null)).toBe(true);
  }
});

test("both meals of a batch name the same pot", () => {
  const state = plannerState({ draft: eveningBefore() });
  const a = request(state, meal(state, DINNER_1.date, DINNER_1.key)).pot!;
  const b = request(state, meal(state, LUNCH_2.date, LUNCH_2.key)).pot!;
  expect(b).toEqual(a);
});

test("a batch meal on the session's own day takes its share from the pot", () => {
  // The good draft cooks on Day 1 afternoon; Day 1 dinner eats from it that evening.
  const state = plannerState();
  const r = request(state, meal(state, DINNER_1.date, DINNER_1.key));
  expect(r.pot).toMatchObject({ cooks: false, storage: "fresh" });
  expect(recipeUserText(r)).toContain("cooked earlier today");
  expect(request(state, meal(state, LUNCH_2.date, LUNCH_2.key)).pot).toMatchObject({ cooks: false, storage: "fridge" });
});

test("a meal cooked fresh has no pot", () => {
  const state = plannerState({ draft: eveningBefore() });
  const portions = mealPortions(state.plan, state.charter!.profile, targetsOf(state.charter, REGION));
  const fresh = state.plan!.days.flatMap((d) =>
    (["breakfast", "lunch", "dinner"] as const).flatMap((k) => (d[k].mode === "make" && !portions.has(refKey({ date: d.date, meal: k })) ? [{ date: d.date, key: k }] : [])),
  );
  expect(fresh.length).toBeGreaterThan(0);
  for (const at of fresh) {
    const view = meal(state, at.date, at.key);
    expect(view.pot).toBeNull();
    const r = recipeRequest(view, state.charter!.profile, "en");
    if (r) expect(r.pot).toBeNull();
  }
});

test("the sweep asks under the page's key", () => {
  const state = plannerState({ draft: eveningBefore() });
  const page = request(state, meal(state, LUNCH_2.date, LUNCH_2.key));
  const swept = recipesToWrite(state, { today: START, region: REGION, language: "en", stored: new Set(), limit: 50 });
  expect(swept.find((r) => r.name === page.name && r.pot)?.key).toBe(page.key);
  // The screen's week reads the same shares.
  const week = mealsView(state, START, REGION).week.find((d) => d.date === LUNCH_2.date);
  expect(week?.meals.find((m) => m.key === "lunch")?.pot).toEqual(meal(state, LUNCH_2.date, LUNCH_2.key).pot);
});

test("a week with the old pots reads them as before", () => {
  const s = weekState({ plan: potWeek() });
  const plan = s.plan!;
  const old = potPortions(plan);
  expect(old.size).toBeGreaterThan(0);
  expect(mealPortions(plan, s.charter!.profile, targetsOf(s.charter, REGION))).toEqual(old);
  for (const [key, portion] of old) {
    const [date, k] = key.split("|") as [string, MealView["key"]];
    const view = dayViewOn(s, date, plan.startDate, REGION)?.meals.find((m) => m.key === k);
    expect(view?.pot).toEqual(portion);
    expect(portion.batch).toBeUndefined();
  }
});
