// The library's dish pictures: which picture a meal shows
// (src/info/meals/photos/dish-art.ts) and how this device gets it
// (src/info/meals/photos/dish-art-store.ts).
// Run: scripts/t.sh tests/info/meals

import { expect, test } from "bun:test";
import {
  DISH_ART_TAG,
  dishArtByName,
  dishArtId,
  dishArtPath,
  dishArtUrl,
  weekArtIds,
  withDishArt,
} from "../../../../src/info/meals/photos/dish-art";
import { DISH_ART_IDS } from "../../../../src/info/meals/photos/dish-art-ids";
import { createDishArtStore, type DishArtIo } from "../../../../src/info/meals/photos/dish-art-store";
import { dishesToDraw } from "../../../../src/info/meals/photos/dish-drawing";
import { dishPicture } from "../../../../src/info/meals/screen/view";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import type { Meal, WeekPlan } from "../../../../src/info/meals/plan/types";
import { week } from "../fixtures/week";

const seed = (id: string) => {
  const d = SEED_DISHES.find((x) => x.id === id);
  if (!d) throw new Error(`no seed dish ${id}`);
  return d;
};

const made = (searchName: string): Meal => ({ mode: "make", name: searchName, searchName: searchName.toLowerCase() });

// --- which picture --------------------------------------------------------------

test("every published picture is reachable from exactly one library meal", () => {
  const byName = dishArtByName();
  expect(byName.size).toBe(DISH_ART_IDS.length);
  expect(new Set(byName.values())).toEqual(new Set(DISH_ART_IDS));
});

test("a way of a batch main shows that way's picture, a fresh main and a breakfast their own", () => {
  const chili = seed("chicken_bean_chili");
  const second = chili.ways?.[1];
  expect(second).toBeDefined();
  expect(dishArtId(second?.nameEn.toLowerCase())).toBe(`chicken_bean_chili--w2-${second?.staple ?? "plain"}`);

  const salad = seed("steak_spinach_salad");
  expect(dishArtId(salad.nameEn.toLowerCase())).toBe(`steak_spinach_salad--${salad.staples[0]}`);

  expect(dishArtId(seed("milk_toast_boiled_egg").nameEn.toLowerCase())).toBe("milk_toast_boiled_egg--breakfast");

  // Spacing and case are the cache key's, not the name's.
  expect(dishArtId(`  ${salad.nameEn.toUpperCase()} `)).toBe(`steak_spinach_salad--${salad.staples[0]}`);
  // A name the library does not have, which is also what a swapped food's renamed dish is.
  expect(dishArtId("shrimp rice bowl")).toBeNull();
  expect(dishArtId(undefined)).toBeNull();
});

test("an id the release does not carry is left out, so the meal shows what it showed before", () => {
  const chili = seed("chicken_bean_chili");
  const byName = dishArtByName([chili], ["chicken_bean_chili--w1-brown_rice"]);
  expect([...byName.values()]).toEqual(["chicken_bean_chili--w1-brown_rice"]);
});

test("the picture lives at the release under its tag, and on disk under the tag too", () => {
  expect(dishArtUrl("beef_ragu--w1-pasta")).toBe(
    `https://github.com/Einstellung/Reading-Partner/releases/download/${DISH_ART_TAG}/beef_ragu--w1-pasta.webp`,
  );
  expect(dishArtPath("beef_ragu--w1-pasta")).toBe(`meals-art/${DISH_ART_TAG}/beef_ragu--w1-pasta.webp`);
});

function planWithLibraryMeals(): { plan: WeekPlan; wayName: string; freshName: string; wayId: string; freshId: string } {
  const chili = seed("chicken_bean_chili");
  const way = chili.ways?.[0];
  const salad = seed("steak_spinach_salad");
  const plan = week();
  const [d0, d1] = plan.days;
  if (!d0 || !d1 || !way) throw new Error("fixture");
  const days = [
    { ...d0, lunch: made(way.nameEn), dinner: made(salad.nameEn) },
    // The same way again on the next day: one picture.
    { ...d1, lunch: made(way.nameEn), dinner: { mode: "out" as const, place: "canteen" } },
    ...plan.days.slice(2),
  ];
  return {
    plan: { ...plan, days },
    wayName: way.nameEn,
    freshName: salad.nameEn,
    wayId: `chicken_bean_chili--w1-${way.staple ?? "plain"}`,
    freshId: `steak_spinach_salad--${salad.staples[0]}`,
  };
}

