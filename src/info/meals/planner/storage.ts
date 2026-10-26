// Containers, boxes and where everything is kept (docs/671 一锅, 整包与开封),
// computed from the checked draft, its solved plan and the shopping list. No
// dates: days are plan days and a time is a day plus a meal or the prep
// session. Day 0 is the prep day before Day 1: the list is bought by it, and
// its evening has the night-before reminders for Day 1.
//
// - Every pot is cooked at the one prep session and eaten inside the cooking
//   day plus FRIDGE_DAYS_AFTER_COOK, so cooked food is only refrigerated.
// - A box holds the pot portion of one meal; the vegetables, and a staple that
//   is not the plan's rice, are made fresh at the meal. The pot meal eaten at
//   the prep session's own meal is not boxed. A user who does not box gets one
//   lidded large container per pot with something left in it. Every box and
//   container is eaten by the pot's last meal.
// - The plan's rice (rice.ts) is one rice-cooker batch cooked at the prep
//   session for every rice meal after it, kept like a pot: a pot meal's rice
//   goes into its box, the rest into one lidded container. Rice meals before
//   the session cook their own at the meal. With no prep session the batch is
//   cooked at the first rice meal.
// - Raw meat and fish wait in the fridge until their cooking day when they keep
//   that long and are frozen the day they are bought when they do not; what a
//   pack leaves over is frozen raw, flat in a dated bag. Food bought frozen
//   stays frozen, and a fish meal from the freezer moves to the fridge the
//   night before.
// - Opened perishable packs go in the fridge with the day they are used by;
//   cans, dry goods, oils and spices go in the cupboard.

import { getLocale, t } from "../../../i18n";
import type { Dish } from "../dishes/types";
import { CHILL_AFTER_OPENING, ROOM_TEMPERATURE } from "../nutrition/food-columns";
import { foodById, type Food } from "../nutrition/foods";
import type { Profile } from "../nutrition/targets";
import { draftMeal, isBatchMain, MAIN_SLOTS, PREP_DAY, type MainSlot, type MealAt, type PlanDraft, type PlanSlot } from "./draft";
import type { PlanLibrary } from "./library";
import { boughtName, isRawFlesh, LEFTOVER_IGNORE, rawKeepsUntil, shopDay, shownName, type PackLine } from "./packs";
import { planRice, riceMeals, stapleOf } from "./rice";
import type { PlanLine, SolvedPlan } from "./solve";

/** The box to get: about this many millilitres, lidded, microwave-safe, glass preferred. */
export const BOX_ML = 750;
/** Raw meat and fish frozen from a pack are used within this many weeks (the next plans pick them up). */
export const RAW_FREEZER_WEEKS = 4;

/** A point in the plan: a meal, the day's prep session, or the whole day when there is no slot. */
export interface PlanTime {
  day: number;
  slot?: PlanSlot | "prep";
}

export type Container =
  /** Boxes: the pot meals less the ones eaten at the prep session's meal, times the people eating. */
  | { kind: "box"; count: number; potMeals: number; eatenAtPrep: number }
  /** No boxes: one lidded large container per pot with something left. */
  | { kind: "potContainer"; count: number; batches: string[] }
  /** One lidded container for the batch rice not boxed with a pot portion, and the meals it is for. */
  | { kind: "riceContainer"; count: number; staple: string; meals: MealAt[] }
  /** One per raw leftover and per raw portion frozen the day it is bought. */
  | { kind: "freezerBag"; count: number; foods: string[] };

export interface FoodBox {
  batch: string;
  dish: string;
  /** The meal it is for. */
  meal: MealAt;
  /** The pot's last meal. */
  eatBy: MealAt;
  /** Boxes for this meal: the people eating. */
  count: number;
  /** The plan's rice boxed with the pot portion (a staple dish id), or null. */
  rice: string | null;
  /** Made fresh at the meal, never boxed: the staple when it is not the boxed rice (a food or staple dish id), the way's add-ons (food ids), the sides (dish ids). */
  staple: string | null;
  addOns: string[];
  sides: string[];
}

