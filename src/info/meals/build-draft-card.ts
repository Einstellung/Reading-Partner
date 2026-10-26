// The draft card's payload, written by the program from a checked draft
// (docs/671 对话): names, pot letters, the prep session and its minutes, the
// meal eaten straight from the pot, the night-before reminders, and which meals
// a revision changed. The model hands in ids; everything shown comes from here.

import type {
  DraftCardDay,
  DraftCardMeal,
  DraftCardNight,
  DraftCardPot,
  DraftCardSession,
  MealsDraftCardData,
  Named,
} from "./cards";
import type { Dish } from "./dishes/types";
import { foodById } from "./nutrition/foods";
import { addDays } from "./plan/week";
import type { DraftResult } from "./planner/checks";
import { isBatchMain, type DraftMeal, type MainSlot, type PlanDraft } from "./planner/draft";
import type { PlanLibrary } from "./planner/library";
import { shownName } from "./planner/packs";
import type { NightItem } from "./planner/storage";

const LETTERS = "ABCDEFGHIJ";

/** A food by the name it is shown under, in both languages (storage.ts: foods have only their Chinese name). */
export function foodNamed(id: string): Named {
  const f = foodById(id);
  const name = f ? shownName(f) : id;
  return { zh: name, en: name };
}

/**
 * A dish by the name the card shows. Many seed dishes carry the foreign dish's
 * own name in a trailing （…） after the Chinese one (鸡腿丁红芸豆炖菜（chili）);
 * it reads like a batch id on a pot legend, so the card drops it, the way
 * foodNamed drops a food's trailing note.
 */
function dishNamed(d: Dish | undefined, id: string): Named {
  return d ? { zh: d.name.replace(/（[^）]*）$/, ""), en: d.nameEn } : { zh: id, en: id };
}

/** A staple or side ref: a dish id from the library, else a food id. */
export function refNamed(lib: PlanLibrary, id: string): Named {
  const d = lib.dish(id);
  return d ? dishNamed(d, id) : foodNamed(id);
}

/**
 * Hands-on and start-to-finish minutes of one prep session: one pair of hands,
 * the longest pot started first, each pot's hands-on part before its waiting.
 * Shown as 「共约」, an estimate until the timeline (docs/671 时间线与语音).
 */
export function prepMinutes(dishes: readonly Pick<Dish, "activeMin" | "totalMin">[]): { activeMin: number; totalMin: number } {
  const sorted = [...dishes].sort((a, b) => b.totalMin - a.totalMin);
  let hands = 0;
  let end = 0;
  for (const d of sorted) {
    end = Math.max(end, hands + Math.max(d.totalMin, d.activeMin));
    hands += d.activeMin;
  }
  return { activeMin: hands, totalMin: Math.max(end, hands) };
}

/** The meal a prep session's pots are first eaten at: lunch after a morning session, dinner after an afternoon one. */
export function mealAtSession(part: PlanDraft["sessions"][number]["part"]): MainSlot | null {
  return part === "morning" ? "lunch" : part === "afternoon" ? "dinner" : null;
}

/** What identifies a meal for telling two versions apart: the dish and way, never the model's batch id. */
function mealKey(draft: PlanDraft, meal: DraftMeal | undefined): string {
  if (!meal) return "";
  const main = meal.main;
  const head = isBatchMain(main)
    ? `pot:${draft.batches.find((b) => b.id === main.batch)?.dish ?? main.batch}:${main.way}`
    : `dish:${main.dish}:${main.staple ?? ""}`;
  return `${head}|${[...meal.sides].sort().join(",")}`;
}

function nightOf(item: NightItem): DraftCardNight {
  if (item.kind === "soyMilk") return { kind: "soyMilk", foods: item.foods.map((f) => foodNamed(f).zh), meal: item.meal };
  return { kind: "thaw", food: foodNamed(item.food).zh, fromFrozen: item.fromFrozen, meal: item.meal };
}

