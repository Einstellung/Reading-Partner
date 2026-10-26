// The meals writes (docs/73), and what the AI is told afterwards.
//
// Sequences over ports rather than over the live store, so "a second click
// does nothing" and "a failed write changes nothing on screen" are testable
// without React and without a filesystem. The plan tool drafts a card and
// writes nothing; Apply on it is the write. Onboarding, a profile change and a
// deviation write straight through: they are the reader's own answers and
// sentences, with nothing to approve.

import type { MealsAppliedCardData, MealsDraftCardData } from "./cards";
import type { PhotoCache } from "./photos/dish-photos";
import type { Profile, Region, Targets } from "./nutrition/targets";
import { dishesToDraw } from "./photos/dish-drawing";
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
import { applyDeviation, isoWeekday } from "./plan/week";
import { checkDraft } from "./planner/checks";
import { planLibrary } from "./planner/library";
import { planDayTargets } from "./planner/solve";
import { resolvePlannerWeek, solvePlannerRecord, weekFromDraft } from "./planner/to-week";
import { plannerShoppingList } from "./planner/trip";

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
  // Draw the dishes the week has no picture of, in the background
  // (dish-draw-sweep.ts). Answers once the round is over; nobody waits on it.
  drawDishes?(): Promise<unknown>;
  // Whether this device's provider can draw at all.
  canDraw?(): Promise<boolean>;
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
  // What the AI is told the reader just did. Empty when nothing happened.
  note: string;
  // What the reader is shown in place of the note, after the plan card's Apply.
  shown?: MealsAppliedCardData;
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
  const people = charter?.profile.people ?? 1;
  if (plan.planner) {
    // A planner plan is solved again from its draft (planner/to-week.ts); the
    // weekly solver would re-read its stored grams as a template. Its list is
    // whole packs; a draft that no longer solves keeps its plan and its list.
    const again = targets && charter ? solvePlannerRecord(plan, charter.profile, targets) : null;
    if (!again || !charter || !targets) return { plan, shopping };
    const next = resolvePlannerWeek(plan, charter.profile, targets, again);
    return { plan: next, shopping: reconcileShoppingList(shopping, plannerShoppingList(again.solved, again.draft, next, people)) };
  }
  const solved = targets && charter ? solvePlan(plan, targets, charter.profile) : plan;
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
 * The draft card's 「就这样」, or apply_meal_plan: solve the draft against the
 * profile as it is now, write the plan and the shopping list derived from it
 * in one write (docs/671 对话). The draft's days replace the plan's days they
 * cover; the old plan's days before them stay when they run straight in.
 */
export async function applyDraft(card: MealsDraftCardData, ports: MealsPorts): Promise<Applied> {
  if (card.phase === "applied") return NOTHING;
  const state = await ports.current();
  const charter = state.charter;
  const targets = targetsOf(charter, ports.region());
  if (!charter || !targets) return NOTHING;
  const profile = charter.profile;
  const lib = planLibrary(profile);
  const result = checkDraft(card.draft, {
    profile,
    targets: planDayTargets(targets, profile, card.startDate, card.draft.days.length),
    startWeekday: isoWeekday(card.startDate),
    people: profile.people,
    library: lib,
  });
  if (!result.plan) return NOTHING;
  const plan = weekFromDraft({ result, lib, start: card.startDate, now: ports.now(), previous: state.plan });
  const shopping = reconcileShoppingList(state.shopping, plannerShoppingList(result.plan, result.draft, plan, profile.people));
  try {
    await ports.savePlan(plan, shopping);
  } catch {
    return NOTHING;
  }
  ports.changed();
  // Not part of `pending`: a round of drawings is a minute of paid calls, and
  // the screen shows the ingredient strip until each one lands.
  void ports.drawDishes?.().catch(() => {});
  const cache = ports.photos ? await ports.photos().catch(() => ({})) : {};
  // The photographs are asked for after the plan is on disk and after the note
  // is handed back: the search takes minutes and the screen is usable without
  // it (photo-sweep.ts).
  const pending = startPhotoSearch(plan, cache, ports, state.photosAskedAt ?? 0).then(
    () => {},
    () => {},
  );
  return { ok: true, note: draftNote(card, shopping), shown: draftApplied(card, shopping), pending };
}

