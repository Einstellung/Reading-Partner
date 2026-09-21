// The dinner file on disk (docs/73): one JSON under AppData holding the
// charter, the week being eaten, its shopping list and the nights that went
// differently.
//
// Read through readGuardedJson for the reason info-labs.json is: all of it is
// authored in conversation and nothing can rebuild it, and every mutation here
// is load-modify-save — so a read that failed must not become the file that
// gets written (docs/13).
//
// One file rather than four, and merged opaque rather than by field: the plan,
// the list derived from it and the deviations applied to it are not independent
// of each other, and a per-field merge would assemble a state that never
// existed on either device (pitfall 237). Two devices planning the same week
// twice is rare; the loser loses their whole edit, not half of it.

import {
  quarantineFile,
  readGuardedJson,
  writeTextAtomic,
  type CorruptFileReport,
  type GuardedRead,
} from "../../platform/app/atomic-fs";
import { isObject } from "../../platform/std/json";
import { reportStoreError } from "../../platform/app/store-errors";
import { withoutDishPhoto } from "./dish-photos";
import {
  DINNER_VERSION,
  EMPTY_DINNER,
  type Deviation,
  type DinnerCharter,
  type DinnerState,
  type DishPhotoEntry,
  type ShoppingItem,
  type WeekPlan,
} from "./types";

export const DINNER_FILE = "info-dinner.json";

// The file access this store needs, as a parameter. A test hands it an
// in-memory AppData instead of rewriting the module registry with mock.module,
// which rewrites it for every other test file in the same worker (pitfall 119).
export interface DinnerIo {
  read(
    file: string,
    validate: (raw: unknown) => DinnerState | null,
  ): Promise<GuardedRead<DinnerState>>;
  write(file: string, contents: string): Promise<void>;
  quarantine(file: string): Promise<string | null>;
  reportCorrupt(report: CorruptFileReport): void;
}

export const dinnerIo: DinnerIo = {
  read: readGuardedJson,
  write: writeTextAtomic,
  quarantine: quarantineFile,
  reportCorrupt: (report) => reportStoreError("corrupt-file", report),
};

/**
 * The state out of a parsed info-dinner.json, or null when the bytes are not
 * this writer's shape at all — which is what readGuardedJson quarantines.
 *
 * Fields a newer build wrote ride through untouched: the objects are returned
 * as they were read, so a device on an older build does not delete them.
 */
export function parseDinnerFile(raw: unknown): DinnerState | null {
  if (!isObject(raw)) return null;
  const plan = validatePlan(raw.plan);
  const charter = validateCharter(raw.charter);
  const shopping = Array.isArray(raw.shopping)
    ? raw.shopping.filter(isShoppingItem)
    : [];
  const deviations = Array.isArray(raw.deviations)
    ? raw.deviations.filter(isDeviation)
    : [];
  const dishPhotos = isObject(raw.dishPhotos)
    ? (raw.dishPhotos as Record<string, DishPhotoEntry>)
    : {};
  return { charter, plan, shopping, deviations, dishPhotos };
}

function validateCharter(raw: unknown): DinnerCharter | null {
  if (!isObject(raw)) return null;
  if (typeof raw.text !== "string") return null;
  if (typeof raw.people !== "number") return null;
  return raw as unknown as DinnerCharter;
}

function validatePlan(raw: unknown): WeekPlan | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.startDate !== "string") return null;
  if (!Array.isArray(raw.days) || !Array.isArray(raw.dishes)) return null;
  if (typeof raw.revision !== "number") return null;
  return raw as unknown as WeekPlan;
}

function isShoppingItem(raw: unknown): raw is ShoppingItem {
  return isObject(raw) && typeof raw.name === "string" && typeof raw.category === "string";
}

function isDeviation(raw: unknown): raw is Deviation {
  return isObject(raw) && typeof raw.date === "string" && typeof raw.said === "string";
}

/** The file body to write for a state. */
export function dinnerFileBody(state: DinnerState): string {
  return JSON.stringify({ version: DINNER_VERSION, ...state }, null, 2);
}

