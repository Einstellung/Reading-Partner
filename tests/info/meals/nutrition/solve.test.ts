import { describe, expect, test } from "bun:test";
import { computeTargets, type Profile } from "../../../../src/info/meals/nutrition/targets";
import {
  mealEnergy,
  rowNutrition,
  solveDay,
  solveMeal,
  type DayMealInput,
  type TemplateItem,
} from "../../../../src/info/meals/nutrition/solve";
import { foodById } from "../../../../src/info/meals/nutrition/foods";

const EXAMPLE: Profile = {
  consent: "health",
  goal: "cut",
  sex: "m",
  age: 30,
  heightCm: 175,
  weightKg: 72,
  bodyFatPct: 18,
  trainingDays: [1, 3, 5],
  trainTime: "evening",
  work: "sit",
  minutesPerMeal: 10,
  people: 1,
  shops: [],
  kitchen: [],
  dislikes: [],
};
const T = computeTargets(EXAMPLE, "CN");

// The prototype's templates, on the table's ids.
const YOGURT_OATS: TemplateItem[] = [
  { foodId: "greek_yogurt", role: "protein" },
  { foodId: "oats", role: "staple" },
  { foodId: "walnuts", role: "fat" },
  { foodId: "blueberries", role: "fixed", grams: 80 },
];
const EGG_TOAST: TemplateItem[] = [
  { foodId: "egg", role: "protein" },
  { foodId: "whole_wheat_toast", role: "staple" },
  { foodId: "peanut_butter", role: "fat" },
  { foodId: "low_fat_milk", role: "fixed", grams: 250 },
  { foodId: "cherry_tomato", role: "fixed", grams: 100 },
];
const CHICKEN_BOWL: TemplateItem[] = [
  { foodId: "ready_chicken_breast", role: "protein" },
  { foodId: "microwave_grain_rice", role: "staple" },
  { foodId: "olive_oil", role: "fat" },
  { foodId: "frozen_broccoli", role: "fixed", grams: 200 },
  { foodId: "avocado", role: "fixed", grams: 50 },
];
const FISH_SOBA: TemplateItem[] = [
  { foodId: "frozen_tilapia_fillet", role: "protein" },
  { foodId: "soba_dry", role: "staple" },
  { foodId: "sesame_oil", role: "fat" },
  { foodId: "bok_choy", role: "fixed", grams: 150 },
  { foodId: "enoki", role: "fixed", grams: 100 },
  { foodId: "light_soy_sauce", role: "fixed", grams: 10 },
];
const BEEF_RICE: TemplateItem[] = [
  { foodId: "braised_beef_shank", role: "protein" },
  { foodId: "microwave_grain_rice", role: "staple" },
  { foodId: "sesame_oil", role: "fat" },
  { foodId: "cucumber", role: "fixed", grams: 200 },
  { foodId: "light_soy_sauce", role: "fixed", grams: 10 },
];
const MILK_BANANA: TemplateItem[] = [
  { foodId: "low_fat_milk", role: "protein" },
  { foodId: "banana", role: "staple" },
];

const within = (got: number, want: number, pct: number) => Math.abs(got - want) / want <= pct;