async function canDrawHere(ports: MealsPorts): Promise<boolean> {
  return !!ports.drawDishes && (await ports.canDraw?.().catch(() => false)) === true;
}

/**
 * Ask for the ingredient photographs a week has none of, on the machine that can search.
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
  // How many ingredients the week will be searched for.
  queries: number;
  // Whether the search started here.
  searching: boolean;
  // How many dishes this device will draw again (the first round's worth).
  // Zero on a device whose provider cannot draw.
  dishes: number;
  // Whether it is drawing them.
  drawing: boolean;
}

const NO_REFRESH: PhotoRefresh = { queries: 0, searching: false, dishes: 0, drawing: false };

/**
 * Picture the whole week again: draw its dishes where the provider can, search
 * its ingredients. The ask is a timestamp on the week (photosAskedAt), not a run,
 * because the machine that can search is usually not the one being held, and
 * every device that draws or searches reads the same timestamp.
 */
export async function refreshPhotos(ports: MealsPorts): Promise<PhotoRefresh> {
  const state = await ports.current();
  if (!state.plan) return NO_REFRESH;
  const at = ports.now();
  try {
    if (!ports.markPhotosAsked) return NO_REFRESH;
    await ports.markPhotosAsked(at);
  } catch {
    return NO_REFRESH;
  }
  const cache = ports.photos ? await ports.photos().catch(() => ({})) : {};
  const draws = await canDrawHere(ports);
  const dishes = draws ? dishesToDraw(state.plan, cache, at, { askedAt: at }).length : 0;
  const drawing = dishes > 0;
  if (drawing) void ports.drawDishes?.().catch(() => {});
  const queries = photoQueriesForPlan(state.plan, cache, at, {
    bankImage: ports.bankImage ?? (() => null),
    askedAt: at,
  });
  if (!queries.length) return { queries: 0, searching: false, dishes, drawing };
  const start = ports.startPhotoRun;
  if (!start) return { queries: queries.length, searching: false, dishes, drawing };
  await start(state.plan.id, queries);
  return { queries: queries.length, searching: true, dishes, drawing };
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
  const moved = applyDeviation(state.plan, deviation, state.charter?.profile ?? null, ports.today());
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

function stillToBuy(shopping: ShoppingState): { toBuy: number; freeze: number } {
  const list = currentList(shopping).filter((i) => !isChecked(shopping, i));
  return { toBuy: list.length, freeze: list.filter((i) => i.freezeOnArrival).length };
}

/**
 * The note left in the thread after the draft is applied, for the model, on a
 * row with the assistant's role that draws nothing: the draft card above has
 * collapsed to say it (cards.ts MealsAppliedCardData).
 */
export function draftNote(card: MealsDraftCardData, shopping: ShoppingState): string {
  const { toBuy, freeze } = stillToBuy(shopping);
  const days = card.days.length;
  return (
    `[The reader confirmed the draft: the ${days}-day plan is saved and its grams solved.` +
    ` The shopping list is on their screen — ${toBuy} things` +
    (freeze ? `, ${freeze} to freeze on arrival.` : ".") +
    " Do not read it back to them.]"
  );
}

/** The row the draft's Apply leaves (cards.ts MealsAppliedCardData): it draws nothing. */
export function draftApplied(card: MealsDraftCardData, shopping: ShoppingState): MealsAppliedCardData {
  return { kind: "meals-applied", adjustment: false, changed: [], ...stillToBuy(shopping), draft: card.draftId };
}

export function deviationNote(deviation: Deviation, attention: readonly MealRef[]): string {
  const head = `${deviation.date} ${deviation.meal}: ${deviation.said}`;
  return attention.length
    ? `${head} That leaves ${attention.map(mealWords).join(" and ")} to sort out — those meals only.`
    : `${head} Nothing else needs to change.`;
}