test("the week asks for each of its made meals' pictures once", () => {
  const { plan, wayId, freshId } = planWithLibraryMeals();
  expect(weekArtIds(plan)).toEqual([wayId, freshId]);
  expect(weekArtIds(null)).toEqual([]);
});

test("a read picture is what the card shows, over a drawing; one not read yet leaves the drawing", () => {
  const { plan, wayName, freshName, wayId } = planWithLibraryMeals();
  const drawn = { drawing: "meals-pictures/a.jpg", drawnAt: 1, src: "data:image/jpeg;base64,AAAA" };
  const cache = { [`drawing:${freshName.toLowerCase()}`]: drawn };
  const shown = withDishArt(cache, plan, { [wayId]: "data:image/webp;base64,UklG" });
  expect(dishPicture(made(wayName), shown)?.url).toBe("data:image/webp;base64,UklG");
  expect(dishPicture(made(freshName), shown)?.url).toBe(drawn.src);
  // The cache handed in is not touched: the file never sees a library picture.
  expect(Object.keys(cache)).toEqual([`drawing:${freshName.toLowerCase()}`]);
});

test("a meal the library has a picture of is never sent to the image model", () => {
  const { plan, wayName, freshName } = planWithLibraryMeals();
  const keys = dishesToDraw(plan, {}, 1).map((d) => d.key);
  expect(keys).not.toContain(`drawing:${wayName.toLowerCase()}`);
  expect(keys).not.toContain(`drawing:${freshName.toLowerCase()}`);
  expect(keys.length).toBeGreaterThan(0);
});

// --- on this device -------------------------------------------------------------

function memoryArt() {
  const files = new Map<string, Uint8Array>();
  const io: DishArtIo = {
    exists: async (path) => files.has(path),
    readBytes: async (path) => {
      const bytes = files.get(path);
      if (!bytes) throw new Error(`no file ${path}`);
      return bytes;
    },
    writeBytes: async (path, bytes) => {
      files.set(path, bytes);
    },
    mkdirp: async () => {},
  };
  return { files, io };
}

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46]);

test("a picture is downloaded once, kept under its tag, and read from disk after", async () => {
  const disk = memoryArt();
  const asked: string[] = [];
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const store = createDishArtStore({
    io: disk.io,
    fetchBytes: async (url) => {
      asked.push(url);
      await gate;
      return WEBP;
    },
  });
  const id = "beef_ragu--w1-pasta";
  expect(await store.cached([id])).toEqual({});
  // Two reloads asking at once share one download.
  const first = store.download([id]);
  const second = store.download([id]);
  release();
  expect(await first).toEqual({ [id]: "data:image/webp;base64,UklGRg==" });
  expect(await second).toEqual({ [id]: "data:image/webp;base64,UklGRg==" });
  expect(asked).toEqual([dishArtUrl(id)]);
  expect(disk.files.get(dishArtPath(id))).toEqual(WEBP);
  expect(await store.cached([id, "missing--breakfast"])).toEqual({ [id]: "data:image/webp;base64,UklGRg==" });
});

test("a picture the release does not have is not asked for again; one that could not be reached is", async () => {
  const disk = memoryArt();
  const asked: string[] = [];
  let offline = true;
  const store = createDishArtStore({
    io: disk.io,
    fetchBytes: async (url) => {
      asked.push(url);
      if (url.includes("gone")) return null;
      if (offline) throw new Error("network down");
      return WEBP;
    },
  });
  expect(await store.download(["gone--breakfast", "here--breakfast"])).toEqual({});
  offline = false;
  expect(Object.keys(await store.download(["gone--breakfast", "here--breakfast"]))).toEqual(["here--breakfast"]);
  expect(asked.filter((u) => u.includes("gone")).length).toBe(1);
  expect(asked.filter((u) => u.includes("here")).length).toBe(2);
  expect(disk.files.size).toBe(1);
});
