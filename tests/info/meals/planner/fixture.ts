// A three-day draft that passes every draft check, and the profile it is
// checked for. Tests change a copy (structuredClone) to break one rule at a
// time.

import { computeTargets, type Profile } from "../../../../src/info/meals/nutrition/targets";
import type { PlanDraft } from "../../../../src/info/meals/planner/draft";
import { planDayTargets } from "../../../../src/info/meals/planner/solve";

export const PROFILE: Profile = {
  consent: "manual",
  goal: "steady",
  sex: "f",
  age: 32,
  heightCm: 165,
  weightKg: 60,
  trainingDays: [1, 3, 5],
  trainTime: "evening",
  work: "sit",
  effort: "simple",
  people: 1,
  shops: [],
  kitchen: [],
  dislikes: [],
};

/** 2026-11-02 is a Monday. */
export const START = "2026-11-02";
export const START_WEEKDAY = 1;

export function targetsFor(profile: Profile = PROFILE, days = 3) {
  return planDayTargets(computeTargets(profile, "other"), profile, START, days);
}

export function goodDraft(): PlanDraft {
  return {
    days: [
      {
        breakfast: "soy_milk_maker_plain",
        lunch: { main: { dish: "kung_pao_chicken", staple: "brown_rice" }, sides: [] },
        dinner: { main: { batch: "chili", way: 1 }, sides: [] },
        fruit: ["apple"],
      },
      {
        breakfast: "milk_toast_boiled_egg",
        lunch: { main: { batch: "chili", way: 3 }, sides: [] },
        dinner: { main: { dish: "salmon_broccoli_skillet", staple: "brown_rice" }, sides: [] },
        fruit: ["apple", "orange"],
      },
      {
        breakfast: "milk_oats_banana",
        lunch: { main: { dish: "green_pepper_pork_strips", staple: "multigrain_rice" }, sides: [] },
        dinner: { main: { dish: "lemon_seared_cod", staple: "quinoa" }, sides: [] },
        fruit: ["orange"],
      },
    ],
    batches: [
      {
        id: "chili",
        dish: "chicken_bean_chili",
        session: "s1",
        meals: [
          { day: 1, slot: "dinner" },
          { day: 2, slot: "lunch" },
        ],
      },
    ],
    sessions: [{ id: "s1", day: 1, part: "afternoon" }],
  };
}
