// Grams for a meal the model composed (docs/73 每顿怎么搭).
//
// The model names the foods and their roles; the program solves the amounts.
// The protein food gets a normal portion, not the meal's protein target: the
// target is a floor the portions usually clear. The staple then fills the
// meal's kcal within its usual range, and the oil or spread moves up from its
// default only when the staple is full. The snack is solved last and its fat
// item (the nuts) closes what the day's main meals left of the day's kcal.

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

/**
 * The protein a meal's protein food brings, together with any non-dairy
 * protein the model fixed beside it (milk and yogurt on the side do not
 * count): two eggs at breakfast, an ordinary piece of meat at lunch and
 * dinner, a cup of soy milk or yogurt at the snack.
 */
export const PORTION_PROTEIN: Readonly<Record<MealSlot, number>> = { breakfast: 12, lunch: 25, dinner: 25, snack: 9 };
/** The most kcal a staple brings to one meal. */
export const STAPLE_KCAL_CAP = 400;

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

/** A fixed item whose protein counts toward the portion: a protein food that is not dairy. */
function countsTowardPortion(food: Food): boolean {
  return food.roles.includes("protein") && !food.roles.includes("dairy");
}

/**
 * The grams of a protein food that make the slot's portion, given the protein
 * the fixed items beside it already count for: whole units (eggs) or 5 g,
 * within the food's range.
 */
export function portionGrams(food: Food, slot: MealSlot, beside = 0): number {
  const want = Math.max(0, PORTION_PROTEIN[slot] - beside);
  const unit = food.unit?.grams ?? 5;
  return Math.round(clamp((want / food.protein) * 100, food.minG, food.maxG) / unit) * unit;
}

/** The most of a staple one meal takes: its usual max, or 400 kcal of it when that is less. */
export function stapleCapG(food: Food): number {
  return Math.max(food.minG, Math.min(food.maxG, (STAPLE_KCAL_CAP / food.kcal) * 100));
}

export interface SolveOptions {
  /** Raises a main meal's fat item over its default; the day-level fat-floor loop uses it. */
  fatBumpG?: number;
  /** The kcal to fill when it is not the target's: the snack fills what the day has left. */
  kcal?: number;
}

/**
 * Solve one meal: exactly one protein item, at most one staple and at most one
 * fat (which slots need a staple is the checks' rule). The protein food gets
 * its portion; the staple fills the kcal within [its min, stapleCapG]; the fat
 * item starts at its default plus `fatBumpG` (the snack's at its minimum) and
 * moves up, within its max, to close what is still short.
 */
export function solveMeal(
  slot: MealSlot,
  items: readonly TemplateItem[],
  target: MealTarget,
  opts: SolveOptions = {},
): MealSolution {
  const rows = items.map((i) => ({ item: i, food: need(i.foodId), grams: i.role === "fixed" ? (i.grams ?? 0) : 0 }));
  const proteinRows = rows.filter((r) => r.item.role === "protein");
  const stapleRows = rows.filter((r) => r.item.role === "staple");
  const fatRows = rows.filter((r) => r.item.role === "fat");
  const P = proteinRows[0];
  if (!P || proteinRows.length !== 1 || stapleRows.length > 1 || fatRows.length > 1) {
    throw new Error("A meal template needs exactly one protein, at most one staple and at most one fat item");
  }
  const C = stapleRows[0];
  const O = fatRows[0];
  const kcal = opts.kcal ?? target.kcal;
  const kc = (f: Food) => f.kcal / 100;
  const sum = () => rows.reduce((s, r) => s + kc(r.food) * r.grams, 0);
  const beside = rows
    .filter((r) => r.item.role === "fixed" && countsTowardPortion(r.food))
    .reduce((s, r) => s + (r.food.protein * r.grams) / 100, 0);

  P.grams = portionGrams(P.food, slot, beside);
  if (O) {
    const start = slot === "snack" ? O.food.minG : (O.food.defaultG ?? O.food.minG) + (opts.fatBumpG ?? 0);
    O.grams = Math.min(O.food.maxG, start);
  }
  if (C) C.grams = round5(clamp((kcal - sum()) / kc(C.food), C.food.minG, stapleCapG(C.food)));
  const short = kcal - sum();
  if (O && short > 0) O.grams = Math.min(O.food.maxG, round5(O.grams + short / kc(O.food)));

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
 * Solve a day's meals against its targets, returned in the day's eating order.
 * The main meals are solved first; the snack then fills its own share plus
 * whatever they left under theirs. When the day's fat lands under its floor,
 * each main meal's fat item gets 5 g more and the day is solved again, up to
 * four solves in all.
 */
export function solveDay(meals: readonly DayMealInput[], day: DayTargets): DaySolution {
  const order = (m: DayMealInput) => {
    const i = day.order.indexOf(m.slot);
    return i < 0 ? day.order.length : i;
  };
  const sorted = [...meals].sort((a, b) => order(a) - order(b));
  const solveAll = (bump: number): MealSolution[] => {
    const mains = sorted.map((m) =>
      m.slot === "snack" ? null : solveMeal(m.slot, m.items, day.meals[m.slot], { fatBumpG: bump }),
    );
    const left = mains.reduce((s, m) => s + (m ? m.target.kcal - m.totals.kcal : 0), 0);
    return sorted.map(
      (m, i) => mains[i] ?? solveMeal(m.slot, m.items, day.meals[m.slot], { kcal: day.meals[m.slot].kcal + left }),
    );
  };
  let bump = 0;
  let solved: MealSolution[] = [];
  let totals: Nutrition = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  for (let round = 0; round < MAX_FAT_ROUNDS; round++) {
    solved = solveAll(bump);
    totals = addUp(solved.map((m) => m.totals));
    if (totals.fat >= day.fatFloor || round === MAX_FAT_ROUNDS - 1) break;
    bump += FAT_BUMP_STEP;
  }
  return { meals: solved, totals, fatBumpG: bump, fatFloorMet: totals.fat >= day.fatFloor };
}
