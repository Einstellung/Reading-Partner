// Grams for a drafted plan (docs/671 克数). The model never supplies an
// amount; the program solves them per person:
//
// - A breakfast is its template grown by whole everyday units (an egg, a cup
//   of milk, a slice of bread) toward the breakfast's kcal share
//   (growBreakfast). Fruit is whole pieces.
// - A main dish scales from its reference serving (25 g protein) to the
//   meal's protein: the day's protein target less breakfast, fruit and sides,
//   halved over lunch and dinner; never under the reference serving, never a
//   protein line over its food's maximum. A pot's meals share one scale, and
//   a pot's packed protein rounds to whole packs when that moves it 30 % or
//   less ("一盒整盒下锅"). Seasoning grows with the square root of the scale
//   (scaledMain). A day still over DAY_SODIUM_MG steps its mains' scales down
//   while it keeps DAY_PROTEIN_FLOOR of its protein target and its kcal floor.
// - The staple fills the meal's kcal within its range, the range growing with
//   a day above 2000 kcal (mealStapleCapG); the day's carbs are held to the
//   carb floor.
// - A lunch or dinner without a staple leaves its share of the kcal to the
//   other meal's staple, within that staple's cap.
// - What lunch and dinner cannot fill goes to a snack of whole units, a cup
//   of milk or yogurt and a pack of nuts (snackLines); what is still missing
//   grows the breakfast past its share, by the same whole units.
// - Oil never fills kcal: a day under its fat floor gets 5 g of oil at each
//   lunch and dinner, up to four solves (docs/73).
// - Packs (packFit): a perishable pack the plan needs just over whole packs
//   of (PACK_TRIM_SHARE) is trimmed to them; what a bought pack leaves over
//   grows the vegetable sides and a way's fresh vegetables that use it, up to
//   the food's maximum a meal.
//
// The draft must have passed the structural checks (checks.ts) first.

import { referenceServing, REFERENCE_TARGET, totals, type Totals } from "../dishes/serving";
import type { Dish, DishIngredient, IngredientRole } from "../dishes/types";
import { foodById, type Food } from "../nutrition/foods";
import { STAPLE_KCAL_CAP } from "../nutrition/solve";
import type { DayTargets, Profile, Targets } from "../nutrition/targets";
import { DAY_KCAL_FLOOR } from "../plan/checks";
import { dayTargetsOn } from "../plan/solve-week";
import { addDays } from "../plan/week";
import { isBatchMain, MAIN_SLOTS, type DraftDay, type MainSlot, type MealAt, type PlanDraft, type PlanSlot } from "./draft";
import type { PlanLibrary } from "./library";
import { leftoverChecked, packList } from "./packs";

export type LineSource = "breakfast" | "main" | "addOn" | "staple" | "side" | "fruit" | "snack" | "oil";

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
  /** What the program adds when lunch and dinner cannot fill the day's kcal; empty on most days. */
  snack: PlanLine[];
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
/** Sodium a plan day holds to (checks.ts re-exports it). */
export const DAY_SODIUM_MG = 2000;
/** The day's protein and kcal reach this share of their targets (checks.ts re-exports it). */
export const DAY_PROTEIN_FLOOR = 0.9;
/** The day the staple caps are written for; a bigger day scales them (mealStapleCapG). */
export const STAPLE_REFERENCE_DAY_KCAL = 2000;
/**
 * A perishable pack the plan needs at most this share over whole packs of is
 * trimmed to them instead of buying one more (packFit). Nobody weighs a box of
 * mushrooms to the gram: 268 g of them and a 250 g box make the same stew,
 * while the next box would leave 85 % or more of itself to spoil. A pot's
 * protein already moves up to POT_PACK_SNAP to whole packs; a single food
 * moves half that, and the plan rules are checked after.
 */
export const PACK_TRIM_SHARE = 0.15;

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

/** A main's scale steps down by this much a round while its day is over DAY_SODIUM_MG, for at most MAX_SODIUM_ROUNDS rounds. */
const SODIUM_SCALE_STEP = 0.1;
const MAX_SODIUM_ROUNDS = 20;

/**
 * A main's reference serving at `k` times its protein. Seasoning lines grow
 * with the square root of `k`: a bigger pot is seasoned to taste, not by the
 * meat's weight, and the reference serving's seasoning is what the entry
 * check holds to its sodium limit. Every other line grows with `k`.
 */
