// The draft card's payload (src/info/meals/build-draft-card.ts): pot letters,
// the prep session and its minutes, the meal eaten straight from the pot, the
// night-before reminders, and what a revision marks as changed.
// Run: scripts/t.sh tests/info/meals/build-draft-card.test.ts

import { expect, test } from "bun:test";
import { mealAtSession, prepMinutes } from "../../../src/info/meals/build-draft-card";
import { addDays } from "../../../src/info/meals/plan/week";
import type { PlanDraft } from "../../../src/info/meals/planner/draft";
import { draftCard, twoPotDraft } from "./planner/card-fixture";
import { goodDraft, START } from "./planner/fixture";

test("a first draft is version 1 under the new id, dated from the host's start", () => {
  const card = draftCard();
  expect(card).toMatchObject({ kind: "meals-draft", threadId: "meals", draftId: "42", version: 1, startDate: START, phase: "proposed" });
  expect(card.days.map((d) => d.date)).toEqual([START, addDays(START, 1), addDays(START, 2)]);
  expect(card.draft).toEqual(goodDraft());
});

test("pots are lettered by the first meal that eats from them, not by their order in the draft", () => {
  const card = draftCard(twoPotDraft());
  expect(card.pots.map((p) => [p.letter, p.batch, p.meals])).toEqual([
    ["A", "chili", 2],
    ["B", "beef", 1],
  ]);
  expect(card.pots[0]).toMatchObject({ equipment: "stove", cuisine: "american", name: { en: "Chicken and kidney bean chili" } });
  expect(card.days[2]!.lunch.pot).toBe("B");
  expect(card.days[0]!.dinner.pot).toBe("A");
});

test("the prep session lists its pots in letter order with one pair of hands' minutes", () => {
  expect(draftCard().session).toMatchObject({ day: 1, part: "afternoon", pots: ["A"], activeMin: 15, totalMin: 60 });
  // Beef chili 15/120 started first, chicken chili 15/60 while it simmers.
  expect(draftCard(twoPotDraft()).session).toMatchObject({ day: 1, part: "afternoon", pots: ["A", "B"], activeMin: 30, totalMin: 120 });
});

test("prep minutes: the longest pot first, hands-on parts back to back", () => {
  expect(prepMinutes([])).toEqual({ activeMin: 0, totalMin: 0 });
  expect(prepMinutes([{ activeMin: 15, totalMin: 60 }])).toEqual({ activeMin: 15, totalMin: 60 });
  expect(prepMinutes([{ activeMin: 10, totalMin: 70 }, { activeMin: 15, totalMin: 120 }])).toEqual({ activeMin: 25, totalMin: 120 });
  // All hands, no waiting: the minutes add up.
  expect(prepMinutes([{ activeMin: 30, totalMin: 30 }, { activeMin: 30, totalMin: 30 }])).toEqual({ activeMin: 60, totalMin: 60 });
});

test("the meal after the prep session eats straight from the pot; no other meal does", () => {
  expect(mealAtSession("morning")).toBe("lunch");
  expect(mealAtSession("afternoon")).toBe("dinner");
  expect(mealAtSession("evening")).toBeNull();
  const card = draftCard();
  const now = card.days.flatMap((d) => [d.lunch, d.dinner].filter((m) => m.now).map(() => d.day));
  expect(now).toEqual([1]);
  expect(card.days[0]!.dinner).toMatchObject({ pot: "A", now: true, staple: null, name: { zh: "鸡丁豆子炖菜盖糙米饭配菠菜" } });
  expect(card.days[1]!.lunch).toMatchObject({ pot: "A", now: false });
});

test("a fresh main carries its staple and sides by name", () => {
  const draft = goodDraft();
  draft.days[0]!.dinner.sides = ["tomato_cucumber_salad"];
  const card = draftCard(draft);
  expect(card.days[0]!.lunch).toMatchObject({ pot: null, now: false, name: { zh: "宫保鸡丁" }, staple: { zh: "糙米饭", en: "Brown rice" } });
  expect(card.days[0]!.dinner.sides).toHaveLength(1);
  expect(card.days[0]!.dinner.sides[0]!.en).not.toBe("tomato_cucumber_salad");
  expect(card.days[0]!.fruit).toEqual(["苹果"]);
});

test("the night-before reminders sit on the night they are done", () => {
  const card = draftCard();
  expect(card.days.map((d) => d.nights.length)).toEqual([0, 2, 0]);
  expect(card.days[1]!.nights).toEqual([
    { kind: "thaw", food: "猪后腿瘦肉", fromFrozen: false, meal: { day: 3, slot: "lunch" } },
    { kind: "thaw", food: "鳕鱼", fromFrozen: true, meal: { day: 3, slot: "dinner" } },
  ]);
});

// Day 3's breakfast and dinner staple changed, and the pot's id renamed by the model.
function revised(): PlanDraft {
  const d = goodDraft();
  d.days[2]!.breakfast = "milk_toast_boiled_egg";
  d.days[2]!.fruit = ["orange", "apple"];
  d.days[2]!.dinner = { main: { dish: "lemon_seared_cod", staple: "whole_wheat_pasta" }, sides: [] };
  d.batches[0]!.id = "pot1";
  d.days[0]!.dinner = { main: { batch: "pot1", way: 1 }, sides: [] };
  d.days[1]!.lunch = { main: { batch: "pot1", way: 3 }, sides: [] };
  return d;
}

test("a revision keeps the draft id, bumps the version and marks only the meals that changed", () => {
  const first = draftCard();
  const second = draftCard(revised(), first, "99");
  expect(second.draftId).toBe("42");
  expect(second.version).toBe(2);
  expect(second.days.map((d) => d.breakfastChanged)).toEqual([false, false, true]);
  const changed = second.days.flatMap((d) => (["lunch", "dinner"] as const).filter((k) => d[k].changed).map((k) => `${d.day} ${k}`));
  // The pot meals are the same dish and way under a new batch id: not changed.
  expect(changed).toEqual(["3 dinner"]);
  expect(draftCard(revised(), second).version).toBe(3);
  // A first draft marks nothing.
  expect(first.days.some((d) => d.breakfastChanged || d.lunch.changed || d.dinner.changed)).toBe(false);
});
