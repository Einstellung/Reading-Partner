// Chat-card payloads for the meals line (docs/671 对话), following the convention
// in info/boxes/cards.ts: the payload is plain data in the info layer, so the
// tool that drafts it and the component that draws it import one definition.
//
// The draft card is what propose_meal_plan raises. It carries no grams: which
// dish each meal eats, which meals share a pot, the prep session and the
// night-before reminders, all written by the program from the checked draft
// (build-draft-card.ts). A revision replaces the payload of the same card in place
// (the patchPart channel, keyed by `draftId`) and bumps `version`. 「就这样」 or
// apply_meal_plan is the only write (apply.ts applyDraft); `phase` is what a
// second click reads to do nothing, and the applied card draws its short form.

import type { CookPart } from "./nutrition/targets";
import type { Cuisine, Equipment } from "./dishes/types";
import type { PlanDraft } from "./planner/draft";
import type { PlanTime } from "./planner/storage";
import type { MealRef } from "./plan/types";

/** A name in the two languages the dish library is written in. Foods carry their Chinese name in both. */
export interface Named {
  zh: string;
  en: string;
}

/** A pot of the draft, lettered by its first meal. */
export interface DraftCardPot {
  letter: string;
  batch: string;
  name: Named;
  equipment: Equipment;
  cuisine: Cuisine;
  /** Meals it feeds, the one eaten at the prep session counted. */
  meals: number;
}

export interface DraftCardMeal {
  /** The pot's letter, or null for a main made at the meal. */
  pot: string | null;
  /** The way's name for a pot meal, the dish's for a fresh one. */
  name: Named;
  /** A fresh main's staple, shown on its own line. */
  staple: Named | null;
  sides: Named[];
  /** Eaten at the prep session, straight from the pot. */
  now: boolean;
  /** Different from the card's previous version. */
  changed: boolean;
}

export type DraftCardNight =
  | { kind: "soyMilk"; foods: string[]; meal: PlanTime }
  | { kind: "thaw"; food: string; fromFrozen: boolean; meal: PlanTime };

export interface DraftCardDay {
  day: number;
  /** Local date, written by the program. */
  date: string;
  breakfast: Named;
  breakfastChanged: boolean;
  lunch: DraftCardMeal;
  dinner: DraftCardMeal;
  /** Fruit by name, one per portion. */
  fruit: string[];
  /** What to do on this day's evening for the next day. */
  nights: DraftCardNight[];
}

/** The day before day 1 when the prep session is on it: not a plan day, at most its dinner from the pots. */
export interface DraftCardPrepDay {
  /** Local date, written by the program. */
  date: string;
  /** The dinner eaten from the pots, or null when the session is after dinner. */
  dinner: DraftCardMeal | null;
  /** What to do that evening for day 1. */
  nights: DraftCardNight[];
}

export interface DraftCardSession {
  day: number;
  part: CookPart;
  /** The letters of the pots cooked. */
  pots: string[];
  activeMin: number;
  totalMin: number;
  /** The plan's rice when it is cooked at this session (planner/rice.ts); absent when none is, and on cards from before it. */
  rice?: Named;
}

export interface MealsDraftCardData {
  kind: "meals-draft";
  threadId: string;
  /** Stable across revisions: the card is addressed by it. */
  draftId: string;
  /** 1 for the first draft; each revision in place adds one. */
  version: number;
  /** Local date of day 1. */
  startDate: string;
  /** The checked draft with the program's additions, solved again on apply. */
  draft: PlanDraft;
  /** The model's picks it was filled from: the breakfasts and staples they asked for, which a revision keeps. */
  picks?: PlanDraft;
  pots: DraftCardPot[];
  /** Present when the session is on the day before day 1. */
  prepDay?: DraftCardPrepDay;
  days: DraftCardDay[];
  session: DraftCardSession | null;
  phase: "proposed" | "applied";
}

// The row an Apply leaves for the model. Its text is the model's note
// (apply.ts) and is never drawn. A week applied from the old weekly card drew
// one short line here; a draft applied from the draft card draws nothing,
// because the draft card above it has already collapsed to say so (`draft` is
// that card's id).
export interface MealsAppliedCardData {
  kind: "meals-applied";
  adjustment: boolean;
  // The meals an adjustment changed. Empty on a fresh week.
  changed: MealRef[];
  // Lines still to buy, and how many of them go in the freezer on arrival.
  toBuy: number;
  freeze: number;
  draft?: string;
}

export type MealsCard = MealsDraftCardData | MealsAppliedCardData;

/** The kinds this domain contributes, for the registry the UI assembles. */
export const MEALS_CARD_KINDS = ["meals-draft", "meals-applied"] as const;

/** The card id a draft is raised and patched under. */
export function draftCardId(draftId: string): string {
  return `meals-draft-${draftId}`;
}
