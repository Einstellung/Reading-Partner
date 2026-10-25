// Swapping a food the user cannot buy (docs/671 替换组).
// Run: scripts/t.sh tests/info/meals/dishes/swap.test.ts

import { describe, expect, test } from "bun:test";
import { checkDish, type CheckOptions } from "../../../../src/info/meals/dishes/check";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import { dishFoods, swapCandidates, swapFood, swapUnavailable } from "../../../../src/info/meals/dishes/swap";
import type { Dish } from "../../../../src/info/meals/dishes/types";
import { foodById } from "../../../../src/info/meals/nutrition/foods";
import { SWAP_GROUP_OF } from "../../../../src/info/meals/nutrition/swap-groups";

const OPTS: CheckOptions = { stapleDishIds: new Set(SEED_DISHES.filter((d) => d.role === "staple").map((d) => d.id)) };

function dish(id: string): Dish {
  const d = SEED_DISHES.find((x) => x.id === id);
  if (!d) throw new Error(`no seed dish ${id}`);
  return structuredClone(d);
}

/** Protein grams of a dish's protein-role lines. */
function protein(d: Dish): number {
  return d.ingredients
    .filter((l) => l.role === "protein")
    .reduce((s, l) => s + ((foodById(l.food)?.protein ?? 0) * l.grams) / 100, 0);
}

const inGroup = (group: string) => (food: string) => SWAP_GROUP_OF.get(food) === group;

describe("candidates", () => {
  test("own tier first, then later tiers, then earlier ones; never the food itself", () => {
    expect(swapCandidates("cod")).toEqual(["frozen_tilapia_fillet", "basa_fillet"]);
    const beans = swapCandidates("canned_kidney_beans");
    expect(beans.slice(0, 2)).toEqual(["canned_chickpeas", "canned_black_beans"]);
    expect(beans).not.toContain("canned_kidney_beans");
    expect(swapCandidates("frozen_edamame")).toEqual([
      "firm_tofu",
      "canned_kidney_beans",
      "canned_chickpeas",
      "canned_black_beans",
      "kidney_beans_dry",
      "chickpeas_dry",
      "black_soybean_dry",
    ]);
  });

  test("a food with no group, or an unknown id, has none", () => {
    expect(swapCandidates("chicken_thigh")).toEqual([]);
    expect(swapCandidates("no_such_food")).toEqual([]);
  });
});

describe("an in-group swap", () => {
  test("keeps the protein and passes the dish check", () => {
    const stored = dish("tomato_braised_cod");
    expect(checkDish(stored, OPTS).ok).toBe(true);
    const r = swapUnavailable(stored, (f) => f === "cod", OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.swaps).toEqual([{ from: "cod", to: "frozen_tilapia_fillet", soak: false }]);
    expect(dishFoods(r.dish)).not.toContain("cod");
    expect(dishFoods(r.dish)).toContain("frozen_tilapia_fillet");
    expect(Math.abs(protein(r.dish) - protein(stored)) / protein(stored)).toBeLessThan(0.02);
    expect(checkDish(r.dish, OPTS).ok).toBe(true);
  });

  test("a protein line from a leaner food gets more grams", () => {
    const stored = dish("tuna_edamame_salad");
    const r = swapUnavailable(stored, (f) => f === "canned_tuna_water", OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const from = foodById("canned_tuna_water")!;
    const to = foodById(r.swaps[0].to)!;
    const before = stored.ingredients.find((l) => l.food === "canned_tuna_water")!;
    const after = r.dish.ingredients.find((l) => l.food === r.swaps[0].to)!;
    expect(after.grams).toBeCloseTo((before.grams * from.protein) / to.protein, 6);
    expect(Math.abs(protein(r.dish) - protein(stored)) / protein(stored)).toBeLessThan(0.02);
  });

  test("a staple line keeps its kcal", () => {
    const stored = dish("chicken_bean_chili");
    const r = swapUnavailable(stored, (f) => f === "canned_kidney_beans", OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const before = stored.ingredients.find((l) => l.food === "canned_kidney_beans")!;
    const after = r.dish.ingredients.find((l) => l.food === r.swaps[0].to)!;
    const kcal = (food: string, g: number) => ((foodById(food)?.kcal ?? 0) * g) / 100;
    expect(kcal(after.food, after.grams)).toBeCloseTo(kcal(before.food, before.grams), 6);
  });

  test("a dry pulse is soaked", () => {
    const blocked = new Set(["canned_kidney_beans", "canned_chickpeas", "canned_black_beans"]);
    const r = swapUnavailable(dish("chicken_bean_chili"), (f) => blocked.has(f), OPTS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.swaps).toHaveLength(1);
    expect(r.swaps[0].to).toMatch(/_dry$/);
    expect(r.swaps[0].soak).toBe(true);
  });

  test("a candidate whose dish fails the check is passed over", () => {
    // Edamame and tofu cannot be a staple line, so with every other bean
    // blocked the staple bean line has no member left.
    const stored = dish("chicken_bean_chili");
    const only = new Set(["frozen_edamame", "firm_tofu"]);
    const r = swapUnavailable(stored, (f) => inGroup("beans")(f) && !only.has(f), OPTS);
    expect(r).toEqual({ ok: false, food: "canned_kidney_beans", reason: "no_member" });
  });

  test("does not change the dish it was given", () => {
    const stored = dish("tomato_braised_cod");
    const copy = structuredClone(stored);
    swapUnavailable(stored, (f) => f === "cod", OPTS);
    swapFood(stored, "cod", "frozen_tilapia_fillet");
    expect(stored).toEqual(copy);
  });

  test("a dish that uses no blocked food comes back unchanged", () => {
    const stored = dish("tomato_braised_cod");
    const r = swapUnavailable(stored, () => false, OPTS);
    expect(r).toEqual({ ok: true, dish: stored, swaps: [] });
  });
});

describe("a blocked group", () => {
  test("with the whole group unavailable the result is not ok", () => {
    for (const [id, food, group] of [
      ["tomato_braised_cod", "cod", "white_fish"],
      ["tuna_edamame_salad", "canned_tuna_water", "canned_fish"],
      ["steak_spinach_salad", "spinach", "leafy_greens"],
    ] as const) {
      const r = swapUnavailable(dish(id), inGroup(group), OPTS);
      expect(r, id).toEqual({ ok: false, food, reason: "no_member" });
    }
  });

  test("a blocked food with no group cannot be swapped", () => {
    const r = swapUnavailable(dish("chicken_bean_chili"), (f) => f === "chicken_thigh", OPTS);
    expect(r).toEqual({ ok: false, food: "chicken_thigh", reason: "no_group" });
  });

  test("an unknown blocked food id is ignored", () => {
    const stored = dish("tomato_braised_cod");
    const r = swapUnavailable(stored, (f) => f === "no_such_food", OPTS);
    expect(r.ok).toBe(true);
  });
});
