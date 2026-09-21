// The dinner desk's tools (src/info/meals/tools.ts): what the instruction
// tells the model, and what each tool does with what comes back — which is
// draft a card and write nothing.
// Run: scripts/t.sh tests/info/dinner

import { expect, test } from "bun:test";
import {
  buildProposeMealsCharterTool,
  buildProposeMealsPlanTool,
  mealsGuidance,
  toDayDrafts,
  toDishDrafts,
  type MealsToolDeps,
} from "../../../src/info/meals/tools";
import type { MealsCard } from "../../../src/info/meals/cards";
import { EMPTY_MEALS, type MealsState, type WeekPlan } from "../../../src/info/meals/types";

const MON = "2026-09-21";

function week(): WeekPlan {
  return {
    id: `week-${MON}`,
    startDate: MON,
    days: [
      { date: "2026-09-21", mode: "cook", dishId: "dish-a" },
      { date: "2026-09-22", mode: "reheat", reheatOf: "2026-09-21", freshAdd: "leaves" },
      { date: "2026-09-23", mode: "delivery", place: "the noodle place" },
      { date: "2026-09-24", mode: "out" },
      { date: "2026-09-25", mode: "out" },
      { date: "2026-09-26", mode: "out" },
      { date: "2026-09-27", mode: "out" },
    ],
    dishes: [
      {
        id: "dish-a",
        name: "Traybake",
        searchName: "chicken traybake",
        oneLine: "one tray",
        base: "b",
        fresh: "f",
        keepsADay: true,
        handsOnMinutes: 10,
        ingredients: [],
      },
    ],
    createdAt: 1,
    revision: 1,
  };
}

function deps(state: MealsState = { ...EMPTY_MEALS }): MealsToolDeps & { cards: MealsCard[] } {
  const cards: MealsCard[] = [];
  return {
    cards,
    threadId: "t",
    state: async () => state,
    today: () => MON,
    now: () => 500,
    onMealsCard: (card) => cards.push(card),
    random: () => 0.5,
  };
}

const fullWeek = {
  adjustment: false,
  dishes: [
    {
      name: "Chicken traybake",
      oneLine: "one tray",
      base: "chicken and roots",
      fresh: "leaves",
      keepsADay: true,
      handsOnMinutes: 12,
      ingredients: [
        { name: "chicken thighs", en: "chicken thighs", qty: "600g", category: "protein", keeps: "d1-2" },
      ],
    },
  ],
  days: [
    { day: 1, mode: "cook", dish: "Chicken traybake" },
    { day: 2, mode: "reheat", reheatOfDay: 1, freshAdd: "leaves" },
    { day: 3, mode: "delivery", place: "the noodle place" },
    { day: 4, mode: "out", place: "the canteen" },
    { day: 5, mode: "out" },
    { day: 6, mode: "out" },
    { day: 7, mode: "out" },
  ],
};

test("with no charter the instruction says to ask two or three questions first", () => {
  const text = mealsGuidance({ ...EMPTY_MEALS }, MON);
  expect(text).toContain("ask two or three questions");
  expect(text).toContain("No week is planned");
  expect(text).toContain(`Today is ${MON}`);
});

test("the instruction numbers the week's days and marks today, so the model never writes a date", () => {
  const text = mealsGuidance({ ...EMPTY_MEALS, plan: week() }, "2026-09-22");
  expect(text).toContain("- Day 1 (2026-09-21): cook Traybake");
  expect(text).toContain("- Day 2 (2026-09-22): reheat the base from day 1, plus leaves  <- today");
  expect(text).toContain("- Day 3 (2026-09-23): delivery from the noodle place");
  expect(text).toContain("Never write a date");
});

test("the instruction carries the hard constraints and forbids nutrition numbers", () => {
  const text = mealsGuidance({ ...EMPTY_MEALS }, MON);
  expect(text).toContain("One pot");
  expect(text).toContain("15 minutes hands-on");
  expect(text).toContain("Never count calories");
  expect(text).toContain("Never re-plan the week");
});

// Any name finds a photograph now, so the menu is not narrowed to named
// dishes: the search name is what is typed in, not what is cooked (docs/73 图片).
test("every dish is asked for a search name and nothing is narrowed", () => {
  const guidance = mealsGuidance({ ...EMPTY_MEALS }, MON);
  expect(guidance).toContain("Give every dish a `searchName`");
  expect(guidance).not.toContain("Prefer dishes that have a common name");
});