export type StoreRow =
  /** A cooked pot, in boxes or one container. */
  | { kind: "pot"; batch: string; dish: string; portions: number; boxed: boolean; eatBy: MealAt }
  /** The batch rice kept for later meals: portions boxed with a pot and portions in the rice container. */
  | { kind: "rice"; staple: string; inBoxes: number; inContainer: number; eatBy: MealAt }
  /** Raw meat or fish waiting in the fridge for these cooking times. */
  | { kind: "rawForMeal"; food: string; meals: PlanTime[] }
  /** An opened perishable pack, used by the end of `useBy`. */
  | { kind: "opened"; food: string; useBy: number; how: "produce" | "water" | "lid" | "bread" }
  /** Unopened or loose foods kept cold; `produce` for the vegetable drawer. */
  | { kind: "chilled"; foods: string[]; produce: boolean }
  /** Opened seasoning jars kept cold. */
  | { kind: "jars"; foods: string[] }
  /** What a raw pack leaves over, frozen flat in a dated bag. */
  | { kind: "rawLeftover"; food: string; grams: number; weeks: number }
  /** Meat or fish kept frozen until these meals: bought frozen, or frozen the day it is bought. */
  | { kind: "frozenForMeal"; food: string; meals: PlanTime[]; boughtFrozen: boolean }
  /** Frozen vegetables, fruit and the like, kept frozen. */
  | { kind: "frozenOther"; foods: string[] }
  /** Produce kept out of the fridge. */
  | { kind: "room"; foods: string[] }
  /** Dry goods, cans, oils, spices and seasonings that go back in the cupboard. */
  | { kind: "pantry"; foods: string[] };

export type NightItem =
  | { kind: "soyMilk"; meal: { day: number; slot: "breakfast" }; dish: string; foods: string[] }
  | { kind: "thaw"; food: string; meal: PlanTime; fromFrozen: boolean };

/** What to do on the evening of `day` for the day after. */
export interface NightBefore {
  day: number;
  items: NightItem[];
}

/** The plan's one rice-cooker batch: every rice meal from its cooking time on. */
export interface RiceBatch {
  /** The rice staple dish id. */
  staple: string;
  /** The staple line's food and its grams for the whole batch (the food's own grams, cooked or dry), times the people eating. */
  food: string;
  grams: number;
  /** The prep session, or the first rice meal when the plan has none. */
  cookedAt: PlanTime;
  /** The meals it feeds, in order; `portions` is their count times the people eating. */
  meals: MealAt[];
  portions: number;
  /** The meal eaten as it is cooked, not kept; null when none is. */
  eatenNow: MealAt | null;
}

export interface StoragePlan {
  /** Null when no meal at or after the rice's cooking time has rice. */
  rice: RiceBatch | null;
  containers: Container[];
  /** Empty when the user does not box. */
  boxes: FoodBox[];
  fridge: StoreRow[];
  freezer: StoreRow[];
  cupboard: StoreRow[];
  nights: NightBefore[];
}

export interface StorageInput {
  draft: PlanDraft;
  plan: SolvedPlan;
  shopping: readonly PackLine[];
  profile: Pick<Profile, "boxes">;
  library: PlanLibrary;
  people?: number;
}

const PART_AT = { morning: 0, afternoon: 1, evening: 2 } as const;
const SLOT_AT = { breakfast: -0.5, lunch: 0.5, dinner: 1.5, prep: 0 } as const;
const OPENED_CHECKED: ReadonlySet<string> = new Set(["d1-2", "d3-5", "w1"]);

const timeAt = (p: PlanTime) => p.day * 10 + (p.slot ? SLOT_AT[p.slot] : 0);
const sameTime = (a: PlanTime, b: PlanTime) => a.day === b.day && a.slot === b.slot;
const byTime = (a: PlanTime, b: PlanTime) => timeAt(a) - timeAt(b);

/** The solved lines of a lunch or dinner, the prep day's dinner at day 0. */
function linesAt(plan: SolvedPlan, m: MealAt): PlanLine[] {
  return m.day === PREP_DAY ? (m.slot === "dinner" ? (plan.prepDinner?.lines ?? []) : []) : (plan.days[m.day - 1]?.meals[m.slot].lines ?? []);
}

/** The session of a pot, or null for a draft that did not hold. */
function sessionOf(draft: PlanDraft, batchId: string) {
  const batch = draft.batches.find((b) => b.id === batchId);
  return draft.sessions.find((s) => s.id === batch?.session) ?? null;
}

