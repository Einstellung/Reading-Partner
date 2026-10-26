// The week's pots (src/info/meals/plan/pots.ts) and what the rest of the line
// does with them: the split, where each share waits, the thaw night, the
// shopping list and a deviation.
// Run: scripts/t.sh tests/info/meals/plan/pots.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { FOODS, POT_PACK_G, foodById } from "../../../../src/info/meals/nutrition/foods";
import {
  potPortions,
  potShareG,
  potStorage,
  refKey,
  settlePots,
  thawTonight,
} from "../../../../src/info/meals/plan/pots";
import { deriveShoppingList } from "../../../../src/info/meals/plan/shopping";
import type { DayPlan, Meal, WeekPlan } from "../../../../src/info/meals/plan/types";
import { addDays, applyDeviation } from "../../../../src/info/meals/plan/week";
import { dayViewOn } from "../../../../src/info/meals/screen/view";
import { mealsGuidance } from "../../../../src/info/meals/tools";
import { MON, potMeal, potWeek, state } from "../fixtures/week";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("zh-CN");
});
afterEach(() => setLocale(before));

const D = (i: number) => addDays(MON, i);
const day = (plan: WeekPlan, i: number) => plan.days[i] as DayPlan;

test("the pot column is on raw meat bought by the pack, and on nothing portioned per meal", () => {
  for (const id of Object.keys(POT_PACK_G)) {
    const food = foodById(id)!;
    expect(food.roles).toContain("protein");
    expect(food.keeps).toBe("d1-2");
    expect(food.potG).toBe(POT_PACK_G[id]);
  }
  for (const id of ["salmon", "cod", "frozen_shrimp", "egg", "ready_chicken_breast", "firm_tofu", "greek_yogurt"]) {
    expect(foodById(id)!.potG).toBeUndefined();
  }
  expect(FOODS.filter((f) => f.potG).map((f) => f.id)).toEqual(expect.arrayContaining(["beef_shank_raw", "chicken_thigh"]));
});

test("a share is the raw weight over the meals, to 5 g", () => {
  expect(potShareG(600, 4)).toBe(150);
  expect(potShareG(400, 3)).toBe(135);
  expect(potShareG(450, 4)).toBe(115);
  expect(potShareG(450, 0)).toBe(0);
});

test("the cook meal eats it fresh, the next two days from the fridge, later ones from the freezer", () => {
  const cook = { date: MON, meal: "dinner" as const };
  expect(potStorage(cook, cook)).toBe("fresh");
  expect(potStorage(cook, { date: MON, meal: "snack" })).toBe("fridge");
  expect(potStorage(cook, { date: D(2), meal: "dinner" })).toBe("fridge");
  expect(potStorage(cook, { date: D(3), meal: "breakfast" })).toBe("freezer");
});

test("every meal of a pot gets its share as its protein grams, and the rest is solved around it", () => {
  const plan = potWeek();
  const portions = potPortions(plan);
  const fri = portions.get(refKey({ date: D(4), meal: "lunch" }))!;
  expect(fri).toMatchObject({ index: 4, count: 4, shareG: 150, storage: "freezer", cooks: false });
  expect(fri.boxes.map((b) => [b.ref.date, b.storage])).toEqual([
    [D(1), "fridge"],
    [D(2), "fridge"],
    [D(4), "freezer"],
  ]);
  expect(portions.get(refKey({ date: MON, meal: "dinner" }))).toMatchObject({ cooks: true, storage: "fresh" });
  const protein = (i: number) => day(plan, i).lunch.solved!.find((r) => r.role === "protein")!;
  expect(protein(1)).toEqual({ foodId: "beef_shank_raw", role: "protein", grams: 150 });
  expect(protein(3)).toEqual({ foodId: "chicken_breast", role: "protein", grams: 135 });
  expect(day(plan, 1).lunch.solved!.some((r) => r.role === "staple" && r.grams > 0)).toBe(true);
});

test("the night before a frozen share is eaten, it comes out of the freezer", () => {
  const plan = potWeek();
  expect(thawTonight(plan, D(3)).map((t) => [t.pot.id, t.ref.date, t.ref.meal])).toEqual([["A", D(4), "lunch"]]);
  expect(thawTonight(plan, D(5)).map((t) => [t.pot.id, t.ref.date])).toEqual([["B", D(6)]]);
  expect(thawTonight(plan, D(1))).toEqual([]);
  const thu = dayViewOn(state({ plan }), D(3), MON, "other")!;
  expect(thu.thaw).toEqual(["今晚把星期五午餐那盒卤牛腱从冷冻拿到冷藏"]);
  const lunch = dayViewOn(state({ plan }), D(1), MON, "other")!.meals.find((m) => m.key === "lunch")!;
  expect(lunch.rows.find((r) => r.role === "protein")).toMatchObject({ potLabel: "卤牛腱一锅的 1/4", grams: 150 });
  expect(lunch.rows.filter((r) => r.potLabel)).toHaveLength(1);
});

test("the shopping list buys a pot's food whole, by the day it is cooked", () => {
  const items = deriveShoppingList(potWeek(), MON, 2);
  const breast = items.find((i) => i.foodId === "chicken_breast")!;
  expect(breast).toMatchObject({ grams: 800, qty: "800 g", neededBy: D(3), freezeOnArrival: true });
  expect(items.find((i) => i.foodId === "beef_shank_raw")).toMatchObject({ grams: 1200, neededBy: MON, freezeOnArrival: false });
});

