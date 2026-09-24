// Grams for a meal the model composed (docs/research/健身饮食与快手三餐调研.md,
// 算法 step 9).
//
// The model names the foods and their roles; the program solves the amounts.
// One energy basis throughout, the foods' listed kcal: the protein food and
// the staple are solved together so the meal lands on both its protein and its
// kcal. The oil or spread starts at its default and moves (within its range)
// only when the staple would leave its own range; past the oil's cap the
// staple may grow to 1.5× its usual maximum.

import { foodById, isProduce, type Food } from "./foods";
import type { DayTargets, MealSlot, MealTarget } from "./targets";

export type TemplateRole = "protein" | "staple" | "fat" | "fixed";

export interface TemplateItem {
  foodId: string;
  role: TemplateRole;
  /** Required for "fixed"; ignored for the solved roles. */
  grams?: number;
}

export interface Nutrition {
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface SolvedRow extends Nutrition {
  foodId: string;
  food: Food;
  role: TemplateRole;
  grams: number;
}

export interface MealCells {
  /** Protein at ≥ min(90% of target, 20 g main / 8 g snack). */
  protein: boolean;
  /** Veg and fruit grams ≥ 150 at lunch and dinner, ≥ 80 at breakfast and the snack. */
  produce: boolean;
  /** Carbs ≥ 30 g main / 15 g snack. */
  carbs: boolean;
}

export interface MealSolution {
  slot: MealSlot;
  target: MealTarget;
  rows: SolvedRow[];
  totals: Nutrition;
  produceG: number;
  cells: MealCells;
}

export interface DayMealInput {
  slot: MealSlot;
  items: TemplateItem[];
}

export interface DaySolution {
  meals: MealSolution[];
  totals: Nutrition;
  /** Grams of oil added to each main meal's fat item to reach the day's fat floor. */
  fatBumpG: number;
  fatFloorMet: boolean;
}

const MAX_FAT_ROUNDS = 4;
const FAT_BUMP_STEP = 5;
const STAPLE_STRETCH = 1.5;

const round5 = (x: number) => Math.round(x / 5) * 5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function need(id: string): Food {
  const f = foodById(id);
  if (!f) throw new Error(`Unknown food id: ${id}`);
  return f;
}

/** One food at a weight: kcal, protein, fat and carbs. */
export function rowNutrition(food: Food, grams: number): Nutrition {
  const k = grams / 100;
  return { kcal: food.kcal * k, protein: food.protein * k, fat: food.fat * k, carbs: food.carbs * k };
}

/** The sum of a meal's rows, by food id or food. */
export function mealEnergy(rows: readonly { foodId?: string; food?: Food; grams: number }[]): Nutrition {
  const out: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (const r of rows) {
    const n = rowNutrition(r.food ?? need(r.foodId as string), r.grams);
    out.kcal += n.kcal;
    out.protein += n.protein;
    out.fat += n.fat;
    out.carbs += n.carbs;
  }
  return out;
}

function addUp(parts: readonly Nutrition[]): Nutrition {
  return parts.reduce(
    (s, n) => ({ kcal: s.kcal + n.kcal, protein: s.protein + n.protein, fat: s.fat + n.fat, carbs: s.carbs + n.carbs }),
    { kcal: 0, protein: 0, fat: 0, carbs: 0 },
  );
}

/**
 * Solve one meal. `fatBumpG` raises the fat item's starting amount (the
 * day-level fat-floor loop uses it); the fat item stays within its max.
 */
export function solveMeal(slot: MealSlot, items: readonly TemplateItem[], target: MealTarget, fatBumpG = 0): MealSolution {
  const rows = items.map((i) => ({ item: i, food: need(i.foodId), grams: i.role === "fixed" ? (i.grams ?? 0) : 0 }));
  const proteinRows = rows.filter((r) => r.item.role === "protein");
  const stapleRows = rows.filter((r) => r.item.role === "staple");
  const fatRows = rows.filter((r) => r.item.role === "fat");
  if (proteinRows.length !== 1 || stapleRows.length !== 1 || fatRows.length > 1) {
    throw new Error("A meal template needs exactly one protein, one staple and at most one fat item");
  }
  const P = proteinRows[0];
  const C = stapleRows[0];
  const O = fatRows[0];
  const fixed = rows.filter((r) => r.item.role === "fixed");
  const fixedN = addUp(fixed.map((r) => rowNutrition(r.food, r.grams)));

  const kc = (f: Food) => f.kcal / 100;
  const pr = (f: Food) => f.protein / 100;
  const pUnit = P.food.unit?.grams ?? 5;

  if (O) O.grams = Math.min(O.food.maxG, (O.food.defaultG ?? O.food.minG) + fatBumpG);

  const solve = () => {
    const restP = target.protein - fixedN.protein - (O ? pr(O.food) * O.grams : 0);
    const restK = target.kcal - fixedN.kcal - (O ? kc(O.food) * O.grams : 0);
    const det = pr(P.food) * kc(C.food) - pr(C.food) * kc(P.food);
    const raw = det !== 0 ? (restP * kc(C.food) - pr(C.food) * restK) / det : restP / pr(P.food);
    const x = Math.round(clamp(raw, P.food.minG, P.food.maxG) / pUnit) * pUnit;
    P.grams = x;
    C.grams = (restK - kc(P.food) * x) / kc(C.food);
  };

  solve();
  if (O) {
    if (C.grams > C.food.maxG) {
      O.grams = Math.min(O.food.maxG, O.grams + ((C.grams - C.food.maxG) * kc(C.food)) / kc(O.food));
      solve();
    } else if (C.grams < C.food.minG) {
      O.grams = Math.max(O.food.minG, O.grams - ((C.food.minG - C.grams) * kc(C.food)) / kc(O.food));
      solve();
    }
    O.grams = round5(O.grams);
    solve();
  }
  C.grams = round5(clamp(C.grams, C.food.minG, C.food.maxG * STAPLE_STRETCH));

  const solved: SolvedRow[] = rows
    .filter((r) => r.grams > 0)
    .map((r) => ({ foodId: r.food.id, food: r.food, role: r.item.role, grams: r.grams, ...rowNutrition(r.food, r.grams) }));
  const totals = addUp(solved);
  const produceG = solved.filter((r) => isProduce(r.food)).reduce((s, r) => s + r.grams, 0);
  return { slot, target, rows: solved, totals, produceG, cells: mealCells(slot, target, totals, produceG) };
}

/** The three squares of a meal, from what it adds up to. */
export function mealCells(slot: MealSlot, target: MealTarget, totals: Nutrition, produceG: number): MealCells {
  const main = slot !== "snack";
  return {
    protein: totals.protein >= Math.min(target.protein * 0.9, main ? 20 : 8),
    produce: produceG >= (slot === "lunch" || slot === "dinner" ? 150 : 80),
    carbs: totals.carbs >= (main ? 30 : 15),
  };
}

/**
 * Solve a day's meals against its targets, in the day's eating order. When
 * the day's fat lands under its floor, each main meal's fat item gets 5 g more
 * and the day is solved again, up to four solves in all.
 */
export function solveDay(meals: readonly DayMealInput[], day: DayTargets): DaySolution {
  const order = (m: DayMealInput) => {
    const i = day.order.indexOf(m.slot);
    return i < 0 ? day.order.length : i;
  };
  const sorted = [...meals].sort((a, b) => order(a) - order(b));
  let bump = 0;
  let solved: MealSolution[] = [];
  let totals: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (let round = 0; round < MAX_FAT_ROUNDS; round++) {
    solved = sorted.map((m) => solveMeal(m.slot, m.items, day.meals[m.slot], m.slot === "snack" ? 0 : bump));
    totals = addUp(solved.map((m) => m.totals));
    if (totals.fat >= day.fatFloor || round === MAX_FAT_ROUNDS - 1) break;
    bump += FAT_BUMP_STEP;
  }
  return { meals: solved, totals, fatBumpG: bump, fatFloorMet: totals.fat >= day.fatFloor };
}