/** True when the meal comes after the prep session, so it can be cooked or eaten at it. */
function afterSession(s: PlanDraft["sessions"][number], meal: MealAt): boolean {
  return meal.day > s.day || (meal.day === s.day && SLOT_AT[meal.slot] > (PART_AT[s.part] ?? 9));
}

/** The pot meal eaten at the prep session's own meal: the session day's first lunch or dinner after it. */
function prepMeal(draft: PlanDraft, batchId: string): MealAt | null {
  const s = sessionOf(draft, batchId);
  if (!s) return null;
  const slot = MAIN_SLOTS.find((m) => SLOT_AT[m] > (PART_AT[s.part] ?? 9));
  return slot ? { day: s.day, slot } : null;
}

/** The batch of the plan's rice, or null when no rice meal comes at or after its cooking time. */
function riceBatch(draft: PlanDraft, plan: SolvedPlan, lib: PlanLibrary, people: number): RiceBatch | null {
  const staple = planRice(draft, lib);
  if (!staple) return null;
  const all = riceMeals(draft, lib).filter((r) => r.staple === staple).map((r) => r.meal);
  const session = draft.sessions[0];
  const meals = session ? all.filter((m) => afterSession(session, m)) : all;
  const first = meals[0];
  if (!first) return null;
  const lines = meals.flatMap((m) => linesAt(plan, m).filter((l) => l.source === "staple" && l.role === "staple" && l.dish === staple));
  const food = lines[0]?.food ?? lib.dish(staple)?.ingredients.find((l) => l.role === "staple")?.food ?? staple;
  const grams = lines.filter((l) => l.food === food).reduce((sum, l) => sum + l.grams, 0) * people;
  let eatenNow: MealAt | null = { ...first };
  if (session) {
    const slot = MAIN_SLOTS.find((m) => SLOT_AT[m] > (PART_AT[session.part] ?? 9));
    eatenNow = slot && first.day === session.day && first.slot === slot ? { ...first } : null;
  }
  return {
    staple,
    food,
    grams: Math.round(grams),
    cookedAt: session ? { day: session.day, slot: "prep" } : { ...first },
    meals: meals.map((m) => ({ ...m })),
    portions: meals.length * people,
    eatenNow,
  };
}

function addOnsOf(draft: PlanDraft, lib: PlanLibrary, day: number, slot: MainSlot): string[] {
  const main = draftMeal(draft, day, slot)?.main;
  if (!main || !isBatchMain(main)) return [];
  const batch = draft.batches.find((b) => b.id === main.batch);
  return (lib.dish(batch?.dish ?? "")?.ways?.[main.way - 1]?.addOns ?? []).map((l) => l.food);
}

/** When each food is cooked or eaten: a pot's main lines and the batch rice at their cooking time, everything else at its meal. */
function usesByFood(draft: PlanDraft, plan: SolvedPlan, rice: RiceBatch | null): Map<string, PlanTime[]> {
  const out = new Map<string, PlanTime[]>();
  const add = (food: string, at: PlanTime) => {
    const list = out.get(food) ?? [];
    if (!list.some((x) => sameTime(x, at))) list.push(at);
    out.set(food, list);
  };
  for (const d of plan.days) {
    for (const slot of ["breakfast", "lunch", "dinner"] as const) {
      const main = slot === "breakfast" ? null : draft.days[d.day - 1]?.[slot].main;
      const pot = main && isBatchMain(main) ? sessionOf(draft, main.batch) : null;
      const batchRice = rice && slot !== "breakfast" && rice.meals.some((m) => m.day === d.day && m.slot === slot) ? rice : null;
      for (const l of d.meals[slot].lines) {
        if (batchRice && l.source === "staple" && l.dish === batchRice.staple) add(l.food, batchRice.cookedAt);
        else add(l.food, pot && l.source === "main" ? { day: pot.day, slot: "prep" } : { day: d.day, slot });
      }
    }
    for (const l of d.fruit) add(l.food, { day: d.day });
  }
  if (plan.prepDinner && draft.prepDinner) {
    const main = draft.prepDinner.main;
    const pot = isBatchMain(main) ? sessionOf(draft, main.batch) : null;
    const at: PlanTime = { day: PREP_DAY, slot: "dinner" };
    const batchRice = rice && rice.meals.some((m) => sameTime(m, at)) ? rice : null;
    for (const l of plan.prepDinner.lines) {
      if (batchRice && l.source === "staple" && l.dish === batchRice.staple) add(l.food, batchRice.cookedAt);
      else add(l.food, pot && l.source === "main" ? { day: pot.day, slot: "prep" } : at);
    }
  }
  for (const list of out.values()) list.sort(byTime);
  return out;
}

