// The docs/671 columns on the food table: sodium, added sugar, protein
// category, not-freezable and grams per piece, and the compound seasonings.

import { describe, expect, test } from "bun:test";
import { ADDED_SUGAR_G, NOT_FREEZABLE, PIECE_G, PROTEIN_CATEGORY, SODIUM_MG } from "../../../../src/info/meals/nutrition/food-columns";
import { FOOD_TABLE } from "../../../../src/info/meals/nutrition/food-table";
import { FOODS, PROTEIN_CATEGORIES, foodById, isProduce } from "../../../../src/info/meals/nutrition/foods";
import { ADDED_FOODS } from "../../../../src/info/meals/nutrition/added-foods";
import { COMPOUND_SEASONINGS } from "../../../../src/info/meals/nutrition/seasonings";

const ids = new Set(FOODS.map((f) => f.id));

describe("food table columns", () => {
  test("every row has sodium and added sugar", () => {
    const missing = FOODS.filter((f) => !Number.isFinite(f.sodium) || !Number.isFinite(f.addedSugar)).map((f) => f.id);
    expect(missing).toEqual([]);
    for (const f of FOODS) {
      expect(f.sodium!, f.id).toBeGreaterThanOrEqual(0);
      expect(f.addedSugar!, f.id).toBeGreaterThanOrEqual(0);
      expect(f.addedSugar!, f.id).toBeLessThanOrEqual(f.carbs + 0.01);
    }
  });

  test("the overlay maps name only real rows, and every generated row has sodium", () => {
    for (const m of [SODIUM_MG, ADDED_SUGAR_G, PROTEIN_CATEGORY, PIECE_G]) {
      for (const id of Object.keys(m)) expect(ids.has(id), id).toBe(true);
    }
    for (const id of NOT_FREEZABLE) expect(ids.has(id), id).toBe(true);
    const unsourced = FOOD_TABLE.filter((f) => SODIUM_MG[f.id] == null).map((f) => f.id);
    expect(unsourced).toEqual([]);
  });

  test("a sodium figure from another record names it", () => {
    expect(foodById("light_soy_sauce")?.sodium).toBe(4997);
    expect(foodById("light_soy_sauce")?.sodiumSource).toBeUndefined();
    expect(foodById("olive_oil")?.sodiumSource).toMatchObject({ kind: "usda", fdcId: 171413 });
    expect(foodById("whole_wheat_bun")?.sodiumSource).toMatchObject({ kind: "tw", code: "R2400201" });
  });

  test("every seasoning row has an added-sugar entry; whole foods count 0", () => {
    for (const f of FOOD_TABLE.filter((x) => x.roles.includes("sauce"))) {
      expect(ADDED_SUGAR_G[f.id], f.id).toBeDefined();
    }
    expect(foodById("chicken_breast")?.addedSugar).toBe(0);
    expect(foodById("apple")?.addedSugar).toBe(0);
    expect(foodById("honey")?.addedSugar).toBe(79.6);
  });

  test("every protein food has a protein category", () => {
    const missing = FOODS.filter((f) => f.roles.includes("protein") && !f.proteinCategory).map((f) => f.id);
    expect(missing).toEqual([]);
    for (const f of FOODS) if (f.proteinCategory) expect(PROTEIN_CATEGORIES).toContain(f.proteinCategory);
    expect(foodById("chicken_thigh")?.proteinCategory).toBe("poultry");
    expect(foodById("lean_beef")?.proteinCategory).toBe("meat");
    expect(foodById("cod")?.proteinCategory).toBe("seafood");
    expect(foodById("tea_egg")?.proteinCategory).toBe("egg");
    expect(foodById("firm_tofu")?.proteinCategory).toBe("soy");
    expect(foodById("greek_yogurt")?.proteinCategory).toBe("dairy");
    expect(foodById("canned_chickpeas")?.proteinCategory).toBe("legume");
  });

  test("not freezable covers the docs/671 list", () => {
    for (const id of ["egg", "firm_tofu", "soft_tofu", "potato", "spinach", "bok_choy"]) {
      expect(foodById(id)?.noFreeze, id).toBe(true);
    }
    expect(foodById("chicken_breast")?.noFreeze).toBeUndefined();
    expect(foodById("frozen_tofu")?.noFreeze).toBeUndefined();
  });

  test("piece weights are on produce, staples and citrus only and leave unit alone", () => {
    for (const f of FOODS.filter((x) => x.piece)) {
      expect(isProduce(f) || f.roles.includes("staple") || f.category === "produce", f.id).toBe(true);
      expect(f.piece!.grams, f.id).toBeGreaterThan(0);
      expect(f.unit, f.id).toBeUndefined();
    }
    expect(foodById("apple")?.piece).toEqual({ grams: 182, label: "个" });
    expect(foodById("onion")?.piece).toEqual({ grams: 110, label: "个" });
  });
});

