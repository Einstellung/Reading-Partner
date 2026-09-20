// Dish photographs: what a search answer becomes, what is cached, and what an
// Apply does with them. No network — the fetch and the ports are both fakes.

import { expect, test } from "bun:test";

import { resolveDishPhotos, type DinnerPorts } from "../../../src/info/dinner/apply";
import {
  dishPhotoQuery,
  type FetchLike,
  licenseLabel,
  lookupDishPhoto,
  needsPhotoLookup,
  normalizeSearchName,
  photoForDish,
  pickPhoto,
  searchNamesToLookup,
  withDishPhotos,
  PHOTO_MISS_RETRY_MS,
} from "../../../src/info/dinner/dish-photos";
import { dishPhotoCredit } from "../../../src/info/dinner/view";
import {
  EMPTY_DINNER,
  type Dish,
  type DinnerState,
  type DishPhoto,
  type DishPhotoEntry,
  type WeekPlan,
} from "../../../src/info/dinner/types";

const MON = "2026-09-21";
const NOW = 1_770_000_000_000;

function result(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    title: "Mapo Tofu",
    url: "https://live.staticflickr.com/2106/mapo_b.jpg",
    thumbnail: "https://api.openverse.org/v1/images/abc/thumb/",
    creator: "avlxyz",
    license: "by-sa",
    license_version: "2.0",
    license_url: "https://creativecommons.org/licenses/by-sa/2.0/",
    foreign_landing_url: "https://www.flickr.com/photos/10559879@N00/2268560276",
    mature: false,
    width: 1024,
    height: 768,
    ...over,
  };
}

function body(results: unknown[]): string {
  return JSON.stringify({ result_count: results.length, results });
}

function dish(over: Partial<Dish> = {}): Dish {
  return {
    id: "dish-a",
    name: "麻婆豆腐",
    searchName: "mapo tofu",
    oneLine: "",
    base: "b",
    fresh: "",
    keepsADay: true,
    handsOnMinutes: 12,
    ingredients: [],
    ...over,
  };
}

function plan(dishes: Dish[]): WeekPlan {
  return {
    id: `week-${MON}`,
    startDate: MON,
    days: [{ date: MON, mode: "cook", dishId: dishes[0]?.id }],
    dishes,
    createdAt: NOW,
    revision: 1,
  };
}

const PHOTO: DishPhoto = {
  url: "https://live.staticflickr.com/2106/mapo_b.jpg",
  thumb: "",
  title: "Mapo Tofu",
  creator: "avlxyz",
  license: "CC BY-SA 2.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
  foreignLandingUrl: "https://www.flickr.com/photos/1/2268560276",
};

// --- the search --------------------------------------------------------------

test("the query carries the name, every licence and a small page", () => {
  const url = dishPhotoQuery("  Mapo   Tofu ");
  expect(url).toBe(
    "https://api.openverse.org/v1/images/?q=mapo%20tofu&license_type=all&page_size=5",
  );
});

test("a found dish comes back with its creator and a display licence", async () => {
  let seen: { url: string; ua: unknown } | null = null;
  const fake: FetchLike = async (input, init) => {
    seen = {
      url: String(input),
      ua: (init?.headers as Record<string, string> | undefined)?.["User-Agent"],
    };
    return new Response(body([result()]));
  };
  const photo = await lookupDishPhoto("Mapo Tofu", fake);
  expect(photo).toEqual({
    url: "https://live.staticflickr.com/2106/mapo_b.jpg",
    thumb: "https://api.openverse.org/v1/images/abc/thumb/",
    title: "Mapo Tofu",
    creator: "avlxyz",
    license: "CC BY-SA 2.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/2.0/",
    foreignLandingUrl: "https://www.flickr.com/photos/10559879@N00/2268560276",
  });
  expect(seen!.url).toContain("q=mapo%20tofu");
  expect(String(seen!.ua)).toContain("ReadingPartner");
});

test("a landscape result is preferred over a portrait one that came first", () => {
  const picked = pickPhoto({
    results: [
      result({ url: "https://x/portrait.jpg", width: 683, height: 1024 }),
      result({ url: "https://x/landscape.jpg", width: 1024, height: 683 }),
    ],
  });
  expect(picked?.url).toBe("https://x/landscape.jpg");
});

