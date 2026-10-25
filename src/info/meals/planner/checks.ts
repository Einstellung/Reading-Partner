// The rules a drafted plan is held to before the user sees it (docs/671 一锅,
// 多样性, 整包与开封). Every problem is one English sentence the model can act
// on, with the rule's name; the tool sends them back, at most MAX_DRAFT_ROUNDS
// times a turn.
//
// Order: the structure first (dishes known and plannable, pots and the prep
// session consistent, the fridge window), because nothing can be solved until
// it holds. Then the grams are solved, a day short of vegetables gets a quick
// side added by the program (said in `notes`), and the rules that read the
// solved plan run: red meat, legumes, whole grains, vegetables, fruit,
// protein variety, fish, sodium, the day's protein and kcal, and the packs
// nobody finishes.

import { dishStorage } from "../dishes/methods";
import { referenceServing } from "../dishes/serving";
import { isFishOrSeafood } from "../dishes/check";
import type { Dish } from "../dishes/types";
import { foodById, type Food } from "../nutrition/foods";
import type { DayTargets, Profile } from "../nutrition/targets";
import { DAY_KCAL_FLOOR } from "../plan/checks";
import {
  isBatchMain,
  MAIN_SLOTS,
  MAX_PLAN_DAYS,
  MAX_PREP_SESSIONS,
  mealName,
  PLAN_SLOTS,
  POT_MEALS,
  type DraftDay,
  type MainSlot,
  type PlanDraft,
  type PlanSlot,
} from "./draft";
import { planLibrary, type PlanLibrary } from "./library";
import { leftoverMatters, packList, shownName, type PackLine } from "./packs";
import { solveDraft, type PlanLine, type SolvedDay, type SolvedPlan } from "./solve";

export type DraftRule =
  | "days"
  | "dish"
  | "dish_role"
  | "dish_blocked"
  | "staple"
  | "way"
  | "pot"
  | "pot_meals"
  | "pot_link"
  | "one_pot_per_dish"
  | "session"
  | "sessions"
  | "cook_slot"
  | "fridge"
  | "same_day_dish"
  | "ways_vary"
  | "fresh_fish"
  | "equipment"
  | "fruit_food"
  | "red_meat"
  | "legumes"
  | "whole_grain"
  | "vegetables"
  | "veg_variety"
  | "fruit"
  | "protein_variety"
  | "same_protein"
  | "fish"
  | "sodium"
  | "protein"
  | "kcal"
  | "leftover";

export interface DraftProblem {
  rule: DraftRule;
  message: string;
  day?: number;
  slot?: PlanSlot;
  batch?: string;
  food?: string;
}

export interface DraftContext {
  profile: Pick<Profile, "dislikes" | "kitchen" | "unavailable" | "cookSlots">;
  /** Each plan day's targets (solve.ts planDayTargets). */
  targets: readonly DayTargets[];
  /** ISO weekday of day 1, for the profile's cooking times. */
  startWeekday: number;
  people?: number;
  /** The library; the seed dishes by default. */
  library?: PlanLibrary;
}

export interface DraftResult {
  problems: DraftProblem[];
  /** What the program changed on its own (a quick side added), one line each, for the model to say. */
  notes: string[];
  /** The draft with the program's additions. */
  draft: PlanDraft;
  /** Solved when the structure held; meaningful only when `problems` is empty. */
  plan: SolvedPlan | null;
  shopping: PackLine[];
}

/** Whole grains are at least this share of the plan's staple servings. */
export const WHOLE_GRAIN_SHARE = 0.5;
/** Lunch and dinner together: real vegetables, and the deep-coloured share of them. */
export const DAY_VEG = { realG: 300, deepShare: 0.5 } as const;
/** Fruit portions a day (about 2). */
export const FRUIT_PORTIONS = { min: 2, max: 3 } as const;
export const DAY_SODIUM_MG = 2000;
/** One protein food in at most this many lunches and dinners of a plan. */
export const SAME_PROTEIN_MAX_MEALS = 3;
/** The day's protein and kcal reach this share of their targets. */
export const DAY_PROTEIN_FLOOR = 0.9;
/** Quick sides added to one day at most. */
const MAX_TOP_UPS = 2;

