// Swapping a food the user cannot buy (docs/671 替换组). A pure function: the
// dish's lines that use a blocked food take another member of the food's swap
// group, the grams rescaled so the line keeps its protein (protein lines), its
// kcal (staple lines) or its weight (vegetables), and the dish is checked
// again with checkDish. A candidate whose dish fails the check is passed over
// for the next one; when none passes, the dish cannot be planned for this user.

import { foodById, type Food } from "../nutrition/foods";
import { swapGroupById, type SwapBasis } from "../nutrition/swap-groups";
import { checkDish, type CheckOptions } from "./check";
import type { Dish, DishIngredient } from "./types";

export interface FoodSwap {
  from: string;
  to: string;
  /** The new food is a dry pulse: soaked the night before and pressure-cooked (the recipe page adds the steps). */
  soak: boolean;
}

export type SwapResult =
  | { ok: true; dish: Dish; swaps: FoodSwap[] }
  | { ok: false; food: string; reason: "no_group" | "no_member" };

/** Group members to try for a food, its own tier first, then later tiers, then earlier ones. */
export function swapCandidates(foodId: string): string[] {
  const group = swapGroupById(foodById(foodId)?.swapGroup ?? "");
  if (!group) return [];
  const at = group.tiers.findIndex((t) => t.includes(foodId));
  const order = [...group.tiers.slice(at), ...group.tiers.slice(0, at)];
  return order.flat().filter((id) => id !== foodId);
}

function basisFor(line: DishIngredient, groupBasis: SwapBasis): SwapBasis {
  if (line.role === "protein") return "protein";
  if (line.role === "staple") return "kcal";
  if (line.role === "veg") return "weight";
  return groupBasis;
}

function rescale(grams: number, from: Food, to: Food, basis: SwapBasis): number {
  if (basis === "protein" && to.protein > 0) return (grams * from.protein) / to.protein;
  if (basis === "kcal" && to.kcal > 0) return (grams * from.kcal) / to.kcal;
  return grams;
}

/** The name a food goes by inside a dish name: its Chinese name without the trailing note and the can. */
function shortZh(food: Food): string {
  return food.zh.replace(/（[^）]*）$/, "").replace(/罐头$/, "");
}

function renamed(text: string, from: Food, to: Food, en: boolean): string {
  if (en) {
    if (!from.en || !to.en || from.en === to.en) return text;
    return text.replace(new RegExp(from.en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), to.en);
  }
  for (const name of [shortZh(from), ...from.aliases]) {
    if (name && text.includes(name)) return text.replace(name, shortZh(to));
  }
  return text;
}

/** The dish with every use of one food replaced by another. */
export function swapFood(dish: Dish, fromId: string, toId: string): Dish {
  const from = foodById(fromId);
  const to = foodById(toId);
  if (!from || !to) return dish;
  const groupBasis = swapGroupById(from.swapGroup ?? "")?.basis ?? "weight";
  const lines = (ls: readonly DishIngredient[]) =>
    ls.map((l) => (l.food === fromId ? { ...l, food: toId, grams: rescale(l.grams, from, to, basisFor(l, groupBasis)) } : { ...l }));
  return {
    ...dish,
    name: renamed(dish.name, from, to, false),
    nameEn: renamed(dish.nameEn, from, to, true),
    staples: dish.staples.map((s) => (s === fromId ? toId : s)),
    ingredients: lines(dish.ingredients),
    ...(dish.ways
      ? {
          ways: dish.ways.map((w) => ({
            ...w,
            name: renamed(w.name, from, to, false),
            nameEn: renamed(w.nameEn, from, to, true),
            staple: w.staple === fromId ? toId : w.staple,
            addOns: lines(w.addOns),
          })),
        }
      : {}),
  };
}

/** Every food id a dish uses: its lines, its ways' add-ons and staples, and its staple list. */
export function dishFoods(dish: Dish): string[] {
  const ids = [
    ...dish.ingredients.map((l) => l.food),
    ...dish.staples,
    ...(dish.ways ?? []).flatMap((w) => [...w.addOns.map((l) => l.food), ...(w.staple ? [w.staple] : [])]),
  ];
  return [...new Set(ids)].filter((id) => foodById(id));
}

/**
 * The dish made with what this user can get. `blocked` says which foods they
 * cannot buy, do not want or dislike; a swapped-in food must pass it too.
 * `swapOut` says which of the dish's foods are swapped, `blocked` when absent.
 */
export function swapUnavailable(
  dish: Dish,
  blocked: (foodId: string) => boolean,
  opts: CheckOptions = {},
  swapOut: (foodId: string) => boolean = blocked,
): SwapResult {
  let current = dish;
  const swaps: FoodSwap[] = [];
  for (const food of dishFoods(dish).filter(swapOut)) {
    const candidates = swapCandidates(food).filter((id) => !blocked(id));
    if (!foodById(food)?.swapGroup) return { ok: false, food, reason: "no_group" };
    const next = candidates.map((to) => ({ to, dish: swapFood(current, food, to) })).find((c) => checkDish(c.dish, opts).ok);
    if (!next) return { ok: false, food, reason: "no_member" };
    current = next.dish;
    const to = foodById(next.to);
    swaps.push({ from: food, to: next.to, soak: to?.category === "pantry" && /_dry$/.test(next.to) && to.roles.includes("protein") });
  }
  return { ok: true, dish: current, swaps };
}
