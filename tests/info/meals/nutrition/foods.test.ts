import { describe, expect, test } from "bun:test";
import {
  FOOD_TAGS,
  FOODS,
  TAIWAN_FDA_CREDIT,
  TAIWAN_FDA_DATASET_URL,
  TAIWAN_FDA_LICENSE_URL,
  TAIWAN_FDA_VERSION,
  USDA_FDC_CREDIT,
  findFood,
  foodAllowed,
  foodById,
  isProduce,
  sourceLabel,
  type Food,
} from "../../../../src/info/meals/nutrition/foods";
import { ingredientImageUrl } from "../../../../src/info/meals/images";
import {
  CATEGORY_ORDER,
  KEEPS_ORDER,
  type IngredientCategory,
  type KeepsClass,
} from "../../../../src/info/meals/types";

const ROLES = ["protein", "staple", "veg", "fruit", "fat", "sauce", "dairy"];

describe("food table integrity", () => {
  test("size and unique snake_case ids", () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(150);
    expect(FOODS.length).toBeLessThanOrEqual(220);
    const ids = FOODS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  test("every row has its numbers", () => {
    for (const f of FOODS) {
      for (const v of [f.kcal, f.protein, f.fat, f.carbs]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(f.kcal).toBeGreaterThan(0);
      expect(f.protein + f.fat + f.carbs).toBeLessThanOrEqual(101);
    }
  });

  test("kcal is consistent with 4/9/4 from the macros", () => {
    // 總碳水化合物 includes fibre, which 修正熱量 counts at far less than 4
    // kcal/g, so leafy greens and seaweed sit well under plain 4/9/4. This only
    // catches a row whose columns were read into the wrong fields.
    const off = FOODS.filter((f) => {
      const atwater = 4 * f.protein + 9 * f.fat + 4 * f.carbs;
      return f.kcal < atwater * 0.55 || f.kcal > atwater * 1.15;
    }).map((f) => `${f.id} ${f.kcal} vs ${4 * f.protein + 9 * f.fat + 4 * f.carbs}`);
    expect(off).toEqual([]);
  });

  test("categories, keeps, roles and tags are known values", () => {
    for (const f of FOODS) {
      const c: IngredientCategory = f.category;
      const k: KeepsClass = f.keeps;
      expect(CATEGORY_ORDER).toContain(c);
      expect(KEEPS_ORDER).toContain(k);
      expect(f.roles.length).toBeGreaterThan(0);
      for (const r of f.roles) expect(ROLES).toContain(r);
      for (const t of f.tags) expect(FOOD_TAGS).toContain(t);
    }
  });

  test("gram ranges, defaults and units make sense", () => {
    for (const f of FOODS) {
      expect(f.minG).toBeGreaterThanOrEqual(0);
      expect(f.maxG).toBeGreaterThan(f.minG);
      if (f.defaultG != null) {
        expect(f.defaultG).toBeGreaterThanOrEqual(f.minG);
        expect(f.defaultG).toBeLessThanOrEqual(f.maxG);
      }
      if (f.unit) {
        expect(f.unit.grams).toBeGreaterThan(0);
        expect(f.unit.label.length).toBeGreaterThan(0);
      }
    }
    expect(foodById("egg")?.unit).toEqual({ grams: 50, label: "个" });
    for (const f of FOODS.filter((x) => x.roles.includes("fat") && x.roles.length === 1)) {
      expect(f.defaultG).toBeDefined();
    }
  });

  test("every row names its source", () => {
    for (const f of FOODS) {
      const s = f.source;
      if (s.kind === "tw") expect(s.code).toMatch(/^[A-R]\d{4,7}$/);
      else if (s.kind === "usda") expect(Number.isInteger(s.fdcId)).toBe(true);
      else expect(s.note.length).toBeGreaterThan(0);
      expect(sourceLabel(f).length).toBeGreaterThan(0);
    }
    const tw = FOODS.filter((f) => f.source.kind === "tw").length;
    expect(tw).toBeGreaterThan(FOODS.length / 2);
  });

  test("every photo name resolves in images.ts or is left empty", () => {
    const unresolved = FOODS.filter((f) => f.en && !ingredientImageUrl(f.en)).map((f) => `${f.id}: ${f.en}`);
    expect(unresolved).toEqual([]);
  });

  test("no name or alias points at two foods", () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const f of FOODS) {
      for (const n of new Set([f.zh, ...f.aliases])) {
        const prev = owner.get(n);
        if (prev && prev !== f.id) clashes.push(`${n}: ${prev} / ${f.id}`);
        owner.set(n, f.id);
      }
    }
    expect(clashes).toEqual([]);
  });

  test("the attribution the Method screen shows", () => {
    expect(TAIWAN_FDA_CREDIT).toContain("食品營養成分資料集");
    expect(TAIWAN_FDA_CREDIT).toContain("政府資料開放授權條款－第1版");
    expect(TAIWAN_FDA_LICENSE_URL).toBe("https://data.gov.tw/license");
    expect(TAIWAN_FDA_DATASET_URL).toBe("https://data.gov.tw/dataset/8543");
    expect(TAIWAN_FDA_VERSION).toBe("2026-08-27");
    expect(USDA_FDC_CREDIT).toContain("CC0");
  });
});

describe("lookups", () => {
  test("by id, name, alias and the name without its note", () => {
    expect(findFood("egg")?.id).toBe("egg");
    expect(findFood("鸡蛋")?.id).toBe("egg");
    expect(findFood("蕹菜")?.id).toBe("water_spinach");
    expect(findFood("青江菜")?.id).toBe("bok_choy");
    expect(findFood("油菜心")?.id).toBe("choy_sum");
    expect(findFood("鸡胸肉")?.id).toBe("chicken_breast");
    expect(findFood("即食鸡胸")?.id).toBe("ready_chicken_breast");
    expect(findFood("全麦意面(干)")?.id).toBe("whole_wheat_pasta_dry");
    expect(findFood(" 西红柿 ")?.id).toBe("tomato");
    expect(findFood("龙虾")).toBeUndefined();
    expect(foodById("nope")).toBeUndefined();
  });

  test("dislikes by tag, id or name", () => {
    const beef = foodById("braised_beef_shank") as Food;
    const shrimp = foodById("frozen_shrimp") as Food;
    const salmon = foodById("salmon") as Food;
    expect(foodAllowed(beef, ["beef"])).toBe(false);
    expect(foodAllowed(shrimp, ["beef"])).toBe(true);
    expect(foodAllowed(shrimp, ["seafood"])).toBe(false);
    expect(foodAllowed(shrimp, ["fish"])).toBe(true);
    expect(foodAllowed(salmon, ["fish"])).toBe(false);
    expect(foodAllowed(salmon, ["三文鱼"])).toBe(false);
    expect(foodAllowed(foodById("chili_sauce") as Food, ["spicy"])).toBe(false);
    expect(foodAllowed(foodById("egg") as Food, ["蛋"])).toBe(false);
  });

  test("produce is veg or fruit", () => {
    expect(isProduce(foodById("broccoli") as Food)).toBe(true);
    expect(isProduce(foodById("banana") as Food)).toBe(true);
    expect(isProduce(foodById("oats") as Food)).toBe(false);
  });

  test("enough fish rows for the twice-a-week check", () => {
    expect(FOODS.filter((f) => f.tags.includes("fish")).length).toBeGreaterThanOrEqual(6);
  });
});
