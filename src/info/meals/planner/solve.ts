// Grams for a drafted plan (docs/671 克数). The model never supplies an
// amount; the program solves them per person:
//
// - A breakfast is its template as written. Fruit is whole pieces.
// - A main dish scales from its reference serving (25 g protein) to the
//   meal's protein: the day's protein target less breakfast, fruit and sides,
//   halved over lunch and dinner; never under the reference serving, never a
//   protein line over its food's maximum. A pot's meals share one scale, and
//   a pot's packed protein rounds to whole packs when that moves it 30 % or
//   less ("一盒整盒下锅").
// - The staple fills the meal's kcal within its range (nutrition/solve.ts
//   stapleCapG); the day's carbs are held to the carb floor.
// - Oil never fills kcal: a day under its fat floor gets 5 g of oil at each
//   lunch and dinner, up to four solves (docs/73).
//
// The draft must have passed the structural checks (checks.ts) first.

import { referenceServing, REFERENCE_TARGET, totals, type Totals } from "../dishes/serving";
import type { Dish, DishIngredient, IngredientRole } from "../dishes/types";
import { foodById, type Food } from "../nutrition/foods";
import { stapleCapG } from "../nutrition/solve";
import type { DayTargets, Profile, Targets } from "../nutrition/targets";
import { dayTargetsOn } from "../plan/solve-week";
import { addDays } from "../plan/week";
import { isBatchMain, MAIN_SLOTS, type DraftDay, type MainSlot, type MealAt, type PlanDraft, type PlanSlot } from "./draft";
import type { PlanLibrary } from "./library";

export type LineSource = "breakfast" | "main" | "addOn" | "staple" | "side" | "fruit" | "oil";

export interface PlanLine extends DishIngredient {
  source: LineSource;
  /** The dish the line belongs to; absent on fruit and added oil. */
  dish?: string;
}

export interface SolvedMeal {
  day: number;
  slot: PlanSlot;
  lines: PlanLine[];
  totals: Totals;
}

export interface SolvedDay {
  day: number;
  target: DayTargets;
  meals: Record<PlanSlot, SolvedMeal>;
  fruit: PlanLine[];
  totals: Totals;
  /** Oil added at each lunch and dinner to reach the fat floor. */
  fatBumpG: number;
}

export interface SolvedBatch {
  id: string;
  dish: string;
  session: string;
  meals: MealAt[];
  /** The whole pot for one person: its meals' main lines added up. */
  lines: DishIngredient[];
}

export interface SolvedPlan {
  days: SolvedDay[];
  batches: SolvedBatch[];
}

const FAT_BUMP_STEP = 5;
const MAX_FAT_ROUNDS = 4;
const FAT_BUMP_FOOD = "olive_oil";
/** A pot's packed protein rounds to whole packs when that changes it by at most this share. */
export const POT_PACK_SNAP = 0.3;
/** A fruit portion is whole pieces making at least this many grams; fruit not counted in pieces is this many grams. */
export const FRUIT_PORTION_G = 125;

const r1 = (n: number) => Math.round(n * 10) / 10;
const round5 = (n: number) => Math.round(n / 5) * 5;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** One fruit portion: whole pieces of at least 100 g (one apple, two mandarins), else FRUIT_PORTION_G. */
export function fruitPortionG(food: Food): number {
  const piece = food.piece?.grams;
  if (!piece) return FRUIT_PORTION_G;
  return piece * Math.max(1, Math.ceil(100 / piece));
}

/** The day targets of each plan day, read off the calendar date day 1 falls on. */
export function planDayTargets(targets: Targets, profile: Pick<Profile, "trainingDays">, startDate: string, days: number): DayTargets[] {
  return Array.from({ length: days }, (_, i) => dayTargetsOn(targets, profile, addDays(startDate, i)));
}

function need(lib: PlanLibrary, id: string): Dish {
  const d = lib.dish(id);
  if (!d) throw new Error(`Dish not in the library: ${id}`);
  return d;
}

const tag = (lines: readonly DishIngredient[], source: LineSource, dish?: string, k = 1): PlanLine[] =>
  lines.map((l) => ({ food: l.food, grams: r1(l.grams * k), role: l.role, ...(l.ground ? { ground: true } : {}), source, ...(dish ? { dish } : {}) }));

