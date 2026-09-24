// The week's grams (docs/73 每顿怎么搭): every made meal solved against its
// day's meal target, and the numbers a stored meal adds up to.
//
// Targets are never stored. They come from the profile each time, so a
// changed weight or goal re-solves the week and nothing else has to be kept in
// step (docs/73 体重变化).

import { foodById, isProduce } from "./nutrition/foods";
import {
  mealCells,
  rowNutrition,
  solveDay,
  type MealCells,
  type Nutrition,
  type SolvedRow,
  type TemplateItem,
} from "./nutrition/solve";
import {
  computeTargets,
  targetsForWeekday,
  type DayTargets,
  type MealTarget,
  type Profile,
  type Region,
  type Targets,
} from "./nutrition/targets";
import { MEAL_KEYS, type DayPlan, type Meal, type MealKey, type MealsCharter, type WeekPlan } from "./types";
import { isoWeekday } from "./week";

/** The reader's targets, or null when there is no profile or they withheld body data. */
export function targetsOf(charter: MealsCharter | null, region: Region): Targets | null {
  if (!charter || charter.profile.consent === "no") return null;
  return computeTargets(charter.profile, region);
}

/** The targets of one calendar day: training or rest by its weekday. */
export function dayTargetsOn(targets: Targets, profile: Pick<Profile, "trainingDays">, date: string): DayTargets {
  return targetsForWeekday(targets, profile, isoWeekday(date));
}

/**
 * Whether the solver can take a template: every food known, exactly one
 * protein and one staple, at most one fat, and grams on every fixed item.
 * checks.ts says what is wrong in words; this only decides.
 */
export function templateSolvable(items: readonly TemplateItem[] | undefined): items is TemplateItem[] {
  if (!items?.length) return false;
  if (items.some((i) => !foodById(i.foodId))) return false;
  const count = (role: TemplateItem["role"]) => items.filter((i) => i.role === role).length;
  if (count("protein") !== 1 || count("staple") !== 1 || count("fat") > 1) return false;
  return items.every((i) => i.role !== "fixed" || (typeof i.grams === "number" && i.grams > 0));
}

/** One day's made meals solved together, so the day's fat floor holds. */
function solveOneDay(day: DayPlan, target: DayTargets): DayPlan {
  const keys = MEAL_KEYS.filter((k) => day[k].mode === "make" && templateSolvable(day[k].items));
  const next: DayPlan = { ...day };
  for (const key of MEAL_KEYS) {
    const meal = day[key];
    if (meal.mode === "make" && !keys.includes(key) && meal.solved) {
      const bare: Meal = { ...meal };
      delete bare.solved;
      next[key] = bare;
    }
  }
  if (!keys.length) return next;
  const solution = solveDay(
    keys.map((k) => ({ slot: k, items: day[k].items as TemplateItem[] })),
    target,
  );
  for (const m of solution.meals) {
    const key = m.slot as MealKey;
    next[key] = {
      ...day[key],
      solved: m.rows.map((r) => ({ foodId: r.foodId, role: r.role, grams: r.grams })),
    };
  }
  return next;
}

/** The week with every made meal's grams solved against the targets. */
export function solvePlan(plan: WeekPlan, targets: Targets, profile: Profile): WeekPlan {
  return { ...plan, days: plan.days.map((d) => solveOneDay(d, dayTargetsOn(targets, profile, d.date))) };
}

/** What one stored meal adds up to. */
export interface MealNumbers {
  target: MealTarget;
  rows: SolvedRow[];
  totals: Nutrition;
  produceG: number;
  cells: MealCells;
}

/** The numbers of a made meal from its stored grams, or null when it has none. */
export function mealNumbers(meal: Meal, key: MealKey, day: DayTargets): MealNumbers | null {
  if (meal.mode !== "make" || !meal.solved?.length) return null;
  const rows: SolvedRow[] = [];
  for (const s of meal.solved) {
    const food = foodById(s.foodId);
    if (!food) continue;
    rows.push({ foodId: s.foodId, food, role: s.role, grams: s.grams, ...rowNutrition(food, s.grams) });
  }
  const totals = sumNutrition(rows);
  const produceG = rows.filter((r) => isProduce(r.food)).reduce((s, r) => s + r.grams, 0);
  const target = day.meals[key];
  return { target, rows, totals, produceG, cells: mealCells(key, target, totals, produceG) };
}

export function sumNutrition(parts: readonly Nutrition[]): Nutrition {
  const out: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const n of parts) {
    out.kcal += n.kcal;
    out.protein += n.protein;
    out.fat += n.fat;
    out.carbs += n.carbs;
  }
  return out;
}
