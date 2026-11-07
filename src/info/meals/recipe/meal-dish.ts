// Which library dish a meal belongs to, for the head of that meal's page
// (docs/671): the pot's dish for a meal of a prep batch, the dish itself for a
// main or breakfast made fresh at the meal. Read from the stored plan's draft;
// a stored meal that no longer matches the draft's dish (the reader changed it
// afterwards) and a meal that is not a library dish give nothing.

import { t } from "../../../i18n";
import type { Locale } from "../../../i18n/locale";
import { isBatchMain, parseDraft, PREP_DAY, type PlanDraft } from "../planner/draft";
import { planLibrary } from "../planner/library";
import type { Profile } from "../nutrition/targets";
import type { WeekPlan } from "../plan/types";
import { daysBetween } from "../plan/week";
import type { MealView } from "../screen/view";

export interface MealDish {
  id: string;
  name: string;
  /** The cuisine tag, as the prep page's pot card words it: 「东南亚菜」. */
  cuisine: string;
  /** What it tastes like, or empty for a dish with no taste line (a reader's own). */
  taste: string;
  /** The dish's one-line method. */
  summary: string;
}

/** The dish id the draft gives the meal: the batch's dish for a pot, else the fresh main's or the breakfast's. */
function draftDishId(draft: PlanDraft, start: string, date: string, view: Pick<MealView, "key" | "pot">): string | null {
  if (view.key === "snack") return null;
  const between = daysBetween(start, date);
  if (between === null) return null;
  // Day 1 is the plan's start; the day before it is the prep day, which has only a dinner.
  const day = between + 1;
  if (view.key === "breakfast") return draft.days[day - 1]?.breakfast || null;
  const meal = day === PREP_DAY ? (view.key === "dinner" ? draft.prepDinner : undefined) : draft.days[day - 1]?.[view.key];
  const main = meal?.main;
  if (!main) return null;
  if (!isBatchMain(main)) return main.dish;
  // A pot's meal is known by the batch the plan gave it; the draft's slot must agree.
  if (view.pot?.batch !== main.batch) return null;
  return draft.batches.find((b) => b.id === main.batch)?.dish ?? null;
}

/**
 * The library dish of a made meal, or null for a meal that is not of one: not
 * made, a snack, a plan with no draft, or a meal changed since the draft.
 */
export function mealDish(
  view: Pick<MealView, "key" | "mode" | "pot" | "meal">,
  plan: WeekPlan | null,
  date: string,
  profile: Profile,
  language: Locale,
): MealDish | null {
  const rec = plan?.planner;
  if (view.mode !== "make" || !rec) return null;
  const id = draftDishId(parseDraft(rec.draft), rec.start, date, view);
  if (!id) return null;
  const lib = planLibrary(profile);
  const dish = lib.dish(id) ?? lib.stored(id);
  if (!dish) return null;
  // A fresh meal is stored under its dish's English name (a batch meal under its way's).
  if (!view.pot && view.meal.searchName !== dish.nameEn.toLowerCase()) return null;
  const zh = language === "zh-CN";
  return {
    id,
    name: zh ? dish.name : dish.nameEn,
    cuisine: t(`meals.cuisine.${dish.cuisine}`),
    taste: (zh ? dish.taste : dish.tasteEn)?.trim() ?? "",
    summary: zh ? dish.summary : dish.summaryEn,
  };
}
