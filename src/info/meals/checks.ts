// The rules a drafted week is held to before the reader sees it (docs/73 每顿
// 怎么搭). Every failure comes back as a sentence the model can act on, and
// only the meals that failed are sent back to be re-picked.
//
// Order: the template first (only foods in the table, the roles the solver
// needs), because nothing can be solved until it holds; then the grams are
// solved; then the rules that read the solved week — minutes, dislikes,
// protein reached, flavour next to flavour, fish twice a week.

import { foodAllowed, foodById, type Food } from "./nutrition/foods";
import type { TemplateItem } from "./nutrition/solve";
import type { Profile, Targets } from "./nutrition/targets";
import { dayTargetsOn, mealNumbers, solvePlan } from "./solve-week";
import { MAIN_MEAL_KEYS, MEAL_KEYS, type Meal, type MealRef, type WeekPlan } from "./types";
import { dayIndexOf, sameMeal } from "./week";

export interface CheckInput {
  plan: WeekPlan;
  profile: Profile;
  targets: Targets;
  // The meals this draft wrote. Null checks every meal, which is a fresh week.
  changed?: readonly MealRef[] | null;
  // The week before an adjustment, so a weekly rule the reader's own deviation
  // already broke is not blamed on the meals being re-picked.
  previous?: WeekPlan | null;
}

export interface CheckResult {
  // The week with its grams solved. Only meaningful when `problems` is empty.
  plan: WeekPlan;
  problems: string[];
}

function where(plan: WeekPlan, ref: MealRef): string {
  return `Day ${dayIndexOf(plan, ref.date)} ${ref.meal}`;
}

const ROLE_FITS: Record<Exclude<TemplateItem["role"], "fixed">, (f: Food) => boolean> = {
  protein: (f) => f.roles.includes("protein"),
  staple: (f) => f.roles.includes("staple") || f.roles.includes("fruit"),
  fat: (f) => f.roles.includes("fat"),
};

/** What is wrong with one made meal's template, before anything is solved. */
export function templateProblems(at: string, meal: Meal): string[] {
  const out: string[] = [];
  if (!meal.name) out.push(`${at} needs a name.`);
  if (!meal.searchName) out.push(`${at} needs a searchName.`);
  if (!meal.flavour) out.push(`${at} needs a flavour from the list.`);
  if (!meal.method) out.push(`${at} needs its one-line method.`);
  if (!(typeof meal.minutes === "number" && meal.minutes > 0)) out.push(`${at} needs its hands-on minutes.`);
  const items = meal.items ?? [];
  if (!items.length) return [...out, `${at} names no foods.`];
  for (const item of items) {
    const food = foodById(item.foodId);
    if (!food) {
      out.push(`${at}: "${item.foodId}" is not in the food table. Use ids from the list only.`);
      continue;
    }
    if (item.role === "fixed") {
      const g = item.grams;
      if (!(typeof g === "number" && g > 0)) out.push(`${at}: ${food.id} is fixed but has no grams.`);
      else if (g < food.minG || g > food.maxG) {
        out.push(`${at}: ${g} g of ${food.id} is outside its ${food.minG}–${food.maxG} g range.`);
      }
    } else if (!ROLE_FITS[item.role](food)) {
      out.push(`${at}: ${food.id} cannot be the ${item.role}; its roles are ${food.roles.join(", ")}.`);
    }
  }
  const count = (role: TemplateItem["role"]) => items.filter((i) => i.role === role).length;
  if (count("protein") !== 1) out.push(`${at} needs exactly one protein item; it has ${count("protein")}.`);
  if (count("staple") !== 1) out.push(`${at} needs exactly one staple item; it has ${count("staple")}.`);
  if (count("fat") > 1) out.push(`${at} has ${count("fat")} fat items; at most one.`);
  return out;
}

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

/**
 * Hold a drafted week to the rules, solving its grams on the way.
 *
 * With `changed`, the per-meal rules read only those meals and the flavour
 * rule only the pairs that touch one of them: an adjustment answers for what
 * it wrote, not for the week around it.
 */
export function checkPlan(input: CheckInput): CheckResult {
  const { profile, targets } = input;
  const changed = input.changed ?? null;
  const inScope = (ref: MealRef) => !changed || changed.some((c) => sameMeal(c, ref));

  const problems: string[] = [];
  for (const day of input.plan.days) {
    for (const key of MEAL_KEYS) {
      const ref = { date: day.date, meal: key };
      if (day[key].mode === "make" && inScope(ref)) problems.push(...templateProblems(where(input.plan, ref), day[key]));
    }
  }
  if (problems.length) return { plan: input.plan, problems };

  const plan = solvePlan(input.plan, targets, profile);
  for (const day of plan.days) {
    const dayT = dayTargetsOn(targets, profile, day.date);
    for (const key of MEAL_KEYS) {
      const meal = day[key];
      const ref = { date: day.date, meal: key };
      if (meal.mode !== "make" || !inScope(ref)) continue;
      const at = where(plan, ref);
      if ((meal.minutes ?? 0) > profile.minutesPerMeal) {
        problems.push(`${at} takes ${meal.minutes} minutes; they allow ${profile.minutesPerMeal}.`);
      }
      for (const item of meal.items ?? []) {
        const food = foodById(item.foodId);
        if (food && !foodAllowed(food, profile.dislikes)) problems.push(`${at} uses ${food.id}, which they do not eat.`);
      }
      const numbers = mealNumbers(meal, key, dayT);
      if (numbers && !numbers.cells.protein) {
        const p = numbers.rows.find((r) => r.role === "protein");
        problems.push(
          `${at}: protein reaches only ${Math.round(numbers.totals.protein)} g of the ` +
            `${Math.round(numbers.target.protein)} g this meal needs` +
            (p ? ` even with ${p.grams} g of ${p.food.id}` : "") +
            ". Choose a denser protein food, or add a second one as a fixed item.",
        );
      }
    }
  }

  // Flavour: two main meals in a row, across the night, never taste the same.
  const mains: { ref: MealRef; meal: Meal }[] = [];
  for (const day of plan.days) for (const key of MAIN_MEAL_KEYS) mains.push({ ref: { date: day.date, meal: key }, meal: day[key] });
  for (let i = 1; i < mains.length; i++) {
    const a = mains[i - 1];
    const b = mains[i];
    if (!a || !b || a.meal.mode !== "make" || b.meal.mode !== "make") continue;
    if (!a.meal.flavour || a.meal.flavour !== b.meal.flavour) continue;
    if (!inScope(a.ref) && !inScope(b.ref)) continue;
    problems.push(`${where(plan, a.ref)} and ${where(plan, b.ref)} are both ${a.meal.flavour}; change one.`);
  }

  const noFish = profile.dislikes.some((d) => d.trim() === "fish" || d.trim() === "seafood");
  const fish = fishMeals(plan);
  const before = input.previous ? fishMeals(input.previous) : Infinity;
  if (!noFish && fish < 2 && fish < before) {
    problems.push(`The week has ${fish} fish or seafood meal${fish === 1 ? "" : "s"}; it needs at least two.`);
  }

  return { plan, problems };
}
