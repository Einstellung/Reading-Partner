// The photograph cache on disk: info-meals-photos.json (docs/73 图片).
//
// Its own file rather than a field of info-meals.json. The plan is written in
// the reader's turn and the photographs are written by a run on the PC minutes
// later, one entry at a time; sharing a file would mean the run's load-modify-
// save sitting on top of a week the reader has meanwhile adjusted. The two have
// nothing to say to each other — the cache is keyed by name and outlives every
// week — so they are two files. Palace merges the week whole and this one per
// key against the last synced copy (kinds.ts), which is what lets a dropped
// entry stay dropped on the other device.

import {
  quarantineFile,
  readGuardedJson,
  writeTextAtomic,
  type CorruptFileReport,
  type GuardedRead,
} from "../../platform/app/atomic-fs";
import { isObject } from "../../platform/std/json";
import { reportStoreError } from "../../platform/app/store-errors";
import { dishPhotoKey, withoutPhoto, type PhotoCache } from "./dish-photos";
import { MEALS_VERSION, type DishPhotoEntry } from "./types";

export const MEALS_PHOTOS_FILE = "info-meals-photos.json";

/** What the file holds: every photograph ever found, by key. */
export interface MealsPhotos {
  photos: Record<string, DishPhotoEntry>;
}

export const EMPTY_MEALS_PHOTOS: MealsPhotos = { photos: {} };

// The same shape the meals store takes, for the same reason: a test hands it
// an in-memory AppData rather than rewriting the module registry (pitfall 119).
export interface PhotoIo {
  read(
    file: string,
    validate: (raw: unknown) => MealsPhotos | null,
  ): Promise<GuardedRead<MealsPhotos>>;
  write(file: string, contents: string): Promise<void>;
  quarantine(file: string): Promise<string | null>;
  reportCorrupt(report: CorruptFileReport): void;
}

export const photoIo: PhotoIo = {
  read: readGuardedJson,
  write: writeTextAtomic,
  quarantine: quarantineFile,
  reportCorrupt: (report) => reportStoreError("corrupt-file", report),
};

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

async function readPhotos(io: PhotoIo): Promise<MealsPhotos> {
  const read = await io.read(MEALS_PHOTOS_FILE, parsePhotoFile);
  if (read.status === "ok") return read.value;
  if (read.status === "missing") return { photos: {} };
  // A file that is there and will not read raises rather than being overwritten
  // with an empty cache: a week of searches is worth more than one write.
  if (read.savedAs === null) throw new Error(`${MEALS_PHOTOS_FILE} could not be read`);
  return { photos: {} };
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
 * Forget the photograph of one dish, because the picture the search found will
 * not load in this app (see withoutPhoto). Called from the screen, not from a
 * run: the `<img>` is the only place that finds out.
 *
 * Nothing is written when the name is not in the cache, so a strip of ingredient
 * pictures failing costs no writes at all.
 */
export async function markDishPhotoBroken(
  searchName: string,
  io: PhotoIo = photoIo,
): Promise<PhotoCache> {
  return mutate(io, (photos) => withoutPhoto(photos, dishPhotoKey(searchName)));
}
