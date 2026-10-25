// The columns the planner reads off the food table (docs/671): whole grain,
// retail pack, swap group, and the avocado row that replaces the generated one.
// Run: scripts/t.sh tests/info/meals/nutrition/planner-columns.test.ts

import { describe, expect, test } from "bun:test";
import { NUTRIENT_OVERRIDES, RETAIL_PACK, WHOLE_GRAIN, type PackKind } from "../../../../src/info/meals/nutrition/food-columns";
import { FOODS, foodById } from "../../../../src/info/meals/nutrition/foods";
import { SWAP_GROUPS, SWAP_GROUP_OF } from "../../../../src/info/meals/nutrition/swap-groups";

const PACK_KINDS: readonly PackKind[] = ["box", "bag", "block", "carton", "head", "bunch", "loaf"];
const ids = new Set(FOODS.map((f) => f.id));

describe("whole grain", () => {
  test("every whole-grain id is a food, and the flag lands on exactly those", () => {
    for (const id of WHOLE_GRAIN) expect(ids.has(id), id).toBe(true);
    const flagged = FOODS.filter((f) => f.wholeGrain).map((f) => f.id).sort();
    expect(flagged).toEqual([...WHOLE_GRAIN].sort());
  });

  test("potatoes and white staples are not whole grain; brown rice and oats are", () => {
    for (const id of ["potato", "baby_potato", "sweet_potato", "purple_sweet_potato", "rice_cooked", "white_toast", "pasta_dry"]) {
      expect(foodById(id)?.wholeGrain, id).toBeUndefined();
    }
    for (const id of ["brown_rice_cooked", "oats", "quinoa_cooked", "whole_wheat_toast"]) {
      expect(foodById(id)?.wholeGrain, id).toBe(true);
    }
  });
});

describe("retail pack", () => {
  test("every pack has positive grams, a known kind and positive open days", () => {
    const withPack = FOODS.filter((f) => f.pack);
    expect(withPack.length).toBeGreaterThan(0);
    for (const f of withPack) {
      expect(f.pack!.grams, f.id).toBeGreaterThan(0);
      expect(PACK_KINDS, f.id).toContain(f.pack!.kind);
      expect(f.pack!.openDays, f.id).toBeGreaterThan(0);
    }
  });

  test("the pack table names only real foods, and every entry reaches its food", () => {
    for (const [id, pack] of Object.entries(RETAIL_PACK)) {
      expect(ids.has(id), id).toBe(true);
      expect(foodById(id)?.pack, id).toEqual(pack);
    }
    expect(FOODS.filter((f) => f.pack).length).toBe(Object.keys(RETAIL_PACK).length);
  });

  test("a food's pack is a copy, not the table's object", () => {
    const first = Object.keys(RETAIL_PACK)[0];
    expect(foodById(first)?.pack).not.toBe(RETAIL_PACK[first]);
  });
});

describe("swap groups", () => {
  test("every member of every tier exists as a food and points back at its group", () => {
    for (const g of SWAP_GROUPS) {
      for (const id of g.tiers.flat()) {
        expect(ids.has(id), `${g.id}: ${id}`).toBe(true);
        expect(foodById(id)?.swapGroup, id).toBe(g.id);
      }
    }
  });

  test("a food is in at most one group, and no tier is empty", () => {
    const all = SWAP_GROUPS.flatMap((g) => g.tiers.flat());
    expect(new Set(all).size).toBe(all.length);
    expect(new Set(SWAP_GROUPS.map((g) => g.id)).size).toBe(SWAP_GROUPS.length);
    for (const g of SWAP_GROUPS) for (const tier of g.tiers) expect(tier.length, g.id).toBeGreaterThan(0);
    expect(SWAP_GROUP_OF.size).toBe(all.length);
  });

  test("a food outside the table is in no group", () => {
    for (const f of FOODS) if (!SWAP_GROUP_OF.has(f.id)) expect(f.swapGroup, f.id).toBeUndefined();
  });
});

describe("avocado", () => {
  // USDA FDC 171706, SR Legacy "Avocados, raw, California", per 100 g:
  // 167 kcal, protein 1.96 g, fat 15.41 g, carbohydrate 8.64 g, sodium 8 mg
  // (checked against the FoodData_Central_sr_legacy_food_csv_2018-04 download).
  test("the row carries the USDA California values, not the Taiwan variety's", () => {
    const f = foodById("avocado");
    expect(f).toMatchObject({ kcal: 167, protein: 2.0, fat: 15.4, carbs: 8.6, sodium: 8 });
    expect(f?.source).toEqual({ kind: "usda", fdcId: 171706, dataset: "SR Legacy", name: "Avocados, raw, California" });
  });

  test("the override is the only place that sets them", () => {
    expect(Object.keys(NUTRIENT_OVERRIDES)).toEqual(["avocado"]);
    expect(NUTRIENT_OVERRIDES.avocado).toMatchObject({ kcal: 167, protein: 2.0, fat: 15.4, carbs: 8.6 });
  });
});

describe("table size", () => {
  test("at most 260 foods", () => {
    expect(FOODS.length).toBeLessThanOrEqual(260);
  });

  test("ids are unique", () => {
    expect(ids.size).toBe(FOODS.length);
  });
});
