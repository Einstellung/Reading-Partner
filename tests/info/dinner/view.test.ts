// What the dinner screen reads off the state (src/info/dinner/view.ts): the
// words, which nights are ahead, and the order the shopping list is drawn in.
// Run: bash scripts/t.sh tests/info/dinner/view.test.ts

import { expect, test } from "bun:test";
import {
  categoryLabel,
  dayWord,
  dishThumbnails,
  headlineDays,
  keepsLabel,
  laterDays,
  leftToBuy,
  modeWord,
  shoppingGroups,
  upcomingDays,
  weekdayName,
} from "../../../src/info/dinner/view";
import type { Dish, ShoppingItem, WeekPlan } from "../../../src/info/dinner/types";

function dish(id: string, name: string, names: string[] = []): Dish {
  return {
    id,
    name,
    searchName: name.toLowerCase(),
    oneLine: "",
    base: "",
    fresh: "",
    keepsADay: false,
    handsOnMinutes: 10,
    ingredients: names.map((n) => ({
      name: n,
      en: n,
      qty: "1",
      category: "produce" as const,
      keeps: "d3-5" as const,
    })),
  };
}

const PLAN: WeekPlan = {
  id: "week-2026-09-20",
  startDate: "2026-09-20",
  days: [
    { date: "2026-09-20", mode: "cook", dishId: "dish-1" },
    { date: "2026-09-21", mode: "reheat", reheatOf: "2026-09-20", freshAdd: "a handful of greens" },
    { date: "2026-09-22", mode: "out", place: "the noodle place" },
    { date: "2026-09-23", mode: "delivery", place: "the Thai place" },
    { date: "2026-09-24", mode: "cook", dishId: "dish-2" },
    { date: "2026-09-25", mode: "cook", dishId: "dish-2" },
    { date: "2026-09-26", mode: "out" },
  ],
  dishes: [dish("dish-1", "Chickpea stew", ["chickpeas", "spinach"]), dish("dish-2", "Fried rice")],
  createdAt: 0,
  revision: 1,
};

test("every mode has a plain word, and none of them apologises", () => {
  expect(modeWord("cook")).toBe("Cook");
  expect(modeWord("reheat")).toBe("Reheat");
  expect(modeWord("out")).toBe("Eat out");
  expect(modeWord("delivery")).toBe("Delivery");
});

test("a shelf-life class is shown as words", () => {
  expect(keepsLabel("d1-2")).toBe("1–2 days");
  expect(keepsLabel("w2plus")).toBe("2+ weeks");
  expect(keepsLabel("pantry")).toBe("pantry");
  expect(categoryLabel("protein")).toBe("Protein");
});

// Read as UTC: the string is already local, and re-reading it in the host's
// zone moves the day either side of midnight.
test("a date's weekday does not depend on the host's timezone", () => {
  expect(weekdayName("2026-09-20")).toBe("Sunday");
  expect(weekdayName("2026-09-21")).toBe("Monday");
  expect(weekdayName("nonsense")).toBe("");
});

test("today and tomorrow are named; everything else is a weekday", () => {
  expect(dayWord("2026-09-20", "2026-09-20")).toBe("Today");
  expect(dayWord("2026-09-21", "2026-09-20")).toBe("Tomorrow");
  expect(dayWord("2026-09-22", "2026-09-20")).toBe("Tuesday");
});

test("a night already eaten leaves the screen", () => {
  expect(upcomingDays(PLAN, "2026-09-23").map((v) => v.day.date)).toEqual([
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
  ]);
  expect(upcomingDays(null, "2026-09-23")).toEqual([]);
});

test("the two nights at the top are the next two, and the rest follow", () => {
  const head = headlineDays(PLAN, "2026-09-20");
  expect(head.map((v) => v.word)).toEqual(["Today", "Tomorrow"]);
  // A reheat night carries the dish whose base it eats, not one of its own.
  expect(head[1].dish?.name).toBe("Chickpea stew");
  expect(laterDays(PLAN, "2026-09-20").map((v) => v.day.date)).toEqual([
    "2026-09-22",
    "2026-09-23",
    "2026-09-24",
    "2026-09-25",
    "2026-09-26",
  ]);
});

test("the last night of the week leaves nothing for the compact list", () => {
  expect(headlineDays(PLAN, "2026-09-26").map((v) => v.word)).toEqual(["Today"]);
  expect(laterDays(PLAN, "2026-09-26")).toEqual([]);
});

test("a dish stands in with up to three of its ingredients' pictures", () => {
  const d = dish("dish-3", "Soup", ["a", "b", "c", "d"]);
  // Resolved by the English name, which is the only one images.ts has a row for.
  expect(dishThumbnails(d, (n) => `/img/${n}.jpg`)).toEqual(["/img/a.jpg", "/img/b.jpg", "/img/c.jpg"]);
  // Names the bank has never heard of are skipped, not drawn as gaps.
  expect(dishThumbnails(d, (n) => (n === "c" ? "/img/c.jpg" : null))).toEqual(["/img/c.jpg"]);
  expect(dishThumbnails(null)).toEqual([]);
  // The names above are not ingredients, so the live table has nothing for them
  // and the night falls through to the block.
  expect(dishThumbnails(d)).toEqual([]);
  // A dish of real ingredients gets real photographs, in the order it lists
  // them, and skips the one nothing has a picture of.
  const real = dish("dish-4", "Stew", ["farro", "kale", "garlic", "lemon", "ginger"]);
  const urls = dishThumbnails(real);
  expect(urls.length).toBe(3);
  expect(urls[0]).toContain("Kale-small.png");
  expect(urls[2]).toContain("Lemon-small.png");
});

function item(name: string, category: ShoppingItem["category"], checked = false): ShoppingItem {
  return {
    name,
    en: "",
    qty: "1",
    category,
    keeps: "d3-5",
    freezeOnArrival: false,
    checked,
    neededBy: "2026-09-20",
  };
}

test("only what is left to buy is counted", () => {
  expect(leftToBuy([item("a", "produce"), item("b", "produce", true), item("c", "pantry")])).toBe(2);
});

test("the list walks the aisles in the derivation's own order", () => {
  const groups = shoppingGroups([
    item("rice", "grains"),
    item("chicken", "protein"),
    item("spinach", "produce"),
  ]);
  expect(groups.map((g) => g.category)).toEqual(["produce", "protein", "grains"]);
  expect(groups[0].label).toBe("Produce");
});

test("a ticked line sinks to the bottom of its own aisle and stays on the list", () => {
  const groups = shoppingGroups([
    item("spinach", "produce", true),
    item("leeks", "produce"),
    item("chard", "produce", true),
    item("rice", "grains"),
  ]);
  expect(groups[0].items.map((i) => i.name)).toEqual(["leeks", "spinach", "chard"]);
  expect(groups.map((g) => g.category)).toEqual(["produce", "grains"]);
});
