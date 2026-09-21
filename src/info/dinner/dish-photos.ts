// A photograph of the dish itself, searched for once (docs/73 图片).
//
// Openverse's image index takes no key and answers "mapo tofu" with two hundred
// and forty Flickr photographs of the dish. What it cannot do is invented
// names: `sheet pan salmon broccoli` and `roasted sweet potato lentil bowl`
// come back empty (docs/research/食材与菜品图片源调研.md), which is why the plan
// carries a searchName and the model is told to plan dishes that have one.
//
// A lookup happens at Apply and nowhere else: never while the screen renders,
// never while the model is talking. The answer is cached by searchName for
// good, and an empty answer is cached too — for thirty days, because a dish the
// index does not have today may be there next season and asking again every
// week is not.
//
// Nothing here throws at its caller, but it does distinguish two failures. An
// index that answered and had nothing is a fact about the dish and is cached; a
// dead network, a timeout and a refusal are facts about the moment and are not.
// Caching the second as "this dish has no photograph" would take a dish off the
// screen for a month over one flight-mode Apply.

import { isDishPhotoMiss, type Dish, type DishPhoto, type DishPhotoEntry, type WeekPlan } from "./types";

const ENDPOINT = "https://api.openverse.org/v1/images/";

// Anonymous callers get 20 requests a minute and 200 a day, and the API asks to
// be told who is calling. A week of seven dishes is seven requests at most, and
// only for dishes never planned before.
const USER_AGENT = "ReadingPartner/1.0 (reading companion; dinner dish photos)";

// Long enough for a slow mobile connection, short enough that an Apply's
// photographs are there before the reader has read the shopping list.
const TIMEOUT_MS = 10_000;

// How long an empty answer stands before the name is searched again.
export const PHOTO_MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

// Five is enough to skip a mature or portrait first hit without paging.
const PAGE_SIZE = 5;

// Just enough of fetch to make the request this file makes. Named rather than
// `typeof fetch` because the runtime's own type carries properties a fake has
// no business implementing.
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** The request URL for one name. Exported so a test asserts it rather than a mock's shape. */
export function dishPhotoQuery(searchName: string): string {
  const q = encodeURIComponent(normalizeSearchName(searchName));
  return `${ENDPOINT}?q=${q}&license_type=all&page_size=${PAGE_SIZE}`;
}

/** The cache key a name is stored under: trimmed, collapsed, lower case. */
export function normalizeSearchName(raw: string): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * What one search came back with: an answer, which is a photograph or nothing,
 * or no answer at all.
 *
 * The two are not the same fact. `{ ok: true, photo: null }` says the index
 * has no photograph of this dish and is worth remembering; `{ ok: false }` says
 * the question did not get through — offline, timed out, refused, or answered
 * with something that is not JSON — and is worth nothing at all.
 */
export type DishPhotoLookup = { ok: true; photo: DishPhoto | null } | { ok: false };

const UNANSWERED: DishPhotoLookup = { ok: false };

/**
 * The photograph for one dish name.
 *
 * Nothing is thrown into the Apply path: every failure is `{ ok: false }`. A
 * 2xx whose body parses but holds no usable result is an answer, not a failure,
 * because that is the index saying it has nothing.
 *
 * `fetchFn` is injected so the whole selection is tested against a fake without
 * a network.
 */
