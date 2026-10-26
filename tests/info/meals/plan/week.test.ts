// The week read as a week (src/info/meals/plan/week.ts): which day is which, what
// one deviation moves.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  addDays,
  applyDeviation,
  dayIndexOf,
  dayOn,
  daysBetween,
  isoWeekday,
  mealOn,
  planExhausted,
  weekDates,
} from "../../../../src/info/meals/plan/week";
import type { Deviation } from "../../../../src/info/meals/plan/types";
import { MON, profile, week } from "../fixtures/week";

function deviation(over: Partial<Deviation>): Deviation {
  return {
    date: MON,
    meal: "dinner",
    said: "ordered in",
    became: "delivery",
    changed: "",
    at: 0,
    ...over,
  };
}

test("dates are counted, not parsed into a local zone", () => {
  expect(addDays(MON, 3)).toBe("2026-09-24");
  expect(addDays(MON, -1)).toBe("2026-09-20");
  expect(daysBetween(MON, "2026-09-27")).toBe(6);
  expect(weekDates(MON)).toHaveLength(7);
  expect(weekDates(MON)[6]).toBe("2026-09-27");
  expect(isoWeekday(MON)).toBe(1);
  expect(isoWeekday("2026-09-27")).toBe(7);
  expect(isoWeekday("not a date")).toBe(0);
});

test("a meal is reached by date and key, a day by date and by its number", () => {
  const plan = week();
  expect(dayOn(plan, "2026-09-22")?.date).toBe("2026-09-22");
  expect(mealOn(plan, "2026-09-22", "lunch")?.name).toBe("金枪鱼口袋饼");
  expect(mealOn(plan, "2026-09-22", "snack")?.mode).toBe("make");
  expect(mealOn(plan, "2026-10-01", "lunch")).toBeNull();
  expect(dayIndexOf(plan, MON)).toBe(1);
  expect(dayIndexOf(plan, "2026-09-27")).toBe(7);
  expect(dayIndexOf(plan, "2026-09-28")).toBe(0);
});

test("the week runs out the day after its last", () => {
  const plan = week();
  expect(planExhausted(plan, "2026-09-27")).toBe(false);
  expect(planExhausted(plan, "2026-09-28")).toBe(true);
  expect(planExhausted(null, MON)).toBe(true);
});

test("a lunch that was not made leaves its foods in the fridge, and the next made main meal is the one to look at", () => {
  const before = week();
  const { plan, attention } = applyDeviation(
    before,
    deviation({ meal: "lunch", became: "out", place: "the canteen", said: "ate at the canteen" }),
  );
  expect(attention).toEqual([{ date: MON, meal: "dinner" }]);
  expect(mealOn(plan, MON, "lunch")).toEqual({ mode: "out", place: "the canteen" });
  // The dinner itself is untouched: it is still a good plan.
  expect(mealOn(plan, MON, "dinner")).toEqual(mealOn(before, MON, "dinner")!);
  expect(plan.revision).toBe(before.revision + 1);
});

test("a dinner that became delivery hands back tomorrow's breakfast", () => {
  const { plan, attention } = applyDeviation(week(), deviation({ place: "the usual place" }));
  expect(attention).toEqual([{ date: "2026-09-22", meal: "breakfast" }]);
  expect(mealOn(plan, MON, "dinner")).toEqual({ mode: "delivery", place: "the usual place" });
});

// The snack is eaten between lunch and dinner on a rest day and on an evening
// training day, and right after training on a morning one (targets.ts dayPlan).
test("a snack not eaten hands back the next main meal in the order the day is eaten", () => {
  const tue = "2026-09-22";
  const snack = deviation({ date: tue, meal: "snack", became: "skip", said: "wasn't hungry" });
  // Tuesday is a rest day for the fixture reader.
  expect(applyDeviation(week(), snack, profile()).attention).toEqual([{ date: tue, meal: "dinner" }]);
  // No profile reads as a rest day.
  expect(applyDeviation(week(), snack).attention).toEqual([{ date: tue, meal: "dinner" }]);

  // Monday is a training day; trained in the morning, the snack comes before breakfast.
  const monSnack = deviation({ meal: "snack", became: "skip", said: "no time" });
  expect(applyDeviation(week(), monSnack, profile({ trainTime: "morning" })).attention).toEqual([
    { date: MON, meal: "breakfast" },
  ]);
  expect(applyDeviation(week(), monSnack, profile({ trainTime: "midday" })).attention).toEqual([
    { date: MON, meal: "lunch" },
  ]);
  expect(applyDeviation(week(), monSnack, profile({ trainTime: "evening" })).attention).toEqual([
    { date: MON, meal: "dinner" },
  ]);
});

test("a meal that becomes made with no foods is itself the one to pick", () => {
  const wed = "2026-09-23";
  const { plan, attention } = applyDeviation(
    week(),
    deviation({ date: wed, meal: "dinner", became: "make", said: "I'll cook after all" }),
  );
  expect(attention).toEqual([{ date: wed, meal: "dinner" }]);
  expect(mealOn(plan, wed, "dinner")).toEqual({ mode: "make" });
});

test("a meal that was never made moves nothing else, and keeps the reader's note", () => {
  const sun = "2026-09-27";
  const { plan, attention } = applyDeviation(
    week(),
    deviation({ date: sun, meal: "dinner", became: "out", place: "noodle shop", said: "went out" }),
  );
  expect(attention).toEqual([]);
  expect(mealOn(plan, sun, "dinner")).toEqual({ mode: "out", place: "noodle shop", note: "late lunch" });

  // A made meal that stays made keeps its foods and grams.
  const before = week();
  const same = applyDeviation(before, deviation({ meal: "lunch", became: "make", said: "made it" }));
  expect(same.attention).toEqual([]);
  expect(mealOn(same.plan, MON, "lunch")).toEqual(mealOn(before, MON, "lunch")!);
});

test("a deviation about a day off the plan changes nothing", () => {
  const before = week();
  const { plan, attention } = applyDeviation(before, deviation({ date: "2026-10-05" }));
  expect(attention).toEqual([]);
  expect(plan).toBe(before);
});
