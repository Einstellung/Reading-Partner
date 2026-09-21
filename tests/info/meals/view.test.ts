// What the meals screen reads off the state (src/info/meals/view.ts): the
// words, the three meals of a day, which days are ahead, and the order the
// shopping list is drawn in.
// Run: scripts/t.sh tests/info/meals/view.test.ts

import { expect, test } from "bun:test";
import {
  categoryLabel,
  dayViewOn,
  dayWord,
  dishThumbnails,
  headlineDays,
  keepsLabel,
  laterDays,
  leftToBuy,
  mealLabel,
  mealViews,
  modeWord,
  shoppingGroups,
  upcomingDays,
  weekdayName,
} from "../../../src/info/meals/view";
import { deriveShoppingList, setShoppingChecked, shoppingItemKey } from "../../../src/info/meals/shopping";
import { MON, shopping, week } from "./fixtures/week";

test("every mode has a plain word and none of them apologises", () => {
  expect(modeWord("cook")).toBe("Cook");
  expect(modeWord("packed")).toBe("Packed");
  expect(modeWord("bought")).toBe("Bought");
  expect(modeWord("skip")).toBe("Skip");
  expect(mealLabel("breakfast")).toBe("Breakfast");
  expect(keepsLabel("d1-2")).toBe("1–2 days");
  expect(categoryLabel("produce")).toBe("Produce");
});

test("a date is Today, Tomorrow, or its weekday", () => {
  expect(weekdayName(MON)).toBe("Monday");
  expect(dayWord(MON, MON)).toBe("Today");
  expect(dayWord("2026-09-22", MON)).toBe("Tomorrow");
  expect(dayWord("2026-09-23", MON)).toBe("Wednesday");
});

test("a day is three meals, in the order they are eaten", () => {
  const plan = week();
  const views = mealViews(plan, plan.days[1]!);
  expect(views.map((v) => v.key)).toEqual(["breakfast", "lunch", "dinner"]);
  expect(views[1]!.word).toBe("Packed");
  expect(views[1]!.dish?.name).toBe("Chickpea stew");
  expect(views[2]!.dish?.name).toBe("Sheet pan salmon");
});

test("a day by its date, with the dish it leads with", () => {
  const view = dayViewOn(week(), "2026-09-22", MON)!;
  expect(view.word).toBe("Tomorrow");
  expect(view.dish?.name).toBe("Sheet pan salmon");
  expect(dayViewOn(week(), "2026-10-01", MON)).toBeNull();
  expect(dayViewOn(null, MON, MON)).toBeNull();
});

test("a day already eaten leaves the screen", () => {
  const plan = week();
  expect(upcomingDays(plan, "2026-09-25")).toHaveLength(3);
  expect(headlineDays(plan, MON).map((v) => v.day.date)).toEqual([MON, "2026-09-22"]);
  expect(laterDays(plan, MON)).toHaveLength(5);
  expect(upcomingDays(null, MON)).toEqual([]);
});

test("a dish with no photograph is drawn from up to three ingredient pictures", () => {
  const stew = week().dishes[1]!;
  expect(dishThumbnails(stew, (en) => (en === "kale" ? "kale.png" : null))).toEqual(["kale.png"]);
  expect(dishThumbnails(null)).toEqual([]);
});

test("the list is drawn in aisle order, ticked lines sunk, and counted once", () => {
  const items = deriveShoppingList(week(), MON);
  const state = setShoppingChecked(
    shopping({ items }),
    shoppingItemKey(items.find((i) => i.name === "kale")!),
    true,
  );
  expect(leftToBuy(state)).toBe(4);
  const groups = shoppingGroups(state);
  expect(groups.map((g) => g.label)).toEqual(["Produce", "Protein", "Dairy", "Grains", "Pantry"]);
  expect(groups[0]!.items[groups[0]!.items.length - 1]!.name).toBe("kale");
});