test("a deviation that takes the cook meal moves the cooking to the next meal of the pot", () => {
  const plan = potWeek();
  const moved = applyDeviation(plan, { date: MON, meal: "dinner", said: "外面吃的", became: "out", changed: "", at: 1 });
  expect(moved.plan.pots!.find((p) => p.id === "A")!.cook).toEqual({ date: D(1), meal: "lunch" });
  expect(potPortions(moved.plan).get(refKey({ date: D(1), meal: "lunch" }))).toMatchObject({ count: 3, shareG: 200, cooks: true });

  const gone = settlePots({ ...plan, days: plan.days.map((d) => ({ ...d, lunch: unpot(d.lunch) })) });
  expect(gone.pots!.map((p) => p.id)).toEqual(["A"]);
});

const unpot = (m: Meal): Meal => (m.pot === "B" ? { mode: "skip" } : m);

test("a week planned before the pots has none and solves as it did", () => {
  const plan = state().plan!;
  expect(plan.pots).toBeUndefined();
  expect(potPortions(plan).size).toBe(0);
  expect(thawTonight(plan, MON)).toEqual([]);
});

const out = (date: string, meal: "lunch" | "dinner") =>
  ({ date, meal, said: "外面吃的", became: "out", changed: "", at: 1 }) as const;

test("a deviation before a pot is cooked splits it again over the meals left", () => {
  const moved = applyDeviation(potWeek(), out(D(5), "lunch"), null, MON);
  const pot = moved.plan.pots!.find((p) => p.id === "B")!;
  expect(pot.packed).toBeUndefined();
  expect(potPortions(moved.plan).get(refKey({ date: D(6), meal: "lunch" }))).toMatchObject({ index: 2, count: 2, shareG: 200 });

  const cook = applyDeviation(potWeek(), out(MON, "dinner"), null, MON);
  expect(cook.plan.pots!.find((p) => p.id === "A")).toMatchObject({ cook: { date: D(1), meal: "lunch" } });
  expect(cook.plan.pots!.find((p) => p.id === "A")!.packed).toBeUndefined();
});

// Pot A is cooked on day 1 dinner and eaten on days 2, 3 and 5 at lunch; day 3's
// lunch is eaten out, told on day 2.
const packedWeek = () => applyDeviation(potWeek(), out(D(2), "lunch"), null, D(1)).plan;

test("a deviation after a pot is cooked keeps the boxes and sets the meal's box aside", () => {
  const plan = packedWeek();
  const pot = plan.pots!.find((p) => p.id === "A")!;
  expect(pot.cook).toEqual({ date: MON, meal: "dinner" });
  expect(pot.packed).toEqual([
    { for: { date: D(1), meal: "lunch" }, storage: "fridge" },
    { for: { date: D(2), meal: "lunch" }, storage: "fridge" },
    { for: { date: D(4), meal: "lunch" }, storage: "freezer" },
  ]);
  const portions = potPortions(plan);
  expect(portions.get(refKey({ date: D(1), meal: "lunch" }))).toMatchObject({ index: 2, count: 4, shareG: 150, storage: "fridge" });
  expect(portions.get(refKey({ date: D(4), meal: "lunch" }))).toMatchObject({ index: 4, count: 4, shareG: 150, storage: "freezer" });
  expect(portions.has(refKey({ date: D(2), meal: "lunch" }))).toBe(false);

  const lunch = dayViewOn(state({ plan }), D(4), MON, "other")!.meals.find((m) => m.key === "lunch")!;
  expect(lunch.rows.find((r) => r.role === "protein")).toMatchObject({ potLabel: "卤牛腱一锅的 1/4", grams: 150 });
  expect(dayViewOn(state({ plan }), D(2), MON, "other")!.meals.flatMap((m) => m.rows).some((r) => r.potLabel)).toBe(false);

  // A second deviation leaves the packing as it was.
  const again = applyDeviation(plan, out(D(4), "lunch"), null, D(3)).plan;
  expect(again.pots!.find((p) => p.id === "A")!.packed).toEqual(pot.packed!);
  expect(potPortions(again).get(refKey({ date: D(1), meal: "lunch" }))).toMatchObject({ count: 4, shareG: 150 });
});

test("a later meal can take a spare box at the packed share", () => {
  const plan = packedWeek();
  day(plan, 1).dinner = potMeal("番茄牛腱面", "tomato", "A", "beef_shank_raw", "dried_noodles", "bok_choy");
  expect(potPortions(plan).get(refKey({ date: D(1), meal: "dinner" }))).toMatchObject({ index: 3, count: 4, shareG: 150, storage: "fridge" });
  expect(mealsGuidance(state({ plan }), D(1))).not.toContain("spare box:");
});

test("a freezer box is taken at its place in the packing, and thawed the night before", () => {
  const frozen = applyDeviation(potWeek(), out(D(4), "lunch"), null, D(1)).plan;
  day(frozen, 5).dinner = potMeal("咖喱牛腱面", "curry", "A", "beef_shank_raw", "dried_noodles", "bok_choy");
  expect(potPortions(frozen).get(refKey({ date: D(5), meal: "dinner" }))).toMatchObject({ index: 4, storage: "freezer" });
  expect(thawTonight(frozen, D(4)).map((t) => [t.pot.id, t.ref.date, t.ref.meal])).toEqual([["A", D(5), "dinner"]]);
});