export interface DraftCardInput {
  /** A passing check: no problems, `plan` and `storage` solved. */
  result: DraftResult;
  lib: PlanLibrary;
  startDate: string;
  threadId: string;
  /** The proposed draft card this one revises, or null for a first draft. */
  previous: MealsDraftCardData | null;
  /** The id a first draft is given. */
  newId: string;
}

export function buildDraftCard(input: DraftCardInput): MealsDraftCardData {
  const { result, lib, previous } = input;
  const draft = result.draft;
  const order = (b: PlanDraft["batches"][number]) =>
    Math.min(...b.meals.map((m) => m.day * 2 + (m.slot === "dinner" ? 1 : 0)));
  const batches = [...draft.batches].sort((a, b) => order(a) - order(b));
  const letterOf = new Map(batches.map((b, i) => [b.id, LETTERS[i] ?? String(i + 1)]));
  const pots: DraftCardPot[] = batches.map((b) => {
    const dish = lib.dish(b.dish);
    return {
      letter: letterOf.get(b.id) ?? "",
      batch: b.id,
      name: dishNamed(dish, b.dish),
      equipment: dish?.equipment.find((e) => e !== "stove") ?? dish?.equipment[0] ?? "stove",
      cuisine: dish?.cuisine ?? "other",
      meals: b.meals.length,
    };
  });

  const s = draft.sessions[0];
  let session: DraftCardSession | null = null;
  if (s) {
    const cooked = batches.filter((b) => b.session === s.id);
    const minutes = prepMinutes(cooked.flatMap((b) => lib.dish(b.dish) ?? []));
    session = { day: s.day, part: s.part, pots: cooked.map((b) => letterOf.get(b.id) ?? ""), ...minutes };
    const rice = result.storage?.rice;
    if (rice && rice.cookedAt.slot === "prep" && rice.cookedAt.day === s.day) session.rice = refNamed(lib, rice.staple);
  }
  const nowSlot = s ? mealAtSession(s.part) : null;
  const prevDraft = previous?.draft ?? null;

  const meal = (day: number, slot: MainSlot, m: DraftMeal): DraftCardMeal => {
    const main = m.main;
    const sides = m.sides.map((id) => refNamed(lib, id));
    const changed = prevDraft !== null && mealKey(prevDraft, prevDraft.days[day - 1]?.[slot]) !== mealKey(draft, m);
    if (isBatchMain(main)) {
      const batch = draft.batches.find((b) => b.id === main.batch);
      const dish = batch ? lib.dish(batch.dish) : undefined;
      const way = dish?.ways?.[main.way - 1];
      return {
        pot: letterOf.get(main.batch) ?? null,
        name: way ? { zh: way.name, en: way.nameEn } : dishNamed(dish, batch?.dish ?? main.batch),
        staple: null,
        sides,
        now: !!s && batch?.session === s.id && s.day === day && nowSlot === slot,
        changed,
      };
    }
    return {
      pot: null,
      name: refNamed(lib, main.dish),
      staple: main.staple ? refNamed(lib, main.staple) : null,
      sides,
      now: false,
      changed,
    };
  };

  const nights = result.storage?.nights ?? [];
  const days: DraftCardDay[] = draft.days.map((d, i) => {
    const day = i + 1;
    return {
      day,
      date: addDays(input.startDate, i),
      breakfast: refNamed(lib, d.breakfast),
      breakfastChanged: prevDraft !== null && prevDraft.days[i]?.breakfast !== d.breakfast,
      lunch: meal(day, "lunch", d.lunch),
      dinner: meal(day, "dinner", d.dinner),
      fruit: d.fruit.map((f) => foodNamed(f).zh),
      nights: nights.filter((n) => n.day === day).flatMap((n) => n.items.map((item) => nightOf(item))),
    };
  });

  return {
    kind: "meals-draft",
    threadId: input.threadId,
    draftId: previous?.draftId ?? input.newId,
    version: previous ? previous.version + 1 : 1,
    startDate: input.startDate,
    draft,
    pots,
    days,
    session,
    phase: "proposed",
  };
}
