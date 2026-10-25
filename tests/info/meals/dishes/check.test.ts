// The entry check (docs/671 入库检查), every rule passing and failing, with
// the numbers worked by hand from the food table (per 100 g):
//   chicken_tender 106 kcal, 23.7 P, Na 44, 80-250 g
//   tomato 17 kcal, 0.7 P, Na 2
//   light_soy_sauce 90 kcal, 7.8 P, Na 4997, added sugar 14.7
//   olive_oil 884 kcal, 100 F, Na 2
//   white_sugar 387 kcal, added sugar 100
//   lemon_pepper_seasoning 6.0 P, Na 11540
//   rice_noodles_dry 353 kcal, 0.4 P, Na 197
//   egg 132 kcal, 12.5 P, Na 147, 50-150 g
//   whole_wheat_toast 252 kcal, 12.4 P, Na 455
//   brown_rice_cooked 123 kcal, 2.7 P, 1.0 F, Na 4
//   soft_tofu 51 kcal, 4.9 P, Na 32, 100-350 g

import { describe, expect, test } from "bun:test";
import { checkDish, type CheckFailure, type CheckRule } from "../../../../src/info/meals/dishes/check";
import type { Dish, DishIngredient } from "../../../../src/info/meals/dishes/types";

// 25.0 g protein as written, so the reference serving is the template itself:
// 176.8 kcal, 5 g added fat, 296.55 mg sodium, 0.735 g added sugar, 130 g veg.
const BASE: DishIngredient[] = [
  { food: "chicken_tender", grams: 100, role: "protein" },
  { food: "tomato", grams: 130, role: "veg" },
  { food: "light_soy_sauce", grams: 5, role: "seasoning" },
  { food: "olive_oil", grams: 5, role: "oil" },
];

function dish(over: Partial<Dish> = {}): Dish {
  return {
    id: "test_dish",
    name: "测试菜",
    nameEn: "Test dish",
    role: "main",
    cuisine: "chinese",
    method: "stir_fry",
    equipment: ["stove"],
    activeMin: 15,
    totalMin: 20,
    prep: "batch",
    staples: ["brown_rice_cooked"],
    ingredients: BASE,
    origin: "seed",
    createdAt: "2026-10-25T00:00:00.000Z",
    ...over,
  };
}

function failures(d: Dish): CheckFailure[] {
  const r = checkDish(d);
  return r.ok ? [] : r.failures;
}

function only(d: Dish, rule: CheckRule): CheckFailure {
  const f = failures(d);
  expect(f.map((x) => x.rule)).toEqual([rule]);
  return f[0];
}

