// The eating-day finishing steps as the meals screens draw them (docs/671): a
// day's meals with what is left to do for each, and today's notes for tonight.
// The day views are rebuilt on every render, so the answers are kept per state
// object, which only changes when the meals file does.

import type { Locale } from "../../../i18n";
import type { MealKey, MealsState } from "../plan/types";
import type { DayView, MealView } from "../screen/view";
import { finishingFor } from "./finishing";
import { tonightNotes } from "./tonight";
import type { Finishing } from "./types";

export type DayFinishing = ReadonlyMap<MealKey, Finishing>;

export interface FinishSource {
  /** The day's meals that eat from a prepped box, each with what is left to do. */
  day(state: MealsState, view: DayView, language: Locale): DayFinishing;
  /** The notes for tonight when `date` is today, else none. */
  tonight(state: MealsState, date: string, today: string, language: Locale): readonly string[];
}

const NO_MEALS: DayFinishing = new Map();
const NO_NOTES: readonly string[] = [];

/** A source over the given functions; the screens use `finishView`, tests pass their own. */
export function finishSource(
  finish: typeof finishingFor = finishingFor,
  notes: typeof tonightNotes = tonightNotes,
): FinishSource {
  const days = new WeakMap<MealsState, Map<string, DayFinishing>>();
  const nights = new WeakMap<MealsState, Map<string, readonly string[]>>();
  return {
    day(state, view, language) {
      const profile = state.charter?.profile;
      if (!profile) return NO_MEALS;
      const key = `${view.date}|${language}`;
      let byKey = days.get(state);
      if (!byKey) days.set(state, (byKey = new Map()));
      const kept = byKey.get(key);
      if (kept) return kept;
      const out = new Map<MealKey, Finishing>();
      for (const meal of view.meals) {
        const f = finish(meal, profile, language);
        if (f) out.set(meal.key, f);
      }
      const value = out.size > 0 ? out : NO_MEALS;
      byKey.set(key, value);
      return value;
    },
    tonight(state, date, today, language) {
      if (date !== today) return NO_NOTES;
      const key = `${today}|${language}`;
      let byKey = nights.get(state);
      if (!byKey) nights.set(state, (byKey = new Map()));
      const kept = byKey.get(key);
      if (kept) return kept;
      const value = notes(state, today, language);
      byKey.set(key, value.length > 0 ? value : NO_NOTES);
      return byKey.get(key)!;
    },
  };
}

export const finishView: FinishSource = finishSource();

/**
 * Whether a meal's card opens its page: a made meal with its grams (recipe.ts
 * hasRecipe, not imported so that recipe/ can import this directory), or one
 * with finishing steps.
 */
export function opensMealPage(view: Pick<MealView, "mode" | "rows">, finishing: Finishing | null | undefined): boolean {
  return (view.mode === "make" && view.rows.length > 0) || finishing != null;
}

/** The day card's thaw lines that tonight's notes do not already say. */
export function thawNotInNotes(thaw: readonly string[], notes: readonly string[]): string[] {
  return thaw.filter((line) => !notes.includes(line));
}