describe("solveMeal", () => {
  test("lands each template within 2% of the meal's kcal and protein", () => {
    const cases = [
      ["breakfast", YOGURT_OATS, T.rest.meals.breakfast],
      ["lunch", CHICKEN_BOWL, T.rest.meals.lunch],
      ["dinner", FISH_SOBA, T.training.meals.dinner],
      ["lunch", BEEF_RICE, T.training.meals.lunch],
    ] as const;
    for (const [slot, items, target] of cases) {
      const m = solveMeal(slot, items, target);
      expect(within(m.totals.kcal, target.kcal, 0.02)).toBe(true);
      expect(within(m.totals.protein, target.protein, 0.02)).toBe(true);
      for (const r of m.rows) expect(r.grams % 5).toBe(0);
      expect(m.cells).toEqual({ protein: true, produce: true, carbs: true });
    }
  });

  test("eggs are solved in whole eggs", () => {
    const m = solveMeal("breakfast", EGG_TOAST, T.rest.meals.breakfast);
    const egg = m.rows.find((r) => r.foodId === "egg");
    expect(egg).toBeDefined();
    expect((egg?.grams ?? 0) % 50).toBe(0);
    expect(within(m.totals.kcal, T.rest.meals.breakfast.kcal, 0.02)).toBe(true);
  });

  test("rows carry the table's numbers at their grams, and the totals are their sum", () => {
    const m = solveMeal("lunch", CHICKEN_BOWL, T.rest.meals.lunch);
    for (const r of m.rows) {
      const n = rowNutrition(r.food, r.grams);
      expect(r.kcal).toBeCloseTo(n.kcal, 9);
      expect(r.protein).toBeCloseTo(n.protein, 9);
    }
    const sum = mealEnergy(m.rows.map((r) => ({ foodId: r.foodId, grams: r.grams })));
    expect(m.totals.kcal).toBeCloseTo(sum.kcal, 9);
    expect(m.totals.fat).toBeCloseTo(sum.fat, 9);
    expect(m.produceG).toBe(250); // broccoli 200 + avocado 50
    const broccoli = m.rows.find((r) => r.foodId === "frozen_broccoli");
    expect(broccoli?.grams).toBe(200);
  });

  test("oil moves off its default only when the staple would leave its range, within its cap", () => {
    const olive = foodById("olive_oil");
    const normal = solveMeal("lunch", CHICKEN_BOWL, T.rest.meals.lunch);
    expect(normal.rows.find((r) => r.foodId === "olive_oil")?.grams).toBe(olive?.defaultG);
    // A huge meal pushes the rice past its max: oil rises to its cap, rice stretches up to 1.5×.
    const big = solveMeal("lunch", CHICKEN_BOWL, { kcal: 2000, protein: 45 });
    expect(big.rows.find((r) => r.foodId === "olive_oil")?.grams).toBe(olive?.maxG);
    const rice = big.rows.find((r) => r.foodId === "microwave_grain_rice");
    expect(rice?.grams).toBeLessThanOrEqual(400 * 1.5);
    expect(rice?.grams).toBeGreaterThan(400);
    // A tiny meal pushes the rice under its min: oil drops, never under its min.
    const small = solveMeal("lunch", CHICKEN_BOWL, { kcal: 350, protein: 30 });
    const oil = small.rows.find((r) => r.foodId === "olive_oil");
    expect(oil === undefined || oil.grams < (olive?.defaultG ?? 0)).toBe(true);
    expect(small.rows.find((r) => r.foodId === "microwave_grain_rice")?.grams).toBeGreaterThanOrEqual(80);
  });

  test("cells flag a meal short of protein, produce or carbs", () => {
    const snack = solveMeal("snack", MILK_BANANA, T.rest.meals.snack);
    expect(snack.cells.protein).toBe(true); // snack threshold is min(90%, 8 g)
    expect(snack.cells.produce).toBe(snack.produceG >= 80);
    const bare = solveMeal("dinner", [
      { foodId: "ready_chicken_breast", role: "protein" },
      { foodId: "microwave_grain_rice", role: "staple" },
    ], T.rest.meals.dinner);
    expect(bare.produceG).toBe(0);
    expect(bare.cells.produce).toBe(false);
    expect(bare.cells.protein).toBe(true);
    expect(bare.cells.carbs).toBe(true);
  });

  test("a malformed template or an unknown food throws", () => {
    expect(() => solveMeal("lunch", [{ foodId: "egg", role: "protein" }], T.rest.meals.lunch)).toThrow();
    expect(() =>
      solveMeal("lunch", [{ foodId: "no_such_food", role: "protein" }, { foodId: "oats", role: "staple" }], T.rest.meals.lunch),
    ).toThrow();
  });
});

describe("solveDay", () => {
  const day = (dinner: TemplateItem[]): DayMealInput[] => [
    { slot: "snack", items: MILK_BANANA },
    { slot: "dinner", items: dinner },
    { slot: "breakfast", items: YOGURT_OATS },
    { slot: "lunch", items: CHICKEN_BOWL },
  ];

  test("solves in the day's order and adds up", () => {
    const d = solveDay(day(FISH_SOBA), T.training);
    expect(d.meals.map((m) => m.slot)).toEqual(T.training.order);
    const sum = d.meals.reduce((s, m) => s + m.totals.kcal, 0);
    expect(d.totals.kcal).toBeCloseTo(sum, 9);
    expect(within(d.totals.kcal, T.training.kcal, 0.02)).toBe(true);
  });

  test("a day under its fat floor gets 5 g more oil per main meal until it clears", () => {
    // Lean foods all day, so the first solve lands under the floor.
    const lean: DayMealInput[] = [
      { slot: "breakfast", items: [{ foodId: "greek_yogurt", role: "protein" }, { foodId: "oats", role: "staple" }, { foodId: "walnuts", role: "fat" }] },
      { slot: "lunch", items: [{ foodId: "frozen_shrimp", role: "protein" }, { foodId: "rice_cooked", role: "staple" }, { foodId: "olive_oil", role: "fat" }, { foodId: "spinach", role: "fixed", grams: 200 }] },
      { slot: "snack", items: MILK_BANANA },
      { slot: "dinner", items: [{ foodId: "cod", role: "protein" }, { foodId: "sweet_potato", role: "staple" }, { foodId: "olive_oil", role: "fat" }, { foodId: "broccoli", role: "fixed", grams: 200 }] },
    ];
    const target = T.training;
    const first = lean.map((m) => solveMeal(m.slot, m.items, target.meals[m.slot]));
    const firstFat = first.reduce((s, m) => s + m.totals.fat, 0);
    expect(firstFat).toBeLessThan(target.fatFloor);

    const d = solveDay(lean, target);
    expect(d.fatBumpG).toBeGreaterThan(0);
    expect(d.fatBumpG % 5).toBe(0);
    expect(d.fatBumpG).toBeLessThanOrEqual(15);
    expect(d.totals.fat).toBeGreaterThan(firstFat);
    expect(d.fatFloorMet).toBe(d.totals.fat >= target.fatFloor);
    const lunchOil = d.meals.find((m) => m.slot === "lunch")?.rows.find((r) => r.foodId === "olive_oil");
    expect(lunchOil?.grams).toBeGreaterThan(10);
  });

  test("a day already over its fat floor is solved once", () => {
    const d = solveDay(day(BEEF_RICE), T.rest);
    expect(d.fatBumpG).toBe(0);
    expect(d.fatFloorMet).toBe(true);
  });
});