export async function lookupDishPhoto(
  searchName: string,
  fetchFn: FetchLike = fetch,
): Promise<DishPhotoLookup> {
  const name = normalizeSearchName(searchName);
  // Nothing was asked, so there is nothing to remember. resolveDishPhotos never
  // gets here — it drops empty names before it calls.
  if (!name) return UNANSWERED;
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(dishPhotoQuery(name), {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: control.signal,
    });
    // 429 included: a refusal to answer is not an answer.
    if (!res.ok) return UNANSWERED;
    // A body that will not parse lands in the catch below, unanswered.
    return { ok: true, photo: pickPhoto(await res.json()) };
  } catch {
    return UNANSWERED;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The first usable result of a response body.
 *
 * Usable means it has a full-size URL and is not flagged mature; landscape is
 * preferred over portrait because the night's card is a 16:9 box and a portrait
 * photograph is cropped to its middle. A body that is not the shape this reader
 * expects yields nothing rather than a half-filled record.
 */
export function pickPhoto(body: unknown): DishPhoto | null {
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return null;
  const usable = results.filter(isUsable);
  const landscape = usable.find((r) => {
    const w = Number(r.width);
    const h = Number(r.height);
    return Number.isFinite(w) && Number.isFinite(h) && h > 0 && w > h;
  });
  const chosen = landscape ?? usable[0];
  if (!chosen) return null;
  return {
    url: String(chosen.url),
    thumb: text(chosen.thumbnail),
    title: text(chosen.title),
    creator: text(chosen.creator),
    license: licenseLabel(text(chosen.license), text(chosen.license_version)),
    licenseUrl: text(chosen.license_url),
    foreignLandingUrl: text(chosen.foreign_landing_url),
  };
}

type Result = Record<string, unknown>;

function isUsable(raw: unknown): raw is Result {
  if (!raw || typeof raw !== "object") return false;
  const r = raw as Result;
  if (typeof r.url !== "string" || !/^https?:\/\//i.test(r.url)) return false;
  // Absent is not false: only a result the index says is clean is shown.
  return r.mature === false;
}

function text(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/**
 * The licence as a caption says it. The index answers in codes ("by-sa") and a
 * separate version, and the licences' own names are what a credit line has to
 * carry.
 */
export function licenseLabel(code: string, version: string): string {
  const c = code.trim().toLowerCase();
  const v = version.trim();
  if (!c) return "";
  if (c === "pdm") return "Public Domain Mark";
  if (c === "cc0") return v ? `CC0 ${v}` : "CC0";
  return v ? `CC ${c.toUpperCase()} ${v}` : `CC ${c.toUpperCase()}`;
}

/** Whether a name still has to be searched for: never asked, or a stale miss. */
export function needsPhotoLookup(entry: DishPhotoEntry | undefined, now: number): boolean {
  if (!entry) return true;
  if (!isDishPhotoMiss(entry)) return false;
  return now - entry.checkedAt >= PHOTO_MISS_RETRY_MS;
}

/**
 * The names a plan's dishes still need a search for, each once and in the order
 * the dishes are planned. Distinct, because a week that cooks the same dish
 * twice is one request.
 */
export function searchNamesToLookup(
  dishes: readonly Dish[],
  cache: Readonly<Record<string, DishPhotoEntry>>,
  now: number,
): string[] {
  const out: string[] = [];
  for (const dish of dishes) {
    const name = normalizeSearchName(dish.searchName ?? "");
    if (!name || out.includes(name)) continue;
    if (needsPhotoLookup(cache[name], now)) out.push(name);
  }
  return out;
}

/**
 * The cache with one name's photograph forgotten, or null when there was
 * nothing to forget.
 *
 * A web image search hands back arbitrary CDNs, and some of them refuse the
 * app's request even with a Referer. The screen falls back to the ingredient
 * strip, which is right for the night but wrong for the month: the entry would
 * sit in the cache being loaded and failing every time. Forgotten rather than
 * written down as a miss, because a miss is the index saying it has nothing
 * and this is the app failing to load what it found — the next Apply asks
 * again, and may well get a different picture.
 */
export function withoutDishPhoto(
  cache: Readonly<Record<string, DishPhotoEntry>>,
  searchName: string,
): Record<string, DishPhotoEntry> | null {
  const name = normalizeSearchName(searchName);
  if (!name || !(name in cache)) return null;
  const next = { ...cache };
  delete next[name];
  return next;
}

/** The photograph a dish shows, from the cache, or null. */
export function photoForDish(
  dish: Dish | null | undefined,
  cache: Readonly<Record<string, DishPhotoEntry>> | undefined,
): DishPhoto | null {
  if (!dish) return null;
  const entry = cache?.[normalizeSearchName(dish.searchName ?? "")];
  if (!entry || isDishPhotoMiss(entry)) return null;
  return entry;
}

/**
 * The plan with every dish's `image` set from the cache.
 *
 * The same object back when nothing changed, so a caller can tell whether a
 * second write is worth making. A dish the cache has nothing for is left
 * exactly as it is, including an `image` it already carries: an adjustment
 * keeps the dishes of the week it adjusts, and a search that has not run yet
 * must not strip their photographs.
 */
export function withDishPhotos(
  plan: WeekPlan,
  cache: Readonly<Record<string, DishPhotoEntry>>,
): WeekPlan {
  let changed = false;
  const dishes = plan.dishes.map((dish) => {
    const photo = photoForDish(dish, cache);
    if (!photo || dish.image === photo.url) return dish;
    changed = true;
    return { ...dish, image: photo.url };
  });
  return changed ? { ...plan, dishes } : plan;
}
