// The photograph cache, read (docs/73 图片).
//
// One record for the whole line, keyed by what was searched for rather than by
// what is planned: `dish:mapo tofu` and `ingredient:kale` outlive every week, so
// a dish cooked again in October costs no search and a vegetable bought every
// week costs one ever. Where it is kept and how it is written is photo-store.ts;
// this file is the pure half — the keys, what still has to be searched for, and
// what a plan looks like once the pictures have landed.

import { isDishPhotoMiss, type DishPhoto, type DishPhotoEntry } from "../plan/types";

// How long an empty answer stands before the name is searched again. A search
// that found nothing today may find something next season, and asking every
// week is not how that is discovered.
export const PHOTO_MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

/** The cache key a name is stored under: trimmed, collapsed, lower case. */
export function normalizeSearchName(raw: string): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Where a dish's photograph is kept. Empty when the dish has no search name. */
export function dishPhotoKey(searchName: string): string {
  const name = normalizeSearchName(searchName);
  return name ? `dish:${name}` : "";
}

/** Where an ingredient's photograph is kept, by its English name. */
export function ingredientPhotoKey(en: string): string {
  const name = normalizeSearchName(en);
  return name ? `ingredient:${name}` : "";
}

/** The whole cache, as everything that reads it takes it. */
export type PhotoCache = Readonly<Record<string, DishPhotoEntry>>;

/** When one entry was written: found or looked for and not found. */
export function photoEntryAt(entry: DishPhotoEntry): number {
  return isDishPhotoMiss(entry) ? entry.checkedAt : entry.foundAt;
}

/**
 * Whether a key still has to be searched for: never asked, asked again since
 * this answer was written, or a miss old enough to be worth another look.
 *
 * `askedAt` is the reader saying the pictures are wrong (MealsState.
 * photosAskedAt). It is a time rather than a flag because the reader and the
 * machine that searches are usually not the same machine: the ask travels over
 * sync, and every entry older than it is what "search the week again" means.
 */
export function needsPhotoLookup(
  entry: DishPhotoEntry | undefined,
  now: number,
  askedAt = 0,
): boolean {
  if (!entry) return true;
  if (photoEntryAt(entry) < askedAt) return true;
  if (!isDishPhotoMiss(entry)) return false;
  return now - entry.checkedAt >= PHOTO_MISS_RETRY_MS;
}

/** The photograph under one key, or null when there is none or it was a miss. */
export function photoAt(cache: PhotoCache | undefined, key: string): DishPhoto | null {
  const entry = key ? cache?.[key] : undefined;
  if (!entry || isDishPhotoMiss(entry)) return null;
  return entry;
}

/** The photograph a dish shows, from the cache, or null. */
export function photoForDish(
  dish: { searchName?: string } | null | undefined,
  cache: PhotoCache | undefined,
): DishPhoto | null {
  if (!dish) return null;
  return photoAt(cache, dishPhotoKey(dish.searchName ?? ""));
}

/** The photograph an ingredient line shows when no picture bank has one. */
export function photoForIngredient(en: string, cache: PhotoCache | undefined): DishPhoto | null {
  return photoAt(cache, ingredientPhotoKey(en));
}

/**
 * The cache with one key forgotten, or null when there was nothing to forget.
 *
 * A web image search hands back arbitrary CDNs, and some of them refuse the
 * app's request even with a Referer. The screen falls back to the ingredient
 * strip, which is right for the night but wrong for the month: the entry would
 * sit in the cache being loaded and failing every time. Forgotten rather than
 * written down as a miss, because a miss is the search having nothing and this
 * is the app failing to load what it found — the next run asks again, and may
 * well get a different picture.
 */
export function withoutPhoto(
  cache: PhotoCache,
  key: string,
): Record<string, DishPhotoEntry> | null {
  if (!key || !(key in cache)) return null;
  const next = { ...cache };
  delete next[key];
  return next;
}
