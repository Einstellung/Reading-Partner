// Chat-card payloads for the meals line (docs/73), following the convention in
// info/boxes/cards.ts: the payload is plain data in the info layer, so the tool
// that drafts it and the component that draws it import one definition.
//
// The plan card is a draft. The tool that produces it writes nothing; Apply is
// the only write, and a synthetic user turn afterwards tells the model what
// landed (apply.ts). `phase` is what a second click reads to do nothing. The
// profile has no card: onboarding and a stated change write it directly.

import type { DayPlan, MealRef } from "./types";

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
  // True when this reopens meals in the week already on disk.
  adjustment: boolean;
  // The meals this card changes, and the dates they fall on. Empty on a fresh
  // week.
  changed: MealRef[];
  changedDates: string[];
  phase: "proposed" | "applied";
}

export type MealsCard = MealsPlanCardData;

/** The kinds this domain contributes, for the registry the UI assembles. */
export const MEALS_CARD_KINDS = ["meals-plan"] as const;