describe("compound seasonings", () => {
  const WANT = [
    "garlic_powder",
    "garlic_paste",
    "ginger_paste",
    "ground_ginger",
    "curry_roux",
    "curry_powder",
    "gochujang",
    "miso",
    "doubanjiang",
    "oyster_sauce",
    "light_soy_sauce",
    "reduced_salt_soy_sauce",
    "teriyaki_sauce",
    "taco_seasoning",
    "fajita_seasoning",
    "italian_seasoning",
    "lemon_pepper_seasoning",
    "smoked_paprika",
    "zaatar",
    "harissa",
    "pesto",
    "cajun_seasoning",
    "five_spice_powder",
    "ground_cumin",
    "chili_crisp",
  ];

  test("the spread across cuisines is in the table", () => {
    for (const id of WANT) expect(foodById(id), id).toBeDefined();
  });

  test("each added row is a pantry seasoning that cites its label or record", () => {
    for (const f of COMPOUND_SEASONINGS) {
      expect(f.roles, f.id).toContain("sauce");
      expect(f.category, f.id).toBe("pantry");
      expect(f.sodium, f.id).toBeDefined();
      expect(f.addedSugar, f.id).toBeDefined();
      const s = f.source;
      if (s.kind === "label") expect(s.note, f.id).toMatch(/Open Food Facts \d+/);
    }
  });

  test("the reduced-salt soy sauce has less sodium than the plain one", () => {
    expect(foodById("reduced_salt_soy_sauce")!.sodium!).toBeLessThan(foodById("light_soy_sauce")!.sodium!);
  });
});

describe("foods added for the dish library", () => {
  test("each cites its record and carries the docs/671 columns", () => {
    for (const f of ADDED_FOODS) {
      expect(foodById(f.id), f.id).toBeDefined();
      expect(Number.isFinite(f.sodium), f.id).toBe(true);
      expect(Number.isFinite(f.addedSugar), f.id).toBe(true);
      const s = f.source;
      if (s.kind === "usda") expect(s.dataset, f.id).toBe("SR Legacy");
      else expect(s.kind === "label" && /Open Food Facts \d+/.test(s.note), f.id).toBe(true);
      if (f.roles.includes("protein")) expect(f.proteinCategory, f.id).toBeDefined();
    }
  });

  test("sodium per 100 g as the records give it", () => {
    const want: Record<string, number> = {
      salt: 38758,
      lemon: 2,
      lime: 2,
      light_coconut_milk: 40,
      ground_turkey: 69,
      lean_beef_mince: 66,
      chicken_mince: 60,
      crushed_tomatoes: 186,
      low_sodium_stock: 30,
      red_lentils_dry: 7,
      lentils_dry: 6,
      feta: 1139,
      corn_tortilla: 45,
      breadcrumbs: 732,
      sesame_seeds: 11,
      coriander: 46,
      parsley: 56,
      basil: 4,
      dill: 61,
      mint: 30,
    };
    expect(ADDED_FOODS.map((f) => f.id).sort()).toEqual(Object.keys(want).sort());
    for (const [id, mg] of Object.entries(want)) expect(foodById(id)?.sodium, id).toBe(mg);
  });

  test("protein category, added sugar, pieces and packs", () => {
    expect(foodById("ground_turkey")?.proteinCategory).toBe("poultry");
    expect(foodById("chicken_mince")?.proteinCategory).toBe("poultry");
    expect(foodById("lean_beef_mince")?.proteinCategory).toBe("meat");
    expect(foodById("red_lentils_dry")?.proteinCategory).toBe("legume");
    expect(foodById("lentils_dry")?.proteinCategory).toBe("legume");
    expect(foodById("feta")?.proteinCategory).toBe("dairy");
    for (const id of ["ground_turkey", "lean_beef_mince", "chicken_mince"]) expect(foodById(id)?.potG, id).toBe(500);
    expect(foodById("breadcrumbs")?.addedSugar).toBe(6.2);
    expect(foodById("light_coconut_milk")?.addedSugar).toBe(0.8);
    for (const id of ["salt", "lemon", "lime", "crushed_tomatoes", "coriander", "basil"]) {
      expect(foodById(id)?.addedSugar, id).toBe(0);
    }
    expect(foodById("lemon")?.piece).toEqual({ grams: 84, label: "个" });
    expect(foodById("lime")?.piece).toEqual({ grams: 67, label: "个" });
    expect(foodById("corn_tortilla")?.piece).toEqual({ grams: 24, label: "张" });
  });

  test("roles fit the lines they are meant for", () => {
    // Salt, citrus, stock, coconut milk, breadcrumbs and herbs season or top a dish.
    const seasoning = [
      "salt",
      "lemon",
      "lime",
      "low_sodium_stock",
      "light_coconut_milk",
      "breadcrumbs",
      "coriander",
      "parsley",
      "basil",
      "dill",
      "mint",
    ];
    for (const id of seasoning) expect(foodById(id)?.roles, id).toEqual(["sauce"]);
    expect(foodById("crushed_tomatoes")?.roles).toEqual(["veg"]);
    expect(foodById("corn_tortilla")?.roles).toEqual(["staple"]);
    expect(foodById("feta")?.roles).toEqual(["dairy", "fat"]);
    expect(foodById("sesame_seeds")?.roles).toEqual(["fat"]);
    expect(foodById("lentils_dry")?.roles).toEqual(["protein", "staple"]);
  });
});
