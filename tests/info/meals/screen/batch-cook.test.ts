// Where the reader stands with batch cooking (src/info/meals/screen/batch-cook.ts):
// the state the Meals card, the phone tile and the day card's prep row share,
// the next meal by the hour, and where each tap goes.
// Run: scripts/t.sh tests/info/meals/screen/batch-cook.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import type { Meal, MealsState } from "../../../../src/info/meals/plan/types";
import { addDays } from "../../../../src/info/meals/plan/week";
import {
  batchCookEntry,
  entryCardView,
  entryTileView,
  nextMeal,
  planPrep,
  prepRowDate,
  prepRowText,
  prepTitle,
} from "../../../../src/info/meals/screen/batch-cook";
import { state as weekState } from "../fixtures/week";
import { dayBefore, LAST, plannerState, PREP_DATE, START } from "./batch-cook-fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("en");
});
afterEach(() => setLocale(before));

const nameOf = (m: Meal) => (m.mode === "make" ? m.name : m.place);

test("nothing read yet is no state; no profile is setup, and its tile opens the Meals page", () => {
  expect(batchCookEntry(null, START)).toBeNull();
  expect(entryTileView(null, START)).toBeNull();
  const setup = batchCookEntry({ ...weekState(), charter: null, plan: null }, START);
  expect(setup).toEqual({ kind: "setup" });
  expect(entryCardView(setup, START)).toBeNull();
  expect(entryTileView(setup, START)).toMatchObject({ mid: "Set up meals", action: { kind: "meals" } });
});

test("no plan: the card and the tile both say Plan a batch cook and open the planning chat", () => {
  const entry = batchCookEntry({ ...weekState(), plan: null }, START);
  expect(entry).toEqual({ kind: "plan" });
  const card = entryCardView(entry, START)!;
  expect(card).toMatchObject({ kind: "plan", title: "No batch cook planned", open: null });
  expect(card.primary).toEqual({ label: "Plan a batch cook", action: { kind: "plan" } });
  expect(entryTileView(entry, START)).toMatchObject({ mid: "Plan a batch cook", action: { kind: "plan" } });
});

test("a prep still ahead: when, how long, the pots; the card opens the prep and offers Re-plan", () => {
  const s = plannerState();
  const entry = batchCookEntry(s, START, 9);
  expect(entry?.kind).toBe("prep");
  const prep = planPrep(s, START)!;
  expect(prep).toMatchObject({ session: "s1", date: START, part: "afternoon", done: false });
  expect(prep.activeMin).toBeGreaterThan(0);
  expect(prep.totalMin).toBeGreaterThanOrEqual(prep.activeMin);
  expect(prep.pots).toEqual(["Chicken and kidney bean chili"]);

  const card = entryCardView(entry, START)!;
  expect(card.title).toBe("Today, afternoon");
  expect(card.lines).toEqual([`${prep.activeMin} min hands-on · about ${prep.totalMin} min`, "Chicken and kidney bean chili"]);
  expect(card.open).toEqual({ kind: "prep", session: "s1" });
  expect(card.primary).toEqual({ label: "Open the prep", action: { kind: "prep", session: "s1" } });
  expect(card.secondary).toEqual([{ label: "Re-plan", action: { kind: "plan" } }]);

  expect(entryTileView(entry, START)).toEqual({
    mid: "Prep: Today, afternoon",
    foot: `${prep.activeMin} min hands-on · about ${prep.totalMin} min`,
    action: { kind: "prep", session: "s1" },
  });
  // The day card carrying the row is the prep's day.
  expect(prepRowDate(entry)).toBe(START);
  expect(prepRowText(prep)).toBe(`Prep · afternoon · ${prep.activeMin} min hands-on · ${prep.totalMin} min in all`);
});

test("a prep on the day before Day 1 is dated that day, and once that day is past it counts as done", () => {
  const s = plannerState({ draft: dayBefore() });
  expect(planPrep(s, PREP_DATE)).toMatchObject({ date: PREP_DATE, done: false });
  expect(batchCookEntry(s, PREP_DATE, 9)?.kind).toBe("prep");
  expect(entryCardView(batchCookEntry(s, addDays(PREP_DATE, -1), 9), addDays(PREP_DATE, -1))!.title).toBe("Tomorrow, afternoon");

  // The next morning nobody tapped Done: the plan is the record.
  expect(planPrep(s, START)?.done).toBe(true);
  expect(batchCookEntry(s, START, 9)?.kind).toBe("next");
});

