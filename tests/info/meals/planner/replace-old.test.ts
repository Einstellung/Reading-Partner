// A new plan confirmed while an old one is still running (planner/to-week.ts
// weekFromDraft, docs/671 形态): the old plan's past days stay, nothing of it
// from today on does, and the Meals page reads only the new plan from today.
// The dates are the ones the reader hit: an old plan over 10-23..10-28, a new
// one from 10-29 confirmed on 10-28.
// Run: scripts/t.sh tests/info/meals/planner/replace-old.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import type { MealsState, WeekPlan } from "../../../../src/info/meals/plan/types";
import type { DraftResult } from "../../../../src/info/meals/planner/checks";
import type { PlanDraft } from "../../../../src/info/meals/planner/draft";
import { fillDraft } from "../../../../src/info/meals/planner/fill";
import { weekFromDraft } from "../../../../src/info/meals/planner/to-week";
import { plannerShoppingList } from "../../../../src/info/meals/planner/trip";
import { batchCookEntry } from "../../../../src/info/meals/screen/batch-cook";
import { dayTotalsLine } from "../../../../src/info/meals/screen/screen-lines";
import { dayViewOn, mealsView } from "../../../../src/info/meals/screen/view";
import { shopping } from "../fixtures/week";
import { checked, LIB, twoPotDraft } from "./card-fixture";
import { goodDraft, PROFILE, START_WEEKDAY, targetsFor } from "./fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("zh-CN");
});
afterEach(() => setLocale(before));

const TODAY = "2026-10-28";
const NEW = "2026-10-29";
const PAST = ["2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27"];
const AHEAD = ["2026-10-29", "2026-10-30", "2026-10-31"];

function filled(d: PlanDraft): DraftResult {
  const out = fillDraft(d, { profile: PROFILE, targets: targetsFor(), startWeekday: START_WEEKDAY, people: PROFILE.people, library: LIB });
  if (out.result.problems.length || !out.result.plan) throw new Error(out.unfilled.join("\n"));
  return out.result;
}

/** 「今晚做，吃后面三天」: the session this evening, no meal of today's from it. */
function eveningBefore(): DraftResult {
  const d = goodDraft();
  d.sessions[0] = { id: "s1", day: 0, part: "evening" };
  return filled(d);
}

/** 「下午做，今晚就吃」: the session this afternoon, tonight's dinner from the pot. */
function afternoonBefore(): DraftResult {
  const d = goodDraft();
  d.sessions[0] = { id: "s1", day: 0, part: "afternoon" };
  d.prepDinner = { main: { batch: "chili", way: 2 }, sides: [] };
  d.batches[0]!.meals.unshift({ day: 0, slot: "dinner" });
  return filled(d);
}

const apply = (result: DraftResult, start: string, today: string, previous: WeekPlan | null, now = 5) =>
  weekFromDraft({ result, lib: LIB, start, now, today, previous });

/** The old plan as it was on disk: 10-23..10-25, then 10-26..10-28 run straight on from it. */
function oldPlan(): WeekPlan {
  const first = apply(checked(), "2026-10-23", "2026-10-23", null, 1);
  return apply(checked(), "2026-10-26", "2026-10-26", first, 2);
}

const dates = (p: WeekPlan) => p.days.map((d) => d.date);
const fresh = (result: DraftResult, start = NEW) => apply(result, start, start, null).days;
const meals = (p: WeekPlan): MealsState => ({
  charter: { profile: PROFILE, text: "", updatedAt: 1 },
  plan: p,
  shopping: shopping(),
  deviations: [],
});

test("the old plan covers 10-23..10-28", () => {
  expect(dates(oldPlan())).toEqual([...PAST, TODAY]);
});

