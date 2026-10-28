// The lines a planner plan keeps at home (seasonings, oils, dry rice) are a
// cupboard check at the foot of the shopping list: tickable, but in neither
// "N left" nor the count the model is told. A week from the old weekly card
// has no such lines and is unchanged.
// Run: scripts/t.sh tests/info/meals/planner/on-hand-group.test.ts

import { afterEach, beforeEach, expect, test } from "bun:test";
import { getLocale, setLocale, t } from "../../../../src/i18n";
import { currentList, isOnHand, leftToBuy, missed, setShoppingChecked, shoppingItemKey, stillToGet } from "../../../../src/info/meals/plan/shopping";
import { EMPTY_SHOPPING, type ShoppingItem } from "../../../../src/info/meals/plan/types";
import { checkDraft } from "../../../../src/info/meals/planner/checks";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import { weekFromDraft } from "../../../../src/info/meals/planner/to-week";
import { plannerShoppingList } from "../../../../src/info/meals/planner/trip";
import { shoppingPreview, shoppingStatus } from "../../../../src/info/meals/screen/list-order";
import { PROFILE, START, START_WEEKDAY, goodDraft, targetsFor } from "./fixture";
import messages from "../../../../src/i18n/messages/meals";

const initial = getLocale();
beforeEach(() => setLocale("zh-CN"));
afterEach(() => setLocale(initial));

function planList(): ShoppingItem[] {
  const lib = planLibrary(PROFILE);
  const result = checkDraft(goodDraft(), {
    profile: PROFILE,
    targets: targetsFor(PROFILE),
    startWeekday: START_WEEKDAY,
    people: PROFILE.people,
    library: lib,
  });
  if (!result.plan) throw new Error("fixture draft fails");
  const plan = weekFromDraft({ result, lib, start: START, now: 1, today: START, previous: null });
  return plannerShoppingList(result.plan, result.draft, plan);
}

test("a lemon is bought by the piece, not kept on hand", () => {
  const lemon = planList().find((i) => i.foodId === "lemon");
  expect(lemon).toBeDefined();
  expect(lemon!.pack?.onHand).toBeUndefined();
  expect(lemon!.qty).toMatch(/^\d+ 个（约 \d+ g）$/);
});

test("on-hand lines are not counted in what is left to buy", () => {
  const items = planList();
  const onHand = items.filter(isOnHand);
  const buy = items.filter((i) => !isOnHand(i));
  expect(onHand.length).toBeGreaterThan(3);
  expect(buy.length).toBeGreaterThan(10);
  const state = { ...EMPTY_SHOPPING, items };
  expect(leftToBuy(state)).toBe(buy.length);
  expect(shoppingStatus(state, currentList(state))).toBe(t("meals.shopping.left", { count: buy.length }));

  // Ticking a cupboard line changes no count; ticking a bought one does.
  const ticked = setShoppingChecked(state, shoppingItemKey(onHand[0]!), true);
  expect(leftToBuy(ticked)).toBe(buy.length);
  const boughtOne = setShoppingChecked(ticked, shoppingKeyOf(buy[0]!), true);
  expect(leftToBuy(boughtOne)).toBe(buy.length - 1);
});

const shoppingKeyOf = (i: ShoppingItem) => shoppingItemKey(i);

test("the preview and the after-trip lists skip the cupboard lines", () => {
  const items = planList();
  const state = { ...EMPTY_SHOPPING, items };
  const lines = currentList(state);
  const preview = shoppingPreview(state, lines, 100);
  expect(preview.items.every((i) => !isOnHand(i))).toBe(true);
  expect(missed(state, lines).every((i) => !isOnHand(i))).toBe(true);
  expect(stillToGet({ ...state }, lines.map((i) => ({ ...i, afterDone: true }))).every((i) => !isOnHand(i))).toBe(true);
});

test("a week from the old weekly card has no on-hand lines and counts every line", () => {
  const old: ShoppingItem[] = planList().map(({ pack: _pack, ...rest }) => rest);
  const state = { ...EMPTY_SHOPPING, items: old };
  expect(old.some(isOnHand)).toBe(false);
  expect(leftToBuy(state)).toBe(old.length);
});

test("the cupboard group has its words in every meals locale", () => {
  for (const [locale, area] of Object.entries(messages)) {
    const m = area as Record<string, unknown>;
    expect(typeof m.onHandTitle, locale).toBe("string");
    expect(typeof m.onHandHint, locale).toBe("string");
    expect(m["pack.can"], locale).toBeDefined();
  }
  expect(messages["zh-CN"].onHandTitle).toBe("家里应该有");
});
