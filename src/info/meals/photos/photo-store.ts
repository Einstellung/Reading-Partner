// The picture cache on disk: info-meals-photos.json (docs/73 图片), and the
// drawn dish pictures it points at, one file each under meals-pictures/.
//
// Its own file rather than a field of info-meals.json. The plan is written in
// the reader's turn and the pictures are written by a pass minutes later, one
// entry at a time; sharing a file would mean the pass's load-modify-
// save sitting on top of a week the reader has meanwhile adjusted. The two have
// nothing to say to each other — the cache is keyed by name and outlives every
// week — so they are two files. Palace merges the week whole and this one per
// key against the last synced copy (kinds.ts), which is what lets a dropped
// entry stay dropped on the other device.

import { appData } from "../../../platform/app/appdata";
import { contentHash } from "../../../platform/app/content-hash";
import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../../platform/app/guarded-file";
import { bytesToBase64 } from "../../../platform/std/base64";
import { isObject } from "../../../platform/std/json";
import { dishDrawingKey, dishPhotoKey, withoutPhoto, type PhotoCache } from "./dish-photos";
import { DRAWINGS_DIR, drawingPath, withClaimsReleased } from "./dish-drawing";
import { isDishDrawing, MEALS_VERSION, type DishPhotoEntry } from "../plan/types";

/** The byte half of the store: where a drawn picture's file is put and read back. */
export interface DrawingIo {
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  mkdirp(path: string): Promise<void>;
}

export const drawingIo: DrawingIo = appData;

/**
 * Keep a drawn picture, answering its path. Named for the hash of its bytes, so
 * the file is written once and never revised, and two devices never write the
 * same path with different bytes: it travels on the data channel like an
 * article body (palace kinds.ts `meals-picture`).
 */
export async function saveDrawingFile(
  bytes: Uint8Array,
  mediaType: string,
  io: DrawingIo = drawingIo,
): Promise<string> {
  const path = drawingPath(await contentHash(bytes), mediaType);
  await io.mkdirp(DRAWINGS_DIR);
  await io.writeBytes(path, bytes);
  return path;
}

function mediaTypeOf(path: string): string {
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

/**
 * The cache with the drawings under `keys` read into memory as data: URIs, for
 * the screen. A file that has not arrived yet (the cache entry synced ahead of
 * it) or will not read leaves its entry without a source, which the screen
 * draws as a dish with no picture.
 */
export async function withDrawingSources(
  cache: PhotoCache,
  keys: readonly string[],
  io: Pick<DrawingIo, "readBytes"> = drawingIo,
): Promise<PhotoCache> {
  const next: Record<string, DishPhotoEntry> = { ...cache };
  for (const key of new Set(keys)) {
    const entry = cache[key];
    if (!entry || !isDishDrawing(entry)) continue;
    try {
      const bytes = await io.readBytes(entry.drawing);
      next[key] = { ...entry, src: `data:${mediaTypeOf(entry.drawing)};base64,${bytesToBase64(bytes)}` };
    } catch {
      // Not here yet; the pull that brings it reloads the screen.
    }
  }
  return next;
}

export const MEALS_PHOTOS_FILE = "info-meals-photos.json";

/** What the file holds: every photograph ever found, by key. */
export interface MealsPhotos {
  photos: Record<string, DishPhotoEntry>;
}

export const EMPTY_MEALS_PHOTOS: MealsPhotos = { photos: {} };

// The same shape the meals store takes, for the same reason: a test hands it
// an in-memory AppData rather than rewriting the module registry (pitfall 119).
export type PhotoIo = GuardedFileIo<MealsPhotos>;

export const photoIo: PhotoIo = appGuardedFileIo();

/** The cache out of a parsed file, or null when the bytes are not this shape. */
export function parsePhotoFile(raw: unknown): MealsPhotos | null {
  if (!isObject(raw)) return null;
  const photos = isObject(raw.photos) ? (raw.photos as Record<string, DishPhotoEntry>) : {};
  return { photos };
}

/** The file body to write for a cache. */
export function photoFileBody(state: MealsPhotos): string {
  return JSON.stringify({ version: MEALS_VERSION, ...state }, null, 2);
}

// A file that is there and will not read raises (readGuardedFile) rather than
// being overwritten with an empty cache: a week of searches is worth more than
// one write.
async function readPhotos(io: PhotoIo): Promise<MealsPhotos> {
  const state = await readGuardedFile(io, MEALS_PHOTOS_FILE, parsePhotoFile);
  return state ?? { photos: {} };
}

/** Every photograph found so far. */
export async function loadMealsPhotos(io: PhotoIo = photoIo): Promise<PhotoCache> {
  return (await readPhotos(io)).photos;
}

async function mutate(
  io: PhotoIo,
  change: (photos: Record<string, DishPhotoEntry>) => Record<string, DishPhotoEntry> | null,
): Promise<PhotoCache> {
  const current = await readPhotos(io);
  const next = change(current.photos);
  if (!next) return current.photos;
  await io.write(MEALS_PHOTOS_FILE, photoFileBody({ photos: next }));
  return next;
}

/**
 * Write what one search found, merged into whatever is already there.
 *
 * Merged rather than replaced because the run writes each entry as it lands and
 * the file is synced between devices: a concurrent write that added another
 * name's photograph is not undone by this one.
 */
export async function savePhotoEntries(
  entries: Readonly<Record<string, DishPhotoEntry>>,
  io: PhotoIo = photoIo,
): Promise<PhotoCache> {
  if (Object.keys(entries).length === 0) return loadMealsPhotos(io);
  return mutate(io, (photos) => ({ ...photos, ...entries }));
}

/**
 * Forget the picture of one dish, because it will not load in this app (see
 * withoutPhoto): the drawing when that was what showed, else the searched
 * photograph. The next pass draws or searches it again. Called from the
 * screen, not from a run: the `<img>` is the only place that finds out.
 *
 * Nothing is written when the name is not in the cache, so a strip of ingredient
 * pictures failing costs no writes at all.
 */
export async function markDishPhotoBroken(
  searchName: string,
  drawn: boolean,
  io: PhotoIo = photoIo,
): Promise<PhotoCache> {
  const key = drawn ? dishDrawingKey(searchName) : dishPhotoKey(searchName);
  return mutate(io, (photos) => withoutPhoto(photos, key));
}

/**
 * Take back the claims a round wrote at `since` on the dishes it did not draw,
 * so that a failed drawing hands the dish to the search at once rather than
 * after the claim lapses.
 */
export async function releaseDrawingClaims(
  keys: readonly string[],
  since: number,
  io: PhotoIo = photoIo,
): Promise<PhotoCache> {
  return mutate(io, (photos) => withClaimsReleased(photos, keys, since));
}