test("a result flagged mature, or with no url, is not shown", () => {
  expect(pickPhoto({ results: [result({ mature: true })] })).toBeNull();
  expect(pickPhoto({ results: [result({ url: 12 })] })).toBeNull();
  // Absent is not false: only what the index says is clean is used.
  const unknown = { ...result() };
  delete unknown.mature;
  expect(pickPhoto({ results: [unknown] })).toBeNull();
});

test("an invented name, an error status and a body of the wrong shape are all no photograph", async () => {
  const empty: FetchLike = async () => new Response(body([]));
  expect(await lookupDishPhoto("sheet pan salmon broccoli", empty)).toBeNull();

  const refused: FetchLike = async () => new Response("too many", { status: 429 });
  expect(await lookupDishPhoto("mapo tofu", refused)).toBeNull();

  const junk: FetchLike = async () => new Response("<html>nope</html>");
  expect(await lookupDishPhoto("mapo tofu", junk)).toBeNull();

  const dead: FetchLike = async () => {
    throw new Error("offline");
  };
  expect(await lookupDishPhoto("mapo tofu", dead)).toBeNull();

  const never: FetchLike = async () => new Response(body([result()]));
  expect(await lookupDishPhoto("   ", never)).toBeNull();
});

test("the licence is spelled the way a credit line has to spell it", () => {
  expect(licenseLabel("by-sa", "2.0")).toBe("CC BY-SA 2.0");
  expect(licenseLabel("cc0", "1.0")).toBe("CC0 1.0");
  expect(licenseLabel("pdm", "1.0")).toBe("Public Domain Mark");
  expect(licenseLabel("by", "")).toBe("CC BY");
  expect(licenseLabel("", "2.0")).toBe("");
});

// --- the cache ---------------------------------------------------------------

test("a name never searched is looked up, a hit never again, a miss after thirty days", () => {
  const miss: DishPhotoEntry = { none: true, checkedAt: NOW };
  expect(needsPhotoLookup(undefined, NOW)).toBe(true);
  expect(needsPhotoLookup(PHOTO, NOW + PHOTO_MISS_RETRY_MS * 12)).toBe(false);
  expect(needsPhotoLookup(miss, NOW + PHOTO_MISS_RETRY_MS - 1)).toBe(false);
  expect(needsPhotoLookup(miss, NOW + PHOTO_MISS_RETRY_MS)).toBe(true);
});

test("one week asks for each name once, and not for the ones it already has", () => {
  const dishes = [
    dish({ id: "dish-a", searchName: "Mapo Tofu" }),
    dish({ id: "dish-b", searchName: "mapo tofu" }),
    dish({ id: "dish-c", searchName: "shakshuka" }),
    dish({ id: "dish-d", searchName: "" }),
    dish({ id: "dish-e", searchName: "minestrone" }),
  ];
  const cache = { minestrone: PHOTO };
  expect(searchNamesToLookup(dishes, cache, NOW)).toEqual(["mapo tofu", "shakshuka"]);
});

test("the cache writes the image onto the dishes it has, and leaves the others alone", () => {
  const before = plan([
    dish({ id: "dish-a", searchName: "mapo tofu" }),
    dish({ id: "dish-b", searchName: "shakshuka", image: "https://old/kept.jpg" }),
  ]);
  const after = withDishPhotos(before, { "mapo tofu": PHOTO });
  expect(after.dishes[0]?.image).toBe(PHOTO.url);
  expect(after.dishes[1]?.image).toBe("https://old/kept.jpg");
  // Nothing to change is the same object, so no second write is made.
  expect(withDishPhotos(after, { "mapo tofu": PHOTO })).toBe(after);
  expect(photoForDish(after.dishes[0] ?? null, { "mapo tofu": PHOTO })).toEqual(PHOTO);
  expect(photoForDish(after.dishes[1] ?? null, { shakshuka: { none: true, checkedAt: NOW } })).toBeNull();
  expect(normalizeSearchName("  Mapo   TOFU ")).toBe("mapo tofu");
});

// --- what Apply does with them ----------------------------------------------

interface Fake {
  ports: DinnerPorts;
  state: DinnerState;
  asked: string[];
  saved: { photos: Record<string, DishPhotoEntry>; plan: WeekPlan } | null;
  changed: number;
}