/** The largest scale of a reference serving before a protein line passes its food's maximum. */
export function maxMainScale(dish: Dish): number {
  const ref = referenceServing(dish);
  if (!ref) return 1;
  const caps = ref.ingredients
    .filter((l) => l.role === "protein" && l.grams > 0)
    .map((l) => (foodById(l.food)?.maxG ?? Number.POSITIVE_INFINITY) / l.grams);
  return Math.max(1, Math.min(Number.POSITIVE_INFINITY, ...caps));
}

/** The main dish and how it is eaten at one lunch or dinner. */
function mainOf(draft: PlanDraft, lib: PlanLibrary, day: DraftDay, slot: MainSlot) {
  const main = day[slot].main;
  if (isBatchMain(main)) {
    const batch = draft.batches.find((b) => b.id === main.batch);
    const dish = need(lib, batch?.dish ?? "");
    const way = dish.ways?.[main.way - 1];
    return { dish, addOns: way?.addOns ?? [], staple: way?.staple ?? null, batch: batch?.id };
  }
  const dish = need(lib, main.dish);
  return { dish, addOns: [] as DishIngredient[], staple: main.staple ?? null, batch: undefined };
}

/** Staple lines filling `kcal`: a staple food in its range, or a staple dish scaled by its staple line's range. */
function stapleLines(lib: PlanLibrary, ref: string | null, kcal: number, boost = 1): PlanLine[] {
  if (!ref) return [];
  const food = foodById(ref);
  if (food) {
    const g = clamp(((kcal / food.kcal) * 100) * boost, food.minG, stapleCapG(food));
    return [{ food: ref, grams: round5(g), role: "staple", source: "staple" }];
  }
  const dish = lib.dish(ref);
  const serving = dish && referenceServing(dish);
  if (!dish || !serving) return [];
  const main = serving.ingredients.find((l) => l.role === "staple");
  const mainFood = main && foodById(main.food);
  let k = (kcal / REFERENCE_TARGET.staple.value) * boost;
  if (main && mainFood && main.grams > 0) k = clamp(k, mainFood.minG / main.grams, stapleCapG(mainFood) / main.grams);
  return tag(serving.ingredients, "staple", dish.id, Math.max(0, k));
}

