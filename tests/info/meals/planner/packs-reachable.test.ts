// Every food a seed dish, a way to eat a pot, a snack or a day's fruit can put
// on a shopping list has a way to be bought: a pack, a piece, a count, or "on
// hand". None is left to an "about 300 g" line, which nobody can shop for.
// Run: scripts/t.sh tests/info/meals/planner/packs-reachable.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale } from "../../../../src/i18n";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import { FOODS, foodById } from "../../../../src/info/meals/nutrition/foods";
import { buyFor, type PackLine } from "../../../../src/info/meals/planner/packs";
import { SNACK_UNITS } from "../../../../src/info/meals/planner/solve";
import { packItem } from "../../../../src/info/meals/planner/trip";
import { START } from "./fixture";

const initial = getLocale();
beforeEach(() => setLocale("zh-CN"));
afterEach(() => setLocale(initial));

/**
 * Foods allowed to come out as 「约 X g」, each with the reason. Empty: every
 * reachable food has a pack, piece, count or is on hand. Add one only for a
 * food that is really sold loose by weight (a deli counter), with a comment.
 */
const BY_WEIGHT_ALLOWED: readonly string[] = [];

/** Food ids reachable from the seed library, the snack pools and the fruit a day can carry. */
function reachableFoods(): string[] {
  const ids = new Set<string>();
  for (const d of SEED_DISHES) {
    for (const i of d.ingredients) ids.add(i.food);
    for (const w of d.ways ?? []) {
      for (const i of w.addOns) ids.add(i.food);
      if (w.staple) ids.add(w.staple);
    }
    for (const s of d.staples) ids.add(s);
  }
  for (const group of SNACK_UNITS) for (const c of group) ids.add(c.food);
  // The model picks a day's fruit from the whole table.
  for (const f of FOODS) if (f.roles.includes("fruit")) ids.add(f.id);
  // A staple may be a dish id (steamed_sweet_potato); its foods are in the dish.
  return [...ids].filter((id) => foodById(id));
}

test("the sweep reaches the foods the seed library uses", () => {
  const ids = reachableFoods();
  expect(ids.length).toBeGreaterThan(150);
  for (const id of ["lemon", "oats", "cod", "crushed_tomatoes", "steamed_bun", "canned_kidney_beans", "frozen_peas"]) {
    expect(ids, id).toContain(id);
  }
});

test("no reachable food comes out as an 「约 X g」 line", () => {
  const bare = reachableFoods().filter((id) => buyFor(foodById(id)!, 300).by === "weight" && !BY_WEIGHT_ALLOWED.includes(id));
  expect(bare).toEqual([]);
});

test("the allowlist holds only foods that really have no pack", () => {
  for (const id of BY_WEIGHT_ALLOWED) expect(buyFor(foodById(id)!, 300).by, id).toBe("weight");
});

test("the list line of every reachable food is a pack, a piece, a count or on hand", () => {
  for (const id of reachableFoods()) {
    if (BY_WEIGHT_ALLOWED.includes(id)) continue;
    const food = foodById(id)!;
    const line: PackLine = {
      food: id,
      grams: 130,
      buy: buyFor(food, 130),
      firstDay: 1,
      lastDay: 1,
      freeze: false,
      frozen: food.category === "frozen",
      leftover: null,
    };
    const item = packItem(line, START)!;
    expect(item.qty, id).not.toMatch(/^约 \d+ g$/);
    expect(item.qty, id).not.toBe("");
    // A pack or a piece line says its weight: 「1 袋（约 450 g）」, 「3 个（约 360 g）」.
    // A count of eggs or slices, and a cupboard line, do not.
    if (line.buy.by === "pack" || line.buy.by === "piece") expect(item.qty, id).toMatch(/^\d+ \S+（约 \d+ g）$/);
  }
});

test("a tin reads with the weight on its label", () => {
  const line = (id: string, grams: number): PackLine => ({
    food: id, grams, buy: buyFor(foodById(id)!, grams), firstDay: 1, lastDay: 1, freeze: false, frozen: false, leftover: null,
  });
  expect(packItem(line("crushed_tomatoes", 210), START)!.qty).toBe("1 罐（约 400 g）");
  expect(packItem(line("canned_kidney_beans", 130), START)!.qty).toBe("1 罐（约 400 g）");
  expect(packItem(line("frozen_broccoli", 480), START)!.qty).toBe("2 袋（约 900 g）");
  expect(packItem(line("cod", 140), START)!.qty).toBe("1 袋（约 450 g）");
});

test("fresh produce is bought, never kept on hand; only foods bought dry are", () => {
  for (const id of reachableFoods()) {
    const food = foodById(id)!;
    if (food.category !== "produce") continue;
    if (buyFor(food, 100).by === "onHand") expect(food.boughtDry, id).toBeDefined();
  }
  expect(buyFor(foodById("lemon")!, 40).by).toBe("piece");
  expect(buyFor(foodById("lime")!, 40).by).toBe("piece");
});

test("frozen vegetables and fish, tins and oats come in the usual packs", () => {
  const pack = (id: string) => buyFor(foodById(id)!, 100);
  expect(pack("frozen_spinach")).toMatchObject({ by: "pack", packG: 450, kind: "bag" });
  expect(pack("frozen_broccoli")).toMatchObject({ by: "pack", packG: 450, kind: "bag" });
  expect(pack("cod")).toMatchObject({ by: "pack", packG: 450, kind: "bag" });
  expect(pack("crushed_tomatoes")).toMatchObject({ by: "pack", packG: 400, kind: "can" });
  expect(pack("canned_kidney_beans")).toMatchObject({ by: "pack", kind: "can" });
  expect(pack("oats")).toMatchObject({ by: "pack", packG: 500, kind: "bag" });
  expect(pack("steamed_bun")).toMatchObject({ by: "pack", kind: "bag" });
  // Nuts and sliced cheese are bought, not a cupboard seasoning.
  expect(pack("almonds").by).toBe("pack");
  expect(pack("cheese_slice").by).toBe("pack");
  // Oils and sauces still are on hand.
  expect(pack("olive_oil").by).toBe("onHand");
  expect(pack("light_soy_sauce").by).toBe("onHand");
});
