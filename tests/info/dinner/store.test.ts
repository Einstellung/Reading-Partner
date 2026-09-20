// The dinner file on disk (src/info/dinner/store.ts), against the in-memory
// AppData from tests/support/guarded-appdata.ts.
//
// The guarded read matters here for the reason it matters to the lab file:
// every write is load-modify-save, and all of it — the charter, the week, the
// ticks — was authored in conversation and cannot be rebuilt. A read that
// failed must not become the file that gets written.
// Run: scripts/t.sh tests/info/dinner

import { beforeEach, expect, test } from "bun:test";
import { CORRUPT_SUFFIX, createFakeAppData, type FakeAppData } from "../../support/guarded-appdata";
import {
  DINNER_FILE,
  dinnerFileBody,
  loadDinner,
  parseDinnerFile,
  saveCharter,
  saveDeviation,
  savePlan,
  saveShopping,
} from "../../../src/info/dinner/store";
import { EMPTY_DINNER, type DinnerCharter, type ShoppingItem, type WeekPlan } from "../../../src/info/dinner/types";

const ASIDE = `${DINNER_FILE}${CORRUPT_SUFFIX}`;

let io: FakeAppData;

beforeEach(() => {
  io = createFakeAppData();
});

function charter(over: Partial<DinnerCharter> = {}): DinnerCharter {
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
  return {
    id: "week-2026-09-21",
    startDate: "2026-09-21",
    days: [{ date: "2026-09-21", mode: "cook", dishId: "dish-a" }],
    dishes: [],
    createdAt: 1,
    revision: 1,
    ...over,
  };
}

function item(name: string, checked = false): ShoppingItem {
  return {
    name,
    en: "",
    qty: "1",
    category: "produce",
    keeps: "d3-5",
    freezeOnArrival: false,
    checked,
    neededBy: "2026-09-21",
  };
}

test("no file is an empty week, and nothing is written on the reader's behalf", async () => {
  expect(await loadDinner(io)).toEqual(EMPTY_DINNER);
  expect(io.files.has(DINNER_FILE)).toBe(false);
});

test("the charter lands in the file with the version on it, and reads back", async () => {
  await saveCharter(charter(), io);
  expect((io.json(DINNER_FILE) as { version: number }).version).toBe(1);
  expect((await loadDinner(io)).charter?.text).toContain("two of us");
});

test("the week and the list it was derived from land in one write", async () => {
  await savePlan(plan(), [item("lettuce")], io);
  const state = await loadDinner(io);
  expect(state.plan?.id).toBe("week-2026-09-21");
  expect(state.shopping.map((i) => i.name)).toEqual(["lettuce"]);
});

test("ticking a line off leaves the week alone", async () => {
  await savePlan(plan(), [item("lettuce")], io);
  await saveShopping([item("lettuce", true)], io);
  const state = await loadDinner(io);
  expect(state.shopping[0]?.checked).toBe(true);
  expect(state.plan?.revision).toBe(1);
});

test("a deviation is appended; the ones before it stay", async () => {
  await savePlan(plan(), [], io);
  const said = {
    date: "2026-09-21",
    said: "ordered in",
    became: "delivery" as const,
    changed: "nothing else moved",
    at: 1,
  };
  await saveDeviation(said, plan({ revision: 2 }), [], io);
  await saveDeviation({ ...said, date: "2026-09-22" }, plan({ revision: 3 }), [], io);
  const state = await loadDinner(io);
  expect(state.deviations.map((d) => d.date)).toEqual(["2026-09-21", "2026-09-22"]);
  expect(state.plan?.revision).toBe(3);
});

test("bytes of the wrong shape are moved aside and reported, and the reader starts empty", async () => {
  io.files.set(DINNER_FILE, "{ not json");
  expect(await loadDinner(io)).toEqual(EMPTY_DINNER);
  expect(io.files.has(ASIDE)).toBe(true);
  expect(io.reports).toHaveLength(1);
});

test("a file that cannot be read at all raises rather than being written over", async () => {
  await savePlan(plan(), [item("lettuce")], io);
  io.readFails = true;
  await expect(loadDinner(io)).rejects.toThrow("could not be read");
  await expect(saveCharter(charter(), io)).rejects.toThrow("could not be read");
  io.readFails = false;
  // The week is still there: the failed save wrote nothing.
  expect((await loadDinner(io)).shopping.map((i) => i.name)).toEqual(["lettuce"]);
});

test("a half-understood file keeps what this build can read and drops what it cannot", () => {
  const parsed = parseDinnerFile({
    charter: { people: 2, text: "ours" },
    plan: { id: "w", startDate: "2026-09-21", days: [], dishes: [], revision: 0 },
    shopping: [{ name: "lettuce", category: "produce" }, { nope: true }],
    deviations: [{ date: "2026-09-21", said: "ordered in" }, 7],
  });
  expect(parsed?.shopping).toHaveLength(1);
  expect(parsed?.deviations).toHaveLength(1);
  expect(parseDinnerFile("not an object")).toBeNull();
});

test("a file body round-trips through the parser", () => {
  const state = { charter: charter(), plan: plan(), shopping: [item("lettuce")], deviations: [] };
  expect(parseDinnerFile(JSON.parse(dinnerFileBody(state)))).toEqual(state);
});
