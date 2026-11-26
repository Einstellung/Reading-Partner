// The meals host's decisions that need no React (src/ui/components/meals/host.ts).
//
// Run: scripts/t.sh tests/ui/components/meals/host.test.ts

import { expect, test } from "bun:test";
import { isMealsScreen, mealsCallPosition, mealsStickKey } from "../../../../src/ui/components/meals/host";
import { mealsAnchor } from "../../../../src/meals/conversation/anchor";
import { EMPTY_MEALS, type MealsState, type ShoppingItem, type WeekPlan } from "../../../../src/meals/plan/types";

function line(name: string): ShoppingItem {
  return { name, qty: "1", category: "produce", keeps: "week", freezeOnArrival: false, neededBy: "2026-11-06" } as unknown as ShoppingItem;
}

function withList(count: number): MealsState {
  return {
    ...EMPTY_MEALS,
    plan: {} as WeekPlan,
    shopping: { ...EMPTY_MEALS.shopping, items: Array.from({ length: count }, (_, i) => line(`food ${i}`)) },
  };
}

test("the meals card counts what is left to buy on the meals as they are now", () => {
  const anchor = mealsAnchor(withList(41), "2026-11-06");
  expect(anchor.position.line).toContain("41");
  const now = mealsCallPosition(anchor, withList(40));
  expect(now.line).toContain("40");
  expect(now.line).not.toContain("41");
  expect(now.title).toBe(anchor.position.title);
});

test("the meals card keeps the anchor's copy until the meals have been read", () => {
  const anchor = mealsAnchor(withList(41), "2026-11-06");
  expect(mealsCallPosition(anchor, null)).toBe(anchor.position);
});

test("every meals screen is the host's, and no other screen is", () => {
  for (const s of ["meals", "meals-shopping", "meals-day", "meals-recipe", "meals-prep", "meals-method", "meals-onboarding"] as const) {
    expect(isMealsScreen(s)).toBe(true);
  }
  expect(isMealsScreen("briefing")).toBe(false);
  expect(isMealsScreen(null)).toBe(false);
});

test("the conversation's scroll is kept under its thread, apart from the reading thread ids", () => {
  expect(mealsStickKey("meals")).toBe("meals:meals");
});
