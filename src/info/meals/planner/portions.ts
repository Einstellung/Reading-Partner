// What a dish roughly comes to at one reader's portions (docs/671 对话): the
// figures the model drafts with, so it can pair dishes that finish a pack and
// keep a day's sodium under the limit before the program checks the draft.
// The solver (solve.ts) decides each meal's real grams from the whole day;
// these are a typical meal's on a day of `target`: a median breakfast grown
// for them, two fruit, a main scaled to the protein the rest leaves, and a
// staple filling what the median main leaves of the meal's kcal.

import { referenceServing, REFERENCE_TARGET, totals } from "../dishes/serving";
import type { Dish, DishIngredient } from "../dishes/types";
import { foodById } from "../nutrition/foods";
import type { DayTargets } from "../nutrition/targets";
import type { PlanLibrary } from "./library";
import { fruitPortionG, growBreakfast, maxMainScale, scaledMain, stapleLines } from "./solve";

export interface ReaderPortions {
  /** One lunch or dinner's share of a main, with a way's add-ons when `way` (1-based) is given. */
  main(dish: Dish, way?: number): DishIngredient[];
  /** A staple food or staple dish at a typical lunch or dinner. */
  staple(ref: string): DishIngredient[];
  breakfast(dish: Dish): DishIngredient[];
  side(dish: Dish): DishIngredient[];
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** The typical meal of each dish for a day of `target`, over the dishes this reader can have. */
export function readerPortions(lib: PlanLibrary, dishes: readonly Dish[], target: DayTargets): ReaderPortions {
  const usable = dishes.map((d) => lib.dish(d.id)).filter((d): d is Dish => !!d);
  const breakfasts = usable.filter((d) => d.role === "breakfast").map((d) => totals(growBreakfast(d.ingredients, target)));
  const apple = foodById("apple");
  const fruit = apple ? totals([{ food: "apple", grams: 2 * fruitPortionG(apple), role: "fruit" }]) : { kcal: 0, protein: 0 };
  const bfProtein = median(breakfasts.map((b) => b.protein));
  const bfKcal = median(breakfasts.map((b) => b.kcal));
  const mainProtein = Math.max(REFERENCE_TARGET.main.value, (target.protein - bfProtein - fruit.protein) / 2);

  const mainLines = (dish: Dish): DishIngredient[] => {
    const serving = referenceServing(dish);
    if (!serving) return [];
    const k = clamp(mainProtein / REFERENCE_TARGET.main.value, 1, maxMainScale(dish));
    return scaledMain(serving.ingredients, k);
  };
  const mainKcal = median(usable.filter((d) => d.role === "main").map((d) => totals(mainLines(d)).kcal));
  const stapleKcal = (target.kcal - bfKcal - fruit.kcal) / 2 - mainKcal;

  return {
    main: (dish, way) => {
      const addOns = way ? (dish.ways?.[way - 1]?.addOns ?? []) : [];
      return [...mainLines(dish), ...addOns.map((l) => ({ ...l }))];
    },
    staple: (ref) => stapleLines(lib, ref, stapleKcal, target.kcal).map(({ food, grams, role }) => ({ food, grams, role })),
    breakfast: (dish) => growBreakfast(dish.ingredients, target),
    side: (dish) => (referenceServing(dish)?.ingredients ?? []).map((l) => ({ ...l })),
  };
}

/** Sodium of some lines, mg, rounded to 10. */
export function sodiumOf(lines: readonly DishIngredient[]): number {
  return Math.round(totals(lines).sodium / 10) * 10;
}

/**
 * The mains that use a food, with one meal's grams at these portions: "lubia_beef_green_beans 230 g"
 * when every way takes the same, else each way that takes it ("way 2 160 g"). A way's staple and a
 * fresh main's staples count.
 */
export function mainsUsing(p: ReaderPortions, mains: readonly Dish[], food: string, lib: PlanLibrary): { id: string; grams: string }[] {
  const out: { id: string; grams: string }[] = [];
  for (const d of mains) {
    if (d.role !== "main") continue;
    if (d.ways?.length) {
      const per = d.ways.map((w, i) => Math.round(gramsOf([...p.main(d, i + 1), ...(w.staple ? p.staple(w.staple) : [])], food)));
      if (per.every((g) => g === 0)) continue;
      const same = per.every((g) => g === per[0]);
      out.push({ id: d.id, grams: same ? `${per[0]} g` : per.map((g, i) => (g ? `way ${i + 1} ${g} g` : "")).filter(Boolean).join(", ") });
      continue;
    }
    const own = Math.round(gramsOf(p.main(d), food));
    const staple = d.staples.find((s) => lib.dish(s)?.ingredients.some((l) => l.food === food) || s === food);
    const g = own || (staple ? Math.round(gramsOf(p.staple(staple), food)) : 0);
    if (g) out.push({ id: d.id, grams: `${g} g${!own && staple ? ` with ${staple}` : ""}` });
  }
  return out;
}

/** Grams of one food in some lines. */
export function gramsOf(lines: readonly DishIngredient[], food: string): number {
  return lines.reduce((s, l) => s + (l.food === food ? l.grams : 0), 0);
}