// No file is an empty state: a reader who has never opened the screen has none.
// A file sitting there unread is not that — it raises, so the next write cannot
// put one drafted week over the reader's own.
async function readDinner(io: DinnerIo): Promise<DinnerState> {
  const read = await io.read(DINNER_FILE, parseDinnerFile);
  if (read.status === "ok") return read.value;
  if (read.status === "missing") return { ...EMPTY_DINNER };
  if (read.savedAs === null) throw new Error(`${DINNER_FILE} could not be read`);
  return { ...EMPTY_DINNER };
}

/** Everything the dinner screen shows, as one read. */
export async function loadDinner(io: DinnerIo = dinnerIo): Promise<DinnerState> {
  return readDinner(io);
}

// Apply a change and write the file. Returns the state now on disk: the changed
// one when it was written, the one read otherwise, so a caller that renders
// what it gets back shows the file rather than a change that did not land.
async function mutate(
  io: DinnerIo,
  change: (state: DinnerState) => DinnerState,
): Promise<DinnerState> {
  const current = await readDinner(io);
  const next = change(current);
  await io.write(DINNER_FILE, dinnerFileBody(next));
  return next;
}

/** Write the charter. Applying a second one replaces the first; it is one household. */
export async function saveCharter(
  charter: DinnerCharter,
  io: DinnerIo = dinnerIo,
): Promise<DinnerState> {
  return mutate(io, (s) => ({ ...s, charter }));
}

/**
 * Write the week and the list derived from it, in one write.
 *
 * Together because the list is a function of the plan: two writes would leave a
 * window in which the screen shows a shopping list for a week that is no longer
 * planned, and a crash in that window would make it permanent.
 */
export async function savePlan(
  plan: WeekPlan,
  shopping: readonly ShoppingItem[],
  io: DinnerIo = dinnerIo,
): Promise<DinnerState> {
  return mutate(io, (s) => ({ ...s, plan, shopping: [...shopping] }));
}

/** Write the list alone — what ticking a line off in the shop does. */
export async function saveShopping(
  shopping: readonly ShoppingItem[],
  io: DinnerIo = dinnerIo,
): Promise<DinnerState> {
  return mutate(io, (s) => ({ ...s, shopping: [...shopping] }));
}

/**
 * Write the dish photographs a plan's Apply looked up, and the plan that now
 * carries them, in one write.
 *
 * The cache is merged rather than replaced: it is keyed by dish name and
 * outlives every week, so a concurrent write that added another dish's
 * photograph is not undone by this one.
 *
 * The plan is written back only when the one on disk is still the one that was
 * photographed. A lookup takes seconds, and in those seconds the reader may
 * have applied an adjustment; the photographs are still worth keeping — they
 * are by name — but the week they were fetched for is stale and must not
 * overwrite the newer one.
 */
export async function saveDishPhotos(
  photos: Readonly<Record<string, DishPhotoEntry>>,
  plan: WeekPlan,
  io: DinnerIo = dinnerIo,
): Promise<DinnerState> {
  return mutate(io, (s) => ({
    ...s,
    dishPhotos: { ...s.dishPhotos, ...photos },
    plan: s.plan && s.plan.id === plan.id && s.plan.revision === plan.revision ? plan : s.plan,
  }));
}

/**
 * Forget the photograph of one dish, because the picture the search found will
 * not load in this app (see withoutDishPhoto). Called from the screen, not
 * from Apply: the `<img>` is the only place that finds out.
 *
 * Nothing is written when the name is not in the cache, so a strip of
 * ingredient pictures failing costs no writes at all.
 */
export async function markDishPhotoBroken(
  searchName: string,
  io: DinnerIo = dinnerIo,
): Promise<DinnerState> {
  return mutate(io, (s) => {
    const next = withoutDishPhoto(s.dishPhotos, searchName);
    return next ? { ...s, dishPhotos: next } : s;
  });
}

/**
 * Record a night that went differently: the sentence is kept and the plan it
 * was applied to is written with it. The caller has already run applyDeviation
 * — the bookkeeping is the program's, and it is pure, so it is not done here.
 */
export async function saveDeviation(
  deviation: Deviation,
  plan: WeekPlan,
  shopping: readonly ShoppingItem[],
  io: DinnerIo = dinnerIo,
): Promise<DinnerState> {
  return mutate(io, (s) => ({
    ...s,
    plan,
    shopping: [...shopping],
    deviations: [...s.deviations, deviation],
  }));
}