describe("checkDish passes", () => {
  test("the base main", () => {
    const r = checkDish(dish());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.serving.factor).toBeCloseTo(1, 6);
    expect(r.serving.kcal).toBeCloseTo(176.8, 6);
    expect(r.serving.sodium).toBeCloseTo(296.55, 6);
  });

  test("a main with a staple line needs only 20% protein", () => {
    // + rice noodles 80 g: protein 25.32, kcal 176.8 + 282.4 = 459.2,
    // share 101.28 / 459.2 = 22.06%; would fail the 30% without the staple.
    const r = checkDish(dish({ ingredients: [...BASE, { food: "rice_noodles_dry", grams: 80, role: "staple" }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.serving.protein * 4) / r.serving.kcal).toBeCloseTo(0.22056, 4);
  });

  test("a breakfast", () => {
    // egg 100 + toast 35 -> factor 12 / 16.84; share 67.36 / 220.2 = 30.6%;
    // sodium 306.25 * 0.7126 = 218.2 mg; egg 71.3 g.
    const r = checkDish(
      dish({
        role: "breakfast",
        method: "pan_fry",
        prep: "fresh",
        activeMin: 8,
        totalMin: 10,
        staples: [],
        ingredients: [
          { food: "egg", grams: 100, role: "protein" },
          { food: "whole_wheat_toast", grams: 35, role: "staple" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.serving.sodium).toBeCloseTo(218.23, 1);
  });

  test("a staple", () => {
    // rice 150 + oil 5 -> factor 200 / 228.7; added fat 5 * 0.8745 = 4.37 g.
    const r = checkDish(
      dish({
        role: "staple",
        method: "grain",
        activeMin: 5,
        totalMin: 40,
        staples: [],
        ingredients: [
          { food: "brown_rice_cooked", grams: 150, role: "staple" },
          { food: "olive_oil", grams: 5, role: "oil" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });

  test("a staple dish id may stand in the staples list", () => {
    expect(checkDish(dish({ staples: ["brown_rice_pot"] }), { stapleDishIds: new Set(["brown_rice_pot"]) }).ok).toBe(true);
  });
});

describe("checkDish fails, with the numbers", () => {
  test("protein share", () => {
    // oil 25: kcal 106 + 22.1 + 4.5 + 221 = 353.6, share 100 / 353.6 = 28.28%
    const f = failures(dish({ ingredients: [...BASE.slice(0, 3), { food: "olive_oil", grams: 25, role: "oil" }] }));
    const share = f.find((x) => x.rule === "protein_share")!;
    expect(share.actual!).toBeCloseTo(0.28281, 4);
    expect(share.limit).toBe(0.3);
    expect(share.message).toBe("protein is 28.3% of kcal, under 30%");
    expect(f.find((x) => x.rule === "added_fat")!.actual!).toBeCloseTo(25, 6);
  });

  test("breakfast protein share under 20%", () => {
    // egg 50 + toast 100: protein 6.25 + 12.4 = 18.65, kcal 66 + 252 = 318,
    // share 74.6 / 318 = 23.5% passes; toast 150: protein 24.85, kcal 444,
    // share 99.4 / 444 = 22.4%; white toast 150 instead: protein 6.25 + 14.25 =
    // 20.5, kcal 66 + 424.5 = 490.5, share 82 / 490.5 = 16.7%.
    const f = failures(
      dish({
        role: "breakfast",
        method: "assemble",
        prep: "fresh",
        activeMin: 5,
        totalMin: 5,
        staples: [],
        ingredients: [
          { food: "egg", grams: 50, role: "protein" },
          { food: "white_toast", grams: 150, role: "staple" },
        ],
      }),
    );
    const share = f.find((x) => x.rule === "protein_share")!;
    expect(share.actual!).toBeCloseTo(82 / 490.5, 4);
    expect(share.limit).toBe(0.2);
  });

  test("added fat", () => {
    // oil 12: 12 g added fat, protein still 25 g
    const f = only(dish({ ingredients: [...BASE.slice(0, 3), { food: "olive_oil", grams: 12, role: "oil" }] }), "added_fat");
    expect(f.actual!).toBeCloseTo(12, 6);
    expect(f.limit).toBe(10);
    expect(f.message).toBe("added fat 12 g is over 10 g");
  });

  test("added fat on a staple is capped at 5 g", () => {
    // rice 150 + oil 8: kcal 184.5 + 70.72 = 255.22, factor 0.78364, fat 6.27 g
    const f = only(
      dish({
        role: "staple",
        method: "grain",
        activeMin: 5,
        totalMin: 40,
        staples: [],
        ingredients: [
          { food: "brown_rice_cooked", grams: 150, role: "staple" },
          { food: "olive_oil", grams: 8, role: "oil" },
        ],
      }),
      "added_fat",
    );
    expect(f.actual!).toBeCloseTo((8 * 200) / 255.22, 6);
    expect(f.limit).toBe(5);
  });

  test("sodium", () => {
    // + lemon pepper 3 g: protein 25.18, sodium (296.55 + 346.2) * 25 / 25.18 = 638.2 mg
    const f = only(dish({ ingredients: [...BASE, { food: "lemon_pepper_seasoning", grams: 3, role: "seasoning" }] }), "sodium");
    expect(f.actual!).toBeCloseTo((642.75 * 25) / 25.18, 6);
    expect(f.limit).toBe(600);
    expect(f.message).toBe("sodium 638 mg is over 600 mg");
  });

  test("sodium on a breakfast is capped at 400 mg", () => {
    // egg 100 + toast 35 + soy 5: protein 17.23, factor 12 / 17.23,
    // sodium (306.25 + 249.85) * 0.69646 = 387.3 passes; soy 6: protein
    // 17.308, sodium (306.25 + 299.82) * 12 / 17.308 = 420.2
    const f = only(
      dish({
        role: "breakfast",
        method: "pan_fry",
        prep: "fresh",
        activeMin: 8,
        totalMin: 10,
        staples: [],
        ingredients: [
          { food: "egg", grams: 100, role: "protein" },
          { food: "whole_wheat_toast", grams: 35, role: "staple" },
          { food: "light_soy_sauce", grams: 6, role: "seasoning" },
        ],
      }),
      "sodium",
    );
    expect(f.actual!).toBeCloseTo((606.07 * 12) / 17.308, 4);
    expect(f.limit).toBe(400);
  });

  test("added sugar", () => {
    // + sugar 10 g: 0.735 + 10 = 10.735 g, protein unchanged
    const f = only(dish({ ingredients: [...BASE, { food: "white_sugar", grams: 10, role: "seasoning" }] }), "added_sugar");
    expect(f.actual!).toBeCloseTo(10.735, 6);
    expect(f.limit).toBe(10);
  });

  test("vegetables", () => {
    // tomato 50: protein 24.44, factor 25 / 24.44, veg 51.15 g
    const f = only(dish({ ingredients: [BASE[0], { food: "tomato", grams: 50, role: "veg" }, BASE[2], BASE[3]] }), "vegetables");
    expect(f.actual!).toBeCloseTo((50 * 25) / 24.44, 6);
    expect(f.limit).toBe(100);
    expect(f.message).toBe("vegetables 51 g are under 100 g");
  });

  test("a food not in the table", () => {
    const f = failures(dish({ ingredients: [...BASE, { food: "dragon_meat", grams: 10, role: "seasoning" }] }));
    expect(f).toEqual([{ rule: "unknown_food", food: "dragon_meat", message: "dragon_meat is not in the food table" }]);
  });

  test("a line whose food cannot play its role", () => {
    const f = only(dish({ ingredients: [...BASE, { food: "tomato", grams: 100, role: "protein" }] }), "line");
    expect(f.food).toBe("tomato");
  });

  test("a method not in the table", () => {
    only(dish({ method: "deep_fry" as never }), "method");
  });

  test("a made-at-the-meal method as a batch dish", () => {
    only(dish({ method: "greens" }), "batch_method");
    expect(checkDish(dish({ method: "greens", prep: "fresh" })).ok).toBe(true);
  });

  test("protein food grams above the food's upper bound", () => {
    // soft tofu 400 + tomato 100: protein 20.3, factor 1.2315, tofu 492.6 g > 350
    const f = only(
      dish({
        staples: [],
        ingredients: [
          { food: "soft_tofu", grams: 400, role: "protein" },
          { food: "tomato", grams: 100, role: "veg" },
        ],
      }),
      "protein_grams",
    );
    expect(f.actual!).toBeCloseTo((400 * 25) / 20.3, 6);
    expect(f.limit).toBe(350);
  });

  test("protein food grams below the food's lower bound", () => {
    // chicken 30 + egg 160 + tomato 130: protein 7.11 + 20 + 0.91 = 28.02,
    // chicken 30 * 25 / 28.02 = 26.8 g < 80
    const f = only(
      dish({
        ingredients: [
          { food: "chicken_tender", grams: 30, role: "protein" },
          { food: "egg", grams: 160, role: "protein" },
          { food: "tomato", grams: 130, role: "veg" },
        ],
      }),
      "protein_grams",
    );
    expect(f.food).toBe("chicken_tender");
    expect(f.actual!).toBeCloseTo((30 * 25) / 28.02, 6);
    expect(f.limit).toBe(80);
  });

  test("nothing to scale by", () => {
    const r = checkDish(dish({ staples: [], ingredients: [{ food: "olive_oil", grams: 10, role: "oil" }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.serving).toBeNull();
      expect(r.failures.map((x) => x.rule)).toEqual(["scale"]);
    }
  });

  test("unknown cuisine, equipment and staple", () => {
    const f = failures(dish({ cuisine: "martian" as never, equipment: ["teleporter" as never], staples: ["tomato"] }));
    expect(f.map((x) => x.rule)).toEqual(["cuisine", "equipment", "staples"]);
  });
});

describe("time rules", () => {
  test("a batch pot may take 20 hands-on minutes, any wait", () => {
    expect(checkDish(dish({ activeMin: 20, totalMin: 240 })).ok).toBe(true);
    const f = only(dish({ activeMin: 25, totalMin: 240 }), "active_time");
    expect(f).toMatchObject({ actual: 25, limit: 20, message: "hands-on 25 min is over 20 min for a batch pot" });
  });

  test("a fresh dish may take 15", () => {
    expect(checkDish(dish({ prep: "fresh", activeMin: 15, totalMin: 15 })).ok).toBe(true);
    expect(only(dish({ prep: "fresh", activeMin: 16, totalMin: 20 }), "active_time")).toMatchObject({ actual: 16, limit: 15 });
  });

  test("a breakfast may take 10, batch or fresh", () => {
    const breakfast = (activeMin: number, prep: "batch" | "fresh") =>
      dish({
        role: "breakfast",
        method: "steam",
        prep,
        activeMin,
        totalMin: 30,
        staples: [],
        ingredients: [
          { food: "egg", grams: 100, role: "protein" },
          { food: "whole_wheat_toast", grams: 35, role: "staple" },
        ],
      });
    expect(checkDish(breakfast(10, "batch")).ok).toBe(true);
    expect(only(breakfast(12, "fresh"), "active_time")).toMatchObject({ actual: 12, limit: 10 });
    expect(only(breakfast(11, "batch"), "active_time")).toMatchObject({ actual: 11, limit: 10 });
  });

  test("total minutes below hands-on minutes", () => {
    only(dish({ activeMin: 15, totalMin: 10 }), "times");
  });
});
