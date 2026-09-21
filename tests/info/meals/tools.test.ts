// The meals desk's tools (src/info/meals/tools.ts): what the instruction tells
// the model, what the planning tool refuses, and what the three shopping tools
// and the method tool write.
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  buildAddShoppingItemsTool,
  buildProposeMealsCharterTool,
  buildProposeMealsPlanTool,
  buildRemoveShoppingItemTool,
  buildReplaceShoppingItemTool,
  buildWriteMethodTool,
  markShoppingTripDone,
  mealsGuidance,
  toDayDrafts,
  toDishDrafts,
  type MealsToolDeps,
} from "../../../src/info/meals/tools";
import type { MealsPorts } from "../../../src/info/meals/apply";
import type { MealsCard, MealsPlanCardData } from "../../../src/info/meals/cards";
import { currentList, deriveShoppingList } from "../../../src/info/meals/shopping";
import {
  EMPTY_MEALS,
  type DishMethod,
  type MealsState,
  type ShoppingState,
} from "../../../src/info/meals/types";
import { MON, shopping, state, week } from "./fixtures/week";

function deps(current: MealsState): MealsToolDeps & { cards: MealsCard[] } {
  const cards: MealsCard[] = [];
  return {
    cards,
    threadId: "meals",
    state: async () => current,
    today: () => MON,
    now: () => 5,
    onMealsCard: (card) => cards.push(card),
    random: () => 0,
  };
}

function ports(current: MealsState): MealsPorts & { written: ShoppingState[]; methods: DishMethod[] } {
  const p = {
    written: [] as ShoppingState[],
    methods: [] as DishMethod[],
    current: async () => current,
    saveCharter: async () => {},
    savePlan: async () => {},
    saveShopping: async (list: ShoppingState) => {
      p.written.push(list);
      current.shopping = list;
    },
    saveDeviation: async () => {},
    saveDishMethod: async (_id: string, method: DishMethod) => {
      p.methods.push(method);
    },
    now: () => 5,
    today: () => MON,
    changed: () => {},
  };
  return p;
}

/** A tool answers with a string or a result carrying one. */
function said(out: string | { text?: unknown }): string {
  return typeof out === "string" ? out : String(out.text);
}

const LINE = {
  name: "washing up liquid",
  en: "washing up liquid",
  qty: "one bottle",
  category: "other",
  keeps: "pantry",
};

test("the instruction prints all three meals of every day and the breakfast line", () => {
  const text = mealsGuidance(state(), MON);
  expect(text).toContain("Breakfasts this week: Oats most days");
  expect(text).toContain("breakfast: cook Overnight oats");
  expect(text).toContain("carry Chickpea stew (last week's box)");
  expect(text).toContain("<- today");
  expect(text).toContain("They are looking at the week.");
  expect(text).toContain("Never count calories");
});

test("the focus says what the reader has open", () => {
  const withMethod = state();
  withMethod.plan!.dishes[1]!.method = { steps: ["Simmer."], writtenAt: 1 };
  const day = mealsGuidance(withMethod, MON, { focus: { kind: "day", date: MON } });
  expect(day).toContain("They are looking at 2026-09-21:");
  expect(day).toContain("- lunch: carry Chickpea stew");
  expect(day).toContain("The steps for Chickpea stew are already written");

  const list = shopping({ items: deriveShoppingList(week(), MON) });
  const open = mealsGuidance(state({ shopping: list }), MON, { focus: { kind: "shopping" } });
  expect(open).toContain("5 lines, 5 not ticked off");
  expect(open).toContain("has not been done yet");

  const done = mealsGuidance(
    state({ shopping: { ...list, doneOn: MON } }),
    MON,
    { focus: { kind: "shopping" } });
  expect(done).toContain("was done on 2026-09-21");
});

test("a fresh week is refused until it is seven days, three meals and a breakfast line", async () => {
  const d = deps({ ...EMPTY_MEALS, shopping: shopping() });
  const tool = buildProposeMealsPlanTool(d);
  const full = Array.from({ length: 7 }, (_, i) => ({
    day: i + 1,
    breakfast: { mode: "out", place: "cafe" },
    lunch: { mode: "out", place: "canteen" },
    dinner: { mode: "out", place: "out" },
  }));

  const short = await tool.execute({ adjustment: false, dishes: [], days: full.slice(0, 3) });
  expect(said(short)).toContain("needs all 7 days");

  const thin = await tool.execute(
    {
      adjustment: false,
      dishes: [],
      days: full.map((d, i) => (i === 2 ? { day: 3, dinner: d.dinner } : d)),
    });
  expect(said(thin)).toContain("breakfast, lunch and dinner on every day");

  const noLine = await tool.execute({ adjustment: false, dishes: [], days: full });
  expect(said(noLine)).toContain("needs breakfastLine");
  expect(d.cards).toEqual([]);
});

test("a clean week drafts a card and writes nothing", async () => {
  const d = deps({ ...EMPTY_MEALS, shopping: shopping() });
  const out = await buildProposeMealsPlanTool(d).execute(
    {
      adjustment: false,
      breakfastLine: "Oats",
      dishes: [
        {
          name: "Oats",
          searchName: "overnight oats",
          oneLine: "soaked",
          base: "oats",
          fresh: "",
          keepsADay: true,
          handsOnMinutes: 3,
          ingredients: [{ name: "oats", en: "Oats", qty: "1 bag", category: "grains", keeps: "pantry" }],
        },
      ],
      days: Array.from({ length: 7 }, (_, i) => ({
        day: i + 1,
        breakfast: { mode: "cook", dish: "Oats" },
        lunch: { mode: "out", place: "canteen" },
        dinner: { mode: "delivery", place: "the usual place" },
      })),
    });
  expect(said(out)).toContain("Proposed the week's meals");
  const card = d.cards[0] as MealsPlanCardData;
  expect(card.kind).toBe("meals-plan");
  expect(card.breakfastLine).toBe("Oats");
  expect(card.days[0]!.breakfast.mode).toBe("cook");
});