const isFish = (f: Food) => f.proteinCategory === "seafood";
const isFlesh = (f: Food) => ["meat", "poultry", "seafood"].includes(f.proteinCategory ?? "");

export function planStorage(input: StorageInput): StoragePlan {
  const { draft, plan, shopping, profile, library: lib } = input;
  const people = input.people ?? 1;
  const boxed = profile.boxes !== false;
  const n = plan.days.length;
  const rice = riceBatch(draft, plan, lib, people);
  /** The batch rice of this meal is kept, not eaten as it is cooked. */
  const riceKeptFor = (m: MealAt) => !!rice && rice.meals.some((r) => sameTime(r, m)) && !(rice.eatenNow && sameTime(rice.eatenNow, m));
  const riceInBoxes: MealAt[] = [];

  // Pots, boxes and containers.
  const boxes: FoodBox[] = [];
  const fridge: StoreRow[] = [];
  let potMeals = 0;
  let eatenAtPrep = 0;
  const leftPots: string[] = [];
  for (const b of draft.batches) {
    const meals = [...b.meals].sort(byTime);
    const last = meals[meals.length - 1];
    if (!last) continue;
    const now = prepMeal(draft, b.id);
    const stored = meals.filter((m) => !(now && sameTime(m, now)));
    potMeals += meals.length;
    eatenAtPrep += meals.length - stored.length;
    if (!stored.length) continue;
    leftPots.push(b.id);
    fridge.push({ kind: "pot", batch: b.id, dish: b.dish, portions: stored.length * people, boxed, eatBy: { ...last } });
    if (!boxed) continue;
    for (const m of stored) {
      const staple = stapleOf(draft, lib, m.day, m.slot);
      const withRice = riceKeptFor(m) && staple === rice?.staple;
      if (withRice) riceInBoxes.push(m);
      boxes.push({
        batch: b.id,
        dish: b.dish,
        meal: { day: m.day, slot: m.slot },
        eatBy: { ...last },
        count: people,
        rice: withRice ? staple : null,
        staple: withRice ? null : staple,
        addOns: addOnsOf(draft, lib, m.day, m.slot),
        sides: [...(draftMeal(draft, m.day, m.slot)?.sides ?? [])],
      });
    }
  }
  boxes.sort((a, b) => byTime(a.meal, b.meal));
  fridge.sort((a, b) => (a.kind === "pot" && b.kind === "pot" ? byTime(a.eatBy, b.eatBy) : 0));

  const riceKept = rice ? rice.meals.filter(riceKeptFor) : [];
  const riceInContainer = riceKept.filter((m) => !riceInBoxes.some((x) => sameTime(x, m)));
  const riceLast = riceKept[riceKept.length - 1];
  if (rice && riceLast) {
    fridge.push({ kind: "rice", staple: rice.staple, inBoxes: riceInBoxes.length * people, inContainer: riceInContainer.length * people, eatBy: { ...riceLast } });
  }

  // Every shopping line, placed.
  const uses = usesByFood(draft, plan, rice);
  const freezer: StoreRow[] = [];
  const cupboard: StoreRow[] = [];
  const bagFoods: string[] = [];
  const thaw: { food: string; meal: PlanTime; fromFrozen: boolean }[] = [];
  const opened: StoreRow[] = [];
  const openedBread: StoreRow[] = [];
  const chilledProduce: string[] = [];
  const chilledOther: string[] = [];
  const jars: string[] = [];
  const frozenOther: string[] = [];
  const room: string[] = [];
  const pantry: string[] = [];
  const rawFridge: StoreRow[] = [];
  const leftovers: StoreRow[] = [];
  const frozenMeals: StoreRow[] = [];

  const shop = shopDay(draft);
  for (const line of shopping) {
    const food = foodById(line.food);
    if (!food) continue;
    const at = uses.get(line.food) ?? [];
    if (line.buy.by === "onHand" && food.category !== "produce") {
      (CHILL_AFTER_OPENING.has(food.id) ? jars : pantry).push(food.id);
    } else if (isRawFlesh(food)) {
      const keeps = rawKeepsUntil(food, shop);
      const cold = at.filter((p) => p.day <= keeps);
      const frozen = at.filter((p) => p.day > keeps);
      if (cold.length) rawFridge.push({ kind: "rawForMeal", food: food.id, meals: cold });
      if (frozen.length) {
        frozenMeals.push({ kind: "frozenForMeal", food: food.id, meals: frozen, boughtFrozen: false });
        for (const p of frozen) {
          bagFoods.push(food.id);
          thaw.push({ food: food.id, meal: p, fromFrozen: isFish(food) });
        }
      }
      if (line.buy.by === "pack") {
        const left = line.buy.count * line.buy.packG - line.grams;
        if (left >= Math.max(LEFTOVER_IGNORE.share * line.buy.packG, LEFTOVER_IGNORE.grams)) {
          leftovers.push({ kind: "rawLeftover", food: food.id, grams: Math.round(left), weeks: RAW_FREEZER_WEEKS });
          bagFoods.push(food.id);
        }
      }
    } else if (line.frozen) {
      if (isFlesh(food)) {
        frozenMeals.push({ kind: "frozenForMeal", food: food.id, meals: at, boughtFrozen: true });
        if (isFish(food)) for (const p of at) thaw.push({ food: food.id, meal: p, fromFrozen: true });
      } else frozenOther.push(food.id);
    } else if (food.pack && line.buy.by === "pack" && OPENED_CHECKED.has(food.keeps)) {
      const useBy = line.firstDay + food.pack.openDays;
      if (food.pack.kind === "loaf") openedBread.push({ kind: "opened", food: food.id, useBy, how: "bread" });
      else {
        const how = food.proteinCategory === "soy" && food.pack.kind === "block" ? "water" : food.category === "produce" ? "produce" : "lid";
        opened.push({ kind: "opened", food: food.id, useBy, how });
      }
    } else if (food.keeps === "pantry" || food.boughtDry) {
      pantry.push(food.id);
    } else if (ROOM_TEMPERATURE.has(food.id)) {
      room.push(food.id);
    } else {
      (food.category === "produce" ? chilledProduce : chilledOther).push(food.id);
    }
  }

  fridge.push(...rawFridge, ...opened);
  if (chilledProduce.length) fridge.push({ kind: "chilled", foods: chilledProduce, produce: true });
  if (chilledOther.length) fridge.push({ kind: "chilled", foods: chilledOther, produce: false });
  if (jars.length) fridge.push({ kind: "jars", foods: jars });
  freezer.push(...leftovers, ...frozenMeals);
  if (frozenOther.length) freezer.push({ kind: "frozenOther", foods: frozenOther });
  if (room.length) cupboard.push({ kind: "room", foods: room });
  cupboard.push(...openedBread);
  if (pantry.length) cupboard.push({ kind: "pantry", foods: pantry });

  // Containers.
  const containers: Container[] = [];
  const boxCount = boxes.reduce((s, b) => s + b.count, 0);
  if (boxed && boxCount) containers.push({ kind: "box", count: boxCount, potMeals, eatenAtPrep });
  if (!boxed && leftPots.length) containers.push({ kind: "potContainer", count: leftPots.length, batches: leftPots });
  if (rice && riceInContainer.length) containers.push({ kind: "riceContainer", count: 1, staple: rice.staple, meals: riceInContainer.map((m) => ({ ...m })) });
  if (bagFoods.length) containers.push({ kind: "freezerBag", count: bagFoods.length, foods: [...new Set(bagFoods)] });

  // The night before each day after the one the list is bought by.
  const nights: NightBefore[] = [];
  for (let day = shop + 1; day <= n; day++) {
    const items: NightItem[] = [];
    const breakfast = lib.dish(draft.days[day - 1]?.breakfast ?? "");
    if (breakfast?.equipment.includes("soy_milk_maker")) {
      const foods = [...new Set(breakfast.ingredients.map((l) => l.food).filter((id) => foodById(id)?.keeps === "pantry"))];
      items.push({ kind: "soyMilk", meal: { day, slot: "breakfast" }, dish: breakfast.id, foods });
    }
    for (const x of thaw.filter((x) => x.meal.day === day).sort((a, b) => byTime(a.meal, b.meal))) {
      items.push({ kind: "thaw", food: x.food, meal: x.meal, fromFrozen: x.fromFrozen });
    }
    if (items.length) nights.push({ day: day - 1, items });
  }

  return { rice, containers, boxes, fridge, freezer, cupboard, nights };
}

