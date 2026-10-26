// The good draft (fixture.ts) checked and turned into a draft card, for the
// card, view and tool tests. Pure functions: every call builds its own copy.

import { buildDraftCard } from "../../../../src/info/meals/build-draft-card";
import type { MealsDraftCardData } from "../../../../src/info/meals/cards";
import { checkDraft, type DraftResult } from "../../../../src/info/meals/planner/checks";
import type { PlanDraft } from "../../../../src/info/meals/planner/draft";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import { goodDraft, PROFILE, START, START_WEEKDAY, targetsFor } from "./fixture";

export const LIB = planLibrary(PROFILE);

export function checked(draft: PlanDraft = goodDraft()): DraftResult {
  return checkDraft(draft, {
    profile: PROFILE,
    targets: targetsFor(PROFILE, draft.days.length),
    startWeekday: START_WEEKDAY,
    people: PROFILE.people,
    library: LIB,
  });
}

/** The card for a passing draft; throws on a draft that does not pass, so a broken fixture fails loudly. */
export function draftCard(draft: PlanDraft = goodDraft(), previous: MealsDraftCardData | null = null, newId = "42"): MealsDraftCardData {
  const result = checked(draft);
  if (result.problems.length || !result.plan) throw new Error(result.problems.map((p) => p.message).join("\n"));
  return buildDraftCard({ result, lib: LIB, startDate: START, threadId: "meals", previous, newId });
}

/**
 * The good draft with a second pot listed first in `batches` but eaten last:
 * day 3's lunch from a beef chili cooked in the same session.
 */
export function twoPotDraft(): PlanDraft {
  const d = goodDraft();
  d.days[2]!.lunch = { main: { batch: "beef", way: 1 }, sides: [] };
  d.batches.unshift({ id: "beef", dish: "beef_black_bean_chili", session: "s1", meals: [{ day: 3, slot: "lunch" }] });
  return d;
}
