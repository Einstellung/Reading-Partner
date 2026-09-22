// What Apply on a meals card actually does (docs/73), and what the AI is told
// afterwards.
//
// The same shape as info/briefer/card-actions.ts: sequences over ports rather
// than over the live store, so "a second click does nothing" and "a failed
// write changes nothing on screen" are testable without React and without a
// filesystem. The tools that drafted these cards wrote nothing; this is the
// only write.

import type { MealsCharterCardData, MealsPlanCardData } from "./cards";
import { withDishPhotos, type PhotoCache } from "./dish-photos";
import { photoQueriesForPlan, type PhotoQuery } from "./photo-run";
import {
  currentList,
  deriveShoppingList,
  isChecked,
  reconcileShoppingList,
} from "./shopping";
import type {
  Deviation,
  DishMethod,
  MealRef,
  MealsCharter,
  MealsState,
  ShoppingState,
  WeekPlan,
} from "./types";
import { applyDeviation, weekId } from "./week";

export interface MealsPorts {
  // The charter, the week and the list as they are NOW. A card sits in the
  // conversation for the rest of the day, and the week it adjusts may have
  // moved on since it was drafted.
  current(): Promise<MealsState>;
  saveCharter(charter: MealsCharter): Promise<unknown>;
  savePlan(plan: WeekPlan, shopping: ShoppingState): Promise<unknown>;
  // The trip alone: a line the reader added, dropped or swapped by saying so.
  saveShopping(shopping: ShoppingState): Promise<unknown>;
  // A dish's steps, written onto the week (method.ts).
  saveDishMethod(dishId: string, method: DishMethod): Promise<unknown>;
  saveDeviation(
    deviation: Deviation,
    plan: WeekPlan,
    shopping: ShoppingState,
  ): Promise<unknown>;
  // The photographs found so far, by cache key.
  photos?(): Promise<PhotoCache>;
  // Search for what the week still has no picture of. Present only on a machine
  // that has the hidden webview the search needs (docs/73 图片): a run of this
  // kind is executed by whoever starts it, so a phone that started one would
  // search with nothing to search in. Absent is the ordinary case — the week is
  // drawn from its ingredients until the pictures arrive over sync.
  startPhotoRun?(planId: string, queries: readonly PhotoQuery[]): Promise<unknown>;
  // Write down that the reader asked for the pictures again. The request has to
  // travel as data, because the machine that can search is usually not the one
  // being held (docs/73 图片).
  markPhotosAsked?(at: number): Promise<unknown>;
  // Whether a name already has a picture from a bank, which is what decides
  // that an ingredient has to be searched for at all.
  bankImage?(en: string): string | null;
  // The host's clock and calendar. Never the model's (docs/73 事实不经模型).
  now(): number;
  today(): string;
  // The host reloads the screen.
  changed(): void;
}

export interface Applied {
  // False when nothing was written — the card was already applied, or the
  // write failed and the sequence stopped.
  ok: boolean;
  // The synthetic user turn telling the AI what the reader just did. Empty when
  // nothing happened, because there is then nothing to tell it.
  note: string;
  // Work still running after the note was handed back: starting the photograph
  // run. The host ignores it — the screen reloads when the pictures land — and a
  // test awaits it instead of guessing at a number of ticks.
  pending?: Promise<void>;
}

const NOTHING: Applied = { ok: false, note: "" };

/**
 * The charter card's Apply. One household, so a second charter replaces the
 * first rather than accumulating.
 */
export async function applyCharter(
  card: MealsCharterCardData,
  ports: MealsPorts,
): Promise<Applied> {
  if (card.phase === "applied") return NOTHING;
  const charter: MealsCharter = {
    people: card.people,
    stores: card.stores,
    kitchen: card.kitchen,
    dislikes: card.dislikes,
    nightsCooking: card.nightsCooking,
    nightsOut: card.nightsOut,
    nightsDelivery: card.nightsDelivery,
    text: card.text,
    updatedAt: ports.now(),
  };
  try {
    await ports.saveCharter(charter);
  } catch {
    return NOTHING;
  }
  ports.changed();
  return { ok: true, note: charterNote(charter) };
}