// --- what the reader sees ----------------------------------------------------

export interface StorageTextRow {
  name: string;
  detail: string;
  /** Eat or use by, or empty. */
  until: string;
}

export interface StorageText {
  /** The rice-cooker batch cooked at the prep session, or null. */
  rice: { name: string; detail: string } | null;
  containers: { name: string; detail: string; count: string }[];
  boxes: { meal: string; what: string; with: string; keep: string }[];
  /** The reminder said over the fridge list. */
  fridgeLede: string;
  places: { place: "fridge" | "freezer" | "cupboard"; label: string; rows: StorageTextRow[] }[];
  nights: { title: string; lines: string[] }[];
}

const zh = () => getLocale() === "zh-CN";

/** Foods go by their Chinese name in every language, as on the shopping list (packs.ts); the food table has no other. */
function foodName(id: string): string {
  const f = foodById(id);
  return f ? shownName(f) : id;
}

/** A food in the cupboard by the name it is bought by: rice kept dry is 糙米, not 糙米饭. */
function keptName(id: string): string {
  const f = foodById(id);
  return f ? boughtName(f) : id;
}

function dishName(d: Dish | undefined, id: string): string {
  if (!d) return id;
  return zh() ? d.name : d.nameEn;
}

/** A staple ref (food or staple dish id) or a dish id, by name. */
function refName(lib: PlanLibrary, id: string): string {
  const d = lib.dish(id);
  return d ? dishName(d, id) : foodName(id);
}

