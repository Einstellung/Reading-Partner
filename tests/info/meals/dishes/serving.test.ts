// Reference-serving scaling and the storage derived from the method (docs/671
// 菜库, 一锅). Figures per 100 g from the food table: chicken_tender 106 kcal
// 23.7 P 0.6 F, Na 44; tomato 17 kcal 0.7 P 0.1 F, Na 2; light_soy_sauce
// 90 kcal 7.8 P, Na 4997, added sugar 14.7; olive_oil 884 kcal 100 F, Na 2;
// egg 132 kcal 12.5 P, Na 147; whole_wheat_toast 252 kcal 12.4 P, Na 455;
// brown_rice_cooked 123 kcal 2.7 P 1.0 F, Na 4.

import { describe, expect, test } from "bun:test";
import { METHODS, dishStorage } from "../../../../src/info/meals/dishes/methods";
import { referenceServing, totals } from "../../../../src/info/meals/dishes/serving";
import type { DishIngredient } from "../../../../src/info/meals/dishes/types";

const MAIN: DishIngredient[] = [
  { food: "chicken_tender", grams: 100, role: "protein" },
  { food: "tomato", grams: 130, role: "veg" },
  { food: "light_soy_sauce", grams: 5, role: "seasoning" },
  { food: "olive_oil", grams: 5, role: "oil" },
];

describe("totals", () => {
  test("sums the table's figures by grams", () => {
    const t = totals(MAIN);
    // 23.7 + 0.91 + 0.39 + 0
    expect(t.protein).toBeCloseTo(25, 6);
    // 106 + 22.1 + 4.5 + 44.2
    expect(t.kcal).toBeCloseTo(176.8, 6);
    // only the oil's fat is added: 5 g
    expect(t.addedFat).toBeCloseTo(5, 6);
    // 44 + 2.6 + 249.85 + 0.1
    expect(t.sodium).toBeCloseTo(296.55, 6);
    // 14.7 * 0.05
    expect(t.addedSugar).toBeCloseTo(0.735, 6);
    expect(t.vegG).toBe(130);
  });

  test("skips foods the table does not have", () => {
    const t = totals([...MAIN, { food: "dragon_meat", grams: 100, role: "protein" }]);
    expect(t.protein).toBeCloseTo(25, 6);
  });
});

describe("reference serving", () => {
  test("a main scales to 25 g protein", () => {
    const s = referenceServing({ role: "main", ingredients: MAIN })!;
    expect(s.factor).toBeCloseTo(1, 6);
    const doubled = referenceServing({ role: "main", ingredients: MAIN.map((i) => ({ ...i, grams: i.grams * 2 })) })!;
    expect(doubled.factor).toBeCloseTo(0.5, 6);
    expect(doubled.protein).toBeCloseTo(25, 6);
    doubled.ingredients.forEach((i, n) => expect(i.grams).toBeCloseTo(MAIN[n].grams, 6));
  });

  test("a breakfast scales to 12 g protein", () => {
    // egg 100 + toast 35: 12.5 + 4.34 = 16.84 g protein
    const s = referenceServing({
      role: "breakfast",
      ingredients: [
        { food: "egg", grams: 100, role: "protein" },
        { food: "whole_wheat_toast", grams: 35, role: "staple" },
      ],
    })!;
    expect(s.factor).toBeCloseTo(12 / 16.84, 6);
    expect(s.protein).toBeCloseTo(12, 6);
    expect(s.ingredients[0].grams).toBeCloseTo(71.259, 2);
    // (147 + 159.25) * 12 / 16.84
    expect(s.sodium).toBeCloseTo(218.23, 1);
  });

  test("a staple scales to 200 kcal", () => {
    // rice 150 + oil 5: 184.5 + 44.2 = 228.7 kcal
    const s = referenceServing({
      role: "staple",
      ingredients: [
        { food: "brown_rice_cooked", grams: 150, role: "staple" },
        { food: "olive_oil", grams: 5, role: "oil" },
      ],
    })!;
    expect(s.factor).toBeCloseTo(200 / 228.7, 6);
    expect(s.kcal).toBeCloseTo(200, 6);
    expect(s.addedFat).toBeCloseTo(4.3725, 3);
  });

  test("nothing to scale by gives null", () => {
    expect(referenceServing({ role: "main", ingredients: [{ food: "olive_oil", grams: 10, role: "oil" }] })).toBeNull();
    expect(referenceServing({ role: "staple", ingredients: [] })).toBeNull();
  });
});

describe("storage from the method", () => {
  const chicken: DishIngredient[] = [{ food: "chicken_breast", grams: 100, role: "protein" }];

  test("cooked methods keep two days after cooking and freeze for three weeks", () => {
    for (const method of ["stew", "braise", "pressure_cook", "slow_cook", "roast", "steam", "pan_fry", "stir_fry"]) {
      expect(dishStorage({ method: method as never, ingredients: chicken }), method).toEqual({
        fridgeDays: 2,
        freezable: true,
        freezeWeeks: 3,
      });
    }
  });

  test("dressed, pickled and marinated keep three days and do not freeze", () => {
    for (const method of ["cold_dress", "pickle", "marinate"]) {
      expect(dishStorage({ method: method as never, ingredients: chicken }), method).toEqual({
        fridgeDays: 3,
        freezable: false,
        freezeWeeks: 0,
      });
    }
  });

  test("cooked grains keep one day and freeze", () => {
    expect(dishStorage({ method: "grain", ingredients: [{ food: "brown_rice_cooked", grams: 200, role: "staple" }] })).toEqual({
      fridgeDays: 1,
      freezable: true,
      freezeWeeks: 3,
    });
  });

  test("a not-freezable food stops the whole pot freezing", () => {
    for (const food of ["egg", "firm_tofu", "potato", "spinach"]) {
      const s = dishStorage({ method: "stew", ingredients: [...chicken, { food, grams: 50, role: "veg" }] });
      expect(s, food).toEqual({ fridgeDays: 2, freezable: false, freezeWeeks: 0 });
    }
  });

  test("made-at-the-meal and unknown methods cannot be batched", () => {
    for (const method of ["greens", "salad", "sear_fresh", "assemble", "deep_fry"]) {
      expect(dishStorage({ method: method as never, ingredients: chicken }), method).toBeNull();
    }
  });

  test("the method table has no deep frying", () => {
    const ids = METHODS.map((m) => m.id as string);
    expect(ids).not.toContain("deep_fry");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