export function solveDraft(draft: PlanDraft, lib: PlanLibrary, targets: readonly DayTargets[]): SolvedPlan {
  const fixed = draft.days.map((d) => {
    const breakfast = need(lib, d.breakfast);
    const sides = (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const s = referenceServing(need(lib, id));
        return s ? tag(s.ingredients, "side", id) : [];
      });
    return {
      breakfast: tag(breakfast.ingredients, "breakfast", breakfast.id),
      fruit: d.fruit.flatMap((id): PlanLine[] => {
        const f = foodById(id);
        return f ? [{ food: id, grams: fruitPortionG(f), role: "fruit" as IngredientRole, source: "fruit" }] : [];
      }),
      sides: { lunch: sides(d.lunch.sides), dinner: sides(d.dinner.sides) },
    };
  });

  // The protein each lunch and dinner main carries.
  const mainProtein = fixed.map((f, i) => {
    const around = totals([...f.breakfast, ...f.fruit, ...f.sides.lunch, ...f.sides.dinner]).protein;
    return Math.max(REFERENCE_TARGET.main.value, (targets[i].protein - around) / 2);
  });

  // One scale per meal; a pot's meals share theirs.
  const scale = new Map<string, number>();
  const key = (day: number, slot: MainSlot) => `${day}:${slot}`;
  for (const b of draft.batches) {
    const dish = need(lib, b.dish);
    const want = b.meals.reduce((s, m) => s + mainProtein[m.day - 1], 0) / Math.max(1, b.meals.length);
    const k = clamp(want / REFERENCE_TARGET.main.value, 1, maxMainScale(dish));
    for (const m of b.meals) scale.set(key(m.day, m.slot), k);
  }

  const mains = draft.days.map((d, i) =>
    Object.fromEntries(
      MAIN_SLOTS.map((slot) => {
        const m = mainOf(draft, lib, d, slot);
        const serving = referenceServing(m.dish);
        const k = scale.get(key(i + 1, slot)) ?? clamp(mainProtein[i] / REFERENCE_TARGET.main.value, 1, maxMainScale(m.dish));
        const lines = serving ? tag(serving.ingredients, "main", m.dish.id, k) : [];
        return [slot, { ...m, lines }];
      }),
    ) as Record<MainSlot, ReturnType<typeof mainOf> & { lines: PlanLine[] }>,
  );

  // Whole packs into the pot.
  for (const b of draft.batches) {
    const meals = b.meals.map((m) => mains[m.day - 1][m.slot].lines);
    const foods = new Set(meals.flat().filter((l) => l.role === "protein" && foodById(l.food)?.pack).map((l) => l.food));
    for (const food of foods) {
      const total = meals.flat().filter((l) => l.food === food).reduce((s, l) => s + l.grams, 0);
      const pack = foodById(food)?.pack?.grams ?? 0;
      const packs = Math.round(total / pack);
      if (packs < 1 || Math.abs(packs * pack - total) > POT_PACK_SNAP * total) continue;
      const ratio = (packs * pack) / total;
      for (const lines of meals) for (const l of lines) if (l.food === food) l.grams = r1(l.grams * ratio);
    }
  }

  const days: SolvedDay[] = draft.days.map((_, i) => {
    const target = targets[i];
    const f = fixed[i];
    const solveDay = (bump: number, boost: number) => {
      const left = target.kcal - totals([...f.breakfast, ...f.fruit]).kcal;
      const share = target.meals.lunch.kcal / Math.max(1, target.meals.lunch.kcal + target.meals.dinner.kcal);
      const meals = Object.fromEntries(
        MAIN_SLOTS.map((slot) => {
          const m = mains[i][slot];
          const oil: PlanLine[] = bump > 0 ? [{ food: FAT_BUMP_FOOD, grams: bump, role: "oil", source: "oil" }] : [];
          const base = [...m.lines, ...tag(m.addOns, "addOn", m.dish.id), ...f.sides[slot], ...oil];
          const kcal = (slot === "lunch" ? share : 1 - share) * left - totals(base).kcal;
          const lines = [...base, ...stapleLines(lib, m.staple, kcal, boost)];
          return [slot, { day: i + 1, slot, lines, totals: totals(lines) }];
        }),
      ) as Record<MainSlot, SolvedMeal>;
      const breakfast: SolvedMeal = { day: i + 1, slot: "breakfast", lines: f.breakfast, totals: totals(f.breakfast) };
      const all = [...f.breakfast, ...meals.lunch.lines, ...meals.dinner.lines, ...f.fruit];
      return { meals: { breakfast, ...meals }, totals: totals(all) };
    };
    let bump = 0;
    let boost = 1;
    let out = solveDay(bump, boost);
    for (let round = 1; round < MAX_FAT_ROUNDS && out.totals.fat < target.fatFloor; round++) {
      bump += FAT_BUMP_STEP;
      out = solveDay(bump, boost);
    }
    // The carb floor: staples step up 10 % at a time toward their caps.
    for (let step = 0; step < 10 && out.totals.carbs < target.carbFloor; step++) {
      boost += 0.1;
      out = solveDay(bump, boost);
    }
    return { day: i + 1, target, meals: out.meals, fruit: f.fruit, totals: out.totals, fatBumpG: bump };
  });

  const batches: SolvedBatch[] = draft.batches.map((b) => {
    const sum = new Map<string, DishIngredient>();
    for (const m of b.meals) {
      for (const l of mains[m.day - 1][m.slot].lines) {
        const k = `${l.food}\u0000${l.role}`;
        const had = sum.get(k);
        sum.set(k, { food: l.food, role: l.role, grams: r1((had?.grams ?? 0) + l.grams), ...(l.ground ? { ground: true } : {}) });
      }
    }
    return { id: b.id, dish: b.dish, session: b.session, meals: b.meals.map((m) => ({ ...m })), lines: [...sum.values()] };
  });

  return { days, batches };
}