const list = (names: string[]) => names.join(t("meals.listJoin"));

export function timeText(p: PlanTime): string {
  if (p.day === PREP_DAY) {
    if (!p.slot) return t("meals.store.prepDay");
    if (p.slot === "prep") return t("meals.store.prepDayPrep");
    return t("meals.store.prepDayMeal", { slot: t(`meals.meal.${p.slot}`) });
  }
  if (!p.slot) return t("meals.store.day", { day: p.day });
  if (p.slot === "prep") return t("meals.store.prep", { day: p.day });
  return t("meals.store.meal", { day: p.day, slot: t(`meals.meal.${p.slot}`) });
}

function rowText(row: StoreRow, lib: PlanLibrary): StorageTextRow {
  switch (row.kind) {
    case "pot": {
      const dish = dishName(lib.dish(row.dish), row.dish);
      const until = t("meals.store.eatBy", { meal: timeText(row.eatBy) });
      return row.boxed
        ? { name: t("meals.store.pot.boxed", { dish, count: row.portions }), detail: t("meals.store.pot.boxedDo"), until }
        : { name: t("meals.store.pot.left", { dish, count: row.portions }), detail: t("meals.store.pot.leftDo"), until };
    }
    case "rice": {
      const rice = refName(lib, row.staple);
      const detail =
        row.inBoxes && row.inContainer
          ? t("meals.store.rice.split", { boxes: row.inBoxes, rest: row.inContainer })
          : row.inBoxes
            ? t("meals.store.rice.boxes")
            : t("meals.store.rice.container");
      return { name: t("meals.store.rice.left", { rice, count: row.inBoxes + row.inContainer }), detail, until: t("meals.store.eatBy", { meal: timeText(row.eatBy) }) };
    }
    case "rawForMeal":
      return {
        name: t("meals.store.raw.name", { food: foodName(row.food) }),
        detail: t("meals.store.raw.do"),
        until: t("meals.store.useOn", { when: list(row.meals.map(timeText)) }),
      };
    case "opened":
      return { name: foodName(row.food), detail: t(`meals.store.opened.${row.how}`), until: t("meals.store.useBy", { day: row.useBy }) };
    case "chilled":
      return { name: list(row.foods.map(foodName)), detail: t(row.produce ? "meals.store.chilled.produce" : "meals.store.chilled.other"), until: "" };
    case "jars":
      return { name: t("meals.store.jars.name", { foods: list(row.foods.map(foodName)) }), detail: t("meals.store.jars.do"), until: "" };
    case "rawLeftover":
      return {
        name: t("meals.store.leftover.name", { food: foodName(row.food), grams: Math.max(10, Math.round(row.grams / 10) * 10) }),
        detail: t("meals.store.leftover.do"),
        until: t("meals.store.leftover.until", { count: row.weeks }),
      };
    case "frozenForMeal": {
      const food = foodName(row.food);
      const when = list(row.meals.map(timeText));
      const f = foodById(row.food);
      const detail = !row.boughtFrozen
        ? t("meals.store.frozen.portion", { meals: when })
        : f && isFish(f)
          ? t("meals.store.frozen.fish")
          : t("meals.store.frozen.keep");
      return { name: row.boughtFrozen ? food : t("meals.store.raw.name", { food }), detail, until: t("meals.store.useOn", { when }) };
    }
    case "frozenOther":
      return { name: list(row.foods.map(foodName)), detail: t("meals.store.frozen.other"), until: "" };
    case "room":
      return { name: list(row.foods.map(foodName)), detail: t("meals.store.room.do"), until: "" };
    case "pantry":
      return { name: list(row.foods.map(keptName)), detail: t("meals.store.pantry.do"), until: "" };
  }
}

