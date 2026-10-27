// Stored planner plans with a prep session, for the batch-cook entry, the prep
// page and their render tests: the good draft (planner/fixture.ts) filled and
// written the way Apply writes it (planner/to-week.ts weekFromDraft).

import type { Profile } from "../../../../src/info/meals/nutrition/targets";
import type { MealsState, WeekPlan } from "../../../../src/info/meals/plan/types";
import { addDays } from "../../../../src/info/meals/plan/week";
import type { PlanDraft } from "../../../../src/info/meals/planner/draft";
import { fillDraft } from "../../../../src/info/meals/planner/fill";
import { weekFromDraft } from "../../../../src/info/meals/planner/to-week";
import { shopping } from "../fixtures/week";
import { LIB } from "../planner/card-fixture";
import { goodDraft, PROFILE, START, START_WEEKDAY, targetsFor } from "../planner/fixture";

export { START };
/** The day before Day 1. */
export const PREP_DATE = addDays(START, -1);
/** The good draft's last day. */
export const LAST = addDays(START, 2);

/** The good draft: one chili pot cooked on Day 1 afternoon, eaten Day 1 dinner and Day 2 lunch. */
export function onDayOne(): PlanDraft {
  return goodDraft();
}

/** The pot cooked the afternoon before Day 1, that dinner eaten from it (prep-day.test.ts). */
export function dayBefore(): PlanDraft {
  const d = goodDraft();
  d.sessions[0] = { id: "s1", day: 0, part: "afternoon" };
  d.prepDinner = { main: { batch: "chili", way: 2 }, sides: [] };
  d.batches[0]!.meals.unshift({ day: 0, slot: "dinner" });
  return d;
}

/** The pot cooked the evening before Day 1, with Day 1's soy milk set up that night. */
export function eveningBefore(): PlanDraft {
  const d = goodDraft();
  d.sessions[0] = { id: "s1", day: 0, part: "evening" };
  d.days[0]!.breakfast = "soy_milk_maker_plain";
  return d;
}

export function storedPlan(draft: PlanDraft = onDayOne(), profile: Profile = PROFILE): WeekPlan {
  const filled = fillDraft(draft, { profile, targets: targetsFor(profile), startWeekday: START_WEEKDAY, people: profile.people, library: LIB });
  if (filled.result.problems.length || !filled.result.plan) throw new Error(filled.unfilled.join("\n"));
  return weekFromDraft({ result: filled.result, lib: LIB, start: START, now: 1, previous: null });
}

/** A reader with the planner profile and a stored plan; `boxes: false` for one who does not box. */
export function plannerState(opts: { draft?: PlanDraft; profile?: Partial<Profile>; preppedAt?: number } = {}): MealsState {
  const profile = { ...PROFILE, ...opts.profile };
  const plan = storedPlan(opts.draft, profile);
  const withDone = opts.preppedAt !== undefined && plan.planner ? { ...plan, planner: { ...plan.planner, preppedAt: opts.preppedAt } } : plan;
  return { charter: { profile, text: "", updatedAt: 1 }, plan: withDone, shopping: shopping(), deviations: [] };
}