test("the charter tool drafts a card and writes nothing", async () => {
  const d = deps();
  const out = await buildProposeMealsCharterTool(d).execute({
    people: 2,
    stores: ["the market"],
    kitchen: "two burners",
    dislikes: ["coriander"],
    nightsCooking: 4,
    nightsOut: 1,
    nightsDelivery: 2,
    text: "two of us, cooking most nights",
  });
  expect(d.cards).toHaveLength(1);
  expect(d.cards[0]?.kind).toBe("meals-charter");
  expect(d.cards[0]).toMatchObject({ phase: "proposed", people: 2 });
  expect(String(typeof out === "string" ? out : out.text)).toContain("Nothing is saved");
});

test("a week drafts a card with every day dated and the dish id minted", async () => {
  const d = deps();
  await buildProposeMealsPlanTool(d).execute(fullWeek);
  const card = d.cards[0];
  expect(card?.kind).toBe("meals-plan");
  if (card?.kind !== "meals-plan") throw new Error("expected a plan card");
  expect(card.days.map((x) => x.date)[0]).toBe(MON);
  expect(card.days).toHaveLength(7);
  expect(card.days[0]?.dishId).toBe("dish-88888888");
  expect(card.changedDates).toEqual([]);
  expect(card.phase).toBe("proposed");
});

test("a short week is refused with a sentence the model can act on, and no card", async () => {
  const d = deps();
  const out = await buildProposeMealsPlanTool(d).execute({
    ...fullWeek,
    days: fullWeek.days.slice(0, 3),
  });
  expect(d.cards).toHaveLength(0);
  expect(String(typeof out === "string" ? out : out.text)).toContain("needs all 7 days");
});

test("a plan that does not hold up is refused rather than shown to the reader", async () => {
  const d = deps();
  const dishes = [{ ...fullWeek.dishes[0]!, handsOnMinutes: 45 }];
  const out = await buildProposeMealsPlanTool(d).execute({ ...fullWeek, dishes });
  expect(d.cards).toHaveLength(0);
  expect(String(typeof out === "string" ? out : out.text)).toContain("45 minutes hands-on");
});

test("an adjustment names only the nights it changes and leaves the rest of the week alone", async () => {
  const d = deps({ ...EMPTY_MEALS, plan: week() });
  await buildProposeMealsPlanTool(d).execute({
    adjustment: true,
    dishes: [],
    days: [{ day: 2, mode: "delivery", place: "the dumpling place" }],
  });
  const card = d.cards[0];
  if (card?.kind !== "meals-plan") throw new Error("expected a plan card");
  expect(card.adjustment).toBe(true);
  expect(card.changedDates).toEqual(["2026-09-22"]);
  expect(card.days[0]?.dishId).toBe("dish-a");
  expect(card.days[1]?.place).toBe("the dumpling place");
});

test("an adjustment with no week to adjust is refused", async () => {
  const d = deps();
  const out = await buildProposeMealsPlanTool(d).execute({
    adjustment: true,
    dishes: [],
    days: [{ day: 2, mode: "out" }],
  });
  expect(d.cards).toHaveLength(0);
  expect(String(typeof out === "string" ? out : out.text)).toContain("no week planned");
});

test("a category or shelf life the model invented falls back instead of throwing", () => {
  const dishes = toDishDrafts([
    {
      name: "x",
      searchName: "  Kelp Salad ",
      ingredients: [{ name: "kelp", en: "kelp", qty: "1", category: "seaweed", keeps: "forever" }],
    },
    { name: "y" },
  ]);
  expect(dishes[0]?.ingredients[0]).toMatchObject({ category: "other", keeps: "d3-5" });
  expect(dishes[0]?.handsOnMinutes).toBe(0);
  // The search name is filed the way the photo cache is keyed, not as written.
  expect(dishes[0]?.searchName).toBe("kelp salad");
  expect(dishes[1]?.searchName).toBe("");
});

test("a day with a mode nobody defined is dropped, not guessed at", () => {
  expect(toDayDrafts([{ day: 1, mode: "picnic" }, { day: 2, mode: "OUT" }])).toEqual([
    { day: 2, mode: "out" },
  ]);
  expect(toDayDrafts("not an array")).toEqual([]);
});
