// The meals writes (docs/73), and what the AI is told afterwards.
//
// Sequences over ports rather than over the live store, so "a second click
// does nothing" and "a failed write changes nothing on screen" are testable
// without React and without a filesystem. The plan tool drafts a card and
// writes nothing; Apply on it is the write. Onboarding, a profile change and a
// deviation write straight through: they are the reader's own answers and
// sentences, with nothing to approve.

import type { MealsPlanCardData } from "./cards";
import type { PhotoCache } from "./photos/dish-photos";
import type { Profile, Region, Targets } from "./nutrition/targets";
import { photoQueriesForPlan, type PhotoQuery } from "./photos/photo-run";
import { currentList, deriveShoppingList, isChecked, reconcileShoppingList } from "./plan/shopping";
import { solvePlan, targetsOf } from "./plan/solve-week";
import type {
  Deviation,
  MealKey,
  MealRef,
  MealsCharter,
  MealsState,
  ShoppingState,
  WeekPlan,
} from "./plan/types";
import { applyDeviation, weekId } from "./plan/week";

export interface MealsPorts {
  // The profile, the week and the list as they are NOW.
  current(): Promise<MealsState>;
  // The charter, with the week re-solved against it when there is one.
  saveCharter(charter: MealsCharter, week: { plan: WeekPlan; shopping: ShoppingState } | null): Promise<unknown>;
  savePlan(plan: WeekPlan, shopping: ShoppingState): Promise<unknown>;
  // The trip alone: a line the reader added, dropped or swapped by saying so.
  saveShopping(shopping: ShoppingState): Promise<unknown>;
  // One made meal's method line, rewritten.
  saveMealMethod(date: string, meal: MealKey, method: string): Promise<unknown>;
  saveDeviation(deviation: Deviation, plan: WeekPlan, shopping: ShoppingState): Promise<unknown>;
  // The photographs found so far, by cache key.
  photos?(): Promise<PhotoCache>;
  // Search for what the week still has no picture of. Present only on a
  // machine with the hidden webview the search needs (docs/73 图片).
  startPhotoRun?(planId: string, queries: readonly PhotoQuery[]): Promise<unknown>;
  // Write down that the reader asked for the pictures again.
  markPhotosAsked?(at: number): Promise<unknown>;
  // Whether a name already has a picture from a bank.
  bankImage?(en: string): string | null;
  // Which BMI cut points and fat range apply (region.ts).
  region(): Region;
  // The host's clock and calendar. Never the model's (docs/73 事实不经模型).
  now(): number;
  today(): string;
  // The host reloads the screen.
  changed(): void;
}

export interface Applied {
  // False when nothing was written.
  ok: boolean;
  // The synthetic user turn telling the AI what the reader just did. Empty when
  // nothing happened.
  note: string;
  // Work still running after the note was handed back: starting the photograph
  // run. A test awaits it.
  pending?: Promise<void>;
}

const NOTHING: Applied = { ok: false, note: "" };

/**
 * The week re-solved against a charter and the trip re-derived from it, the
 * reader's ticks and lines kept. The plan comes back unsolved when the charter
 * has no targets.
 */
export function resolvedWeek(
  plan: WeekPlan,
  shopping: ShoppingState,
  charter: MealsCharter | null,
  region: Region,
  today: string,
): { plan: WeekPlan; shopping: ShoppingState } {
  const targets = targetsOf(charter, region);
  const solved = targets && charter ? solvePlan(plan, targets, charter.profile) : plan;
  const people = charter?.profile.people ?? 1;
  return { plan: solved, shopping: reconcileShoppingList(shopping, deriveShoppingList(solved, today, people)) };
}

/**
 * Write a profile — the end of onboarding, a replay of it, or a field the
 * reader changed in conversation — and re-solve the week against it in the
 * same write. No model is involved.
 *
 * The targets it now gives, or null when nothing was written or the reader
 * withheld body data.
 */
export async function saveProfile(
  profile: Profile,
  ports: MealsPorts,
  text?: string,
): Promise<{ ok: boolean; targets: Targets | null }> {
  const state = await ports.current();
  const charter: MealsCharter = {
    profile,
    text: text ?? state.charter?.text ?? "",
    updatedAt: ports.now(),
  };
  const week = state.plan
    ? resolvedWeek(state.plan, state.shopping, charter, ports.region(), ports.today())
    : null;
  if (week) week.plan = { ...week.plan, revision: week.plan.revision + 1 };
  try {
    await ports.saveCharter(charter, week);
  } catch {
    return { ok: false, targets: null };
  }
  ports.changed();
  return { ok: true, targets: targetsOf(charter, ports.region()) };
}

/**
 * The plan card's Apply: write the week, re-solved against the profile as it
 * is now, and the shopping list derived from it in the same write.
 */
export async function applyPlan(card: MealsPlanCardData, ports: MealsPorts): Promise<Applied> {
  if (card.phase === "applied") return NOTHING;
  const state = await ports.current();
  const previous = card.adjustment ? state.plan : null;
  const drafted: WeekPlan = {
    id: weekId(card.startDate),
    startDate: card.startDate,
    days: card.days,
    createdAt: previous?.createdAt ?? ports.now(),
    revision: (previous?.revision ?? 0) + 1,
  };
  const { plan, shopping } = resolvedWeek(drafted, state.shopping, state.charter, ports.region(), ports.today());
  try {
    await ports.savePlan(plan, shopping);
  } catch {
    return NOTHING;
  }
  ports.changed();
  const cache = ports.photos ? await ports.photos().catch(() => ({})) : {};
  // The photographs are asked for after the week is on disk and after the note
  // is handed back: the search takes minutes and the screen is usable without
  // it (photo-sweep.ts).
  const pending = startPhotoSearch(plan, cache, ports, state.photosAskedAt ?? 0).then(
    () => {},
    () => {},
  );
  return { ok: true, note: planNote(card, shopping), pending };
}

/**
 * Ask for the photographs a week has none of, on the machine that can search.
 * Never throws: every failure is a week drawn from its ingredients.
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
  // How many names the week will be searched for.
  queries: number;
  // Whether the search started here.
  searching: boolean;
}

/**
 * Search the whole week again. The ask is a timestamp on the week
 * (photosAskedAt), not a run, because the machine that can search is usually
 * not the one being held.
 */
export async function refreshPhotos(ports: MealsPorts): Promise<PhotoRefresh> {
  const state = await ports.current();
  if (!state.plan) return { queries: 0, searching: false };
  const at = ports.now();
  try {
    if (!ports.markPhotosAsked) return { queries: 0, searching: false };
    await ports.markPhotosAsked(at);
  } catch {
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
 * A meal that went differently, recorded (docs/73 偏离): that meal moves, the
 * week is re-solved and the trip re-derived, and the one or two meals now
 * needing foods come back for the model to re-pick. Nothing else is re-planned.
 */
export async function recordDeviation(
  deviation: Deviation,
  ports: MealsPorts,
): Promise<Applied & { attention: MealRef[] }> {
  const state = await ports.current();
  if (!state.plan) return { ...NOTHING, attention: [] };
  const moved = applyDeviation(state.plan, deviation, state.charter?.profile ?? null);
  const { plan, shopping } = resolvedWeek(moved.plan, state.shopping, state.charter, ports.region(), ports.today());
  const attention = moved.attention;
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