/**
 * The plan card's Apply: write the week, and the shopping list derived from it
 * in the same write.
 *
 * The list is derived here rather than carried on the card, because it is a
 * fact about the week and the day it is bought on, and a card drafted last
 * night would have yesterday's freeze-on-arrival marks. Ticks already made
 * survive an adjustment (reconcileShoppingList) — a re-derived list that came
 * back blank would send the reader round the shop twice.
 */
export async function applyPlan(
  card: MealsPlanCardData,
  ports: MealsPorts,
): Promise<Applied> {
  if (card.phase === "applied") return NOTHING;
  const state = await ports.current();
  const previous = card.adjustment ? state.plan : null;
  // The pictures already in the cache go on the week as it is written: a dish
  // cooked in July is on screen the moment the card is applied, and only the
  // names nobody has searched yet wait for the run.
  const cache = ports.photos ? await ports.photos().catch(() => ({})) : {};
  const plan: WeekPlan = withDishPhotos(
    {
      id: weekId(card.startDate),
      startDate: card.startDate,
      days: card.days,
      dishes: card.dishes,
      breakfastLine: card.breakfastLine,
      createdAt: previous?.createdAt ?? ports.now(),
      revision: (previous?.revision ?? 0) + 1,
    },
    cache,
  );
  const shopping = reconcileShoppingList(
    state.shopping,
    deriveShoppingList(plan, ports.today()),
  );
  try {
    await ports.savePlan(plan, shopping);
  } catch {
    return NOTHING;
  }
  ports.changed();
  // The photographs are asked for after the week is on disk and after the note
  // is handed back: the search takes minutes and the screen is usable without
  // it, drawn from the ingredients' pictures until it lands. On a machine that
  // cannot search this does nothing at all, and the machine that can picks the
  // week up when this write reaches it (photo-sweep.ts).
  const pending = startPhotoSearch(plan, cache, ports, state.photosAskedAt ?? 0).then(
    () => {},
    () => {},
  );
  return { ok: true, note: planNote(card, shopping), pending };
}

/**
 * Ask for the photographs a week has none of: the dishes by name, then the
 * ingredients no picture bank has artwork for.
 *
 * Only on the machine that can search — everywhere else the port is absent and
 * this does nothing. Nothing is waited for and nothing is written here: the run
 * writes the cache itself, entry by entry, and the plan picks the pictures up
 * as it renders.
 *
 * The run's id, or null when the week wants nothing or this machine cannot
 * search. Never throws: every failure is a week drawn from its ingredients.
 */
export async function startPhotoSearch(
  plan: WeekPlan,
  cache: PhotoCache,
  ports: MealsPorts,
  askedAt = 0,
): Promise<unknown> {
  const start = ports.startPhotoRun;
  if (!start) return null;
  const queries = photoQueriesForPlan(plan, cache, ports.now(), {
    bankImage: ports.bankImage ?? (() => null),
    askedAt,
  });
  if (!queries.length) return null;
  return start(plan.id, queries);
}

/** What the reader asking for better pictures came to. */
export interface PhotoRefresh {
  // How many names the week will be searched for. Zero when there is no week,
  // nothing in it to search for, or the ask could not be written down.
  queries: number;
  // Whether the search started here. False on the machine the reader is
  // usually holding: the ask was written down and travels to the one that can.
  searching: boolean;
}

/**
 * Search the whole week again: the reader looked at a picture and said it is
 * not the dish.
 *
 * The ask is a timestamp on the week (photosAskedAt), not a run. The machine
 * that can search is usually not the one being held, and a run started here
 * would be executed here — so what travels is the fact that they asked, and
 * every cache entry older than it is looked up again wherever the searching
 * happens. On the searching machine the pass also starts at once.
 */
