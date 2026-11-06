// The corner position card as it stands now (anchors.ts: livePosition). An
// anchor is built once, when Ask is pressed; the meals conversation edits the
// plan it is about, so its card has to follow the meals as last read rather
// than keep the count it was opened with. Pure. Run: bun test.

import { expect, test } from "bun:test";
import { briefingAnchor, livePosition, mealsAnchor } from "../../../src/info/briefer/anchors";
import { EMPTY_MEALS, type MealsState, type ShoppingItem, type WeekPlan } from "../../../src/info/meals/plan/types";
import type { Briefing } from "../../../src/info/boxes/types";

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
  const now = livePosition(anchor, withList(40));
  expect(now.line).toContain("40");
  expect(now.line).not.toContain("41");
  expect(now.title).toBe(anchor.position.title);
});

test("the meals card keeps the anchor's copy until the meals have been read", () => {
  const anchor = mealsAnchor(withList(41), "2026-11-06");
  expect(livePosition(anchor, null)).toBe(anchor.position);
});

test("a card about anything else is the anchor's own", () => {
  const b = {
    date: "2026-11-06",
    generatedAt: 0,
    version: 2,
    labs: [],
    quiet: [],
    mustRead: [],
    oneLiners: [],
  } as unknown as Briefing;
  const anchor = briefingAnchor(b, { reader: "", sources: [], collecting: true });
  expect(livePosition(anchor, withList(3))).toBe(anchor.position);
});