/** The quick sides (hands-on 5 minutes or less) the program adds to a day short of vegetables, in preference order. */
export const QUICK_SIDES: readonly string[] = [
  "microwave_spinach_sesame",
  "quick_garlic_spinach",
  "steamed_carrot_coins",
  "soy_green_beans_microwave",
  "tomato_cucumber_salad",
  "purple_cabbage_vinegar",
  "romaine_cherry_tomato_salad",
];

/** Main meals with red meat a plan may have: 3 a week, prorated and rounded up (1–2 days 1, 3 days 2). */
export function redMeatCap(days: number): number {
  return Math.ceil((3 * days) / 7);
}

/** Fish or shrimp meals a plan needs: 2 a week by docs/671, so one in a 3-day plan and none in a shorter one. */
export function fishMinimum(days: number): number {
  return days >= 3 ? 1 : 0;
}

/** Protein categories a plan needs: 2 for up to 3 days (docs/671 多样性). */
export function proteinKindsMinimum(days: number): number {
  return days <= 3 ? 2 : 3;
}

/** Vegetable kinds over the whole plan: the days plus 2, at most 8. */
export function vegKindsMinimum(days: number): number {
  return Math.min(days + 2, 8);
}

const FISH_FOODS = [
  "salmon", "cod", "frozen_tilapia_fillet", "basa_fillet", "frozen_shrimp", "white_shrimp",
  "canned_tuna_water", "canned_salmon", "canned_sardine", "canned_mackerel_tomato",
];

const PART_AT = { morning: 0, afternoon: 1, evening: 2 } as const;
const SLOT_AT = { lunch: 0.5, dinner: 1.5 } as const;

const isPulse = (f: Food | undefined) => f?.proteinCategory === "soy" || f?.proteinCategory === "legume";
const g = (n: number) => Math.round(n);

// --- structure ---------------------------------------------------------------

