// The photograph cache: the file (src/info/meals/photo-store.ts) and the pure
// half that reads it (src/info/meals/dish-photos.ts).
// Run: scripts/t.sh tests/info/meals

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
} from "../../../src/info/meals/dish-photos";
import type { DishPhoto } from "../../../src/info/meals/types";
import { mergeFile } from "../../../src/platform/sync/merge";

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

function meal(searchName = "mapo tofu") {
  return { searchName };
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

// The reader saying a picture is wrong (MealsState.photosAskedAt): it travels
// as a time, because the machine that searches is not the one they said it on.
test("an answer older than the reader's ask is asked again, and a newer one is not", () => {
  const now = 10 * PHOTO_MISS_RETRY_MS;
  expect(needsPhotoLookup(PHOTO, now, PHOTO.foundAt + 1)).toBe(true);
  expect(needsPhotoLookup(PHOTO, now, PHOTO.foundAt)).toBe(false);
  expect(needsPhotoLookup({ none: true, checkedAt: now - 1000 }, now, now)).toBe(true);
  // Never asked is the ordinary case, and it changes nothing.
  expect(needsPhotoLookup(PHOTO, now, 0)).toBe(false);
});

test("a meal and an ingredient read their own keys, and a miss is nothing", () => {
  const cache = { "dish:mapo tofu": PHOTO, "ingredient:kale": { none: true as const, checkedAt: 1 } };
  expect(photoForDish(meal(), cache)).toEqual(PHOTO);
  expect(photoForDish(meal("shakshuka"), cache)).toBeNull();
  expect(photoForDish({}, cache)).toBeNull();
  expect(photoForDish(null, cache)).toBeNull();
  expect(photoForIngredient("Kale", cache)).toBeNull();
  expect(photoForIngredient("bok choy", cache)).toBeNull();
});

// --- across devices ----------------------------------------------------------
//
// The run on the PC writes entries while the phone marks a dead picture broken,
// both against the copy they last synced. Sync merges the file per key against
// that copy (palace/kinds.ts), so neither device's edit undoes the other's.

const enc = new TextEncoder();
const dec = new TextDecoder();

/** Two devices that have both synced `seed`, and the bytes they agreed on. */
async function twoDevices(seed: Record<string, DishPhoto>) {
  const a = createFakeAppData();
  await savePhotoEntries(seed, a);
  const base = a.files.get(MEALS_PHOTOS_FILE) as string;
  const b = createFakeAppData();
  b.files.set(MEALS_PHOTOS_FILE, base);
  return { a, b, base };
}

/** The keys each device holds once it has merged the other's copy over the base. */
function synced(base: string, a: FakeAppData, b: FakeAppData): string[][] {
  const bytes = (d: FakeAppData) => enc.encode(d.files.get(MEALS_PHOTOS_FILE) as string);
  const keys = (local: FakeAppData, remote: FakeAppData) => {
    const out = mergeFile({
      path: MEALS_PHOTOS_FILE,
      base: enc.encode(base),
      local: bytes(local),
      remote: bytes(remote),
    });
    expect(out.copies).toEqual([]);
    const parsed = parsePhotoFile(JSON.parse(dec.decode(out.merged)));
    return Object.keys(parsed?.photos ?? {}).sort();
  };
  return [keys(a, b), keys(b, a)];
}

test("two devices that each found a photograph both keep both", async () => {
  const { a, b, base } = await twoDevices({ "dish:mapo tofu": PHOTO });
  await savePhotoEntries({ "dish:shakshuka": PHOTO }, a);
  await savePhotoEntries({ "ingredient:kale": { none: true, checkedAt: 5 } }, b);
  const all = ["dish:mapo tofu", "dish:shakshuka", "ingredient:kale"];
  expect(synced(base, a, b)).toEqual([all, all]);
});

// The other device writes the file too, just not that entry: a device that left
// the file alone would hand the merge nothing to decide.
test("a photograph one device dropped stays dropped while the other adds its own", async () => {
  const { a, b, base } = await twoDevices({ "dish:mapo tofu": PHOTO, "dish:shakshuka": PHOTO });
  await markDishPhotoBroken("mapo tofu", a);
  await savePhotoEntries({ "ingredient:kale": { none: true, checkedAt: 5 } }, b);
  const all = ["dish:shakshuka", "ingredient:kale"];
  expect(synced(base, a, b)).toEqual([all, all]);
});

test("a photograph one device dropped stays dropped when the other did nothing", async () => {
  const { a, b, base } = await twoDevices({ "dish:mapo tofu": PHOTO, "dish:shakshuka": PHOTO });
  await markDishPhotoBroken("mapo tofu", a);
  expect(synced(base, a, b)).toEqual([["dish:shakshuka"], ["dish:shakshuka"]]);
});
