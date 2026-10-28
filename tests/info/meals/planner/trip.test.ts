// A planner plan's shopping list (src/info/meals/planner/trip.ts): whole packs
// in the stored list lines the shopping screen reads, with the meals that went
// differently taken out, and re-derived when the profile re-solves the plan.
// Run: scripts/t.sh tests/info/meals/planner/trip.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale } from "../../../../src/i18n";
import { resolvedWeek } from "../../../../src/info/meals/apply";
import { computeTargets } from "../../../../src/info/meals/nutrition/targets";
import { currentList, setShoppingChecked, shoppingItemKey } from "../../../../src/info/meals/plan/shopping";
import { EMPTY_SHOPPING, type ShoppingItem, type WeekPlan } from "../../../../src/info/meals/plan/types";
import { checkDraft } from "../../../../src/info/meals/planner/checks";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import { packList } from "../../../../src/info/meals/planner/packs";
import { packItem, plannerShoppingList } from "../../../../src/info/meals/planner/trip";
import { weekFromDraft } from "../../../../src/info/meals/planner/to-week";
import { shoppingNote } from "../../../../src/info/meals/screen/view";
import { PROFILE, START, START_WEEKDAY, goodDraft, targetsFor } from "./fixture";

const initial = getLocale();
beforeEach(() => setLocale("zh-CN"));
afterEach(() => setLocale(initial));

function solved(profile = PROFILE) {
  const lib = planLibrary(profile);
  const result = checkDraft(goodDraft(), {
    profile,
    targets: targetsFor(profile),
    startWeekday: START_WEEKDAY,
    people: profile.people,
    library: lib,
  });
  if (!result.plan) throw new Error(`fixture draft fails: ${JSON.stringify(result.problems)}`);
  const plan = weekFromDraft({ result, lib, start: START, now: 1, today: START, previous: null });
  return { result, lib, plan, solvedPlan: result.plan };
}

const byFood = (items: readonly ShoppingItem[], food: string) => items.find((i) => i.foodId === food);

test("every line is whole packs, pieces or an about-weight, never grams to weigh", () => {
  const { result, plan } = solved();
  const items = plannerShoppingList(result.plan!, result.draft, plan);
  expect(items.length).toBeGreaterThan(5);
  for (const item of items) {
    expect(item.pack).toBeDefined();
    expect(item.qty).not.toMatch(/^\d+ ?g$/);
    expect(item.qty.length).toBeGreaterThan(0);
  }
});

test("the lines follow packList one for one, named by what is bought", () => {
  const { result, plan } = solved();
  const items = plannerShoppingList(result.plan!, result.draft, plan);
  const lines = packList(result.plan!, result.draft);
  expect(items.map((i) => i.foodId).sort()).toEqual(lines.map((l) => l.food).sort());
  // Brown rice is planned cooked and bought dry.
  expect(byFood(items, "brown_rice_cooked")?.name).toBe("糙米");
});

test("seasonings are on hand, eggs are counted, raw meat that waits past its days is frozen the day it is bought", () => {
  const { result, plan } = solved();
  const items = plannerShoppingList(result.plan!, result.draft, plan);
  const onHand = items.filter((i) => i.pack?.onHand);
  expect(onHand.length).toBeGreaterThan(0);
  for (const i of onHand) expect(i.qty).toBe("家里常备");
  expect(byFood(items, "egg")?.qty).toMatch(/^\d+ 个$/);
  expect(byFood(items, "chicken_thigh")?.qty).toMatch(/^\d+ 盒（约 \d+ g）$/);
  for (const line of packList(result.plan!, result.draft)) {
    const item = byFood(items, line.food)!;
    expect(item.freezeOnArrival).toBe(line.freeze);
    expect(item.pack?.frozen === true).toBe(line.frozen);
  }
});

test("a pack line's note says what to do once home", () => {
  const base: ShoppingItem = {
    name: "鳕鱼",
    en: "cod",
    qty: "1 袋（约 400 g）",
    category: "protein",
    keeps: "d1-2",
    freezeOnArrival: false,
    neededBy: START,
    pack: {},
  };
  expect(shoppingNote({ ...base, pack: { frozen: true } })).toBe("买回直接冷冻");
  expect(shoppingNote({ ...base, freezeOnArrival: true })).toBe("买回当天分装冷冻");
  expect(shoppingNote(base)).toBe("1–2 天");
  expect(shoppingNote({ ...base, keeps: "d1-2", pack: { onHand: true } })).toBe("常温可存");
  expect(shoppingNote({ ...base, pack: { leftover: { grams: 120, useBy: "2026-11-04" } } })).toContain("剩约 120 g");
  // A week from the old weekly card keeps its old note.
  const { pack: _pack, ...old } = base;
  expect(shoppingNote({ ...old, freezeOnArrival: true })).toBe("1–2 天 · 到家就冷冻");
});

test("a meal that went differently is not shopped for", () => {
  const { result, plan } = solved();
  const all = plannerShoppingList(result.plan!, result.draft, plan);
  // Day 3 dinner is the cod; eaten out instead.
  const out: WeekPlan = {
    ...plan,
    days: plan.days.map((d, i) => (i === 2 ? { ...d, dinner: { mode: "out", place: "" } as WeekPlan["days"][number]["dinner"] } : d)),
  };
  const less = plannerShoppingList(result.plan!, result.draft, out);
  expect(byFood(all, "cod")).toBeDefined();
  expect(byFood(less, "cod")).toBeUndefined();
});

test("packItem carries the day it is first needed and the frozen tag", () => {
  const item = packItem(
    { food: "cod", grams: 300, buy: { by: "weight" }, firstDay: 3, lastDay: 3, freeze: false, frozen: true, leftover: null },
    START,
  )!;
  expect(item.neededBy).toBe("2026-11-04");
  expect(item.qty).toBe("约 300 g");
  expect(item.pack).toEqual({ frozen: true });
});

test("a profile change re-solves a planner plan and re-derives its pack list, ticks kept", () => {
  const { result, plan } = solved();
  const items = plannerShoppingList(result.plan!, result.draft, plan);
  const ticked = items[0]!;
  const shopping = setShoppingChecked({ ...EMPTY_SHOPPING, items }, shoppingItemKey(ticked), true);
  const two = { ...PROFILE, people: 2 };
  const charter = { profile: two, text: "", updatedAt: 1 };
  const next = resolvedWeek(plan, shopping, charter, "other", START);
  const after = currentList(next.shopping);
  expect(after.every((i) => i.pack)).toBe(true);
  const grams = (list: readonly ShoppingItem[]) => list.reduce((s, i) => s + (i.grams ?? 0), 0);
  expect(grams(after)).toBeGreaterThan(grams(items) * 1.5);
  expect(next.shopping.checked[shoppingItemKey(ticked)]).toBe(true);
  expect(computeTargets(two, "other")).not.toBeNull();
});

test("a planner plan whose draft no longer solves keeps its plan and its list", () => {
  const { result, plan } = solved();
  const items = plannerShoppingList(result.plan!, result.draft, plan);
  const shopping = { ...EMPTY_SHOPPING, items };
  const charter = { profile: { ...PROFILE, dislikes: ["cod"] }, text: "", updatedAt: 1 };
  const next = resolvedWeek(plan, shopping, charter, "other", START);
  expect(next.plan).toBe(plan);
  expect(next.shopping).toBe(shopping);
});