function nightText(item: NightItem): string {
  if (item.kind === "soyMilk") return t("meals.store.night.soyMilk", { foods: list(item.foods.map(foodName)), meal: timeText(item.meal) });
  return t(item.fromFrozen ? "meals.store.night.thawFish" : "meals.store.night.thaw", { food: foodName(item.food), meal: timeText(item.meal) });
}

/** The storage plan in the reader's language: the rows a prep page or a card shows. */
export function storageText(sp: StoragePlan, lib: PlanLibrary): StorageText {
  const containers = sp.containers.map((c) => {
    if (c.kind === "box") {
      return {
        name: t("meals.store.box.name"),
        detail: `${t("meals.store.box.spec", { ml: BOX_ML })} · ${t("meals.store.box.split", { total: c.potMeals, now: c.eatenAtPrep, count: c.count })}`,
        count: t("meals.store.count", { count: c.count }),
      };
    }
    if (c.kind === "potContainer") {
      return { name: t("meals.store.container.name"), detail: t("meals.store.container.detail"), count: t("meals.store.count", { count: c.count }) };
    }
    if (c.kind === "riceContainer") {
      return {
        name: t("meals.store.riceBox.name"),
        detail: t("meals.store.riceBox.detail", { rice: refName(lib, c.staple), meals: list(c.meals.map(timeText)) }),
        count: t("meals.store.count", { count: c.count }),
      };
    }
    return { name: t("meals.store.bag.name"), detail: t("meals.store.bag.detail", { foods: list(c.foods.map(foodName)) }), count: t("meals.store.count", { count: c.count }) };
  });
  const boxes = sp.boxes.map((b) => {
    const fresh = [...(b.staple ? [refName(lib, b.staple)] : []), ...b.addOns.map(foodName), ...b.sides.map((s) => refName(lib, s))];
    const dish = dishName(lib.dish(b.dish), b.dish);
    return {
      meal: timeText(b.meal),
      what: b.rice ? t("meals.store.box.whatRice", { dish, count: b.count, rice: refName(lib, b.rice) }) : t("meals.store.box.what", { dish, count: b.count }),
      with: fresh.length ? t("meals.store.box.with", { items: list(fresh) }) : "",
      keep: t("meals.store.box.keep", { meal: timeText(b.eatBy) }),
    };
  });
  const places = (["fridge", "freezer", "cupboard"] as const)
    .map((place) => ({ place, label: t(`meals.store.place.${place}`), rows: sp[place].map((r) => rowText(r, lib)) }))
    .filter((p) => p.rows.length);
  const nights = sp.nights.map((nb) => ({
    title: nb.day === PREP_DAY ? t("meals.store.night.prepDayTitle") : t("meals.store.night.title", { day: nb.day }),
    lines: nb.items.map((i) => nightText(i)),
  }));
  const rice = sp.rice
    ? {
        name: t("meals.store.rice.cook", { rice: refName(lib, sp.rice.staple), count: sp.rice.portions }),
        detail: t("meals.store.rice.cookDo", { when: timeText(sp.rice.cookedAt), meals: list(sp.rice.meals.map(timeText)) }),
      }
    : null;
  return { rice, containers, boxes, fridgeLede: t("meals.store.fridgeLede"), places, nights };
}
