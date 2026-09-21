// The week read as a week (src/info/meals/week.ts): which day is which, what
// one deviation moves, and what a drafted week becomes once the program has
// dated it.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  addDays,
  applyDeviation,
  assembleWeekPlan,
  dayOn,
  daysBetween,
  dishForDay,
  dishForMeal,
  mealOn,
  planExhausted,
  weekDates,
  type WeekDraft,
} from "../../../src/info/meals/week";
import type { Deviation } from "../../../src/info/meals/types";
import { MON, week } from "./fixtures/week";

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
});

test("a meal is reached by date and key, a day by date", () => {
  const plan = week();
  expect(dayOn(plan, "2026-09-22")?.date).toBe("2026-09-22");
  expect(mealOn(plan, "2026-09-22", "lunch")?.mode).toBe("packed");
  expect(mealOn(plan, "2026-10-01", "lunch")).toBeNull();
});

test("a packed lunch shows the dish whose base it carries", () => {
  const plan = week();
  const lunch = mealOn(plan, "2026-09-22", "lunch")!;
  expect(dishForMeal(plan, lunch)?.name).toBe("Chickpea stew");
});

test("a day leads with the cooked meal latest in it", () => {
  const plan = week();
  expect(dishForDay(plan, plan.days[0]!)?.name).toBe("Chickpea stew");
  // Nothing is cooked on the delivery day but breakfast was bought, so there is
  // no dish at all.
  expect(dishForDay(plan, plan.days[2]!)).toBeNull();
  // A day whose only cooking is breakfast leads with breakfast.
  expect(dishForDay(plan, plan.days[3]!)?.name).toBe("Overnight oats");
});

test("the week runs out the day after its last", () => {
  const plan = week();
  expect(planExhausted(plan, "2026-09-27")).toBe(false);
  expect(planExhausted(plan, "2026-09-28")).toBe(true);
  expect(planExhausted(null, MON)).toBe(true);
});

test("a dinner that became delivery strands the packed lunch that ate its base", () => {
  const { plan, attention } = applyDeviation(week(), deviation({}));
  expect(attention).toEqual([{ date: "2026-09-22", meal: "lunch" }]);
  const monday = dayOn(plan, MON)!;
  expect(monday.dinner).toEqual({ mode: "delivery" });
  const lunch = mealOn(plan, "2026-09-22", "lunch")!;
  // The mode stays — it is still a lunch nobody cooks — but it points at
  // nothing, so nothing downstream reads a base that was never made.
  expect(lunch.mode).toBe("packed");
  expect(lunch.reheatOf).toBeUndefined();
  expect(lunch.dishId).toBeUndefined();
  expect(plan.revision).toBe(2);
});

test("a lunch that was not carried leaves a box, and the next cooked meal is the one to look at", () => {
  const { plan, attention } = applyDeviation(
    week(),
    deviation({ meal: "lunch", became: "out", place: "the canteen", said: "ate at the canteen" }),
  );
  // Nothing pointed at that lunch, so nothing is broken; the stew in the fridge
  // is what makes tonight's cooking worth reopening.
  expect(attention).toEqual([{ date: MON, meal: "dinner" }]);
  const lunch = mealOn(plan, MON, "lunch")!;
  expect(lunch).toEqual({ mode: "out", place: "the canteen", note: "last week's box" });
  // The dinner itself is untouched: it is still a good plan.
  expect(mealOn(plan, MON, "dinner")?.dishId).toBe("dish-stew");
});

test("a deviation about a day off the plan changes nothing", () => {
  const before = week();
  const { plan, attention } = applyDeviation(before, deviation({ date: "2026-10-05" }));
  expect(attention).toEqual([]);
  expect(plan).toBe(before);
});

