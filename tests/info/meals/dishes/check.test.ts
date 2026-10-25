// The entry check (docs/671 入库检查), every rule passing and failing, with
// the numbers worked by hand from the food table (per 100 g):
//   chicken_tender 106 kcal, 23.7 P, 0.6 F, Na 44, 80-250 g
//   tomato 17 kcal, 0.7 P, 0.1 F, Na 2
//   light_soy_sauce 90 kcal, 7.8 P, Na 4997, added sugar 14.7
//   olive_oil 884 kcal, 100 F, Na 2
//   white_sugar 387 kcal, added sugar 100
//   lemon_pepper_seasoning 6.0 P, Na 11540
//   rice_noodles_dry 353 kcal, 0.4 P, Na 197
//   egg 132 kcal, 12.5 P, Na 147, 50-150 g
//   whole_wheat_toast 252 kcal, 12.4 P, Na 455
//   brown_rice_cooked 123 kcal, 2.7 P, 1.0 F, Na 4
//   soft_tofu 51 kcal, 4.9 P, Na 32, 100-350 g
//   feta 265 kcal, 14.2 P, 21.5 F, Na 1139 (dairy, fat)
//   greek_yogurt 59 kcal, 10.2 P, 0.4 F, Na 36, 100-350 g
//   cheese_slice 309 kcal, 18.3 P, 23.7 F, Na 1594, 10-40 g (dairy, fat)
//   apple 47 kcal, 0.2 P, Na 3
//   broccoli 33 kcal, 3.4 P, 0.4 F, Na 13
//   salt Na 38758; honey 308 kcal, Na 4, added sugar 79.6

import { describe, expect, test } from "bun:test";
import { ACTIVE_MIN, LIMITS, SUMMARY_MAX_CHARS, checkDish, isMincedMeat, type CheckFailure, type CheckRule } from "../../../../src/info/meals/dishes/check";
import { FOODS } from "../../../../src/info/meals/nutrition/foods";
import { CUISINES, type Dish, type DishIngredient, type DishWay } from "../../../../src/info/meals/dishes/types";

// 25.0 g protein as written, so the reference serving is the template itself:
// 176.8 kcal, 5 g added fat, 296.55 mg sodium, 0.735 g added sugar, 130 g veg.
const BASE: DishIngredient[] = [
  { food: "chicken_tender", grams: 100, role: "protein" },
  { food: "tomato", grams: 130, role: "veg" },
  { food: "light_soy_sauce", grams: 5, role: "seasoning" },
  { food: "olive_oil", grams: 5, role: "oil" },
];

/** A fresh stir-fried main; the base every rule below changes one thing of. */
function dish(over: Partial<Dish> = {}): Dish {
  return {
    id: "test_dish",
    name: "测试菜",
    nameEn: "Test dish",
    summary: "鸡柳和番茄用酱油、橄榄油大火快炒",
    summaryEn: "Chicken tenders and tomato stir-fried hot in soy sauce and olive oil.",
    role: "main",
    cuisine: "chinese",
    method: "stir_fry",
    equipment: ["stove"],
    activeMin: 15,
    totalMin: 20,
    prep: "fresh",
    staples: ["brown_rice_cooked"],
    ingredients: BASE,
    origin: "seed",
    createdAt: "2026-10-25T00:00:00.000Z",
    ...over,
  };
}

const OVER_RICE: DishWay = { name: "盖饭", nameEn: "Over rice", staple: "brown_rice_cooked", addOns: [], activeMin: 2 };
const IN_TORTILLA: DishWay = {
  name: "卷饼",
  nameEn: "In a tortilla",
  staple: "corn_tortilla",
  addOns: [
    { food: "tomato", grams: 50, role: "veg" },
    { food: "feta", grams: 10, role: "topping" },
  ],
  activeMin: 5,
};

