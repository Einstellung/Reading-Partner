// Chat-card payloads for the meals line (docs/73), following the convention in
// info/boxes/cards.ts: the payload is plain data in the info layer, so the tool
// that drafts it and the component that draws it import one definition.
//
// Both cards are drafts. The tool that produces one writes nothing; Apply is
// the only write, and a synthetic user turn afterwards tells the model what
// landed (apply.ts). `phase` is what a second click reads to do nothing.

import type { DayPlan, Dish, MealRef } from "./types";

// The household, drafted out of two or three questions rather than a form
// (diet.md 不用配置). `text` is the paragraph in the reader's own words; the
// fields beside it are what the program can count.
export interface MealsCharterCardData {
  kind: "meals-charter";
  // The conversation it was proposed in, so a card read back off disk still
  // knows what it belonged to.
  threadId: string;
  people: number;
  stores: string[];
  kitchen: string;
  dislikes: string[];
  nightsCooking: number;
  nightsOut: number;
  nightsDelivery: number;
  text: string;
  phase: "proposed" | "applied";
}

// A week of meals, or the one or two meals of it a deviation reopened. Either
// way the card carries the whole week as it would stand once applied, so Apply
// is one code path and the screen renders one shape.
export interface MealsPlanCardData {
  kind: "meals-plan";
  threadId: string;
  // Local date of day one.
  startDate: string;
  days: DayPlan[];
  dishes: Dish[];
  // The week's breakfasts as a pattern, in the reader's own words.
  breakfastLine: string;
  // True when this reopens days in the week already on disk rather than
  // planning a new one.
  adjustment: boolean;
  // The meals this card actually changes, and the dates they fall on, for the
  // screen to highlight. Empty on a fresh week — every meal is new, and
  // highlighting everything highlights nothing.
  changed: MealRef[];
  changedDates: string[];
  phase: "proposed" | "applied";
}

export type MealsCard = MealsCharterCardData | MealsPlanCardData;

/** The kinds this domain contributes, for the registry the UI assembles. */
export const MEALS_CARD_KINDS = ["meals-charter", "meals-plan"] as const;
