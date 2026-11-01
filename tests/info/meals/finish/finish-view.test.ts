// The eating-day finishing steps as the screens read them (info/meals/finish/finish-view.ts):
// one answer per meal and per night, kept per state object.
// Run: scripts/t.sh tests/info/meals/finish/finish-view.test.ts

import { expect, test } from "bun:test";
import { finishSource, opensMealPage, thawNotInNotes } from "../../../../src/info/meals/finish/finish-view";
import type { Finishing } from "../../../../src/info/meals/finish/types";
import type { MealView } from "../../../../src/info/meals/screen/view";
import { dayViewOn } from "../../../../src/info/meals/screen/view";
import { addDays } from "../../../../src/info/meals/plan/week";
import { MON, state } from "../fixtures/week";

const STEPS: Finishing = { line: "Heat the salmon box 3 min", need: ["Salmon box", "Salt"], steps: ["Heat it.", "Eat it."] };

function counting(answer: (view: MealView) => Finishing | null) {
  const calls: string[] = [];
  const finish = (view: MealView) => {
    calls.push(view.key);
    return answer(view);
  };
  return { calls, finish };
}

test("a day maps each meal with steps to them and leaves the others out", () => {
  const s = state();
  const day = dayViewOn(s, MON, MON, "other")!;
  const { calls, finish } = counting((v) => (v.key === "dinner" ? STEPS : null));
  const source = finishSource(finish);
  const got = source.day(s, day, "en");
  expect([...got.keys()]).toEqual(["dinner"]);
  expect(got.get("dinner")).toBe(STEPS);
  expect(calls.sort()).toEqual(day.meals.map((m) => m.key).sort());
});

test("the answer is kept for the same state, date and language, and asked again when any of them moves", () => {
  const s = state();
  const day = dayViewOn(s, MON, MON, "other")!;
  const { calls, finish } = counting(() => STEPS);
  const source = finishSource(finish);
  const first = source.day(s, day, "en");
  // The screens rebuild the view on every render: a fresh view of the same day is the same answer.
  expect(source.day(s, dayViewOn(s, MON, MON, "other")!, "en")).toBe(first);
  const perDay = day.meals.length;
  expect(calls.length).toBe(perDay);

  source.day(s, day, "zh-CN");
  expect(calls.length).toBe(perDay * 2);
  source.day(state(), day, "en");
  expect(calls.length).toBe(perDay * 3);
  source.day(s, dayViewOn(s, addDays(MON, 1), MON, "other")!, "en");
  expect(calls.length).toBeGreaterThan(perDay * 3);
});

test("a state with no profile has nothing to finish and asks nothing", () => {
  const s = state();
  const day = dayViewOn(s, MON, MON, "other")!;
  const { calls, finish } = counting(() => STEPS);
  const got = finishSource(finish).day({ ...s, charter: null }, day, "en");
  expect(got.size).toBe(0);
  expect(calls).toEqual([]);
});

test("tonight's notes are asked for today only, once per state and language", () => {
  const s = state();
  let asked = 0;
  const source = finishSource(undefined, (_s, today) => {
    asked += 1;
    return [`Tonight: thaw the cod (${today})`];
  });
  expect(source.tonight(s, addDays(MON, 1), MON, "en")).toEqual([]);
  expect(asked).toBe(0);
  const first = source.tonight(s, MON, MON, "en");
  expect(first).toEqual([`Tonight: thaw the cod (${MON})`]);
  expect(source.tonight(s, MON, MON, "en")).toBe(first);
  expect(asked).toBe(1);
  source.tonight(s, MON, MON, "ja");
  expect(asked).toBe(2);
});

test("a meal opens its page when it has a recipe or finishing steps", () => {
  const rows = [{}] as MealView["rows"];
  expect(opensMealPage({ mode: "make", rows }, null)).toBe(true);
  expect(opensMealPage({ mode: "make", rows: [] }, null)).toBe(false);
  expect(opensMealPage({ mode: "out", rows: [] }, null)).toBe(false);
  expect(opensMealPage({ mode: "make", rows: [] }, STEPS)).toBe(true);
});

test("a thaw line tonight's notes already say is not drawn twice", () => {
  expect(thawNotInNotes(["A", "B"], ["B", "C"])).toEqual(["A"]);
  expect(thawNotInNotes(["A"], [])).toEqual(["A"]);
});