function structureProblems(draft: PlanDraft, lib: PlanLibrary, ctx: DraftContext): DraftProblem[] {
  const out: DraftProblem[] = [];
  const n = draft.days.length;
  if (n < 1 || n > MAX_PLAN_DAYS) {
    out.push({ rule: "days", message: `The plan has ${n} days; it covers 1 to ${MAX_PLAN_DAYS}. For longer, plan ${MAX_PLAN_DAYS} days and plan again after them.` });
    return out;
  }
  const equipmentSeen = new Set<string>();

  const known = (id: string, at: string, day: number, slot?: PlanSlot): Dish | null => {
    const stored = lib.stored(id);
    if (!stored) {
      out.push({ rule: "dish", message: `${at}: there is no dish "${id}" in the library.`, day, slot });
      return null;
    }
    const block = lib.blocked(id);
    if (block) {
      const food = foodById(block.food);
      const why = block.reason === "dislike" ? "which they dislike" : "which they cannot get, and nothing in its swap group fits";
      out.push({ rule: "dish_blocked", message: `${at}: ${stored.name} uses ${food?.zh ?? block.food} (${block.food}), ${why}. Pick another dish.`, day, slot, food: block.food });
      return null;
    }
    const dish = lib.dish(id) ?? null;
    if (dish && !equipmentSeen.has(dish.id)) {
      equipmentSeen.add(dish.id);
      const missing = dish.equipment.filter((e) => !lib.kitchen.has(e));
      if (missing.length) out.push({ rule: "equipment", message: `${dish.name} needs ${missing.join(", ")}, which is not in their kitchen.`, day, slot });
    }
    return dish;
  };
  const role = (dish: Dish, want: Dish["role"], at: string, day: number, slot?: PlanSlot) => {
    if (dish.role === want) return true;
    out.push({ rule: "dish_role", message: `${at}: ${dish.name} is a ${dish.role} dish, not a ${want}.`, day, slot });
    return false;
  };
  const stapleRef = (ref: string, at: string, day: number, slot: PlanSlot) => {
    if (foodById(ref)?.roles.includes("staple")) {
      if (lib.foodBlocked(ref)) out.push({ rule: "dish_blocked", message: `${at}: they cannot have the staple ${ref}; pick another.`, day, slot, food: ref });
      return;
    }
    const dish = known(ref, at, day, slot);
    if (dish) role(dish, "staple", at, day, slot);
  };

  const mainDish = new Map<string, string>();
  draft.days.forEach((d: DraftDay, i) => {
    const day = i + 1;
    const b = known(d.breakfast, mealName(day, "breakfast"), day, "breakfast");
    if (b) role(b, "breakfast", mealName(day, "breakfast"), day, "breakfast");
    for (const id of d.fruit) {
      const f = foodById(id);
      if (!f?.roles.includes("fruit")) out.push({ rule: "fruit_food", message: `Day ${day} fruit: "${id}" is not a fruit in the food table.`, day });
      else if (lib.foodBlocked(id)) out.push({ rule: "dish_blocked", message: `Day ${day} fruit: they cannot have ${f.zh} (${id}).`, day, food: id });
    }
    for (const slot of MAIN_SLOTS) {
      const at = mealName(day, slot);
      const meal = d[slot];
      for (const s of meal.sides) {
        const side = known(s, at, day, slot);
        if (side) role(side, "side", at, day, slot);
      }
      const main = meal.main;
      if (isBatchMain(main)) {
        const batch = draft.batches.find((x) => x.id === main.batch);
        if (!batch) {
          out.push({ rule: "pot", message: `${at} eats from pot "${main.batch}", which is not in batches.`, day, slot });
          continue;
        }
        const dish = lib.dish(batch.dish);
        if (!dish) continue; // named on the batch
        mainDish.set(`${day}:${slot}`, dish.id);
        const ways = dish.ways ?? [];
        const way = ways[main.way - 1];
        if (!way) out.push({ rule: "way", message: `${at}: ${dish.name} has ways 1 to ${ways.length}; way ${main.way} is not one of them.`, day, slot });
        else if (way.staple) stapleRef(way.staple, at, day, slot);
        if (!batch.meals.some((m) => m.day === day && m.slot === slot)) {
          out.push({ rule: "pot_link", message: `${at} eats from pot ${batch.id}, but the pot does not list ${at} among its meals.`, day, slot, batch: batch.id });
        }
      } else {
        const dish = known(main.dish, at, day, slot);
        if (!dish || !role(dish, "main", at, day, slot)) continue;
        mainDish.set(`${day}:${slot}`, dish.id);
        if (dish.prep === "batch") {
          out.push({ rule: "pot", message: `${at}: ${dish.name} is a batch dish; cook it in a pot (batches) and point the meal at the pot.`, day, slot });
          continue;
        }
        if (dish.staples.length && !main.staple) {
          out.push({ rule: "staple", message: `${at}: ${dish.name} needs one of its staples: ${dish.staples.join(", ")}.`, day, slot });
        } else if (main.staple && !dish.staples.includes(main.staple)) {
          out.push({ rule: "staple", message: `${at}: ${dish.name} goes with ${dish.staples.join(", ") || "no staple"}; "${main.staple}" is not one of them.`, day, slot });
        } else if (main.staple) stapleRef(main.staple, at, day, slot);
      }
    }
    if (mainDish.get(`${day}:lunch`) && mainDish.get(`${day}:lunch`) === mainDish.get(`${day}:dinner`)) {
      const dish = lib.stored(mainDish.get(`${day}:lunch`) as string);
      out.push({ rule: "same_day_dish", message: `Day ${day} has ${dish?.name} at both lunch and dinner.`, day });
    }
  });

  if (draft.sessions.length > MAX_PREP_SESSIONS) {
    out.push({ rule: "sessions", message: `The draft has ${draft.sessions.length} prep sessions; a plan has at most ${MAX_PREP_SESSIONS}: cook every pot in it.` });
  }
  for (const s of draft.sessions) {
    if (!(s.day >= 1 && s.day <= n) || !(s.part in PART_AT)) {
      out.push({ rule: "session", message: `Session ${s.id} is on day ${s.day} ${s.part}; it must be a plan day (1 to ${n}) and morning, afternoon or evening.` });
      continue;
    }
    const slots = ctx.profile.cookSlots ?? [];
    const weekday = ((ctx.startWeekday - 1 + s.day - 1) % 7) + 1;
    if (slots.length && !slots.some((c) => c.weekday === weekday && c.part === s.part)) {
      out.push({ rule: "cook_slot", message: `Session ${s.id} is on Day ${s.day} ${s.part}, which is not one of the times they can cook.` });
    }
  }

  const potsByDish = new Map<string, string[]>();
  for (const b of draft.batches) {
    const dish = known(b.dish, `Pot ${b.id}`, b.meals[0]?.day ?? 1);
    if (!dish) continue;
    potsByDish.set(dish.id, [...(potsByDish.get(dish.id) ?? []), b.id]);
    if (dish.role !== "main" || dish.prep !== "batch") {
      out.push({ rule: "pot", message: `Pot ${b.id}: ${dish.name} is made at the meal, never cooked in a pot.`, batch: b.id });
      continue;
    }
    if (dish.ingredients.some((l) => l.role === "protein" && isFishOrSeafood(foodById(l.food) as Food))) {
      out.push({ rule: "fresh_fish", message: `Pot ${b.id}: ${dish.name} has fish or seafood, which is made at the meal, never batched.`, batch: b.id });
    }
    if (b.meals.length < POT_MEALS.min || b.meals.length > POT_MEALS.max) {
      out.push({ rule: "pot_meals", message: `Pot ${b.id} (${dish.name}) feeds ${b.meals.length} meals; a pot feeds ${POT_MEALS.min} to ${POT_MEALS.max}, the cooking meal counted.`, batch: b.id });
    }
    for (const m of b.meals) {
      const main = draft.days[m.day - 1]?.[m.slot as MainSlot]?.main;
      if (!main || !isBatchMain(main) || main.batch !== b.id) {
        out.push({ rule: "pot_link", message: `Pot ${b.id} lists ${mealName(m.day, m.slot)}, but that meal does not eat from it.`, batch: b.id });
      }
    }
    const session = draft.sessions.find((s) => s.id === b.session);
    if (!session) {
      out.push({ rule: "session", message: `Pot ${b.id} names session "${b.session}", which is not in sessions.`, batch: b.id });
    } else if (session.part in PART_AT) {
      const fridgeDays = dishStorage(dish)?.fridgeDays ?? 0;
      for (const m of b.meals) {
        const after = m.day - session.day;
        if (after < 0 || (after === 0 && SLOT_AT[m.slot] < PART_AT[session.part])) {
          out.push({ rule: "fridge", message: `Pot ${b.id}: ${mealName(m.day, m.slot)} comes before its prep session (Day ${session.day} ${session.part}).`, batch: b.id, day: m.day, slot: m.slot });
        } else if (after > fridgeDays) {
          out.push({ rule: "fridge", message: `Pot ${b.id} (${dish.name}): ${mealName(m.day, m.slot)} is ${after} days after it is cooked; it keeps the cooking day and ${fridgeDays} more in the fridge.`, batch: b.id, day: m.day, slot: m.slot });
        }
      }
    }
    const ways = new Set(
      b.meals.flatMap((m) => {
        const main = draft.days[m.day - 1]?.[m.slot as MainSlot]?.main;
        return main && isBatchMain(main) && main.batch === b.id ? [main.way] : [];
      }),
    );
    const want = Math.min(b.meals.length, dish.ways?.length ?? 1);
    if (ways.size < want) {
      out.push({ rule: "ways_vary", message: `Pot ${b.id} (${dish.name}) is eaten ${b.meals.length} times with ${ways.size} way(s); it has ${dish.ways?.length} ways, so use ${want} different ones.`, batch: b.id });
    }
  }
  for (const [id, pots] of potsByDish) {
    if (pots.length > 1) out.push({ rule: "one_pot_per_dish", message: `${lib.stored(id)?.name} is cooked in ${pots.length} pots (${pots.join(", ")}); a dish is cooked once per plan.` });
  }
  return out;
}

