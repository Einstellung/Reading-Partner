// The week read as a week (src/info/meals/week.ts): which night is tonight,
// whether the plan has run out, what one deviation moves, and what a drafted
// week becomes once the program has dated it.
// Run: scripts/t.sh tests/info/dinner

import { expect, test } from "bun:test";
import {
  addDays,
  applyDeviation,
  assembleWeekPlan,
  dayOn,
  daysBetween,
  dishForDay,
  planExhausted,
  todayAndTomorrow,
  weekDates,
  type WeekDraft,
} from "../../../src/info/meals/week";
import type { Deviation, WeekPlan } from "../../../src/info/meals/types";

const MON = "2026-09-21";

function week(): WeekPlan {
  return {
    id: `week-${MON}`,
    startDate: MON,
    days: [
      { date: "2026-09-21", mode: "cook", dishId: "dish-a" },
      { date: "2026-09-22", mode: "reheat", reheatOf: "2026-09-21", freshAdd: "greens" },
      { date: "2026-09-23", mode: "delivery", place: "the noodle place" },
      { date: "2026-09-24", mode: "cook", dishId: "dish-b" },
      { date: "2026-09-25", mode: "reheat", reheatOf: "2026-09-24" },
      { date: "2026-09-26", mode: "out", place: "the canteen" },
      { date: "2026-09-27", mode: "cook", dishId: "dish-c" },
    ],
    dishes: [
      {
        id: "dish-a",
        name: "Traybake",
        searchName: "chicken traybake",
        oneLine: "",
        base: "b",
        fresh: "f",
        keepsADay: true,
        handsOnMinutes: 10,
        ingredients: [],
      },
    ],
    createdAt: 1,
    revision: 3,
  };
}

function deviation(over: Partial<Deviation> = {}): Deviation {
  return {
    date: "2026-09-21",
    said: "ordered in tonight",
    became: "delivery",
    place: "the noodle place",
    changed: "",
    at: 100,
    ...over,
  };
}

test("dates are counted, not parsed out of a clock", () => {
  expect(addDays(MON, 6)).toBe("2026-09-27");
  // Across a month end and across the spring-forward boundary of a southern
  // timezone: a calendar day is a calendar day.
  expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
  expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  expect(daysBetween(MON, "2026-09-27")).toBe(6);
  expect(daysBetween("2026-09-27", MON)).toBe(-6);
  expect(daysBetween("not a date", MON)).toBeNull();
  expect(weekDates(MON)).toHaveLength(7);
});

test("tonight and tomorrow night are the two days around the local date", () => {
  const { today, tomorrow } = todayAndTomorrow(week(), "2026-09-21");
  expect(today?.mode).toBe("cook");
  expect(tomorrow?.mode).toBe("reheat");
});

test("the last night of the week has no tomorrow, and that is not an error", () => {
  const { today, tomorrow } = todayAndTomorrow(week(), "2026-09-27");
  expect(today?.mode).toBe("cook");
  expect(tomorrow).toBeNull();
});

test("a week is exhausted the day after its last, and no plan at all is exhausted", () => {
  expect(planExhausted(week(), "2026-09-27")).toBe(false);
  expect(planExhausted(week(), "2026-09-28")).toBe(true);
  expect(planExhausted(null, MON)).toBe(true);
});

test("a reheat night eats the dish the night before it cooked", () => {
  const plan = week();
  const reheat = dayOn(plan, "2026-09-22");
  expect(dishForDay(plan, reheat!)?.id).toBe("dish-a");
  expect(dishForDay(plan, dayOn(plan, "2026-09-23")!)).toBeNull();
});

test("a night that became delivery settles that night and leaves the base-eater to be re-planned", () => {
  const { plan, attention } = applyDeviation(week(), deviation());
  const monday = dayOn(plan, "2026-09-21");
  expect(monday?.mode).toBe("delivery");
  expect(monday?.place).toBe("the noodle place");
  expect(monday?.dishId).toBeUndefined();
  // Tuesday was going to eat Monday's base. There is no base.
  const tuesday = dayOn(plan, "2026-09-22");
  expect(tuesday?.reheatOf).toBeUndefined();
  expect(attention).toEqual(["2026-09-22"]);
  expect(plan.revision).toBe(4);
});

test("a deviation moves nothing else in the week", () => {
  const before = week();
  const { plan } = applyDeviation(before, deviation());
  const untouched = plan.days.filter((d) => d.date > "2026-09-22");
  expect(untouched).toEqual(before.days.filter((d) => d.date > "2026-09-22"));
});

