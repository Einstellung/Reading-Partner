// The picture cache, read (docs/73 图片).
//
// One record for the whole line, keyed by name rather than by what is planned:
// `drawing:mapo tofu` and `ingredient:kale` outlive every week, so a dish cooked
// again in October costs no new picture and a vegetable bought every week costs
// one search ever. A dish's key holds the picture an image model drew
// (dish-drawing.ts); a dish nobody drew shows its ingredient strip. An
// ingredient key holds what the image search found. Files synced from older
// builds also carry `dish:` keys, photographs searched for a dish; they stay in
// the file for the builds that still read them, and nothing here reads them.
// Where the cache is kept and how it is written is photo-store.ts; this file is
// the pure half — the keys, what still has to be searched for, and which
// picture a dish or an ingredient shows.

import {
  isDishDrawing,
  isDishDrawingClaim,
  isDishPhoto,
  isDishPhotoMiss,
  type DishDrawing,
  type DishPhoto,
  type DishPhotoEntry,
} from "../plan/types";

// How long an empty answer stands before the name is searched again. A search
// that found nothing today may find something next season, and asking every
// week is not how that is discovered.
export const PHOTO_MISS_RETRY_MS = 30 * 24 * 60 * 60 * 1000;

/** The cache key a name is stored under: trimmed, collapsed, lower case. */
export function normalizeSearchName(raw: string): string {
  return (raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Where a dish's drawn picture is kept. A key of its own rather than the old
 * `dish:`, so a build from before the drawings never reads one as a searched
 * photograph.
 */
export function dishDrawingKey(searchName: string): string {
  const name = normalizeSearchName(searchName);
  return name ? `drawing:${name}` : "";
}

/** Where an ingredient's photograph is kept, by its English name. */
export function ingredientPhotoKey(en: string): string {
  const name = normalizeSearchName(en);
  return name ? `ingredient:${name}` : "";
}

/** The whole cache, as everything that reads it takes it. */
export type PhotoCache = Readonly<Record<string, DishPhotoEntry>>;

/** When one entry was written: found, drawn, claimed, or looked for and not found. */
export function photoEntryAt(entry: DishPhotoEntry): number {
  if (isDishPhotoMiss(entry)) return entry.checkedAt;
  if (isDishDrawing(entry)) return entry.drawnAt;
  if (isDishDrawingClaim(entry)) return entry.drawingSince;
  return entry.foundAt;
}

/**
 * Whether an ingredient still has to be searched for: never asked, asked again
 * since this answer was written, or a miss old enough to be worth another look.
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

/** The searched photograph under one key, or null when there is none or it was a miss. */
function photoAt(cache: PhotoCache | undefined, key: string): DishPhoto | null {
  const entry = key ? cache?.[key] : undefined;
  return entry && isDishPhoto(entry) ? entry : null;
}

/** The drawn picture a dish has, or null. The only picture a dish shows; without one it shows its ingredient strip. */
export function drawingForDish(
  dish: { searchName?: string } | null | undefined,
  cache: PhotoCache | undefined,
): DishDrawing | null {
  if (!dish) return null;
  const key = dishDrawingKey(dish.searchName ?? "");
  const entry = key ? cache?.[key] : undefined;
  return entry && isDishDrawing(entry) ? entry : null;
}

/** The photograph an ingredient line shows when no picture bank has one. */
export function photoForIngredient(en: string, cache: PhotoCache | undefined): DishPhoto | null {
  return photoAt(cache, ingredientPhotoKey(en));
}

/**
 * The cache with one key forgotten, or null when there was nothing to forget.
 *
 * A drawing whose file will not load in this app falls back on screen to the
 * ingredient strip, which is right for the night but wrong for the month.
 * Forgotten rather than written down as anything, because this is the app
 * failing to load what it had: the next round draws it again.
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
