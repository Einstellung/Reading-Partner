// What is left of the weekly checks (docs/73) now that plans are checked as
// drafts (planner/checks.ts): the day's kcal floor both share, and the fish
// count the week summary shows.

import { foodById } from "../nutrition/foods";
import { MEAL_KEYS, type Meal, type WeekPlan } from "./types";

/** A day whose meals solve to less than this share of their kcal goes back to the model. */
export const DAY_KCAL_FLOOR = 0.9;

function isFishy(meal: Meal): boolean {
  return (meal.items ?? []).some((i) => {
    const tags = foodById(i.foodId)?.tags ?? [];
    return tags.includes("fish") || tags.includes("seafood");
  });
}

/** Made meals with fish or seafood in a week. */
export function fishMeals(plan: WeekPlan): number {
  let n = 0;
  for (const day of plan.days) for (const key of MEAL_KEYS) if (day[key].mode === "make" && isFishy(day[key])) n++;
  return n;
}