// --- the solved plan ---------------------------------------------------------

const mainLines = (day: SolvedDay) => [...day.meals.lunch.lines, ...day.meals.dinner.lines];
const dayLines = (day: SolvedDay) => [...day.meals.breakfast.lines, ...mainLines(day), ...day.fruit];

function vegOf(lines: readonly PlanLine[]): { real: number; deep: number; kinds: Set<string> } {
  let real = 0;
  let deep = 0;
  const kinds = new Set<string>();
  for (const l of lines) {
    const f = foodById(l.food);
    if (l.role !== "veg" || !f || f.aromatic) continue;
    real += l.grams;
    if (f.deepColor) deep += l.grams;
    kinds.add(l.food);
  }
  return { real, deep, kinds };
}

const vegShort = (v: { real: number; deep: number }) => v.real < DAY_VEG.realG || v.deep < DAY_VEG.deepShare * v.real;

/** Adds quick sides to the days short of vegetables; returns the notes. */
function topUpVegetables(draft: PlanDraft, plan: SolvedPlan, lib: PlanLibrary): string[] {
  const notes: string[] = [];
  for (const day of plan.days) {
    const d = draft.days[day.day - 1];
    let lunch = vegOf(day.meals.lunch.lines);
    let dinner = vegOf(day.meals.dinner.lines);
    for (let added = 0; added < MAX_TOP_UPS; added++) {
      const v = { real: lunch.real + dinner.real, deep: lunch.deep + dinner.deep };
      if (!vegShort(v)) break;
      const used = new Set([...d.lunch.sides, ...d.dinner.sides]);
      const side = QUICK_SIDES.map((id) => lib.dish(id)).find(
        (s): s is Dish => !!s && !used.has(s.id) && s.equipment.every((e) => lib.kitchen.has(e)),
      );
      if (!side) break;
      const slot: MainSlot = lunch.real <= dinner.real ? "lunch" : "dinner";
      d[slot].sides.push(side.id);
      const lines = (referenceServing(side)?.ingredients ?? []).map((l) => ({ ...l, source: "side" as const }));
      const sideVeg = vegOf(lines);
      if (slot === "lunch") lunch = { ...lunch, real: lunch.real + sideVeg.real, deep: lunch.deep + sideVeg.deep };
      else dinner = { ...dinner, real: dinner.real + sideVeg.real, deep: dinner.deep + sideVeg.deep };
      notes.push(
        `Added the quick side ${side.name} (${side.id}) to ${mealName(day.day, slot)}: lunch and dinner had ${g(v.real)} g of vegetables, ${g(v.deep)} g deep-coloured (they need ${DAY_VEG.realG} g, half deep).`,
      );
    }
  }
  return notes;
}