test("confirmed on 10-28 with prep this evening: the past stays, today's old meals go, the new days follow", () => {
  const old = oldPlan();
  const result = eveningBefore();
  const plan = apply(result, NEW, TODAY, old);
  expect(dates(plan)).toEqual([...PAST, ...AHEAD]);
  expect(plan.days.slice(0, PAST.length)).toEqual(old.days.slice(0, PAST.length));
  expect(plan.days.slice(PAST.length)).toEqual(fresh(result));
  expect(plan.id).toBe(old.id);
  expect(plan.startDate).toBe(PAST[0]);
  expect(plan.planner?.start).toBe(NEW);

  // The page: no card for today, tomorrow first, nothing of the old plan ahead.
  const view = mealsView(meals(plan), TODAY, "other");
  expect(view.upcoming.map((d) => d.date)).toEqual(AHEAD);
  expect(view.headline[0]!.word).toBe("明天");
  expect(view.exhausted).toBe(false);
  expect(dayViewOn(meals(plan), TODAY, TODAY, "other")).toBeNull();
  // The top card is this evening's prep.
  expect(batchCookEntry(meals(plan), TODAY, 10)).toMatchObject({ kind: "prep", prep: { date: TODAY, part: "evening" } });
});

test("the shopping list is the new plan's alone", () => {
  const result = eveningBefore();
  const merged = apply(result, NEW, TODAY, oldPlan());
  const alone = apply(result, NEW, TODAY, null);
  expect(plannerShoppingList(result.plan!, result.draft, merged)).toEqual(plannerShoppingList(result.plan!, result.draft, alone));
});

test("prep this afternoon with tonight's dinner from it: today is the prep day, just that dinner", () => {
  const result = afternoonBefore();
  const plan = apply(result, NEW, TODAY, oldPlan());
  expect(dates(plan)).toEqual([...PAST, TODAY, ...AHEAD]);
  const today = plan.days.find((d) => d.date === TODAY)!;
  expect(today.planned).toEqual(["dinner"]);
  expect([today.breakfast.mode, today.lunch.mode, today.snack.mode]).toEqual(["skip", "skip", "skip"]);
  const view = dayViewOn(meals(plan), TODAY, TODAY, "other")!;
  expect(view.meals.map((m) => m.key)).toEqual(["dinner"]);
  // Part of a day has no day total: no 「x / y kcal」 line.
  expect(dayTotalsLine(view)).toBeNull();
  expect(mealsView(meals(plan), TODAY, "other").headline[0]!.date).toBe(TODAY);
});

test("a second plan the same day replaces the first one whole, the past still kept", () => {
  const first = apply(afternoonBefore(), NEW, TODAY, oldPlan(), 5);
  const result = checked(twoPotDraft());
  const second = apply(result, NEW, TODAY, first, 6);
  expect(dates(second)).toEqual([...PAST, ...AHEAD]);
  expect(second.days.slice(0, PAST.length)).toEqual(oldPlan().days.slice(0, PAST.length));
  expect(second.days.slice(PAST.length)).toEqual(fresh(result));
  expect(second.revision).toBe(first.revision + 1);
});

test("a plan with no prep day, starting today: the old plan's days before today stay", () => {
  const result = checked();
  const plan = apply(result, TODAY, TODAY, oldPlan());
  expect(dates(plan)).toEqual([...PAST, TODAY, "2026-10-29", "2026-10-30"]);
  expect(plan.days.slice(PAST.length)).toEqual(fresh(result, TODAY));
});

test("confirmed the day after the old plan ended, starting that day: all its days are past and stay", () => {
  const old = oldPlan();
  const result = checked();
  const plan = apply(result, NEW, NEW, old);
  expect(dates(plan)).toEqual([...PAST, TODAY, ...AHEAD]);
  expect(plan.days.slice(0, 6)).toEqual(old.days);
});

test("a new plan starting after a gap: the past stays, nothing of the old plan from today on", () => {
  const result = checked();
  const plan = apply(result, "2026-10-31", TODAY, oldPlan());
  expect(dates(plan)).toEqual([...PAST, "2026-10-31", "2026-11-01", "2026-11-02"]);
  const view = mealsView(meals(plan), TODAY, "other");
  expect(view.headline.map((d) => d.date)).toEqual(["2026-10-31", "2026-11-01"]);
});
