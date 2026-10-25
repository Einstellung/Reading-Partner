// The seed dish library (docs/671 菜库): every dish passes the entry check,
// and the library as a whole is balanced across roles, cuisines and prep.

import { describe, expect, test } from "bun:test";
import { checkDish } from "../../../../src/info/meals/dishes/check";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import type { Dish, DishRole } from "../../../../src/info/meals/dishes/types";
import { foodById } from "../../../../src/info/meals/nutrition/foods";

const byRole = (role: DishRole): Dish[] => SEED_DISHES.filter((d) => d.role === role);
const mains = byRole("main");
const batchMains = mains.filter((d) => d.prep === "batch");
const freshMains = mains.filter((d) => d.prep === "fresh");
const STAPLE_IDS: ReadonlySet<string> = new Set(byRole("staple").map((d) => d.id));

describe("seed dishes", () => {
  test("every dish passes the entry check", () => {
    const bad = SEED_DISHES.flatMap((d) => {
      const r = checkDish(d, { stapleDishIds: STAPLE_IDS });
      return r.ok ? [] : [`${d.id}: ${r.failures.map((f) => f.message).join("; ")}`];
    });
    expect(bad).toEqual([]);
  });

  test("ids are unique, do not collide with food ids, and every dish is a seed", () => {
    const ids = SEED_DISHES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => foodById(id))).toEqual([]);
    expect(SEED_DISHES.every((d) => d.origin === "seed" && !Number.isNaN(Date.parse(d.createdAt)))).toBe(true);
  });

  test("names are filled in, Chinese and English", () => {
    for (const d of SEED_DISHES) {
      expect(/[一-鿿]/.test(d.name), d.id).toBe(true);
      expect(/^[A-Za-z]/.test(d.nameEn) && !/[一-鿿]/.test(d.nameEn), d.id).toBe(true);
    }
  });

  test("every dish says how it is cooked: a Chinese sentence of at most 40 characters and an English one", () => {
    for (const d of SEED_DISHES) {
      expect(d.summary.trim().length, d.id).toBeGreaterThan(0);
      expect([...d.summary].length, d.id).toBeLessThanOrEqual(40);
      expect(/[一-鿿]/.test(d.summary), d.id).toBe(true);
      expect(/^[A-Z]/.test(d.summaryEn) && !/[一-鿿]/.test(d.summaryEn), d.id).toBe(true);
    }
    expect(new Set(SEED_DISHES.map((d) => d.summary)).size).toBe(SEED_DISHES.length);
  });

  test("chili is a stew, not a hot sauce: no dish or way name calls it 辣酱", () => {
    for (const d of SEED_DISHES) {
      expect(d.name.includes("辣酱") && d.id.includes("chili"), d.id).toBe(false);
      for (const w of d.ways ?? []) expect(w.name.includes("辣酱") && d.id.includes("chili"), `${d.id}: ${w.name}`).toBe(false);
    }
  });

  test("breakfasts are natural servings: eggs by the whole egg, not scaled", () => {
    for (const d of byRole("breakfast")) {
      for (const i of d.ingredients.filter((x) => x.food === "egg" || x.food === "tea_egg")) expect(i.grams % 50, d.id).toBe(0);
      expect(checkDish(d).serving?.factor, d.id).toBe(1);
    }
  });

  test("breakfasts are mostly two-protein combinations", () => {
    const twoOrMore = byRole("breakfast").filter((d) => d.ingredients.filter((i) => i.role === "protein").length >= 2);
    expect(twoOrMore.length).toBeGreaterThanOrEqual(6);
  });

  test("role counts", () => {
    expect(mains.length).toBeGreaterThanOrEqual(75);
    expect(mains.length).toBeLessThanOrEqual(90);
    expect(byRole("side").length).toBeGreaterThanOrEqual(6);
    expect(byRole("side").length).toBeLessThanOrEqual(10);
    expect(byRole("staple").length).toBeGreaterThanOrEqual(10);
    expect(byRole("staple").length).toBeLessThanOrEqual(15);
    expect(byRole("breakfast").length).toBeGreaterThanOrEqual(8);
    expect(byRole("breakfast").length).toBeLessThanOrEqual(10);
  });

  test("no Korean or Indian dishes, and no cuisine is over 30% of the mains", () => {
    const n: Record<string, number> = {};
    for (const d of mains) n[d.cuisine] = (n[d.cuisine] ?? 0) + 1;
    expect(Object.keys(n).filter((c) => c === "korean" || c === "indian")).toEqual([]);
    for (const d of SEED_DISHES) expect(["korean", "indian", "other"].includes(d.cuisine), d.id).toBe(false);
    for (const [cuisine, count] of Object.entries(n)) expect(count / mains.length, cuisine).toBeLessThanOrEqual(0.3);
    for (const c of ["chinese", "japanese", "southeast_asian", "american", "mexican", "italian", "mediterranean"]) {
      expect(n[c] ?? 0, c).toBeGreaterThanOrEqual(5);
    }
  });

  test("at least 60% of the mains are batch dishes, and batch dishes use batch methods", () => {
    expect(batchMains.length / mains.length).toBeGreaterThanOrEqual(0.6);
    expect(freshMains.length).toBeGreaterThan(0);
  });

  test("every batch main has 2 to 3 ways and no staples list; fresh mains have no ways", () => {
    for (const d of batchMains) {
      expect(d.ways?.length ?? 0, d.id).toBeGreaterThanOrEqual(2);
      expect(d.ways?.length ?? 0, d.id).toBeLessThanOrEqual(3);
      expect(d.staples, d.id).toEqual([]);
    }
    for (const d of freshMains) {
      expect(d.ways, d.id).toBeUndefined();
      expect(d.staples.length, d.id).toBeGreaterThan(0);
    }
  });

  test("every staple dish is named by at least one way or fresh main", () => {
    const named = new Set<string>();
    for (const d of mains) {
      for (const s of d.staples) named.add(s);
      for (const w of d.ways ?? []) if (w.staple) named.add(w.staple);
    }
    for (const id of STAPLE_IDS) expect(named.has(id), `${id} is named by no way or fresh main`).toBe(true);
  });

  test("sides and breakfasts are fresh; breakfasts take under 5 minutes", () => {
    for (const d of [...byRole("side"), ...byRole("breakfast")]) expect(d.prep, d.id).toBe("fresh");
    for (const d of byRole("breakfast")) expect(d.activeMin, d.id).toBeLessThanOrEqual(5);
  });

  test("seasoning is ready-made: no fresh garlic, ginger, scallion or leek, and no braised beef shank row", () => {
    const banned = new Set(["garlic", "ginger", "scallion", "leek", "braised_beef_shank"]);
    for (const d of SEED_DISHES) {
      const lines = [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)];
      for (const i of lines) expect(banned.has(i.food), `${d.id}: ${i.food}`).toBe(false);
    }
  });
});