function solvedProblems(plan: SolvedPlan, lib: PlanLibrary, shopping: readonly PackLine[]): DraftProblem[] {
  const out: DraftProblem[] = [];
  const n = plan.days.length;
  const meals = plan.days.flatMap((d) => PLAN_SLOTS.map((slot) => ({ day: d.day, slot, lines: d.meals[slot].lines })));
  const mainMeals = meals.filter((m) => m.slot !== "breakfast");

  // Red meat.
  const red = mainMeals.filter((m) => m.lines.some((l) => l.source === "main" && l.role === "protein" && foodById(l.food)?.proteinCategory === "meat"));
  if (red.length > redMeatCap(n)) {
    out.push({ rule: "red_meat", message: `Red meat (beef, pork, lamb) is in ${red.length} main meals (${red.map((m) => mealName(m.day, m.slot)).join(", ")}); a ${n}-day plan has at most ${redMeatCap(n)}.` });
  }

  // Legumes: any 3 days in a row, or the whole plan when it is shorter.
  const legumeDay = plan.days.map((d) => dayLines(d).some((l) => (l.role === "protein" || l.role === "staple") && isPulse(foodById(l.food))));
  const span = Math.min(3, n);
  for (let start = 0; start + span <= n; start++) {
    if (!legumeDay.slice(start, start + span).some(Boolean)) {
      const which = span === n ? "the plan" : `Days ${start + 1} to ${start + span}`;
      out.push({ rule: "legumes", message: `No beans, lentils, tofu or soy milk anywhere in ${which}; have them at least once (a soy milk breakfast or a tofu dish counts).` });
    }
  }

  // Whole grains.
  let servings = 0;
  let whole = 0;
  for (const m of meals) {
    const staples = m.lines.filter((l) => l.role === "staple" && !isPulse(foodById(l.food)));
    const own = staples.filter((l) => l.source !== "staple");
    const picked = staples.find((l) => l.source === "staple");
    for (const l of own) {
      servings++;
      if (foodById(l.food)?.wholeGrain) whole++;
    }
    if (picked) {
      servings++;
      if (foodById(picked.food)?.wholeGrain) whole++;
    }
  }
  if (servings && whole < WHOLE_GRAIN_SHARE * servings) {
    out.push({ rule: "whole_grain", message: `${whole} of ${servings} staple servings are whole grain; at least half must be (brown rice, mixed grains, oats, whole-wheat bread or pasta, corn, soba).` });
  }

  const allKinds = new Set<string>();
  for (const d of plan.days) {
    const v = vegOf(mainLines(d));
    if (vegShort(v)) {
      out.push({ rule: "vegetables", message: `Day ${d.day} lunch and dinner have ${g(v.real)} g of vegetables, ${g(v.deep)} g deep-coloured, even with quick sides added; they need ${DAY_VEG.realG} g, half deep. Pick mains or ways with more vegetables.`, day: d.day });
    }
    const kinds = vegOf(dayLines(d)).kinds;
    for (const k of kinds) allKinds.add(k);
    if (kinds.size < 2) out.push({ rule: "veg_variety", message: `Day ${d.day} has ${kinds.size} kind(s) of vegetable at its meals; at least 2.`, day: d.day });

    const fruit = d.fruit.length + d.meals.breakfast.lines.filter((l) => l.role === "fruit").length;
    if (fruit < FRUIT_PORTIONS.min || fruit > FRUIT_PORTIONS.max) {
      out.push({ rule: "fruit", message: `Day ${d.day} has ${fruit} fruit portion(s), breakfast fruit counted; about 2 a day (${FRUIT_PORTIONS.min} to ${FRUIT_PORTIONS.max}): whole fruit that keeps, like apples, bananas, oranges, mandarins, frozen berries.`, day: d.day });
    }
    if (d.totals.sodium > DAY_SODIUM_MG) {
      out.push({ rule: "sodium", message: `Day ${d.day} sodium is ${g(d.totals.sodium)} mg; at most ${DAY_SODIUM_MG}.`, day: d.day });
    }
    if (d.totals.protein < DAY_PROTEIN_FLOOR * d.target.protein) {
      out.push({ rule: "protein", message: `Day ${d.day} protein is ${g(d.totals.protein)} g of ${g(d.target.protein)} g even at the dishes' largest portions; pick mains or a breakfast with more protein.`, day: d.day });
    }
    if (d.totals.kcal < DAY_KCAL_FLOOR * d.target.kcal) {
      out.push({ rule: "kcal", message: `Day ${d.day} comes to ${g(d.totals.kcal)} kcal of ${g(d.target.kcal)}, under ${DAY_KCAL_FLOOR * 100}%; pick mains with a staple or a fuller breakfast.`, day: d.day });
    }
  }
  if (allKinds.size < vegKindsMinimum(n)) {
    out.push({ rule: "veg_variety", message: `The plan has ${allKinds.size} kinds of vegetable; a ${n}-day plan needs at least ${vegKindsMinimum(n)}.` });
  }

  // Protein: kinds, the same food, fish.
  const proteins = meals.flatMap((m) => m.lines.filter((l) => l.role === "protein").map((l) => ({ ...m, food: foodById(l.food) })));
  const kinds = new Set(proteins.map((p) => p.food?.proteinCategory).filter(Boolean));
  if (kinds.size < proteinKindsMinimum(n)) {
    out.push({ rule: "protein_variety", message: `All protein comes from ${[...kinds].join(", ") || "nothing"}; a ${n}-day plan uses at least ${proteinKindsMinimum(n)} kinds (poultry, meat, fish, egg, soy, dairy, beans).` });
  }
  const perFood = new Map<string, Set<string>>();
  for (const m of mainMeals) {
    for (const l of m.lines) {
      if (l.source !== "main" || l.role !== "protein") continue;
      perFood.set(l.food, (perFood.get(l.food) ?? new Set()).add(`${m.day}:${m.slot}`));
    }
  }
  for (const [food, at] of perFood) {
    if (at.size > SAME_PROTEIN_MAX_MEALS) {
      out.push({ rule: "same_protein", message: `${foodById(food)?.zh} (${food}) is the protein of ${at.size} lunches and dinners; at most ${SAME_PROTEIN_MAX_MEALS}.`, food });
    }
  }
  const fishWanted = fishMinimum(n);
  const canFish = FISH_FOODS.some((id) => !lib.foodBlocked(id));
  const fish = meals.filter((m) => m.lines.some((l) => l.role === "protein" && isFishOrSeafood(foodById(l.food) as Food))).length;
  if (canFish && fish < fishWanted) {
    out.push({ rule: "fish", message: `No fish or shrimp in the ${n} days; a ${n}-day plan has it at least ${fishWanted === 1 ? "once" : `${fishWanted} times`} (made at the meal).` });
  }

  // Packs nobody finishes.
  for (const line of shopping) {
    if (!leftoverMatters(line) || !line.leftover) continue;
    const food = foodById(line.food);
    const bought = line.buy.by === "pack" ? `${line.buy.count} ${line.buy.kind} of ${line.buy.packG} g` : line.buy.by === "piece" ? `${line.buy.count} piece(s)` : "";
    out.push({
      rule: "leftover",
      message: `${food ? shownName(food) : line.food} (${line.food}): buying ${bought} leaves ${g(line.leftover.grams)} g that no meal uses; opened on Day ${line.firstDay}, it spoils on Day ${line.leftover.spoilsDay}. Use it in another meal or pick another dish.`,
      food: line.food,
    });
  }
  return out;
}

