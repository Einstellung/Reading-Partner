import { describe, expect, test } from "bun:test";
import { computeTargets, mealTargets, type DayTargets, type Profile } from "../../../../src/info/meals/nutrition/targets";
import {
  mealEnergy,
  portionGrams,
  rowNutrition,
  solveDay,
  solveMeal,
  stapleCapG,
  type DayMealInput,
  type MealSolution,
  type TemplateItem,
} from "../../../../src/info/meals/nutrition/solve";
import { foodById, type Food } from "../../../../src/info/meals/nutrition/foods";

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
  effort: "simple",
  people: 1,
  shops: [],
  kitchen: [],
  dislikes: [],
};
const T = computeTargets(EXAMPLE, "CN");

const food = (id: string): Food => foodById(id) as Food;
const grams = (m: MealSolution, id: string) => m.rows.find((r) => r.foodId === id)?.grams;

// The prototype's templates, on the table's ids.
const YOGURT_OATS: TemplateItem[] = [
  { foodId: "greek_yogurt", role: "protein" },
  { foodId: "oats", role: "staple" },
  { foodId: "walnuts", role: "fat" },
  { foodId: "blueberries", role: "fixed", grams: 80 },
];
const EGG_BUN: TemplateItem[] = [
  { foodId: "egg", role: "protein" },
  { foodId: "steamed_bun", role: "staple" },
  { foodId: "whole_milk", role: "fixed", grams: 250 },
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
const MAPO_TOFU: TemplateItem[] = [
  { foodId: "firm_tofu", role: "protein" },
  { foodId: "steamed_bun", role: "staple" },
  { foodId: "ground_pork", role: "fixed", grams: 50 },
  { foodId: "frozen_green_beans", role: "fixed", grams: 150 },
];
// A snack: protein food, fixed fruit, nuts; no staple.
const SOY_ORANGE_NUTS: TemplateItem[] = [
  { foodId: "soy_milk_unsweetened", role: "protein" },
  { foodId: "orange", role: "fixed", grams: 200 },
  { foodId: "mixed_nuts", role: "fat" },
];
const MILK_BANANA: TemplateItem[] = [
  { foodId: "low_fat_milk", role: "protein" },
  { foodId: "banana", role: "fixed", grams: 120 },
];

describe("solveMeal: the protein portion", () => {
  test("the protein food gets a normal portion, not the meal's protein target", () => {
    const lunch = solveMeal("lunch", CHICKEN_BOWL, T.rest.meals.lunch);
    expect(grams(lunch, "ready_chicken_breast")).toBe(110); // 25 g ÷ 23 g/100 g, to 5 g
    expect(T.rest.meals.lunch.protein).toBeGreaterThan(40);
    // The same portion at any meal size.
    expect(grams(solveMeal("lunch", CHICKEN_BOWL, { kcal: 1200, protein: 60 }), "ready_chicken_breast")).toBe(110);
    expect(grams(solveMeal("dinner", FISH_SOBA, T.training.meals.dinner), "frozen_tilapia_fillet")).toBe(135);
    expect(grams(solveMeal("breakfast", YOGURT_OATS, T.rest.meals.breakfast), "greek_yogurt")).toBe(120);
  });

  test("breakfast is two eggs; milk beside them does not count toward the portion", () => {
    const m = solveMeal("breakfast", EGG_BUN, T.rest.meals.breakfast);
    expect(grams(m, "egg")).toBe(100);
    expect(grams(m, "whole_milk")).toBe(250);
  });

  test("a non-dairy protein fixed beside the protein food counts toward its portion", () => {
    const m = solveMeal("dinner", MAPO_TOFU, T.rest.meals.dinner);
    // 25 g − 50 g pork's 9.25 g = 15.75 g of tofu protein at 8.5 g/100 g.
    expect(grams(m, "firm_tofu")).toBe(185);
  });

  test("portions round to whole units or 5 g and stay in the food's range", () => {
    expect(portionGrams(food("egg"), "lunch")).toBe(150); // 25 g would be four eggs; its max is three
    expect(portionGrams(food("quail_egg"), "breakfast")).toBe(100); // whole 10 g eggs, to its max
    expect(portionGrams(food("frozen_shrimp"), "lunch")).toBe(155);
    expect(portionGrams(food("clam"), "lunch")).toBe(300); // its max
    expect(portionGrams(food("greek_yogurt"), "snack")).toBe(100); // its min
    expect(portionGrams(food("ready_chicken_breast"), "lunch", 30)).toBe(60); // nothing left to give: its min
  });

  test("the snack's protein food is a cup's worth, by the same rule", () => {
    expect(portionGrams(food("soy_milk_unsweetened"), "snack")).toBe(250);
    expect(portionGrams(food("plain_yogurt"), "snack")).toBe(175);
    expect(portionGrams(food("low_fat_milk"), "snack")).toBe(275);
  });
});

describe("solveMeal: staple and fat", () => {
  test("the staple fills the meal's kcal and the oil stays at one spoon while the staple has room", () => {
    const m = solveMeal("dinner", FISH_SOBA, T.rest.meals.dinner);
    expect(grams(m, "sesame_oil")).toBe(food("sesame_oil").defaultG);
    expect(Math.abs(m.totals.kcal - T.rest.meals.dinner.kcal)).toBeLessThan(0.025 * 341); // within 2.5 g of soba
    for (const r of m.rows) expect(r.grams % 5).toBe(0);
  });

  test("the staple never passes its max or 400 kcal, with no stretch", () => {
    expect(stapleCapG(food("steamed_bun"))).toBeCloseTo(400 / 2.46, 6);
    expect(stapleCapG(food("frozen_peas"))).toBe(200); // its max is under 400 kcal
    const big = solveMeal("breakfast", EGG_BUN, { kcal: 1500, protein: 40 });
    expect(grams(big, "steamed_bun")).toBe(165);
    const bowl = solveMeal("lunch", CHICKEN_BOWL, { kcal: 2000, protein: 45 });
    expect(grams(bowl, "microwave_grain_rice")).toBe(265); // 400 kcal at 150 kcal/100 g, to 5 g
  });

  test("a small meal leaves the staple at its min", () => {
    const small = solveMeal("lunch", CHICKEN_BOWL, { kcal: 350, protein: 30 });
    expect(grams(small, "microwave_grain_rice")).toBe(80);
    expect(grams(small, "olive_oil")).toBe(food("olive_oil").defaultG);
  });

  test("when the staple is full the fat item closes the gap, within its max", () => {
    const olive = food("olive_oil");
    // 2000 kcal: rice full, oil at its max, the meal still short.
    const huge = solveMeal("lunch", CHICKEN_BOWL, { kcal: 2000, protein: 45 });
    expect(grams(huge, "olive_oil")).toBe(olive.maxG);
    expect(huge.totals.kcal).toBeLessThan(2000);
    // A little past the full staple: the oil moves part of the way.
    const full = solveMeal("lunch", CHICKEN_BOWL, { kcal: 1, protein: 0 });
    const fixedAndPortion = full.totals.kcal - rowNutrition(olive, grams(full, "olive_oil") ?? 0).kcal - rowNutrition(food("microwave_grain_rice"), 80).kcal;
    const target = fixedAndPortion + rowNutrition(food("microwave_grain_rice"), 265).kcal + rowNutrition(olive, 15).kcal;
    const some = solveMeal("lunch", CHICKEN_BOWL, { kcal: target, protein: 30 });
    expect(grams(some, "microwave_grain_rice")).toBe(265);
    expect(grams(some, "olive_oil")).toBe(15);
  });

  test("a snack needs no staple: its fruit keeps the model's grams and the nuts fill the kcal", () => {
    const nuts = food("mixed_nuts");
    const m = solveMeal("snack", SOY_ORANGE_NUTS, T.rest.meals.snack, { kcal: 350 });
    expect(grams(m, "soy_milk_unsweetened")).toBe(250);
    expect(grams(m, "orange")).toBe(200);
    const n = grams(m, "mixed_nuts") ?? 0;
    expect(n).toBeGreaterThan(nuts.minG);
    expect(n).toBeLessThanOrEqual(nuts.maxG);
    expect(Math.abs(m.totals.kcal - 350)).toBeLessThanOrEqual((2.5 * nuts.kcal) / 100);
    // Nothing left to fill: the nuts stay at their min. A lot left: at their max.
    expect(grams(solveMeal("snack", SOY_ORANGE_NUTS, T.rest.meals.snack, { kcal: 100 }), "mixed_nuts")).toBe(nuts.minG);
    expect(grams(solveMeal("snack", SOY_ORANGE_NUTS, T.rest.meals.snack, { kcal: 900 }), "mixed_nuts")).toBe(nuts.maxG);
    expect(m.cells.protein).toBe(true);
    expect(m.cells.produce).toBe(true);
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
    expect(grams(m, "frozen_broccoli")).toBe(200);
  });

  test("cells flag a meal short of protein, produce or carbs", () => {
    const snack = solveMeal("snack", MILK_BANANA, T.rest.meals.snack);
    expect(snack.cells.protein).toBe(true); // snack threshold is min(90%, 8 g)
    expect(snack.cells.produce).toBe(true);
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
    expect(() => solveMeal("lunch", [{ foodId: "oats", role: "staple" }], T.rest.meals.lunch)).toThrow();
    expect(() =>
      solveMeal("lunch", [{ foodId: "egg", role: "protein" }, { foodId: "tofu_skin", role: "protein" }], T.rest.meals.lunch),
    ).toThrow();
    expect(() =>
      solveMeal("lunch", [{ foodId: "egg", role: "protein" }, { foodId: "oats", role: "staple" }, { foodId: "rice_cooked", role: "staple" }], T.rest.meals.lunch),
    ).toThrow();
    expect(() =>
      solveMeal("lunch", [{ foodId: "no_such_food", role: "protein" }, { foodId: "oats", role: "staple" }], T.rest.meals.lunch),
    ).toThrow();
  });
});

describe("solveDay", () => {
  const day = (dinner: TemplateItem[]): DayMealInput[] => [
    { slot: "snack", items: SOY_ORANGE_NUTS },
    { slot: "dinner", items: dinner },
    { slot: "breakfast", items: YOGURT_OATS },
    { slot: "lunch", items: CHICKEN_BOWL },
  ];

  test("returns the day's order and adds up", () => {
    const d = solveDay(day(FISH_SOBA), T.training);
    expect(d.meals.map((m) => m.slot)).toEqual(T.training.order);
    const sum = d.meals.reduce((s, m) => s + m.totals.kcal, 0);
    expect(d.totals.kcal).toBeCloseTo(sum, 9);
    expect(d.totals.kcal).toBeGreaterThan(0.9 * T.training.kcal);
    expect(d.totals.protein).toBeGreaterThan(T.training.protein * 0.8);
  });

  test("the snack's nuts close what the main meals left of the day", () => {
    const d = solveDay(day(BEEF_RICE), T.rest);
    const mains = d.meals.filter((m) => m.slot !== "snack");
    const left = mains.reduce((s, m) => s + m.target.kcal - m.totals.kcal, 0);
    const snack = d.meals.find((m) => m.slot === "snack") as MealSolution;
    const alone = solveMeal("snack", SOY_ORANGE_NUTS, T.rest.meals.snack);
    expect(left).toBeGreaterThan(0);
    expect(grams(snack, "mixed_nuts") ?? 0).toBeGreaterThan(grams(alone, "mixed_nuts") ?? 0);
    expect(snack.totals.kcal).toBeCloseTo(
      solveMeal("snack", SOY_ORANGE_NUTS, T.rest.meals.snack, { kcal: T.rest.meals.snack.kcal + left }).totals.kcal,
      9,
    );
  });

  test("a day under its fat floor gets 5 g more oil per main meal until it clears", () => {
    // A small day of lean foods, so the oils start at one spoon and the first
    // solve lands under the floor.
    const target: DayTargets = { ...T.rest, kcal: 1500, fatFloor: 45, meals: mealTargets({ kcal: 1500, protein: 100 }, null) };
    const lean: DayMealInput[] = [
      { slot: "breakfast", items: [{ foodId: "greek_yogurt", role: "protein" }, { foodId: "oats", role: "staple" }, { foodId: "walnuts", role: "fat" }] },
      { slot: "lunch", items: [{ foodId: "frozen_shrimp", role: "protein" }, { foodId: "rice_cooked", role: "staple" }, { foodId: "olive_oil", role: "fat" }, { foodId: "spinach", role: "fixed", grams: 200 }] },
      { slot: "snack", items: MILK_BANANA },
      { slot: "dinner", items: [{ foodId: "cod", role: "protein" }, { foodId: "sweet_potato", role: "staple" }, { foodId: "olive_oil", role: "fat" }, { foodId: "broccoli", role: "fixed", grams: 200 }] },
    ];
    const first = lean.map((m) => solveMeal(m.slot, m.items, target.meals[m.slot]));
    const firstFat = first.reduce((s, m) => s + m.totals.fat, 0);
    expect(firstFat).toBeLessThan(target.fatFloor);

    const d = solveDay(lean, target);
    expect(d.fatBumpG).toBeGreaterThan(0);
    expect(d.fatBumpG % 5).toBe(0);
    expect(d.fatBumpG).toBeLessThanOrEqual(15);
    expect(d.totals.fat).toBeGreaterThan(firstFat);
    expect(d.fatFloorMet).toBe(d.totals.fat >= target.fatFloor);
    const lunch = d.meals.find((m) => m.slot === "lunch") as MealSolution;
    const firstLunch = first.find((m) => m.slot === "lunch") as MealSolution;
    expect(grams(lunch, "olive_oil")).toBeGreaterThan(10);
    // The staple gives up the oil's kcal.
    expect(grams(lunch, "rice_cooked") ?? 0).toBeLessThan(grams(firstLunch, "rice_cooked") ?? 0);
  });

  test("a day already over its fat floor is solved once", () => {
    const d = solveDay(day(BEEF_RICE), T.rest);
    expect(d.fatBumpG).toBe(0);
    expect(d.fatFloorMet).toBe(true);
  });
});