function fake(
  state: Partial<DinnerState>,
  answer: (name: string) => Promise<DishPhoto | null>,
): Fake {
  const f: Fake = {
    state: { ...EMPTY_DINNER, ...state },
    asked: [],
    saved: null,
    changed: 0,
    ports: {
      current: async () => f.state,
      saveCharter: async () => {},
      savePlan: async () => {},
      saveDeviation: async () => {},
      saveDishPhotos: async (photos, plan) => {
        f.saved = { photos: { ...photos }, plan };
      },
      lookupDishPhoto: async (name) => {
        f.asked.push(name);
        return answer(name);
      },
      now: () => NOW,
      today: () => MON,
      changed: () => {
        f.changed++;
      },
    },
  };
  return f;
}

test("an applied week looks each new dish up once and writes the plan with the pictures", async () => {
  const f = fake({}, async (name) => (name === "mapo tofu" ? PHOTO : null));
  const week = plan([
    dish({ id: "dish-a", searchName: "mapo tofu" }),
    dish({ id: "dish-b", searchName: "made up bowl" }),
  ]);
  expect(await resolveDishPhotos(week, f.ports)).toBe(true);
  expect(f.asked).toEqual(["mapo tofu", "made up bowl"]);
  expect(f.saved?.photos).toEqual({
    "mapo tofu": PHOTO,
    "made up bowl": { none: true, checkedAt: NOW },
  });
  expect(f.saved?.plan.dishes[0]?.image).toBe(PHOTO.url);
  expect(f.saved?.plan.dishes[1]?.image).toBeUndefined();
});

test("a dish already in the cache costs no request, and a week that is all cached writes nothing", async () => {
  const f = fake({ dishPhotos: { "mapo tofu": PHOTO } }, async () => PHOTO);
  const week = plan([dish({ id: "dish-a", searchName: "mapo tofu", image: PHOTO.url })]);
  expect(await resolveDishPhotos(week, f.ports)).toBe(false);
  expect(f.asked).toEqual([]);
  expect(f.saved).toBeNull();
});

test("a miss older than thirty days is asked again, a fresh one is not", async () => {
  const stale = { none: true as const, checkedAt: NOW - PHOTO_MISS_RETRY_MS - 1 };
  const old = fake({ dishPhotos: { shakshuka: stale } }, async () => PHOTO);
  await resolveDishPhotos(plan([dish({ searchName: "shakshuka" })]), old.ports);
  expect(old.asked).toEqual(["shakshuka"]);

  const fresh = fake(
    { dishPhotos: { shakshuka: { none: true, checkedAt: NOW - 1000 } } },
    async () => PHOTO,
  );
  await resolveDishPhotos(plan([dish({ searchName: "shakshuka" })]), fresh.ports);
  expect(fresh.asked).toEqual([]);
});

test("a search that throws is one dish without a picture, not a failed Apply", async () => {
  const f = fake({}, async () => {
    throw new Error("offline");
  });
  expect(await resolveDishPhotos(plan([dish({ searchName: "mapo tofu" })]), f.ports)).toBe(true);
  expect(f.saved?.photos["mapo tofu"]).toEqual({ none: true, checkedAt: NOW });
});

test("a host with no lookup applies its week and searches for nothing", async () => {
  const f = fake({}, async () => PHOTO);
  const ports: DinnerPorts = { ...f.ports, lookupDishPhoto: undefined };
  expect(await resolveDishPhotos(plan([dish()]), ports)).toBe(false);
  expect(f.asked).toEqual([]);
});

// --- the caption -------------------------------------------------------------

test("a dish showing its photograph credits the photographer and links to the page", () => {
  const shown = dish({ image: PHOTO.url });
  expect(dishPhotoCredit(shown, { "mapo tofu": PHOTO })).toEqual({
    text: "Photo: avlxyz · CC BY-SA 2.0",
    url: PHOTO.foreignLandingUrl,
  });
});

test("nothing is credited for a dish drawn from its ingredients, or for another photograph", () => {
  expect(dishPhotoCredit(dish(), { "mapo tofu": PHOTO })).toBeNull();
  expect(dishPhotoCredit(dish({ image: "https://elsewhere/x.jpg" }), { "mapo tofu": PHOTO })).toBeNull();
  expect(dishPhotoCredit(dish({ image: PHOTO.url }), {})).toBeNull();
  expect(dishPhotoCredit(null, { "mapo tofu": PHOTO })).toBeNull();
});