test("an adjustment with no week to adjust is refused", async () => {
  const d = deps({ ...EMPTY_MEALS, shopping: shopping() });
  const out = await buildProposeMealsPlanTool(d).execute(
    { adjustment: true, dishes: [], days: [{ day: 1, lunch: { mode: "out" } }] });
  expect(said(out)).toContain("no week planned yet");
});

test("the charter tool drafts the paragraph in their words", async () => {
  const d = deps({ ...EMPTY_MEALS, shopping: shopping() });
  await buildProposeMealsCharterTool(d).execute(
    {
      people: 2,
      stores: ["the market", ""],
      kitchen: "one pan",
      dislikes: ["celery"],
      nightsCooking: 4,
      nightsOut: 1,
      nightsDelivery: 1,
      text: "Two of us.",
    });
  expect(d.cards[0]).toMatchObject({ kind: "meals-charter", stores: ["the market"], text: "Two of us." });
});

test("before the trip is done, a line the reader asked for is added", async () => {
  const current = state({ shopping: shopping({ items: deriveShoppingList(week(), MON) }) });
  const p = ports(current);
  const out = await buildAddShoppingItemsTool({ ...deps(current), ports: p }).execute(
    { items: [LINE] });
  expect(said(out)).toContain("Added washing up liquid");
  expect(p.written[0]!.reader[0]!.source).toBe("reader");
  expect(p.written[0]!.reader[0]!.afterDone).toBeUndefined();
});

test("after Done the tool writes nothing and says it goes on next week's list", async () => {
  const current = state({ shopping: shopping({ doneOn: MON }) });
  const p = ports(current);
  const out = await buildAddShoppingItemsTool({ ...deps(current), ports: p }).execute(
    { items: [LINE] });
  expect(said(out)).toContain("next week's list");
  expect(p.written).toEqual([]);

  const passing = await buildAddShoppingItemsTool({ ...deps(current), ports: p }).execute(
    { items: [LINE], today: true });
  expect(said(passing)).toContain("still to get");
  expect(p.written[0]!.reader[0]!.afterDone).toBe(true);
});

test("remove and replace work on the list as it reads, and refuse a name that is not on it", async () => {
  const current = state({ shopping: shopping({ items: deriveShoppingList(week(), MON) }) });
  const p = ports(current);
  const d = { ...deps(current), ports: p };

  const swapped = await buildReplaceShoppingItemTool(d).execute(
    { from: "kale", to: "spring onions", en: "Spring Onions", qty: "" });
  expect(said(swapped)).toContain("kale is now spring onions");
  expect(currentList(p.written[0]!).some((i) => i.name === "spring onions")).toBe(true);

  const gone = await buildRemoveShoppingItemTool(d).execute({ name: "spring onions" });
  expect(said(gone)).toContain("off the list");

  const missing = await buildRemoveShoppingItemTool(d).execute({ name: "durian" });
  expect(said(missing)).toContain("nothing changed");
});

test("the method tool rewrites the steps, and refuses a dish or a shape it cannot", async () => {
  const current = state();
  const p = ports(current);
  const d = { ...deps(current), ports: p };

  const ok = await buildWriteMethodTool(d).execute(
    { dishId: "dish-stew", steps: ["Fry the onion.", "Simmer."], note: "One pan." });
  expect(said(ok)).toContain("Chickpea stew");
  expect(p.methods[0]).toEqual({ steps: ["Fry the onion.", "Simmer."], writtenAt: 5, note: "One pan." });

  const nowhere = await buildWriteMethodTool(d).execute({ dishId: "dish-x", steps: ["a"] });
  expect(said(nowhere)).toContain("not in the week");

  const empty = await buildWriteMethodTool(d).execute({ dishId: "dish-stew", steps: [] });
  expect(said(empty)).toContain("between 1 and 10");

  const long = await buildWriteMethodTool(d).execute(
    { dishId: "dish-stew", steps: ["x".repeat(201)] });
  expect(said(long)).toContain("not a paragraph");
  expect(p.methods).toHaveLength(1);
});

test("the trip is called done by the host", async () => {
  const current = state({ shopping: shopping({ items: deriveShoppingList(week(), MON) }) });
  const p = ports(current);
  expect(await markShoppingTripDone(p, MON)).toBe(true);
  expect(p.written[0]!.doneOn).toBe(MON);
});

test("what the model sent is read defensively", () => {
  expect(toDishDrafts("nonsense")).toEqual([]);
  expect(toDishDrafts([{ name: "  " }])).toEqual([]);
  const days = toDayDrafts([
    { day: 2, breakfast: { mode: "cook", dish: "Oats" }, lunch: { mode: "nonsense" }, dinner: { mode: "packed", reheatOf: { day: 1, meal: "dinner" }, note: "box" } },
  ]);
  expect(days[0]!.lunch).toBeUndefined();
  expect(days[0]!.dinner!.reheatOf).toEqual({ day: 1, meal: "dinner" });
  expect(days[0]!.dinner!.note).toBe("box");
});