/** A stewed batch main with two ways to eat it. */
function batchMain(over: Partial<Dish> = {}): Dish {
  return dish({ method: "stew", prep: "batch", activeMin: 15, totalMin: 60, staples: [], ways: [OVER_RICE, IN_TORTILLA], ...over });
}

const BREAKFAST: DishIngredient[] = [
  { food: "egg", grams: 100, role: "protein" },
  { food: "whole_wheat_toast", grams: 35, role: "staple" },
];

/** Boiled egg and toast. */
function breakfast(over: Partial<Dish> = {}): Dish {
  return dish({
    role: "breakfast",
    method: "simmer",
    equipment: ["stove", "toaster"],
    prep: "fresh",
    activeMin: 5,
    totalMin: 12,
    staples: [],
    ingredients: BREAKFAST,
    ...over,
  });
}

/** A roast tray: 300 g broccoli, 6 g oil, 0.5 g salt; scaled by 150 / 300. */
function side(over: Partial<Dish> = {}): Dish {
  return dish({
    role: "side",
    cuisine: "other",
    method: "roast",
    equipment: ["oven"],
    prep: "batch",
    activeMin: 10,
    totalMin: 35,
    staples: [],
    ingredients: [
      { food: "broccoli", grams: 300, role: "veg" },
      { food: "olive_oil", grams: 6, role: "oil" },
      { food: "salt", grams: 0.5, role: "seasoning" },
    ],
    ...over,
  });
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
    expect(r.ways).toEqual([]);
  });

  test("a main with a staple line needs only 20% protein", () => {
    // + rice noodles 80 g: protein 25.32, kcal 176.8 + 282.4 = 459.2,
    // share 101.28 / 459.2 = 22.06%; would fail the 30% without the staple.
    const r = checkDish(dish({ ingredients: [...BASE, { food: "rice_noodles_dry", grams: 80, role: "staple" }] }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.serving.protein * 4) / r.serving.kcal).toBeCloseTo(0.22056, 4);
  });

  test("a staple", () => {
    // rice 150 + oil 5 -> factor 200 / 228.7; added fat 5 * 0.8745 = 4.37 g.
    const r = checkDish(
      dish({
        role: "staple",
        method: "grain",
        prep: "batch",
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

  test("a cheese may be a protein line", () => {
    // + cheese slice 20 g: protein 28.66, factor 0.8723; cheese 17.4 g in
    // 10-40, chicken 87.2 g; added fat (5 + 4.74) * 0.8723 = 8.50 g; sodium
    // (296.55 + 318.8) * 0.8723 = 536.8 mg; veg 113.4 g.
    const r = checkDish(dish({ ingredients: [...BASE, { food: "cheese_slice", grams: 20, role: "protein" }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.serving.addedFat).toBeCloseTo((9.74 * 25) / 28.66, 4);
  });
});

describe("cuisines", () => {
  test("the set: no Korean or Indian, Italian apart from Mediterranean", () => {
    expect([...CUISINES]).toEqual(["chinese", "japanese", "southeast_asian", "american", "mexican", "italian", "mediterranean", "other"]);
    expect(checkDish(dish({ cuisine: "italian" })).ok).toBe(true);
    expect(checkDish(dish({ cuisine: "mediterranean" })).ok).toBe(true);
    for (const c of ["korean", "indian"]) {
      expect(only(dish({ cuisine: c as never }), "cuisine").message).toBe(`cuisine ${c} is unknown`);
    }
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
        prep: "batch",
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

  test("salt counts by its grams", () => {
    // + salt 0.7 g: 271.3 mg, total 567.9 passes; 0.8 g: 310.06, total 606.6
    expect(checkDish(dish({ ingredients: [...BASE, { food: "salt", grams: 0.7, role: "seasoning" }] })).ok).toBe(true);
    const f = only(dish({ ingredients: [...BASE, { food: "salt", grams: 0.8, role: "seasoning" }] }), "sodium");
    expect(f.actual!).toBeCloseTo(296.55 + 310.064, 6);
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
    expect(only(dish({ ingredients: [...BASE, { food: "tomato", grams: 100, role: "protein" }] }), "line").food).toBe("tomato");
    expect(only(dish({ ingredients: [...BASE, { food: "tomato", grams: 50, role: "fruit" }] }), "line").food).toBe("tomato");
    expect(only(dish({ ingredients: [...BASE, { food: "chicken_breast", grams: 20, role: "topping" }] }), "line").food).toBe(
      "chicken_breast",
    );
  });

  test("a method not in the table", () => {
    only(dish({ method: "deep_fry" as never }), "method");
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

describe("minced meat and fresh-ground cuts", () => {
  const minced = (d: Dish) => failures(d).filter((x) => x.rule === "minced_meat");
  const ground = (d: Dish) => failures(d).filter((x) => x.rule === "ground");
  const withProtein = (line: Partial<DishIngredient>, over: Partial<Dish> = {}) =>
    dish({ ingredients: [{ food: "chicken_tender", grams: 100, role: "protein", ...line }, ...BASE.slice(1)], ...over });
  const SAYS_GROUND = { summary: "鸡柳现绞拌匀，和番茄一起炖熟", summaryEn: "Chicken tenders ground fresh, stewed with tomato." };

  test("pre-packaged ground pork is rejected, naming the food", () => {
    const f = minced(withProtein({ food: "ground_pork" }));
    expect(f).toHaveLength(1);
    expect(f[0]!.food).toBe("ground_pork");
    expect(f[0]!.message).toContain("pre-packaged mince");
  });

  test("a pre-packaged mince fails even when flagged ground", () => {
    expect(minced(withProtein({ food: "ground_pork", ground: true }, SAYS_GROUND))).toHaveLength(1);
  });

  test("a whole lean cut ground fresh passes when the summaries say so", () => {
    const d = withProtein({ food: "lean_pork_leg", ground: true }, SAYS_GROUND);
    expect(minced(d)).toEqual([]);
    expect(ground(d)).toEqual([]);
    // Its nutrition is the cut's: 100 g of lean pork leg, not a mince row.
    expect(checkDish(withProtein({ food: "lean_pork_leg", ground: true }, SAYS_GROUND)).serving?.protein).toBeCloseTo(25, 6);
  });

  test("a ground line needs the summaries to say 现绞 and ground fresh, so the shopping list can ask for it", () => {
    expect(ground(withProtein({ food: "lean_pork_leg", ground: true }))).toHaveLength(1);
    expect(ground(withProtein({ food: "lean_pork_leg", ground: true }, { summary: SAYS_GROUND.summary }))).toHaveLength(1);
    expect(ground(withProtein({ food: "lean_pork_leg", ground: true }, { summaryEn: SAYS_GROUND.summaryEn }))).toHaveLength(1);
  });

  test("only a protein line of a meat or poultry cut can be ground", () => {
    expect(ground(withProtein({ food: "salmon", ground: true }, SAYS_GROUND))).toHaveLength(1);
    expect(ground(withProtein({ food: "firm_tofu", ground: true }, SAYS_GROUND))).toHaveLength(1);
    const veg = dish({ ...SAYS_GROUND, ingredients: [...BASE.slice(0, 1), { food: "tomato", grams: 130, role: "veg", ground: true }, ...BASE.slice(2)] });
    expect(ground(veg)).toHaveLength(1);
    const wayAddOn = batchMain({
      ways: [OVER_RICE, { ...IN_TORTILLA, addOns: [{ food: "chicken_breast", grams: 20, role: "topping", ground: true }] }],
    });
    expect(failures(wayAddOn).filter((x) => x.rule === "ground")).toMatchObject([{ way: 1 }]);
  });

  test("pre-packaged mince in a way's add-ons is rejected too, and spices named ground pass", () => {
    const d = batchMain({
      ways: [OVER_RICE, { ...IN_TORTILLA, addOns: [{ food: "ground_pork", grams: 20, role: "topping" }] }],
    });
    expect(minced(d)).toMatchObject([{ way: 1, food: "ground_pork" }]);
    const cumin = dish({ ingredients: [...BASE, { food: "ground_cumin", grams: 1, role: "seasoning" }] });
    expect(minced(cumin)).toEqual([]);
  });

  test("the only pre-packaged mince in the food table is ground_pork", () => {
    expect(FOODS.filter(isMincedMeat).map((f) => f.id)).toEqual(["ground_pork"]);
  });
});

describe("toppings", () => {
  test("a yogurt topping has no gram minimum; as a protein line it does", () => {
    // + greek yogurt 30 g: protein 28.06, factor 0.89095, yogurt 26.7 g
    // (under its 100 g minimum, fine as a topping), chicken 89.1 g.
    const yogurt = (role: "topping" | "protein") => dish({ ingredients: [...BASE, { food: "greek_yogurt", grams: 30, role }] });
    const r = checkDish(yogurt("topping"));
    expect(r.ok).toBe(true);
    // Its protein counts: the template now has 28.06 g, so it scales by 25 / 28.06.
    if (r.ok) expect(r.serving.factor).toBeCloseTo(25 / 28.06, 6);
    const f = only(yogurt("protein"), "protein_grams");
    expect(f.food).toBe("greek_yogurt");
    expect(f.actual!).toBeCloseTo((30 * 25) / 28.06, 6);
  });

  test("a topping's fat counts as added fat even when the food is not a fat", () => {
    // greek yogurt is a protein food, so as a protein line its fat is not
    // added; as a topping it is: 0.4 * 0.3 = 0.12 g before scaling.
    const asTopping = checkDish(dish({ ingredients: [...BASE, { food: "greek_yogurt", grams: 30, role: "topping" }] }));
    const asProtein = checkDish(dish({ ingredients: [...BASE, { food: "greek_yogurt", grams: 30, role: "protein" }] }));
    expect(asTopping.serving!.addedFat - asProtein.serving!.addedFat).toBeCloseTo((0.12 * 25) / 28.06, 6);
  });
});

describe("batch methods", () => {
  test("every hands-off method can be a batch main", () => {
    for (const method of ["stew", "braise", "pressure_cook", "slow_cook", "roast", "bake", "steam", "simmer"]) {
      expect(checkDish(batchMain({ method: method as never })).ok, method).toBe(true);
    }
  });

  test("stir-fry, pan-fry and the cold methods are made at the meal", () => {
    for (const method of ["stir_fry", "pan_fry", "cold_dress", "pickle", "marinate", "greens", "salad", "assemble"]) {
      const f = only(batchMain({ method: method as never }), "batch_method");
      expect(f.message, method).toStartWith(`${method} (`);
      expect(checkDish(dish({ method: method as never, prep: "fresh" })).ok, method).toBe(true);
    }
  });
});

describe("ways to eat a batch main", () => {
  test("each way is checked as the reference serving plus its add-ons", () => {
    // Over rice: the base, 176.8 kcal. In a tortilla: + tomato 50 (8.5 kcal,
    // 0.35 P, Na 1) + feta 10 (26.5 kcal, 1.42 P, 2.15 F, Na 113.9): 211.8
    // kcal, 26.77 P, added fat 7.15 g, sodium 411.45 mg, veg 180 g.
    const r = checkDish(batchMain());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ways).toHaveLength(2);
    expect(r.ways[0].kcal).toBeCloseTo(176.8, 6);
    const t = r.ways[1];
    expect(t.factor).toBeCloseTo(1, 6);
    expect(t.kcal).toBeCloseTo(211.8, 6);
    expect(t.protein).toBeCloseTo(26.77, 6);
    expect(t.addedFat).toBeCloseTo(7.15, 6);
    expect(t.sodium).toBeCloseTo(411.45, 6);
    expect(t.vegG).toBeCloseTo(180, 6);
  });

  test("a pot short of vegetables passes when every way adds them, and fails on the way that does not", () => {
    // tomato 60: protein 24.51, factor 25 / 24.51, veg 61.2 g. + 50 g salad
    // tomato on the way: 111.2 g.
    const thin = [BASE[0], { food: "tomato", grams: 60, role: "veg" as const }, BASE[2], BASE[3]];
    const salad: DishWay = { ...OVER_RICE, name: "配沙拉", nameEn: "With salad", addOns: [{ food: "tomato", grams: 50, role: "veg" }] };
    const r = checkDish(batchMain({ ingredients: thin, ways: [salad, IN_TORTILLA] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.ways[0].vegG).toBeCloseTo((60 * 25) / 24.51 + 50, 6);
    const f = only(batchMain({ ingredients: thin, ways: [salad, OVER_RICE] }), "vegetables");
    expect(f.way).toBe(1);
    expect(f.actual!).toBeCloseTo((60 * 25) / 24.51, 6);
    expect(f.message).toBe("way 2: vegetables 61 g are under 100 g");
  });

  test("a topping that tips one way over the fat limit fails that way", () => {
    // feta 25 g: added fat 5 + 5.375 = 10.375 g; sodium 296.55 + 284.75 = 581.3 passes
    const cheesy: DishWay = { ...IN_TORTILLA, addOns: [{ food: "feta", grams: 25, role: "topping" }] };
    const f = only(batchMain({ ways: [OVER_RICE, cheesy] }), "added_fat");
    expect(f).toMatchObject({ way: 1, limit: 10, message: "way 2: added fat 10.4 g is over 10 g" });
    expect(f.actual!).toBeCloseTo(10.375, 6);
  });

  test("a batch main has 2 to 3 ways", () => {
    expect(only(batchMain({ ways: [OVER_RICE] }), "ways")).toMatchObject({ actual: 1, limit: 2 });
    expect(only(batchMain({ ways: undefined }), "ways").message).toBe("a batch main needs 2 to 3 ways to eat it; this has 0");
    expect(checkDish(batchMain({ ways: [OVER_RICE, IN_TORTILLA, OVER_RICE] })).ok).toBe(true);
    expect(only(batchMain({ ways: [OVER_RICE, IN_TORTILLA, OVER_RICE, IN_TORTILLA] }), "ways")).toMatchObject({ actual: 4, limit: 3 });
  });

  test("only a batch main has ways", () => {
    expect(only(dish({ ways: [OVER_RICE, IN_TORTILLA] }), "ways").message).toBe("only a batch main has ways to eat it");
    expect(only(side({ ways: [OVER_RICE, IN_TORTILLA] }), "ways").rule).toBe("ways");
  });

  test("a batch main names its staples on its ways, not in staples", () => {
    expect(only(batchMain({ staples: ["brown_rice_cooked"] }), "staples").message).toBe(
      "a batch main names its staple on each way, not in staples",
    );
  });

  test("a way's staple is a staple food, a staple dish or none", () => {
    const self: DishWay = { ...OVER_RICE, staple: null };
    expect(checkDish(batchMain({ ways: [self, IN_TORTILLA] })).ok).toBe(true);
    const pot: DishWay = { ...OVER_RICE, staple: "brown_rice_pot" };
    expect(checkDish(batchMain({ ways: [pot, IN_TORTILLA] }), { stapleDishIds: new Set(["brown_rice_pot"]) }).ok).toBe(true);
    const bad: DishWay = { ...OVER_RICE, staple: "tomato" };
    expect(only(batchMain({ ways: [bad, IN_TORTILLA] }), "staples")).toMatchObject({ way: 0 });
  });

  test("add-ons are veg, fruit or topping lines", () => {
    const fruit: DishWay = { ...OVER_RICE, addOns: [{ food: "apple", grams: 100, role: "fruit" }] };
    expect(checkDish(batchMain({ ways: [fruit, IN_TORTILLA] })).ok).toBe(true);
    for (const line of [
      { food: "chicken_breast", grams: 50, role: "protein" as const },
      { food: "olive_oil", grams: 3, role: "oil" as const },
      { food: "brown_rice_cooked", grams: 100, role: "staple" as const },
    ]) {
      const way: DishWay = { ...OVER_RICE, addOns: [line] };
      const f = failures(batchMain({ ways: [way, IN_TORTILLA] })).filter((x) => x.rule === "line");
      expect(f, line.role).toEqual([
        { rule: "line", food: line.food, way: 0, message: `way 1: ${line.food}: line role ${line.role} is not allowed here` },
      ]);
    }
  });

  test("a way is put together in 5 minutes and has both names", () => {
    expect(ACTIVE_MIN.way).toBe(5);
    const slow: DishWay = { ...OVER_RICE, activeMin: 6 };
    expect(only(batchMain({ ways: [slow, IN_TORTILLA] }), "active_time")).toMatchObject({ way: 0, actual: 6, limit: 5 });
    const nameless: DishWay = { ...OVER_RICE, nameEn: " " };
    expect(only(batchMain({ ways: [nameless, IN_TORTILLA] }), "ways")).toMatchObject({ way: 0 });
  });
});

describe("sides", () => {
  test("a roast tray scales to 150 g of vegetables", () => {
    // factor 150 / 300; added fat 3 g; sodium (39 + 0.12 + 193.79) * 0.5 = 116.46 mg
    const r = checkDish(side());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.serving.factor).toBeCloseTo(0.5, 6);
    expect(r.serving.vegG).toBeCloseTo(150, 6);
    expect(r.serving.addedFat).toBeCloseTo(3, 6);
    expect(r.serving.sodium).toBeCloseTo(116.455, 6);
    expect(LIMITS.side).toEqual({ proteinShare: null, proteinShareWithStaple: null, addedFatG: 5, sodiumMg: 200, addedSugarG: 5, vegG: 150 });
  });

  test("sodium over 200 mg", () => {
    // salt 1 g: (39 + 0.12 + 387.58) * 0.5 = 213.35 mg
    const f = only(side({ ingredients: [...side().ingredients.slice(0, 2), { food: "salt", grams: 1, role: "seasoning" }] }), "sodium");
    expect(f.actual!).toBeCloseTo(213.35, 6);
    expect(f.limit).toBe(200);
  });

  test("added fat over 5 g", () => {
    // oil 12: 6 g
    const [veg, , salt] = side().ingredients;
    const f = only(side({ ingredients: [veg, { food: "olive_oil", grams: 12, role: "oil" }, salt] }), "added_fat");
    expect(f.actual!).toBeCloseTo(6, 6);
    expect(f.limit).toBe(5);
  });

  test("added sugar over 5 g", () => {
    // honey 12 g: 9.552 * 0.5 = 4.776 passes; 13 g: 10.348 * 0.5 = 5.174
    const honey = (grams: number) => side({ ingredients: [...side().ingredients, { food: "honey", grams, role: "seasoning" }] });
    expect(checkDish(honey(12)).ok).toBe(true);
    const f = only(honey(13), "added_sugar");
    expect(f.actual!).toBeCloseTo(5.174, 6);
    expect(f.limit).toBe(5);
  });

  test("no protein rule, and nothing to scale without vegetables", () => {
    // broccoli 300 + oil 10: protein 40.8 kcal of 187.4 = 21.8%, under any
    // main's share but a side has no protein rule; added fat 5 g, at the cap
    const [veg, , salt] = side().ingredients;
    const r = checkDish(side({ ingredients: [veg, { food: "olive_oil", grams: 10, role: "oil" }, salt] }));
    expect(r.ok).toBe(true);
    expect(only(side({ ingredients: [{ food: "potato", grams: 300, role: "staple" }] }), "scale").message).toBe(
      "the ingredients have no vegetables to scale the reference serving by",
    );
  });

  test("steamed greens are made at the meal", () => {
    expect(only(side({ method: "greens" }), "batch_method").rule).toBe("batch_method");
    expect(checkDish(side({ method: "greens", prep: "fresh", equipment: ["stove"] })).ok).toBe(true);
  });

  test("a side lists no staples", () => {
    expect(only(side({ staples: ["brown_rice_cooked"] }), "staples").message).toBe("only a fresh main lists staples; a side has none");
  });
});

describe("breakfast templates", () => {
  test("a boiled egg and toast", () => {
    // as written: 16.84 g protein, share 67.36 / 220.2 = 30.6%, sodium 147 + 159.25 = 306.25 mg
    const r = checkDish(breakfast());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.serving.factor).toBe(1);
      expect(r.serving.protein).toBeCloseTo(16.84, 2);
      expect(r.serving.sodium).toBeCloseTo(306.25, 2);
    }
  });

  test("with a fruit", () => {
    // + apple 100: protein 17.04, kcal 267.2, share 68.16 / 267.2 = 25.5%
    const r = checkDish(breakfast({ ingredients: [...BREAKFAST, { food: "apple", grams: 100, role: "fruit" }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.serving.protein).toBeCloseTo(17.04, 2);
  });

  test("each allowed method", () => {
    for (const method of ["assemble", "simmer", "microwave", "steam", "toast"]) {
      expect(checkDish(breakfast({ method: method as never })).ok, method).toBe(true);
    }
    expect(only(breakfast({ method: "pan_fry" }), "breakfast_method").message).toBe(
      "a breakfast is made by assemble, simmer, microwave, steam, toast, not pan_fry",
    );
    expect(only(breakfast({ method: "stew" }), "breakfast_method").rule).toBe("breakfast_method");
  });

  test("hands-on at most 5 minutes", () => {
    expect(only(breakfast({ activeMin: 6 }), "active_time")).toMatchObject({
      actual: 6,
      limit: 5,
      message: "hands-on 6 min is over 5 min for a breakfast",
    });
  });

  test("never batch", () => {
    expect(only(breakfast({ prep: "batch", method: "steam" }), "prep").message).toBe(
      "a breakfast is put together at the meal and is never batch",
    );
  });

  test("at least one protein and one staple, any number of either", () => {
    // egg alone: 12.5 P, 132 kcal, share 37.9%
    const noStaple = failures(breakfast({ ingredients: [BREAKFAST[0]] })).find((x) => x.rule === "breakfast_items");
    expect(noStaple?.message).toBe("a breakfast needs at least one protein item and one staple item; this has 1 protein, 0 staple");
    const noProtein = failures(breakfast({ ingredients: [BREAKFAST[1]] })).find((x) => x.rule === "breakfast_items");
    expect(noProtein?.message).toBe("a breakfast needs at least one protein item and one staple item; this has 0 protein, 1 staple");
  });

  test("two protein items, two staples and two fruits are fine", () => {
    // egg 50 + milk 250 + toast 35 + oats 20 + apple 80 + banana 60: 6.25 + 8.25 + 4.34 + 2.46 = 21.3 g protein
    const many: DishIngredient[] = [
      { food: "egg", grams: 50, role: "protein" },
      { food: "low_fat_milk", grams: 250, role: "protein" },
      { food: "whole_wheat_toast", grams: 35, role: "staple" },
      { food: "oats", grams: 20, role: "staple" },
      { food: "apple", grams: 80, role: "fruit" },
      { food: "banana", grams: 60, role: "fruit" },
    ];
    expect(checkDish(breakfast({ ingredients: many })).ok).toBe(true);
  });

  test("a breakfast is not scaled: its grams are the serving", () => {
    const r = checkDish(breakfast());
    expect(r.ok && r.serving.ingredients.map((i) => i.grams)).toEqual([100, 35]);
  });

  test("total protein at least 15 g", () => {
    // egg 50 + toast 35: 6.25 + 4.34 = 10.6 g, share 42 / 154 = 27%
    const f = only(breakfast({ ingredients: [{ ...BREAKFAST[0], grams: 50 }, BREAKFAST[1]] }), "breakfast_protein");
    expect(f.actual!).toBeCloseTo(10.59, 2);
    expect(f.limit).toBe(15);
    expect(f.message).toBe("a breakfast has 10.6 g protein, under 15 g");
  });

  test("each protein line stays inside its own gram range, with several lines too", () => {
    // egg 40 g is under 50; with milk 250 and toast 35 the total protein is 17.6 g
    const f = only(
      breakfast({ ingredients: [{ food: "egg", grams: 40, role: "protein" }, { food: "low_fat_milk", grams: 250, role: "protein" }, BREAKFAST[1]] }),
      "protein_grams",
    );
    expect(f).toMatchObject({ food: "egg", actual: 40, limit: 50 });
  });

  test("protein share under 20%", () => {
    // egg 50 + white toast 150: protein 6.25 + 14.25 = 20.5, kcal 66 + 424.5 =
    // 490.5, share 82 / 490.5 = 16.7%
    const f = failures(
      breakfast({
        method: "assemble",
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

  test("no sodium cap: it only counts toward the day total", () => {
    // egg 100 + toast 35 + soy 6: sodium 306.25 + 299.82 = 606.07 mg
    const d = breakfast({ ingredients: [...BREAKFAST, { food: "light_soy_sauce", grams: 6, role: "seasoning" }] });
    const r = checkDish(d);
    expect(r.serving?.sodium).toBeCloseTo(606.07, 2);
    expect(failures(d).filter((x) => x.rule === "sodium")).toEqual([]);
    expect(LIMITS.breakfast.sodiumMg).toBeNull();
    expect(LIMITS.main.sodiumMg).toBe(600);
  });

  test("a breakfast lists no staples beside its staple line", () => {
    expect(only(breakfast({ staples: ["brown_rice_cooked"] }), "staples").rule).toBe("staples");
  });
});

describe("summary", () => {
  test("a dish needs a Chinese and an English summary", () => {
    expect(only(dish({ summary: "" }), "summary").rule).toBe("summary");
    expect(only(dish({ summary: "  " }), "summary").rule).toBe("summary");
    expect(only(dish({ summaryEn: "" }), "summary").rule).toBe("summary");
  });

  test("the Chinese summary is at most 40 characters", () => {
    expect(checkDish(dish({ summary: "字".repeat(SUMMARY_MAX_CHARS) })).ok).toBe(true);
    expect(only(dish({ summary: "字".repeat(SUMMARY_MAX_CHARS + 1) }), "summary")).toMatchObject({ actual: 41, limit: 40 });
  });
});

describe("time rules", () => {
  test("a batch pot may take 20 hands-on minutes, any wait", () => {
    expect(checkDish(batchMain({ activeMin: 20, totalMin: 240 })).ok).toBe(true);
    const f = only(batchMain({ activeMin: 25, totalMin: 240 }), "active_time");
    expect(f).toMatchObject({ actual: 25, limit: 20, message: "hands-on 25 min is over 20 min for a batch pot" });
  });

  test("a fresh dish may take 15", () => {
    expect(checkDish(dish({ activeMin: 15, totalMin: 15 })).ok).toBe(true);
    expect(only(dish({ activeMin: 16, totalMin: 20 }), "active_time")).toMatchObject({ actual: 16, limit: 15 });
  });

  test("total minutes below hands-on minutes", () => {
    only(dish({ activeMin: 15, totalMin: 10 }), "times");
  });
});
