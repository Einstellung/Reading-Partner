// The reader's own dishes (src/info/meals/dishes/user-dishes.ts): the intake
// check on the way in, and every reader of the library seeing the dish once it
// is held. The 2026-11-06 case: the salsa chicken copied as a diced chicken
// braised in a skillet, no pressure cooker, then put on the chicken pot.
// Run: scripts/t.sh tests/info/meals/dishes/user-dishes.test.ts

import { afterEach, expect, test } from "bun:test";
import { createFakeAppData } from "../../../support/guarded-appdata";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import type { Dish } from "../../../../src/info/meals/dishes/types";
import {
  holdUserDishes,
  loadUserDishes,
  MEALS_DISHES_FILE,
  parseUserDishFile,
  removeUserDish,
  saveUserDish,
  userDishes,
  writeUserDish,
  type UserDishIo,
} from "../../../../src/info/meals/dishes/user-dishes";
import { checkDraft } from "../../../../src/info/meals/planner/checks";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import { libraryListing } from "../../../../src/info/meals/planner/listing";
import { weekFromDraft } from "../../../../src/info/meals/planner/to-week";
import { prepStepsRequest } from "../../../../src/info/meals/recipe/prep-steps";
import { shopping } from "../fixtures/week";
import { goodDraft, PROFILE, START, START_WEEKDAY, targetsFor } from "../planner/fixture";

afterEach(() => holdUserDishes([]));

const ID = "skillet_braised_diced_chicken";

function dicedChicken(): Dish {
  const salsa = structuredClone(SEED_DISHES.find((d) => d.id === "salsa_shredded_chicken")!);
  return {
    ...salsa,
    id: ID,
    name: "鸡丁炒锅焖",
    nameEn: "Skillet-braised diced chicken",
    summary: "鸡胸肉切丁，与番茄碎、洋葱、青椒和墨西哥香料下炒锅焖 15 分钟",
    summaryEn: "Diced chicken breast with crushed tomato, onion, pepper and taco spice, braised 15 minutes in a skillet.",
    method: "braise",
    equipment: ["stove"],
    activeMin: 15,
    totalMin: 30,
    ways: salsa.ways!.map((w) => ({
      ...w,
      name: w.name.replace("手撕鸡", "鸡丁"),
      nameEn: w.nameEn.replace("Salsa chicken", "Diced chicken"),
    })),
  };
}

const io = () => createFakeAppData() as unknown as UserDishIo;

test("a dish copied from the salsa chicken, braised on the stove, is checked in, held and planned on the chicken pot", async () => {
  const disk = io();
  const saved = await saveUserDish(dicedChicken(), disk, Date.parse("2026-11-06T10:00:00Z"));
  if (!saved.ok) throw new Error(saved.problems.join("\n"));
  expect(saved.dish.origin).toBe("user");
  expect(userDishes().map((d) => d.id)).toEqual([ID]);
  expect(Object.keys((await loadUserDishes(disk)).dishes)).toEqual([ID]);

  // The library as every caller builds it, with no dishes passed.
  const lib = planLibrary(PROFILE);
  expect(lib.dish(ID)?.equipment).toEqual(["stove"]);
  expect(libraryListing(lib).some((l) => l.includes(`${ID} 鸡丁炒锅焖`))).toBe(true);

  const draft = goodDraft();
  draft.batches[0]!.dish = ID;
  // The chili brought the beans; a soy milk breakfast brings them now.
  draft.days[2]!.breakfast = "sweet_potato_egg_soy_milk";
  draft.days[2]!.fruit = ["orange", "apple"];
  const ctx = { profile: PROFILE, targets: targetsFor(PROFILE), startWeekday: START_WEEKDAY, people: PROFILE.people };
  const result = checkDraft(draft, ctx);
  expect(result.problems).toEqual([]);
  const pot = result.plan!.batches.find((b) => b.id === "chili")!;
  expect(pot.dish).toBe(ID);
  expect(pot.lines.find((l) => l.food === "chicken_breast")!.grams).toBeGreaterThan(0);

  const plan = weekFromDraft({ result, lib, start: START, now: 1, today: START, previous: null });
  const state = { charter: { profile: PROFILE, text: "", updatedAt: 1 }, plan, shopping: shopping(), deviations: [] };
  const request = prepStepsRequest(state, { today: START, region: "other", language: "zh-CN" });
  const asked = request!.pots.find((p) => p.dish === ID)!;
  expect(asked.equipment).toEqual(["stove"]);
  expect(asked.name).toBe("鸡丁炒锅焖");
  expect(asked.method).toContain("炒锅焖");
});

test("a dish the intake check refuses is not written, and a seed id is never the reader's", async () => {
  const disk = createFakeAppData();
  // Stir-fried is made at the meal, so it cannot be a batch pot.
  const refused = await saveUserDish({ ...dicedChicken(), method: "stir_fry" }, disk as unknown as UserDishIo);
  expect(refused.ok).toBe(false);
  if (!refused.ok) expect(refused.problems.join("\n")).toContain("only hands-off methods");
  expect(disk.files.has(MEALS_DISHES_FILE)).toBe(false);
  expect(userDishes()).toEqual([]);

  const seed = writeUserDish({}, { ...dicedChicken(), id: "salsa_shredded_chicken" }, "2026-11-06T00:00:00Z");
  expect(seed.ok).toBe(false);
  expect(removeUserDish({}, "salsa_shredded_chicken").ok).toBe(false);
});

test("changing a dish keeps when it was first written; removing it leaves the others", () => {
  const first = writeUserDish({}, dicedChicken(), "2026-11-06T00:00:00Z");
  if (!first.ok) throw new Error(first.problems.join("\n"));
  const changed = writeUserDish(first.dishes, { ...dicedChicken(), totalMin: 35 }, "2026-11-07T00:00:00Z");
  if (!changed.ok) throw new Error(changed.problems.join("\n"));
  expect(changed.dish.createdAt).toBe("2026-11-06T00:00:00Z");
  expect(changed.dish.totalMin).toBe(35);
  const removed = removeUserDish(changed.dishes, ID);
  expect(removed.ok && Object.keys(removed.dishes)).toEqual([]);
});

test("the file skips a record that names a seed id or does not read as a dish", () => {
  const parsed = parseUserDishFile({ dishes: { [ID]: dicedChicken(), salsa_shredded_chicken: SEED_DISHES[0], broken: { id: "broken" } } });
  expect(Object.keys(parsed!.dishes)).toEqual([ID]);
});