function cloneDraft(draft: PlanDraft): PlanDraft {
  return {
    days: draft.days.map((d) => ({
      breakfast: d.breakfast,
      lunch: { main: { ...d.lunch.main }, sides: [...d.lunch.sides] },
      dinner: { main: { ...d.dinner.main }, sides: [...d.dinner.sides] },
      fruit: [...d.fruit],
    })),
    batches: draft.batches.map((b) => ({ ...b, meals: b.meals.map((m) => ({ ...m })) })),
    sessions: draft.sessions.map((s) => ({ ...s })),
  };
}

export function checkDraft(input: PlanDraft, ctx: DraftContext): DraftResult {
  const lib = ctx.library ?? planLibrary(ctx.profile);
  const draft = cloneDraft(input);
  const structure = structureProblems(draft, lib, ctx);
  if (structure.length || ctx.targets.length < draft.days.length) {
    return { problems: structure, notes: [], draft, plan: null, shopping: [] };
  }
  const first = solveDraft(draft, lib, ctx.targets);
  const notes = topUpVegetables(draft, first, lib);
  const plan = notes.length ? solveDraft(draft, lib, ctx.targets) : first;
  const shopping = packList(plan, draft, ctx.people ?? 1);
  const used = draft.days.flatMap((d) => [
    d.breakfast,
    ...MAIN_SLOTS.flatMap((s) => {
      const main = d[s].main;
      return [...d[s].sides, ...(isBatchMain(main) ? [] : [main.dish, main.staple ?? ""])];
    }),
  ]);
  for (const id of new Set([...used, ...draft.batches.map((b) => b.dish)])) {
    for (const s of lib.swaps(id)) {
      notes.push(`${lib.dish(id)?.name} uses ${foodById(s.to)?.zh} (${s.to}) in place of ${foodById(s.from)?.zh} (${s.from}), which they cannot get.`);
    }
  }
  return { problems: solvedProblems(plan, lib, shopping), notes, draft, plan, shopping };
}
