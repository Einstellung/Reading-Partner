// Chat-card payloads for the meals line (docs/73), following the convention in
// info/boxes/cards.ts: the payload is plain data in the info layer, so the tool
// that drafts it and the component that draws it import one definition.
//
// The plan card is a draft. The tool that produces it writes nothing; Apply is
// the only write, and a row afterwards tells the model what landed (apply.ts):
// its text is a note for the model, and the reader sees only the applied card's
// short line. `phase` is what a second click reads to do nothing. The
// profile has no card: onboarding and a stated change write it directly.

import type { DayPlan, MealRef, Pot } from "./plan/types";

// A week of meals, or the one or two meals of it a deviation reopened. Either
// way the card carries the whole week as it would stand once applied, solved
// against the profile the check ran with; Apply solves it again against the
// profile as it is then.
export interface MealsPlanCardData {
  kind: "meals-plan";
  threadId: string;
  // Local date of day one.
  startDate: string;
  days: DayPlan[];
  // The week's pots as they would stand once applied. Absent on a week with none.
  pots?: Pot[];
  // True when this reopens meals in the week already on disk.
  adjustment: boolean;
  // The meals this card changes, and the dates they fall on. Empty on a fresh
  // week.
  changed: MealRef[];
  changedDates: string[];
  phase: "proposed" | "applied";
}

// What the row written after Apply shows the reader: one short line under the
// card, drawn in the reader's language when it renders. The row's text is the
// model's note (apply.ts planNote) and is never drawn, like an aside receipt's
// (reading/aside.ts). Counts, not words, so a change of language redraws it.
export interface MealsAppliedCardData {
  kind: "meals-applied";
  adjustment: boolean;
  // The meals an adjustment changed. Empty on a fresh week.
  changed: MealRef[];
  // Lines still to buy, and how many of them go in the freezer on arrival.
  toBuy: number;
  freeze: number;
}

export type MealsCard = MealsPlanCardData | MealsAppliedCardData;

/** The kinds this domain contributes, for the registry the UI assembles. */
export const MEALS_CARD_KINDS = ["meals-plan", "meals-applied"] as const;