export function scaledMain(lines: readonly DishIngredient[], k: number): DishIngredient[] {
  const season = Math.sqrt(Math.max(1, k));
  return lines.map((l) => ({ ...l, grams: l.grams * (l.role === "seasoning" ? season : k) }));
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

/**
 * The most of a staple one meal takes. The food's maximum and STAPLE_KCAL_CAP
 * are an ordinary eater's, written for a STAPLE_REFERENCE_DAY_KCAL day; a day
 * above it scales both, so a big eater's lunch gets proportionally more rice.
 */
export function mealStapleCapG(food: Food, dayKcal: number): number {
  const k = Math.max(1, dayKcal / STAPLE_REFERENCE_DAY_KCAL);
  return Math.max(food.minG, k * Math.min(food.maxG, (STAPLE_KCAL_CAP / food.kcal) * 100));
}

/** Staple lines filling `kcal`: a staple food in its range, or a staple dish scaled by its staple line's range. */
export function stapleLines(lib: PlanLibrary, ref: string | null, kcal: number, dayKcal: number, boost = 1): PlanLine[] {
  if (!ref) return [];
  const food = foodById(ref);
  if (food) {
    const g = clamp(((kcal / food.kcal) * 100) * boost, food.minG, mealStapleCapG(food, dayKcal));
    return [{ food: ref, grams: round5(g), role: "staple", source: "staple" }];
  }
  const dish = lib.dish(ref);
  const serving = dish && referenceServing(dish);
  if (!dish || !serving) return [];
  const main = serving.ingredients.find((l) => l.role === "staple");
  const mainFood = main && foodById(main.food);
  let k = (kcal / REFERENCE_TARGET.staple.value) * boost;
  if (main && mainFood && main.grams > 0) k = clamp(k, mainFood.minG / main.grams, mealStapleCapG(mainFood, dayKcal) / main.grams);
  return tag(serving.ingredients, "staple", dish.id, Math.max(0, k));
}

/**
 * The everyday unit a breakfast line grows by, beside the food table's own
 * units (eggs): a 250 ml cup, a slice of bread, half a steamed bun.
 */
export const BREAKFAST_UNITS: Readonly<Record<string, { grams: number; label: string }>> = {
  low_fat_milk: { grams: 250, label: "杯" },
  whole_milk: { grams: 250, label: "杯" },
  soy_milk_unsweetened: { grams: 250, label: "杯" },
  whole_wheat_toast: { grams: 35, label: "片" },
  wholegrain_toast: { grams: 35, label: "片" },
  steamed_bun: { grams: 50, label: "半个" },
  whole_wheat_pita: { grams: 40, label: "个" },
  corn_tortilla: { grams: 30, label: "张" },
  oats: { grams: 30, label: "袋" },
};

export function breakfastUnit(food: Food): { grams: number; label: string } | null {
  return food.unit ?? BREAKFAST_UNITS[food.id] ?? null;
}

/**
 * A breakfast template grown by whole units toward the meal's kcal target
 * (`target.meals.breakfast`): one unit at a time, staples first and then
 * protein, each line to at most twice its template grams and its food's
 * maximum, while a unit brings the breakfast nearer the target. Fruit and
 * lines without a unit stay as written. Sodium: a unit no saltier per kcal
 * than the day's limit allows (DAY_SODIUM_MG over the day's kcal) is always
 * fine; a saltier one (an egg, a slice of bread) only while the breakfast
 * stays within its kcal share of that limit. `extraKcal` grows it past its
 * share, for a day the rest cannot fill.
 */
export function growBreakfast(lines: readonly DishIngredient[], target: Pick<DayTargets, "kcal" | "meals">, extraKcal = 0): DishIngredient[] {
  const out = lines.map((l) => ({ ...l }));
  const kcalTarget = target.meals.breakfast.kcal + Math.max(0, extraKcal);
  const perKcal = DAY_SODIUM_MG / Math.max(1, target.kcal);
  const sodiumShare = kcalTarget * perKcal;
  const growable = out
    .map((l, i) => ({ l, i, food: foodById(l.food) as Food }))
    .filter((x) => (x.l.role === "staple" || x.l.role === "protein") && x.food && breakfastUnit(x.food))
    .sort((a, b) => (a.l.role === b.l.role ? a.i - b.i : a.l.role === "staple" ? -1 : 1));
  const now = totals(out);
  let kcal = now.kcal;
  let sodium = now.sodium;
  for (let added = true; added; ) {
    added = false;
    for (const { l, i, food } of growable) {
      const unit = breakfastUnit(food)?.grams ?? 0;
      const step = (food.kcal * unit) / 100;
      const salt = ((food.sodium ?? 0) * unit) / 100;
      const cap = Math.min(2 * lines[i].grams, food.maxG);
      if (l.grams + unit > cap + 1e-6 || Math.abs(kcal + step - kcalTarget) >= Math.abs(kcal - kcalTarget)) continue;
      if (salt > step * perKcal && sodium + salt > sodiumShare) continue;
      l.grams += unit;
      kcal += step;
      sodium += salt;
      added = true;
    }
  }
  return out;
}

/**
 * The snack a day gets when lunch and dinner cannot fill its kcal (docs/73
 * 加餐): a cup of milk or yogurt, then a small pack of nuts, the first of
 * each the user can have that keeps the day within DAY_SODIUM_MG, each only
 * when it brings the day nearer its target.
 * The day's fruit stays its own line. Soy milk is left out (docs/671 克数).
 */
export const SNACK_UNITS: readonly (readonly { food: string; grams: number; label: string }[])[] = [
  [
    { food: "low_fat_milk", grams: 250, label: "杯" },
    { food: "greek_yogurt", grams: 150, label: "杯" },
    { food: "plain_yogurt", grams: 150, label: "杯" },
    { food: "whole_milk", grams: 250, label: "杯" },
  ],
  [
    { food: "mixed_nuts", grams: 25, label: "小包" },
    { food: "almonds", grams: 25, label: "小包" },
    { food: "walnuts", grams: 25, label: "小包" },
    { food: "peanuts", grams: 25, label: "小包" },
  ],
];

function snackLines(lib: PlanLibrary, short: number, sodium: number): PlanLine[] {
  const out: PlanLine[] = [];
  let left = short;
  let salt = sodium;
  for (const choices of SNACK_UNITS) {
    const pick = choices
      .map((c) => ({ ...c, f: foodById(c.food) as Food }))
      .find((c) => c.f && !lib.foodBlocked(c.food) && salt + ((c.f.sodium ?? 0) * c.grams) / 100 <= DAY_SODIUM_MG);
    if (!pick) continue;
    const kcal = (pick.f.kcal * pick.grams) / 100;
    if (Math.abs(left - kcal) >= Math.abs(left)) continue;
    out.push({ food: pick.food, grams: pick.grams, role: pick.f.roles.includes("protein") ? "protein" : "topping", source: "snack" });
    left -= kcal;
    salt += ((pick.f.sodium ?? 0) * pick.grams) / 100;
  }
  return out;
}

/** What packFit changes: foods trimmed by a ratio, and grams added to one meal's food ("day:slot:food"), per person. */
interface PackFit {
  scale: Map<string, number>;
  extra: Map<string, number>;
}

const NO_FIT: PackFit = { scale: new Map(), extra: new Map() };
const growable = (l: PlanLine) => (l.source === "side" || l.source === "addOn") && l.role === "veg";

/** Lines with a pack fit applied: trimmed foods scaled (main lines excepted when `mainsDone`), a meal's extra grams on its first growable line of the food. */
function fitLines(fit: PackFit, lines: PlanLine[], day: number, slot: PlanSlot, mainsDone = true): PlanLine[] {
  if (!fit.scale.size && !fit.extra.size) return lines;
  const given = new Set<string>();
  return lines.map((l) => {
    let grams = l.grams;
    const k = fit.scale.get(l.food);
    if (k && !(mainsDone && l.source === "main")) grams = r1(grams * k);
    const extra = fit.extra.get(`${day}:${slot}:${l.food}`);
    if (extra && growable(l) && !given.has(l.food)) {
      given.add(l.food);
      grams = r1(grams + extra);
    }
    return grams === l.grams ? l : { ...l, grams };
  });
}

/**
 * Whole packs for the perishables (docs/671 整包与开封): a food the plan needs
 * at most PACK_TRIM_SHARE over whole packs of is trimmed to them; what a
 * bought pack leaves over is shared among the meals whose sides or way's
 * fresh vegetables use the food, opened and not yet spoiled, each up to the
 * food's maximum a meal, in proportion to the room each has.
 */
function packFit(days: readonly SolvedDay[], draft: PlanDraft, people: number): PackFit {
  const fit: PackFit = { scale: new Map(), extra: new Map() };
  for (const line of packList({ days: [...days], batches: [] }, draft, people)) {
    const food = foodById(line.food);
    if (!food || !leftoverChecked(food) || line.buy.by !== "pack") continue;
    const bought = line.buy.count * line.buy.packG;
    if (bought <= line.grams) continue;
    const fewer = bought - line.buy.packG;
    if (fewer > 0 && line.grams <= (1 + PACK_TRIM_SHARE) * fewer) {
      fit.scale.set(food.id, fewer / line.grams);
      continue;
    }
    const spoils = line.leftover?.spoilsDay ?? Number.POSITIVE_INFINITY;
    const rooms: { at: string; room: number }[] = [];
    for (const d of days) {
      if (d.day >= spoils) continue;
      for (const slot of MAIN_SLOTS) {
        const lines = d.meals[slot].lines;
        if (!lines.some((l) => l.food === food.id && growable(l))) continue;
        const room = food.maxG - lines.reduce((s, l) => s + (l.food === food.id ? l.grams : 0), 0);
        if (room > 0) rooms.push({ at: `${d.day}:${slot}:${food.id}`, room });
      }
    }
    const total = rooms.reduce((s, r) => s + r.room, 0);
    if (!total) continue;
    const give = Math.min((bought - line.grams) / Math.max(1, people), total);
    for (const r of rooms) fit.extra.set(r.at, Math.floor((r.room * give * 10) / total) / 10);
  }
  return fit;
}

export function solveDraft(draft: PlanDraft, lib: PlanLibrary, targets: readonly DayTargets[], people = 1): SolvedPlan {
  let fit = NO_FIT;
  const fixed = draft.days.map((d, i) => {
    const breakfast = need(lib, d.breakfast);
    const breakfastLines = growBreakfast(breakfast.ingredients, targets[i]);
    const sides = (ids: readonly string[]) =>
      ids.flatMap((id) => {
        const s = referenceServing(need(lib, id));
        return s ? tag(s.ingredients, "side", id) : [];
      });
    return {
      template: breakfast,
      breakfast: tag(breakfastLines, "breakfast", breakfast.id),
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

  // One scale per meal, kept by its unit: a pot's meals share their pot's.
  const meal = (day: number, slot: MainSlot) => `${day}:${slot}`;
  const unitOf = new Map<string, string>();
  const scale = new Map<string, number>();
  for (const b of draft.batches) {
    const dish = need(lib, b.dish);
    const want = b.meals.reduce((s, m) => s + mainProtein[m.day - 1], 0) / Math.max(1, b.meals.length);
    scale.set(b.id, clamp(want / REFERENCE_TARGET.main.value, 1, maxMainScale(dish)));
    for (const m of b.meals) unitOf.set(meal(m.day, m.slot), b.id);
  }
  draft.days.forEach((d, i) => {
    for (const slot of MAIN_SLOTS) {
      const at = meal(i + 1, slot);
      if (unitOf.has(at)) continue;
      unitOf.set(at, at);
      scale.set(at, clamp(mainProtein[i] / REFERENCE_TARGET.main.value, 1, maxMainScale(mainOf(draft, lib, d, slot).dish)));
    }
  });

  const solveAll = () => {
    const mains = draft.days.map((d, i) =>
      Object.fromEntries(
        MAIN_SLOTS.map((slot) => {
          const m = mainOf(draft, lib, d, slot);
          const serving = referenceServing(m.dish);
          const k = scale.get(unitOf.get(meal(i + 1, slot)) ?? "") ?? 1;
          const lines = serving ? fitLines(fit, tag(scaledMain(serving.ingredients, k), "main", m.dish.id), i + 1, slot, false) : [];
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
    return { mains, days: solveDays(mains) };
  };

  const solveDays = (mains: Record<MainSlot, ReturnType<typeof mainOf> & { lines: PlanLine[] }>[]): SolvedDay[] =>
    draft.days.map((_, i) => {
      const target = targets[i];
      const f = fixed[i];
      const solveDay = (bump: number, boost: number) => {
        const day = i + 1;
        const bf = fitLines(fit, f.breakfast, day, "breakfast");
        const left = target.kcal - totals([...bf, ...f.fruit]).kcal;
        const share = target.meals.lunch.kcal / Math.max(1, target.meals.lunch.kcal + target.meals.dinner.kcal);
        const parts = MAIN_SLOTS.map((slot) => {
          const m = mains[i][slot];
          const oil: PlanLine[] = bump > 0 ? [{ food: FAT_BUMP_FOOD, grams: bump, role: "oil", source: "oil" }] : [];
          const base = fitLines(fit, [...m.lines, ...tag(m.addOns, "addOn", m.dish.id), ...f.sides[slot], ...oil], day, slot);
          return { slot, staple: m.staple, base, want: (slot === "lunch" ? share : 1 - share) * left - totals(base).kcal };
        });
        // A meal without a staple leaves what it cannot fill to the other meal's staple.
        for (const p of parts) {
          const other = parts.find((o) => o !== p);
          if (!p.staple && p.want > 0 && other?.staple) {
            other.want += p.want;
            p.want = 0;
          }
        }
        const meals = Object.fromEntries(
          parts.map((p) => {
            const lines = [...p.base, ...fitLines(fit, stapleLines(lib, p.staple, p.want, target.kcal, boost), day, p.slot)];
            return [p.slot, { day, slot: p.slot, lines, totals: totals(lines) }];
          }),
        ) as Record<MainSlot, SolvedMeal>;
        const rest = [...meals.lunch.lines, ...meals.dinner.lines, ...f.fruit];
        const sum = totals([...bf, ...rest]);
        const snack = snackLines(lib, target.kcal - sum.kcal, sum.sodium);
        // Still short: the breakfast grows past its share, by whole units, while the day keeps its sodium.
        let bfLines = bf;
        const now = totals([...bf, ...rest, ...snack]);
        if (now.kcal < target.kcal) {
          const grown = fitLines(fit, tag(growBreakfast(f.template.ingredients, target, target.kcal - now.kcal), "breakfast", f.template.id), day, "breakfast");
          const next = totals([...grown, ...rest, ...snack]);
          if (next.kcal > now.kcal && next.sodium <= Math.max(DAY_SODIUM_MG, now.sodium)) bfLines = grown;
        }
        const breakfast: SolvedMeal = { day, slot: "breakfast", lines: bfLines, totals: totals(bfLines) };
        return { meals: { breakfast, ...meals }, snack, totals: totals([...bfLines, ...rest, ...snack]) };
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
      return { day: i + 1, target, meals: out.meals, fruit: f.fruit, snack: out.snack, totals: out.totals, fatBumpG: bump };
    });

  // Sodium: a day over DAY_SODIUM_MG steps its mains' scales down, a pot's
  // with every day it feeds, while each of those days keeps the share of its
  // protein target the checks hold it to (DAY_PROTEIN_FLOOR) and its kcal floor.
  let solved = solveAll();
  const frozen = new Set<string>();
  for (let round = 0; round < MAX_SODIUM_ROUNDS; round++) {
    const units = [...new Set(solved.days.filter((d) => d.totals.sodium > DAY_SODIUM_MG).flatMap((d) => MAIN_SLOTS.map((slot) => unitOf.get(meal(d.day, slot)) ?? "")))]
      .filter((u) => !frozen.has(u) && (scale.get(u) ?? 1) > 1);
    if (!units.length) break;
    for (const u of units) {
      const fed = new Set(draft.days.map((_, i) => i + 1).filter((day) => MAIN_SLOTS.some((slot) => unitOf.get(meal(day, slot)) === u)));
      if (!solved.days.some((d) => fed.has(d.day) && d.totals.sodium > DAY_SODIUM_MG)) continue;
      const was = scale.get(u) ?? 1;
      scale.set(u, Math.max(1, was - SODIUM_SCALE_STEP));
      const trial = solveAll();
      const keeps = trial.days.every((d, i) =>
        !fed.has(d.day) || (d.totals.protein >= DAY_PROTEIN_FLOOR * d.target.protein && d.totals.kcal >= Math.min(DAY_KCAL_FLOOR * d.target.kcal, solved.days[i].totals.kcal)),
      );
      if (keeps) solved = trial;
      else {
        scale.set(u, was);
        frozen.add(u);
      }
    }
  }
  // Whole packs: solved once more with the perishables trimmed or their leftover shared out.
  const fitted = packFit(solved.days, draft, people);
  if (fitted.scale.size || fitted.extra.size) {
    fit = fitted;
    solved = solveAll();
  }
  const { mains, days } = solved;

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
