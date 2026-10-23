// The ready-made dry seasonings in the food table (docs/73 调味): one jar or
// packet each, a few grams a meal, solved as fixed items.

import { describe, expect, test } from "bun:test";
import { foodAllowed, foodById, type Food, type FoodTag } from "../../../../src/info/meals/nutrition/foods";
import { templateProblems } from "../../../../src/info/meals/plan/checks";
import { FLAVOURS, type Meal } from "../../../../src/info/meals/plan/types";

const SEASONINGS = [
  "curry_powder",
  "ground_cumin",
  "ground_black_pepper",
  "garlic_powder",
  "five_spice_powder",
  "ground_cinnamon",
  "smoked_paprika",
  "chili_powder_blend",
  "poultry_seasoning",
  "dried_oregano",
  "dried_dill",
  "cajun_seasoning",
  "lemon_pepper_seasoning",
  "garlic_herb_seasoning",
  "italian_seasoning",
  "fajita_seasoning",
  "taco_seasoning",
  "bbq_seasoning",
];

const ALLERGENS: FoodTag[] = ["nuts", "gluten", "soy", "dairy", "egg", "seafood", "fish"];

function food(id: string): Food {
  const f = foodById(id);
  if (!f) throw new Error(`no food ${id}`);
  return f;
}

describe("ready-made seasonings", () => {
  test("each is a pantry seasoning at a few grams", () => {
    for (const id of SEASONINGS) {
      const f = food(id);
      expect(f.roles, id).toEqual(["sauce"]);
      expect(f.category, id).toBe("pantry");
      expect(f.keeps, id).toBe("pantry");
      expect(f.minG, id).toBeGreaterThanOrEqual(1);
      expect(f.maxG, id).toBeLessThanOrEqual(12);
      expect(f.defaultG, id).toBeUndefined();
      expect(f.unit, id).toBeUndefined();
      expect(f.potG, id).toBeUndefined();
    }
  });

  test("each names a database row or a label it was read from", () => {
    expect(food("curry_powder").source).toEqual({ kind: "tw", code: "P0200401", name: "咖哩粉" });
    expect(food("ground_cumin").source).toMatchObject({ kind: "tw", code: "P0100201" });
    expect(food("smoked_paprika").source).toMatchObject({ kind: "usda", fdcId: 171329, dataset: "SR Legacy" });
    expect(food("poultry_seasoning").source).toMatchObject({ kind: "usda", fdcId: 171331 });
    const labels = SEASONINGS.slice(SEASONINGS.indexOf("cajun_seasoning"));
    for (const id of labels) {
      const s = food(id).source;
      expect(s.kind, id).toBe("label");
      if (s.kind === "label") expect(s.note, id).toMatch(/label per 100 g \(Open Food Facts \d{8,13}\)$/);
    }
  });

  test("allergen tags follow what the sources list: only the BBQ blend's milk", () => {
    expect(food("bbq_seasoning").tags).toContain("dairy");
    expect(foodAllowed(food("bbq_seasoning"), ["dairy"])).toBe(false);
    for (const id of SEASONINGS.filter((s) => s !== "bbq_seasoning")) {
      const tags = food(id).tags;
      expect(tags.filter((t) => ALLERGENS.includes(t)), id).toEqual([]);
    }
  });

  test("the hot blends are tagged spicy, so a reader who avoids spicy food never gets them", () => {
    for (const id of ["chili_powder_blend", "cajun_seasoning", "fajita_seasoning", "taco_seasoning", "bbq_seasoning"]) {
      expect(food(id).tags, id).toContain("spicy");
    }
    for (const id of ["lemon_pepper_seasoning", "garlic_herb_seasoning", "italian_seasoning", "smoked_paprika"]) {
      expect(food(id).tags, id).not.toContain("spicy");
    }
  });

  test("a meal takes a blend as a fixed item inside its range", () => {
    const meal = (grams: number): Meal => ({
      mode: "make",
      name: "Cajun chicken rice",
      searchName: "cajun chicken rice bowl",
      flavour: "cajun",
      method: "Rub with cajun the night before; roast 20 min.",
      minutes: 10,
      items: [
        { foodId: "chicken_breast", role: "protein" },
        { foodId: "microwave_grain_rice", role: "staple" },
        { foodId: "frozen_mixed_veg", role: "fixed", grams: 150 },
        { foodId: "cajun_seasoning", role: "fixed", grams },
      ],
    });
    expect(templateProblems("Day 1 dinner", meal(3), "dinner")).toEqual([]);
    expect(templateProblems("Day 1 dinner", meal(20), "dinner")).toEqual([
      "Day 1 dinner: 20 g of cajun_seasoning is outside its 2–5 g range.",
    ]);
  });
});

describe("flavours", () => {
  test("the blend flavours come first and the cuisine-bound ones are marked local", () => {
    const ids: string[] = FLAVOURS.map((f) => f.id);
    for (const id of ["herb", "cajun", "tex-mex", "smoked-paprika", "cumin", "bbq", "lemon-pepper", "black-pepper"]) {
      expect(ids).toContain(id);
    }
    const local = FLAVOURS.filter((f) => f.local).map((f) => f.id);
    expect(local).toEqual(["soy-ginger", "scallion-oil", "sesame", "teriyaki", "sweet-sour", "spicy-sichuan", "hot-sour", "miso"]);
    const firstLocal = FLAVOURS.findIndex((f) => f.local);
    expect(FLAVOURS.slice(firstLocal).every((f) => f.local)).toBe(true);
    // Enough everyday flavours that the no-two-in-a-row rule never needs a local one.
    expect(firstLocal).toBeGreaterThanOrEqual(12);
  });
});
