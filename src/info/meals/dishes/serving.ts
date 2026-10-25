// The reference serving (docs/671 菜库): the template scaled so a main has
// 25 g protein, a breakfast 12 g (docs/73's normal amounts) and a staple
// 200 kcal, with every figure the entry check reads, computed from the food
// table.

import { foodById, type Food } from "../nutrition/foods";
import type { Dish, DishIngredient, DishRole } from "./types";

export const REFERENCE_TARGET: Readonly<Record<DishRole, { by: "protein" | "kcal"; value: number }>> = {
  main: { by: "protein", value: 25 },
  breakfast: { by: "protein", value: 12 },
  staple: { by: "kcal", value: 200 },
};

/** Cheese counts toward added fat with oils, sauces and nuts (docs/671 入库检查). */
const CHEESES: ReadonlySet<string> = new Set(["cheese_slice", "low_fat_cheese_slice", "mozzarella"]);

/** Fat that was added rather than carried by the meat or fish: oils, butter, sauces, nuts, cheese. */
export function isAddedFat(food: Food): boolean {
  return food.roles.includes("fat") || food.roles.includes("sauce") || CHEESES.has(food.id);
}

export interface Totals {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  addedFat: number;
  sodium: number;
  addedSugar: number;
  /** Grams of the lines whose role is veg. */
  vegG: number;
}

/** Sums the lines whose food is in the table; unknown foods are skipped (the check reports them). */
export function totals(lines: readonly DishIngredient[]): Totals {
  const t: Totals = { kcal: 0, protein: 0, fat: 0, carbs: 0, addedFat: 0, sodium: 0, addedSugar: 0, vegG: 0 };
  for (const line of lines) {
    const f = foodById(line.food);
    if (!f) continue;
    const k = line.grams / 100;
    t.kcal += f.kcal * k;
    t.protein += f.protein * k;
    t.fat += f.fat * k;
    t.carbs += f.carbs * k;
    if (isAddedFat(f)) t.addedFat += f.fat * k;
    t.sodium += (f.sodium ?? 0) * k;
    t.addedSugar += (f.addedSugar ?? 0) * k;
    if (line.role === "veg") t.vegG += line.grams;
  }
  return t;
}

export interface Serving extends Totals {
  /** Reference grams over template grams. */
  factor: number;
  ingredients: DishIngredient[];
}

/** The template scaled to the reference serving; null when the template has none of what it scales by. */
export function referenceServing(dish: Pick<Dish, "role" | "ingredients">): Serving | null {
  const target = REFERENCE_TARGET[dish.role];
  const base = totals(dish.ingredients);
  const have = target.by === "protein" ? base.protein : base.kcal;
  if (!(have > 0)) return null;
  const factor = target.value / have;
  const ingredients = dish.ingredients.map((i) => ({ ...i, grams: i.grams * factor }));
  return { ...totals(ingredients), factor, ingredients };
}
