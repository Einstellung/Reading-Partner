// Reference-serving scaling and the storage derived from the method (docs/671
// 菜库, 一锅). Figures per 100 g from the food table: chicken_tender 106 kcal
// 23.7 P 0.6 F, Na 44; tomato 17 kcal 0.7 P 0.1 F, Na 2; light_soy_sauce
// 90 kcal 7.8 P, Na 4997, added sugar 14.7; olive_oil 884 kcal 100 F, Na 2;
// egg 132 kcal 12.5 P, Na 147; whole_wheat_toast 252 kcal 12.4 P, Na 455;
// brown_rice_cooked 123 kcal 2.7 P 1.0 F, Na 4.

import { describe, expect, test } from "bun:test";
import { BREAKFAST_METHODS, FRIDGE_DAYS_AFTER_COOK, METHODS, canBatch, dishStorage } from "../../../../src/info/meals/dishes/methods";
import { referenceServing, totals, wayServing } from "../../../../src/info/meals/dishes/serving";
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

  test("a topping's fat is added fat whatever the food", () => {
    // greek yogurt 0.4 g fat per 100 g: not added as a protein line, added as a topping
    expect(totals([{ food: "greek_yogurt", grams: 100, role: "protein" }]).addedFat).toBe(0);
    expect(totals([{ food: "greek_yogurt", grams: 100, role: "topping" }]).addedFat).toBeCloseTo(0.4, 6);
    // feta is a fat food: added either way, 21.5 * 0.2
    expect(totals([{ food: "feta", grams: 20, role: "topping" }]).addedFat).toBeCloseTo(4.3, 6);
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

  test("a breakfast is not scaled: the template grams are the serving", () => {
    // egg 100 + toast 35: 12.5 + 4.34 = 16.84 g protein, sodium 147 + 159.25
    const s = referenceServing({
      role: "breakfast",
      ingredients: [
        { food: "egg", grams: 100, role: "protein" },
        { food: "whole_wheat_toast", grams: 35, role: "staple" },
      ],
    })!;
    expect(s.factor).toBe(1);
    expect(s.ingredients.map((i) => i.grams)).toEqual([100, 35]);
    expect(s.protein).toBeCloseTo(16.84, 2);
    expect(s.sodium).toBeCloseTo(306.25, 2);
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

  test("a side scales to 150 g of vegetables", () => {
    // broccoli 200 + carrot 100 + oil 6: factor 0.5, oil 3 g
    const s = referenceServing({
      role: "side",
      ingredients: [
        { food: "broccoli", grams: 200, role: "veg" },
        { food: "carrot", grams: 100, role: "veg" },
        { food: "olive_oil", grams: 6, role: "oil" },
      ],
    })!;
    expect(s.factor).toBeCloseTo(0.5, 6);
    expect(s.vegG).toBeCloseTo(150, 6);
    expect(s.addedFat).toBeCloseTo(3, 6);
    expect(referenceServing({ role: "side", ingredients: [{ food: "olive_oil", grams: 6, role: "oil" }] })).toBeNull();
  });

  test("a way adds its add-ons to the reference serving without rescaling it", () => {
    // MAIN doubled scales by 0.5 back to the base; + tomato 50 and feta 10:
    // kcal 176.8 + 8.5 + 26.5, protein 25 + 0.35 + 1.42, fat added 5 + 2.15
    const base = referenceServing({ role: "main", ingredients: MAIN.map((i) => ({ ...i, grams: i.grams * 2 })) })!;
    const w = wayServing(base, {
      addOns: [
        { food: "tomato", grams: 50, role: "veg" },
        { food: "feta", grams: 10, role: "topping" },
      ],
    });
    expect(w.factor).toBeCloseTo(0.5, 6);
    expect(w.ingredients).toHaveLength(6);
    expect(w.ingredients[4].grams).toBe(50);
    expect(w.kcal).toBeCloseTo(211.8, 6);
    expect(w.protein).toBeCloseTo(26.77, 6);
    expect(w.addedFat).toBeCloseTo(7.15, 6);
    expect(w.vegG).toBeCloseTo(180, 6);
    expect(wayServing(base, { addOns: [] }).kcal).toBeCloseTo(176.8, 6);
  });

  test("nothing to scale by gives null", () => {
    expect(referenceServing({ role: "main", ingredients: [{ food: "olive_oil", grams: 10, role: "oil" }] })).toBeNull();
    expect(referenceServing({ role: "staple", ingredients: [] })).toBeNull();
  });
});

describe("storage from the method", () => {
  const chicken: DishIngredient[] = [{ food: "chicken_breast", grams: 100, role: "protein" }];

  test("the hands-off methods keep three days after cooking and freeze for three weeks", () => {
    for (const method of ["stew", "braise", "pressure_cook", "slow_cook", "roast", "bake", "steam", "simmer"]) {
      expect(canBatch(method), method).toBe(true);
      expect(dishStorage({ method: method as never, ingredients: chicken }), method).toEqual({
        fridgeDays: 3,
        freezable: true,
        freezeWeeks: 3,
      });
    }
  });

  test("cooked grains keep like a pot and freeze", () => {
    expect(dishStorage({ method: "grain", ingredients: [{ food: "brown_rice_cooked", grams: 200, role: "staple" }] })).toEqual({
      fridgeDays: FRIDGE_DAYS_AFTER_COOK,
      freezable: true,
      freezeWeeks: 3,
    });
  });

  test("a not-freezable food stops the whole pot freezing", () => {
    for (const food of ["egg", "firm_tofu", "potato", "spinach"]) {
      const s = dishStorage({ method: "stew", ingredients: [...chicken, { food, grams: 50, role: "veg" }] });
      expect(s, food).toEqual({ fridgeDays: 3, freezable: false, freezeWeeks: 0 });
    }
  });

  test("stir-fry, pan-fry, cold, assembled, breakfast-only and unknown methods cannot be batched", () => {
    for (const method of [
      "pan_fry",
      "stir_fry",
      "cold_dress",
      "pickle",
      "marinate",
      "greens",
      "salad",
      "microwave",
      "toast",
      "assemble",
      "deep_fry",
    ]) {
      expect(dishStorage({ method: method as never, ingredients: chicken }), method).toBeNull();
      expect(canBatch(method), method).toBe(false);
    }
  });

  test("breakfast methods", () => {
    expect([...BREAKFAST_METHODS]).toEqual(["assemble", "simmer", "microwave", "steam", "toast"]);
    for (const m of BREAKFAST_METHODS) expect(METHODS.map((x) => x.id)).toContain(m);
  });

  test("the method table has no deep frying", () => {
    const ids = METHODS.map((m) => m.id as string);
    expect(ids).not.toContain("deep_fry");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