test("a night nobody was going to eat off asks for nothing", () => {
  const { attention } = applyDeviation(week(), deviation({ date: "2026-09-24", became: "out" }));
  // Thursday's base was for Friday, so Friday is the one left open.
  expect(attention).toEqual(["2026-09-25"]);
  const { attention: none } = applyDeviation(
    week(),
    deviation({ date: "2026-09-26", became: "delivery" }),
  );
  expect(none).toEqual([]);
});

test("a deviation about a day off the plan changes nothing", () => {
  const before = week();
  const { plan, attention } = applyDeviation(before, deviation({ date: "2026-10-09" }));
  expect(plan).toBe(before);
  expect(attention).toEqual([]);
});

// --- assembling a draft ------------------------------------------------------

const pinned = () => 0.5;

function fullDraft(): WeekDraft {
  return {
    dishes: [
      {
        name: "Chicken traybake",
        searchName: "chicken traybake",
        oneLine: "one tray",
        base: "chicken and roots",
        fresh: "a handful of leaves",
        keepsADay: true,
        handsOnMinutes: 12,
        ingredients: [
          { name: "chicken thighs", en: "chicken thighs", qty: "600g", category: "protein", keeps: "d1-2" },
        ],
      },
    ],
    days: [
      { day: 1, mode: "cook", dish: "chicken traybake" },
      { day: 2, mode: "reheat", reheatOfDay: 1, freshAdd: "leaves" },
      { day: 3, mode: "delivery", place: "the noodle place" },
      { day: 4, mode: "out", place: "the canteen" },
      { day: 5, mode: "out" },
      { day: 6, mode: "out" },
      { day: 7, mode: "out" },
    ],
  };
}

test("a draft is dated by the program, and dish ids are minted here", () => {
  const { plan, problems } = assembleWeekPlan(fullDraft(), {
    startDate: MON,
    createdAt: 5,
    random: pinned,
  });
  expect(problems).toEqual([]);
  expect(plan.id).toBe("week-2026-09-21");
  expect(plan.days.map((d) => d.date)).toEqual(weekDates(MON));
  expect(plan.days[0]?.dishId).toBe("dish-88888888");
  expect(plan.days[1]?.reheatOf).toBe("2026-09-21");
  expect(plan.days[2]?.place).toBe("the noodle place");
  expect(plan.dishes).toHaveLength(1);
});

test("a dish over the hands-on limit is a problem, not a plan", () => {
  const draft = fullDraft();
  draft.dishes[0]!.handsOnMinutes = 40;
  const { problems } = assembleWeekPlan(draft, { startDate: MON, createdAt: 5, random: pinned });
  expect(problems[0]).toContain("40 minutes hands-on");
});

test("a reheat of a base nobody cooks, and a cook day naming no dish, are both reported", () => {
  const draft: WeekDraft = {
    dishes: [],
    days: [
      { day: 1, mode: "cook", dish: "something that does not exist" },
      { day: 2, mode: "reheat", reheatOfDay: 1 },
    ],
  };
  const { problems, plan } = assembleWeekPlan(draft, {
    startDate: MON,
    createdAt: 5,
    random: pinned,
  });
  expect(problems).toHaveLength(2);
  expect(plan.days[1]?.reheatOf).toBeUndefined();
});

test("a reheat of a dish that does not keep is reported", () => {
  const draft = fullDraft();
  draft.dishes[0]!.keepsADay = false;
  const { problems } = assembleWeekPlan(draft, { startDate: MON, createdAt: 5, random: pinned });
  expect(problems[0]).toContain("does not keep a day");
});

test("an adjustment writes the days it names and keeps every other night and its dishes", () => {
  const previous = week();
  const draft: WeekDraft = {
    dishes: [],
    days: [{ day: 2, mode: "delivery", place: "the dumpling place" }],
  };
  const { plan, changedDates, problems } = assembleWeekPlan(draft, {
    startDate: "ignored",
    createdAt: 9,
    previous,
    random: pinned,
  });
  expect(problems).toEqual([]);
  expect(changedDates).toEqual(["2026-09-22"]);
  expect(plan.startDate).toBe(MON);
  expect(plan.days[1]?.place).toBe("the dumpling place");
  expect(plan.days[3]).toEqual(previous.days[3]!);
  expect(plan.createdAt).toBe(1);
  expect(plan.revision).toBe(4);
  // dish-a is still cooked on Monday, so it is still carried.
  expect(plan.dishes.map((d) => d.id)).toEqual(["dish-a"]);
});

test("a day number outside the week is reported and plans nothing", () => {
  const { problems } = assembleWeekPlan(
    { dishes: [], days: [{ day: 9, mode: "out" }] },
    { startDate: MON, createdAt: 5, random: pinned },
  );
  expect(problems[0]).toContain("Day 9");
});
