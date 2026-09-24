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
  saveMealMethod,
  savePhotosAsked,
  savePlan,
  saveShopping,
} from "../../../src/info/meals/store";
import {
  EMPTY_MEALS,
  EMPTY_SHOPPING,
  MEALS_VERSION,
  type ShoppingItem,
  type ShoppingState,
  type WeekPlan,
} from "../../../src/info/meals/types";
import { addReaderItem, setShoppingChecked } from "../../../src/info/meals/shopping";
import { charter, profile, shopping as trip, week as fixtureWeek } from "./fixtures/week";

const ASIDE = `${MEALS_FILE}${CORRUPT_SUFFIX}`;

let io: FakeAppData;

beforeEach(() => {
  io = createFakeAppData();
});

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
  await saveCharter(charter(), null, io);
  expect((io.json(MEALS_FILE) as { version: number }).version).toBe(MEALS_VERSION);
  const back = await loadMeals(io);
  expect(back.charter?.profile).toEqual(profile());
  expect(back.charter?.text).toContain("Lunch is at my desk");
  expect(back.plan).toBeNull();
});

test("a charter saved with its re-solved week writes all three in one write", async () => {
  await savePlan(plan(), list("lettuce"), io);
  await saveCharter(charter({ weightKg: 58 }), { plan: plan({ revision: 2 }), shopping: list("rocket") }, io);
  const state = await loadMeals(io);
  expect(state.charter?.profile.weightKg).toBe(58);
  expect(state.plan?.revision).toBe(2);
  expect(state.shopping.items.map((i) => i.name)).toEqual(["rocket"]);
});

test("the week and the trip derived from it land in one write", async () => {
  await savePlan(plan(), list("lettuce"), io);
  const state = await loadMeals(io);
  expect(state.plan?.id).toBe("week-2026-09-21");
  expect(state.plan?.days[0]?.lunch.solved?.length).toBeGreaterThan(0);
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

test("a method line is written onto the made meal, and nowhere when the meal is not made", async () => {
  await savePlan(plan(), list(), io);
  await saveMealMethod("2026-09-21", "lunch", "Microwave the rice, toss the shrimp in the pan.", io);
  const state = await loadMeals(io);
  expect(state.plan?.days[0]?.lunch.method).toBe("Microwave the rice, toss the shrimp in the pan.");
  // Wednesday's dinner is a delivery, and a date past the week is no meal.
  await saveMealMethod("2026-09-23", "dinner", "Nothing.", io);
  await saveMealMethod("2026-10-01", "lunch", "Nothing.", io);
  const after = await loadMeals(io);
  expect(after.plan?.days[2]?.dinner.method).toBeUndefined();
  expect(after.plan?.days.some((d) => d.lunch.method === "Nothing.")).toBe(false);
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
  await expect(saveCharter(charter(), null, io)).rejects.toThrow("could not be read");
  io.readFails = false;
  // The week is still there: the failed save wrote nothing.
  expect((await loadMeals(io)).shopping.items.map((i) => i.name)).toEqual(["lettuce"]);
});

test("a file of the old schema reads as empty apart from the photo ask, and stays on disk", async () => {
  const old = {
    version: 1,
    charter: { people: 2, text: "two of us", updatedAt: 1 },
    plan: { id: "week-2026-09-14", startDate: "2026-09-14", days: [], dishes: [], breakfastLine: "", revision: 4 },
    shopping: { items: [{ name: "kale", category: "produce" }] },
    deviations: [{ date: "2026-09-14", meal: "dinner", said: "ordered in" }],
    photosAskedAt: 42,
  };
  const body = JSON.stringify(old);
  io.files.set(MEALS_FILE, body);
  expect(await loadMeals(io)).toEqual({ ...EMPTY_MEALS, shopping: { ...EMPTY_SHOPPING }, photosAskedAt: 42 });
  // Not quarantined, not rewritten: left as it is until the next write replaces it.
  expect(io.files.get(MEALS_FILE)).toBe(body);
  expect(io.files.has(ASIDE)).toBe(false);
  expect(io.reports).toHaveLength(0);
  // No version at all is the oldest schema.
  expect(parseMealsFile({ charter: old.charter })).toEqual({ ...EMPTY_MEALS, shopping: { ...EMPTY_SHOPPING } });

  // The first write is the new schema, and the photo ask rides through it.
  await savePhotosAsked(50, io);
  const now = io.json(MEALS_FILE) as { version: number; photosAskedAt: number; plan: unknown };
  expect(now.version).toBe(MEALS_VERSION);
  expect(now.photosAskedAt).toBe(50);
  expect(now.plan).toBeNull();
});

test("a half-understood file keeps what this build can read and drops what it cannot", () => {
  const parsed = parseMealsFile({
    version: MEALS_VERSION,
    charter: { profile: { goal: "cut" }, text: "ours" },
    plan: { id: "w", startDate: "2026-09-21", days: [{ date: "2026-09-21", breakfast: { mode: "skip" } }], revision: 0 },
    shopping: { items: [{ name: "lettuce", category: "produce" }, { nope: true }] },
    deviations: [{ date: "2026-09-21", meal: "dinner", said: "ordered in" }, 7],
  });
  // A profile missing its body data is no profile, and a day missing a meal is no plan.
  expect(parsed?.charter).toBeNull();
  expect(parsed?.plan).toBeNull();
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