test("a draft becomes a dated week, ids minted and bases pointed at", () => {
  const draft: WeekDraft = {
    breakfastLine: "Oats, then toast",
    dishes: [
      {
        name: "Tofu pot",
        searchName: "braised tofu",
        oneLine: "One pot.",
        base: "tomato tofu base",
        fresh: "pak choi",
        keepsADay: true,
        handsOnMinutes: 12,
        ingredients: [
          { name: "tofu", en: "tofu", qty: "2 blocks", category: "protein", keeps: "d3-5" },
        ],
      },
      {
        name: "Oats",
        searchName: "overnight oats",
        oneLine: "Soaked.",
        base: "soaked oats",
        fresh: "",
        keepsADay: true,
        handsOnMinutes: 3,
        ingredients: [{ name: "oats", en: "oats", qty: "1 bag", category: "grains", keeps: "pantry" }],
      },
    ],
    days: Array.from({ length: 7 }, (_, i) => ({
      day: i + 1,
      breakfast: { mode: "cook" as const, dish: "Oats" },
      lunch:
        i === 1
          ? { mode: "packed" as const, reheatOf: { day: 1, meal: "dinner" as const } }
          : { mode: "out" as const, place: "the canteen" },
      dinner: i === 0 ? { mode: "cook" as const, dish: "Tofu pot" } : { mode: "out" as const, place: "out" },
    })),
  };
  let n = 0;
  const assembled = assembleWeekPlan(draft, {
    startDate: MON,
    createdAt: 7,
    random: () => (n++ % 16) / 16,
  });
  expect(assembled.problems).toEqual([]);
  expect(assembled.plan.breakfastLine).toBe("Oats, then toast");
  expect(assembled.plan.days).toHaveLength(7);
  expect(assembled.changed).toHaveLength(21);
  const lunch = mealOn(assembled.plan, "2026-09-22", "lunch")!;
  expect(lunch.reheatOf).toEqual({ date: MON, meal: "dinner" });
  // The program fills the dish in from the base rather than trusting the model.
  expect(lunch.dishId).toBe(mealOn(assembled.plan, MON, "dinner")!.dishId);
});

test("the refusals: a packed lunch with no base and no note, a base that does not keep, a slow breakfast", () => {
  const base: WeekDraft = {
    breakfastLine: "Oats",
    dishes: [
      {
        name: "Fry-up",
        searchName: "fry up",
        oneLine: "Not for tomorrow.",
        base: "",
        fresh: "",
        keepsADay: false,
        handsOnMinutes: 14,
        ingredients: [],
      },
    ],
    days: [
      { day: 1, dinner: { mode: "cook", dish: "Fry-up" } },
      { day: 2, lunch: { mode: "packed" }, dinner: { mode: "reheat", reheatOf: { day: 1, meal: "dinner" } } },
    ],
  };
  const assembled = assembleWeekPlan(base, { startDate: MON, createdAt: 0, previous: null });
  expect(assembled.problems.join("\n")).toContain("names neither the meal whose base it eats");
  expect(assembled.problems.join("\n")).toContain('does not keep a day');

  const slow = assembleWeekPlan(
    {
      breakfastLine: "Oats",
      dishes: [
        {
          name: "Congee",
          searchName: "congee",
          oneLine: "Slow.",
          base: "congee",
          fresh: "",
          keepsADay: true,
          handsOnMinutes: 14,
          ingredients: [],
        },
      ],
      days: [{ day: 1, breakfast: { mode: "cook", dish: "Congee" } }],
    },
    { startDate: MON, createdAt: 0 },
  );
  expect(slow.problems[0]).toContain("breakfast allows 10");
});

test("an adjustment keeps every meal it does not name", () => {
  const previous = week();
  const assembled = assembleWeekPlan(
    { dishes: [], days: [{ day: 1, lunch: { mode: "out", place: "the canteen" } }] },
    { startDate: MON, createdAt: 0, previous },
  );
  expect(assembled.problems).toEqual([]);
  expect(assembled.changed).toEqual([{ date: MON, meal: "lunch" }]);
  expect(assembled.changedDates).toEqual([MON]);
  expect(mealOn(assembled.plan, MON, "dinner")?.dishId).toBe("dish-stew");
  // The breakfast line is the week's, not this call's.
  expect(assembled.plan.breakfastLine).toBe(previous.breakfastLine);
  expect(assembled.plan.revision).toBe(2);
});
