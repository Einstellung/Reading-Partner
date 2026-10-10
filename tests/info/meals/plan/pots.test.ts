// The week's pots (src/info/meals/plan/pots.ts) and what the rest of the line
// does with them: the split, where each share waits, the thaw night, the
// checks, the shopping list, a deviation, and assembling a draft.
// Run: scripts/t.sh tests/info/meals/plan/pots.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { FOODS, POT_PACK_G, foodById } from "../../../../src/info/meals/nutrition/foods";
import { checkPlan, potProblems } from "../../../../src/info/meals/plan/checks";
import {
  potPortions,
  potShareG,
  potStorage,
  refKey,
  settlePots,
  thawTonight,
} from "../../../../src/info/meals/plan/pots";
import { deriveShoppingList } from "../../../../src/info/meals/plan/shopping";
import { targetsOf } from "../../../../src/info/meals/plan/solve-week";
import type { DayPlan, Meal, WeekPlan } from "../../../../src/info/meals/plan/types";
import { addDays, applyDeviation, assembleWeekPlan } from "../../../../src/info/meals/plan/week";
import { dayViewOn } from "../../../../src/info/meals/screen/view";
import { MON, charter, draftPotWeek, potMeal, potWeek, profile, state } from "../fixtures/week";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("zh-CN");
});
afterEach(() => setLocale(before));

const D = (i: number) => addDays(MON, i);
const targets = () => targetsOf(charter(), "other")!;
const check = (plan: WeekPlan) => checkPlan({ plan, profile: profile(), targets: targets() });
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

test("a week of pots that hold up passes the checks", () => {
  expect(check(draftPotWeek()).problems).toEqual([]);
});

test("a pot feeds two to four meals", () => {
  const plan = draftPotWeek();
  for (const i of [1, 2, 4]) day(plan, i).lunch = { ...day(plan, i).lunch, pot: undefined };
  const one = check(plan);
  expect(one.problems).toContain("Pot A feeds 1 meal; a pot feeds 2 to 4.");
  const five = draftPotWeek();
  day(five, 5).dinner = potMeal("牛腱面", "garlic", "A", "beef_shank_raw", "dried_noodles", "bok_choy");
  expect(potProblems(five, five.pots![0]!).map((p) => p.text)).toContain("Pot A feeds 5 meals; a pot feeds 2 to 4.");
});

test("the meal a pot is cooked at eats from it, and none eats before it", () => {
  const plan = draftPotWeek();
  plan.pots![0] = { ...plan.pots![0]!, cook: { date: D(1), meal: "lunch" } };
  const before = check(plan);
  expect(before.problems).toContain("Day 1 dinner eats from pot A before it is cooked at Day 2 lunch.");
  expect(before.failing).toContainEqual({ date: MON, meal: "dinner" });

  const away = draftPotWeek();
  away.pots![0] = { ...away.pots![0]!, cook: { date: MON, meal: "lunch" } };
  expect(check(away).problems).toContain(
    "Pot A is cooked at Day 1 lunch, which does not eat from it; the meal it is cooked at eats the first share.",
  );
});

test("no share is eaten more than six days after the pot is cooked", () => {
  const plan = draftPotWeek();
  const extra: DayPlan = { ...day(plan, 6), date: D(7) };
  extra.lunch = potMeal("牛腱面", "garlic", "A", "beef_shank_raw", "dried_noodles", "bok_choy");
  day(plan, 4).lunch = { ...day(plan, 4).lunch, pot: undefined };
  plan.days.push(extra);
  expect(potProblems(plan, plan.pots![0]!).map((p) => p.text).join("\n")).toContain("lunch is 7 days after pot A is cooked; at most 6.");
});

test("a pot is a food with the pot column, at a share one meal can take", () => {
  const fish = draftPotWeek();
  fish.pots![0] = { ...fish.pots![0]!, foodId: "salmon" };
  expect(check(fish).problems.join("\n")).toContain("Pot A: salmon is not cooked as a pot");

  const big = draftPotWeek();
  big.pots![1] = { ...big.pots![1]!, rawG: 900 };
  expect(check(big).problems).toContain(
    "Pot B: 900 g over 3 meals is 300 g a meal, outside the 80–250 g one meal takes. Feed more meals from it or make it smaller.",
  );

  const unknown = draftPotWeek();
  day(unknown, 1).lunch = { ...day(unknown, 1).lunch, pot: "Z" };
  expect(check(unknown).problems).toContain("Day 2 lunch eats from pot Z, which pots does not define.");
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

test("assembly gives a pot meal the pot's food as its protein, and the pack as its weight by default", () => {
  const assembled = assembleWeekPlan(
    {
      days: [
        { day: 1, dinner: { mode: "make", name: "x", pot: "A", items: [{ foodId: "salmon", role: "protein" }, { foodId: "steamed_bun", role: "staple" }] } },
        { day: 2, lunch: { mode: "make", name: "y", pot: "A", items: [{ foodId: "dried_noodles", role: "staple" }] } },
      ],
      pots: [{ id: "A", food: "beef_shank_raw", day: 1, meal: "dinner", name: "卤牛腱", method: "卤" }],
    },
    { startDate: MON, createdAt: 1 },
  );
  expect(assembled.problems).toEqual([]);
  expect(assembled.plan.pots).toEqual([
    { id: "A", foodId: "beef_shank_raw", rawG: 600, cook: { date: MON, meal: "dinner" }, name: "卤牛腱", method: "卤" },
  ]);
  expect(day(assembled.plan, 0).dinner.items).toEqual([
    { foodId: "beef_shank_raw", role: "protein" },
    { foodId: "steamed_bun", role: "staple" },
  ]);

  const off = assembleWeekPlan(
    { days: [], pots: [{ id: "A", food: "beef_shank_raw", day: 9, meal: "dinner", name: "a", method: "b" }] },
    { startDate: MON, createdAt: 1 },
  );
  expect(off.problems).toEqual(["Pot A is cooked on day 9, which is not one of the seven days of the week."]);
  expect(off.plan.pots).toBeUndefined();
});

test("a week planned before the pots has none and solves as it did", () => {
  const plan = state().plan!;
  expect(plan.pots).toBeUndefined();
  expect(potPortions(plan).size).toBe(0);
  expect(thawTonight(plan, MON)).toEqual([]);
});