test("Done moves the entry on to the next meal, by the hour", () => {
  const s = plannerState({ preppedAt: 5 });
  const days = s.plan!.days;
  const at = (hour: number) => batchCookEntry(s, START, hour);
  expect(at(9)).toMatchObject({ kind: "next", next: { date: START, key: "lunch", name: nameOf(days[0]!.lunch) } });
  expect(at(14)).toMatchObject({ kind: "next", next: { date: START, key: "dinner" } });
  expect(at(21)).toMatchObject({ kind: "next", next: { date: addDays(START, 1), key: "lunch" } });

  const card = entryCardView(at(15), START)!;
  expect(card).toMatchObject({ kind: "next", kicker: "Up next", title: nameOf(days[0]!.dinner) });
  expect(card.lines).toEqual(["Today · Dinner"]);
  expect(card.open).toEqual({ kind: "day", date: START });
  expect(card.primary).toBeNull();
  // The prep list stays reachable after it is done, and the next batch cook can be planned.
  expect(card.secondary.map((b) => b.action)).toEqual([{ kind: "prep", session: "s1" }, { kind: "plan" }]);
  expect(entryTileView(at(15), START)).toEqual({ mid: nameOf(days[0]!.dinner) ?? "", foot: "Today · Dinner", action: { kind: "meals" } });
  expect(prepRowDate(at(15))).toBe(START);
});

test("nextMeal skips a day's meals that are not planned and meals eaten out with no place", () => {
  const s = plannerState({ draft: dayBefore() });
  // The prep day has only its dinner planned.
  expect(nextMeal(s.plan!, PREP_DATE, 9)).toMatchObject({ date: PREP_DATE, key: "dinner" });
  expect(nextMeal(s.plan!, addDays(LAST, 1), 9)).toBeNull();
});

test("the plan's last evening: nothing left to eat, and the tile plans the next batch cook", () => {
  const s = plannerState({ preppedAt: 5 });
  const entry = batchCookEntry(s, LAST, 22);
  expect(entry).toMatchObject({ kind: "next", next: null });
  expect(entryCardView(entry, LAST)).toMatchObject({ title: "Nothing left to eat in this plan", open: null });
  expect(entryTileView(entry, LAST)).toEqual({
    mid: "Nothing left to eat in this plan",
    foot: "Plan the next batch cook",
    action: { kind: "plan" },
  });
});

test("a used-up plan: plan the next batch cook, from the card and the tile", () => {
  const s = plannerState();
  const after = addDays(LAST, 1);
  const entry = batchCookEntry(s, after, 9);
  expect(entry).toEqual({ kind: "planNext" });
  const card = entryCardView(entry, after)!;
  expect(card.title).toBe("This plan is used up");
  expect(card.primary).toEqual({ label: "Plan the next batch cook", action: { kind: "plan" } });
  expect(entryTileView(entry, after)).toMatchObject({ mid: "Plan the next batch cook", action: { kind: "plan" } });
  expect(prepRowDate(entry)).toBeNull();
});

test("a plan written before the planner has no prep: the entry is its next meal", () => {
  const s: MealsState = weekState();
  const today = s.plan!.days[0]!.date;
  expect(planPrep(s, today)).toBeNull();
  const entry = batchCookEntry(s, today, 9);
  expect(entry).toMatchObject({ kind: "next", prep: null });
  expect(entryCardView(entry, today)!.secondary).toEqual([{ label: "Plan the next batch cook", action: { kind: "plan" } }]);
});

test("a stored Done of the wrong type is not a Done", () => {
  const s = plannerState();
  const plan = { ...s.plan!, planner: { ...s.plan!.planner!, preppedAt: "yes" as unknown as number } };
  expect(planPrep({ ...s, plan }, START)?.done).toBe(false);
});

test("the prep page's title names the day", () => {
  expect(prepTitle(START)).toBe("Prep · Mon, 11/2");
  setLocale("zh-CN");
  expect(prepTitle(START)).toContain("备餐");
  expect(entryCardView(batchCookEntry(plannerState(), START, 9), START)!.title).toBe("今天下午");
});