export async function refreshPhotos(ports: MealsPorts): Promise<PhotoRefresh> {
  const state = await ports.current();
  if (!state.plan) return { queries: 0, searching: false };
  const at = ports.now();
  try {
    if (!ports.markPhotosAsked) return { queries: 0, searching: false };
    await ports.markPhotosAsked(at);
  } catch {
    // Nothing was written down, so nothing travels: say so rather than let the
    // reader wait for a search nobody will run.
    return { queries: 0, searching: false };
  }
  const cache = ports.photos ? await ports.photos().catch(() => ({})) : {};
  const queries = photoQueriesForPlan(state.plan, cache, at, {
    bankImage: ports.bankImage ?? (() => null),
    askedAt: at,
  });
  if (!queries.length) return { queries: 0, searching: false };
  const start = ports.startPhotoRun;
  if (!start) return { queries: queries.length, searching: false };
  await start(state.plan.id, queries);
  return { queries: queries.length, searching: true };
}

/**
 * A meal that went differently, recorded.
 *
 * Not a card: the reader says one sentence and the bookkeeping is the
 * program's, so there is nothing to approve. It moves that meal and, at most,
 * the one or two meals that leaned on it; the refs that come back are the
 * ones now needing another look, for the AI to propose an adjustment for. The
 * week is never re-planned here.
 *
 * Nothing in this slice calls it yet — whoever wires the chat decides whether
 * the sentence reaches it through a tool or through the host (docs/73).
 */
export async function recordDeviation(
  deviation: Deviation,
  ports: MealsPorts,
): Promise<Applied & { attention: MealRef[] }> {
  const state = await ports.current();
  if (!state.plan) return { ...NOTHING, attention: [] };
  const { plan, attention } = applyDeviation(state.plan, deviation);
  const shopping = reconcileShoppingList(
    state.shopping,
    deriveShoppingList(plan, ports.today()),
  );
  const said: Deviation = {
    ...deviation,
    changed: attention.length
      ? `${attention.map(mealWords).join(", ")} now needs another look.`
      : "Nothing else moved.",
    at: deviation.at || ports.now(),
  };
  try {
    await ports.saveDeviation(said, plan, shopping);
  } catch {
    return { ...NOTHING, attention: [] };
  }
  ports.changed();
  return { ok: true, note: deviationNote(said, attention), attention };
}

// --- the synthetic turns -----------------------------------------------------
//
// Said in the reader's voice, like sourceAddedNote and labFiledNote
// (info/briefer/call.ts): it is their gesture the AI is being told about.

export function charterNote(charter: MealsCharter): string {
  return `Saved what you understood about our meals: ${charter.text}`;
}

/** "2026-09-22 lunch", the way a meal is named to the model and in a note. */
export function mealWords(ref: MealRef): string {
  return `${ref.date} ${ref.meal}`;
}

export function planNote(card: MealsPlanCardData, shopping: ShoppingState): string {
  const list = currentList(shopping).filter((i) => !isChecked(shopping, i));
  const freeze = list.filter((i) => i.freezeOnArrival).length;
  const tail =
    ` The shopping list is on my screen — ${list.length} things` +
    (freeze ? `, ${freeze} to freeze when I get home.` : ".") +
    " Don't read it back to me.";
  if (card.adjustment) {
    return `Applied the change to ${card.changed.map(mealWords).join(", ")}.${tail}`;
  }
  return `Saved this week's meals.${tail}`;
}

export function deviationNote(deviation: Deviation, attention: readonly MealRef[]): string {
  const head = `${deviation.date} ${deviation.meal}: ${deviation.said}`;
  return attention.length
    ? `${head} That leaves ${attention.map(mealWords).join(" and ")} to sort out — those meals only.`
    : `${head} Nothing else needs to change.`;
}
