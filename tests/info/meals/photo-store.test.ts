// The photograph cache: the file (src/info/meals/photo-store.ts) and the pure
// half that reads it (src/info/meals/dish-photos.ts).
// Run: scripts/t.sh tests/info/dinner

import { beforeEach, expect, test } from "bun:test";
import { createFakeAppData, type FakeAppData } from "../../support/guarded-appdata";
import {
  MEALS_PHOTOS_FILE,
  loadMealsPhotos,
  markDishPhotoBroken,
  parsePhotoFile,
  photoFileBody,
  savePhotoEntries,
} from "../../../src/info/meals/photo-store";
import {
  PHOTO_MISS_RETRY_MS,
  dishPhotoKey,
  ingredientPhotoKey,
  needsPhotoLookup,
  photoForDish,
  photoForIngredient,
  withDishPhotos,
} from "../../../src/info/meals/dish-photos";
import type { Dish, DishPhoto, WeekPlan } from "../../../src/info/meals/types";

let io: FakeAppData;

beforeEach(() => {
  io = createFakeAppData();
});

const PHOTO: DishPhoto = {
  url: "https://cdn.example/mapo.jpg",
  thumb: "https://ts3.mm.bing.net/th?id=1",
  pageUrl: "https://example.com/mapo",
  site: "example.com",
  foundAt: 1000,
};

function dish(over: Partial<Dish> = {}): Dish {
  return {
    id: "dish-a",
    name: "Mapo tofu",
    searchName: "mapo tofu",
    oneLine: "",
    base: "",
    fresh: "",
    keepsADay: false,
    handsOnMinutes: 10,
    ingredients: [],
    ...over,
  };
}

test("the keys say what was searched for", () => {
  expect(dishPhotoKey("  Mapo  Tofu ")).toBe("dish:mapo tofu");
  expect(ingredientPhotoKey("Bok Choy")).toBe("ingredient:bok choy");
  expect(dishPhotoKey("")).toBe("");
  expect(ingredientPhotoKey("   ")).toBe("");
});

test("a file body round-trips through the parser", () => {
  const state = { photos: { "dish:mapo tofu": PHOTO } };
  expect(parsePhotoFile(JSON.parse(photoFileBody(state)))).toEqual(state);
  expect(parsePhotoFile(7)).toBeNull();
  expect(parsePhotoFile({})).toEqual({ photos: {} });
});

test("no file is no photographs", async () => {
  expect(await loadMealsPhotos(io)).toEqual({});
});

test("what one search found is merged into what is already there", async () => {
  await savePhotoEntries({ "dish:mapo tofu": PHOTO }, io);
  await savePhotoEntries({ "ingredient:kale": { none: true, checkedAt: 5 } }, io);
  const cache = await loadMealsPhotos(io);
  expect(Object.keys(cache).sort()).toEqual(["dish:mapo tofu", "ingredient:kale"]);
  // Nothing to write is no write at all.
  const before = io.files.get(MEALS_PHOTOS_FILE);
  await savePhotoEntries({}, io);
  expect(io.files.get(MEALS_PHOTOS_FILE)).toBe(before);
});

// A picture the search found and the webview cannot load: dropped, so the next
// run asks again instead of loading the same dead URL every week.
test("a broken dish photograph is dropped from the cache", async () => {
  await savePhotoEntries({ "dish:mapo tofu": PHOTO, "dish:shakshuka": PHOTO }, io);
  const after = await markDishPhotoBroken("Mapo Tofu", io);
  expect(Object.keys(after)).toEqual(["dish:shakshuka"]);
  expect((await loadMealsPhotos(io))["dish:mapo tofu"]).toBeUndefined();
});

test("a name the cache never had is written nowhere", async () => {
  await savePhotoEntries({ "dish:mapo tofu": PHOTO }, io);
  const before = io.files.get(MEALS_PHOTOS_FILE);
  await markDishPhotoBroken("lentil soup", io);
  expect(io.files.get(MEALS_PHOTOS_FILE)).toBe(before);
});

test("a hit stands for good and a miss for thirty days", () => {
  const now = 10 * PHOTO_MISS_RETRY_MS;
  expect(needsPhotoLookup(undefined, now)).toBe(true);
  expect(needsPhotoLookup(PHOTO, now)).toBe(false);
  expect(needsPhotoLookup({ none: true, checkedAt: now - 1000 }, now)).toBe(false);
  expect(needsPhotoLookup({ none: true, checkedAt: now - PHOTO_MISS_RETRY_MS }, now)).toBe(true);
});

test("a dish and an ingredient read their own keys, and a miss is nothing", () => {
  const cache = { "dish:mapo tofu": PHOTO, "ingredient:kale": { none: true as const, checkedAt: 1 } };
  expect(photoForDish(dish(), cache)).toEqual(PHOTO);
  expect(photoForDish(dish({ searchName: "shakshuka" }), cache)).toBeNull();
  expect(photoForDish(null, cache)).toBeNull();
  expect(photoForIngredient("Kale", cache)).toBeNull();
  expect(photoForIngredient("bok choy", cache)).toBeNull();
});

test("a week takes the pictures the cache has and keeps the ones it has not", () => {
  const plan = {
    id: "week-2026-09-21",
    startDate: "2026-09-21",
    days: [],
    breakfastLine: "",
    dishes: [dish(), dish({ id: "dish-b", searchName: "shakshuka", image: "app/old.png" })],
    createdAt: 0,
    revision: 1,
  } satisfies WeekPlan;
  const after = withDishPhotos(plan, { "dish:mapo tofu": PHOTO });
  expect(after.dishes[0]?.image).toBe(PHOTO.url);
  expect(after.dishes[1]?.image).toBe("app/old.png");
  // Nothing to change is the same object, so nothing writes.
  expect(withDishPhotos(after, { "dish:mapo tofu": PHOTO })).toBe(after);
  expect(withDishPhotos(plan, {})).toBe(plan);
});
