// The meals file on disk (src/info/meals/store.ts), against the in-memory
// AppData from tests/support/guarded-appdata.ts.
//
// The guarded read matters here for the reason it matters to the lab file:
// every write is load-modify-save, and all of it — the charter, the week, the
// ticks — was authored in conversation and cannot be rebuilt. A read that
// failed must not become the file that gets written.
// Run: scripts/t.sh tests/info/meals

import { beforeEach, expect, test } from "bun:test";
import { CORRUPT_SUFFIX, createFakeAppData, type FakeAppData } from "../../support/guarded-appdata";
import {
  MEALS_FILE,
  mealsFileBody,
  loadMeals,
  parseMealsFile,
  saveCharter,
  saveDeviation,
  saveDishMethod,
  savePlan,
  saveShopping,
} from "../../../src/info/meals/store";
import {
  EMPTY_MEALS,
  EMPTY_SHOPPING,
  type MealsCharter,
  type ShoppingItem,
  type ShoppingState,
  type WeekPlan,
} from "../../../src/info/meals/types";
import { addReaderItem, setShoppingChecked } from "../../../src/info/meals/shopping";
import { shopping as trip, week as fixtureWeek } from "./fixtures/week";

const ASIDE = `${MEALS_FILE}${CORRUPT_SUFFIX}`;

let io: FakeAppData;

beforeEach(() => {
  io = createFakeAppData();
});

function charter(over: Partial<MealsCharter> = {}): MealsCharter {
  return {
    people: 2,
    stores: ["the market downstairs"],
    kitchen: "two burners, no oven",
    dislikes: ["coriander"],
    nightsCooking: 4,
    nightsOut: 1,
    nightsDelivery: 2,
    text: "two of us, cooking most nights, nothing that takes an oven",
    updatedAt: 10,
    ...over,
  };
}

function plan(over: Partial<WeekPlan> = {}): WeekPlan {
  return { ...fixtureWeek(), ...over };
}

function item(name: string): ShoppingItem {
  return {
    name,
    en: "",
    qty: "1",
    category: "produce",
    keeps: "d3-5",
    freezeOnArrival: false,
    neededBy: "2026-09-21",
  };
}

function list(...names: string[]): ShoppingState {
  return trip({ items: names.map(item) });
}

test("no file is an empty week, and nothing is written on the reader's behalf", async () => {
  expect(await loadMeals(io)).toEqual({ ...EMPTY_MEALS, shopping: { ...EMPTY_SHOPPING } });
  expect(io.files.has(MEALS_FILE)).toBe(false);
});

test("the charter lands in the file with the version on it, and reads back", async () => {
  await saveCharter(charter(), io);
  expect((io.json(MEALS_FILE) as { version: number }).version).toBe(1);
  expect((await loadMeals(io)).charter?.text).toContain("two of us");
});

test("the week and the trip derived from it land in one write", async () => {
  await savePlan(plan(), list("lettuce"), io);
  const state = await loadMeals(io);
  expect(state.plan?.id).toBe("week-2026-09-21");
  expect(state.plan?.breakfastLine).toContain("Oats most days");
  expect(state.shopping.items.map((i) => i.name)).toEqual(["lettuce"]);
});

test("ticking a line off, and adding one of their own, leaves the week alone", async () => {
  await savePlan(plan(), list("lettuce"), io);
  let next = setShoppingChecked((await loadMeals(io)).shopping, "produce\u0000lettuce", true);
  next = addReaderItem(next, item("washing up liquid"));
  await saveShopping(next, io);
  const state = await loadMeals(io);
  expect(state.shopping.checked).toEqual({ "produce\u0000lettuce": true });
  expect(state.shopping.reader[0]?.source).toBe("reader");
  expect(state.plan?.revision).toBe(1);
});

test("a method is written onto the dish in the week, and nowhere when the week has moved on", async () => {
  await savePlan(plan(), list(), io);
  await saveDishMethod("dish-stew", { steps: ["Simmer."], writtenAt: 3 }, io);
  const state = await loadMeals(io);
  expect(state.plan?.dishes.find((d) => d.id === "dish-stew")?.method?.steps).toEqual(["Simmer."]);
  await saveDishMethod("dish-gone", { steps: ["Nothing."], writtenAt: 4 }, io);
  const after = await loadMeals(io);
  expect(after.plan?.dishes.some((d) => d.method?.steps[0] === "Nothing.")).toBe(false);
});

test("a deviation is appended; the ones before it stay", async () => {
  await savePlan(plan(), list(), io);
  const said = {
    date: "2026-09-21",
    meal: "dinner" as const,
    said: "ordered in",
    became: "delivery" as const,
    changed: "nothing else moved",
    at: 1,
  };
  await saveDeviation(said, plan({ revision: 2 }), list(), io);
  await saveDeviation({ ...said, date: "2026-09-22" }, plan({ revision: 3 }), list(), io);
  const state = await loadMeals(io);
  expect(state.deviations.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22"]);
  expect(state.plan?.revision).toBe(3);
});

test("bytes of the wrong shape are moved aside and reported, and the reader starts empty", async () => {
  io.files.set(MEALS_FILE, "{ not json");
  expect(await loadMeals(io)).toEqual({ ...EMPTY_MEALS, shopping: { ...EMPTY_SHOPPING } });
  expect(io.files.has(ASIDE)).toBe(true);
  expect(io.reports).toHaveLength(1);
});

test("a file that cannot be read at all raises rather than being written over", async () => {
  await savePlan(plan(), list("lettuce"), io);
  io.readFails = true;
  await expect(loadMeals(io)).rejects.toThrow("could not be read");
  await expect(saveCharter(charter(), io)).rejects.toThrow("could not be read");
  io.readFails = false;
  // The week is still there: the failed save wrote nothing.
  expect((await loadMeals(io)).shopping.items.map((i) => i.name)).toEqual(["lettuce"]);
});

test("a half-understood file keeps what this build can read and drops what it cannot", () => {
  const parsed = parseMealsFile({
    charter: { people: 2, text: "ours" },
    plan: { id: "w", startDate: "2026-09-21", days: [], dishes: [], revision: 0 },
    shopping: { items: [{ name: "lettuce", category: "produce" }, { nope: true }] },
    deviations: [{ date: "2026-09-21", meal: "dinner", said: "ordered in" }, 7],
  });
  expect(parsed?.shopping.items).toHaveLength(1);
  // A trip written before one of its halves existed keeps the halves it has.
  expect(parsed?.shopping.doneOn).toBeNull();
  expect(parsed?.deviations).toHaveLength(1);
  expect(parseMealsFile("not an object")).toBeNull();
});

test("a file body round-trips through the parser", () => {
  const state = {
    charter: charter(),
    plan: plan(),
    shopping: list("lettuce"),
    deviations: [],
  };
  expect(parseMealsFile(JSON.parse(mealsFileBody(state)))).toEqual(state);
});

