// A plan cooked on the day before day 1 (docs/671 对话): the card's prep-day
// block, the stored prep day with only its dinner planned, the shopping done by
// then, and the night's reminders on it.
// Run: scripts/t.sh tests/info/meals/planner/prep-day.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { buildDraftCard } from "../../../../src/info/meals/build-draft-card";
import { draftCardView } from "../../../../src/info/meals/draft-card-view";
import { addDays } from "../../../../src/info/meals/plan/week";
import type { DraftResult } from "../../../../src/info/meals/planner/checks";
import type { PlanDraft } from "../../../../src/info/meals/planner/draft";
import { fillDraft } from "../../../../src/info/meals/planner/fill";
import { plannerShoppingList } from "../../../../src/info/meals/planner/trip";
import { weekFromDraft } from "../../../../src/info/meals/planner/to-week";
import { dayViewOn } from "../../../../src/info/meals/screen/view";
import { state } from "../fixtures/week";
import { checked, LIB } from "./card-fixture";
import { goodDraft, PROFILE, START, START_WEEKDAY, targetsFor } from "./fixture";

let before: Locale;
beforeEach(() => {
  before = getLocale();
  setLocale("zh-CN");
});
afterEach(() => setLocale(before));

const PREP = addDays(START, -1);

/** 「明天晚饭后备餐，吃后面三天」: the session the evening before, three plan days. */
function eveningBefore(): PlanDraft {
  const d = goodDraft();
  d.sessions[0] = { id: "s1", day: 0, part: "evening" };
  return d;
}

/** 「今晚做今晚就吃，再吃三天」: the session the afternoon before, that dinner from the pot. */
function afternoonBefore(): DraftResult {
  const d = goodDraft();
  d.sessions[0] = { id: "s1", day: 0, part: "afternoon" };
  d.prepDinner = { main: { batch: "chili", way: 2 }, sides: [] };
  d.batches[0]!.meals.unshift({ day: 0, slot: "dinner" });
  const filled = fillDraft(d, {
    profile: PROFILE,
    targets: targetsFor(),
    startWeekday: START_WEEKDAY,
    people: PROFILE.people,
    library: LIB,
  });
  if (filled.result.problems.length || !filled.result.plan) throw new Error(filled.unfilled.join("\n"));
  return filled.result;
}

const card = (result: DraftResult) => buildDraftCard({ result, lib: LIB, startDate: START, threadId: "meals", previous: null, newId: "1" });

test("the card shows the evening before as its own block: 前一天 晚上 备餐, no meal", () => {
  const c = card(checked(eveningBefore()));
  expect(c.prepDay).toMatchObject({ date: PREP, dinner: null });
  expect(c.days).toHaveLength(3);
  const view = draftCardView(c);
  expect(view.title).toContain("3 天");
  const first = view.days[0]!;
  expect(first.title).toBe("前一天");
  expect(first.rows.map((r) => r.kind)[0]).toBe("prep");
  expect(first.rows.find((r) => r.kind === "prep")).toMatchObject({ lead: expect.stringContaining("晚上") });
  // Day 1's soy milk is set up that night.
  expect(c.prepDay!.nights.some((n) => n.kind === "soyMilk")).toBe(true);
  expect(view.days.slice(1).every((d) => d.rows.every((r) => r.kind !== "prep"))).toBe(true);
});

test("cooked the afternoon before, that dinner is on the card after the session, eaten from the pot", () => {
  const c = card(afternoonBefore());
  expect(c.prepDay?.dinner).toMatchObject({ pot: "A", now: true });
  expect(c.pots[0]!.meals).toBe(3);
  const rows = draftCardView(c).days[0]!.rows;
  expect(rows.slice(0, 2).map((r) => r.kind)).toEqual(["prep", "meal"]);
});

test("the stored plan starts on the prep day with only its dinner planned", () => {
  const result = afternoonBefore();
  const plan = weekFromDraft({ result, lib: LIB, start: START, now: 1, previous: null });
  expect(plan.startDate).toBe(PREP);
  expect(plan.days.map((d) => d.date)).toEqual([PREP, START, addDays(START, 1), addDays(START, 2)]);
  const prep = plan.days[0]!;
  expect(prep.planned).toEqual(["dinner"]);
  expect(prep.dinner.mode).toBe("make");
  expect([prep.breakfast.mode, prep.lunch.mode, prep.snack.mode]).toEqual(["skip", "skip", "skip"]);
  expect(plan.planner?.start).toBe(START);

  const view = dayViewOn(state({ plan }), PREP, PREP, "other")!;
  expect(view.meals.map((m) => m.key)).toEqual(["dinner"]);
});

test("an old plan's day on the prep day keeps its own breakfast and lunch, the dinner replaced", () => {
  const old = weekFromDraft({ result: checked(), lib: LIB, start: addDays(START, -3), now: 1, previous: null });
  const result = afternoonBefore();
  const plan = weekFromDraft({ result, lib: LIB, start: START, now: 2, previous: old });
  expect(plan.startDate).toBe(old.startDate);
  const prep = plan.days.find((d) => d.date === PREP)!;
  const was = old.days.find((d) => d.date === PREP)!;
  expect(prep.breakfast).toEqual(was.breakfast);
  expect(prep.lunch).toEqual(was.lunch);
  expect(prep.dinner).not.toEqual(was.dinner);
  expect(prep.planned).toBeUndefined();
});

test("everything the pots need is bought by the prep day", () => {
  const result = afternoonBefore();
  const plan = weekFromDraft({ result, lib: LIB, start: START, now: 1, previous: null });
  const items = plannerShoppingList(result.plan!, result.draft, plan);
  expect(items.length).toBeGreaterThan(0);
  const chicken = items.find((i) => i.foodId === "chicken_thigh" || i.foodId === "chicken_breast");
  expect(chicken?.neededBy).toBe(PREP);
  expect(items.every((i) => i.neededBy >= PREP)).toBe(true);
});
