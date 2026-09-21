// The meals file on disk (docs/73): one JSON under AppData holding the
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
import {
  MEALS_VERSION,
  EMPTY_MEALS,
  type Deviation,
  type MealsCharter,
  type MealsState,
  type ShoppingItem,
  type WeekPlan,
} from "./types";

export const MEALS_FILE = "info-meals.json";

// The file access this store needs, as a parameter. A test hands it an
// in-memory AppData instead of rewriting the module registry with mock.module,
// which rewrites it for every other test file in the same worker (pitfall 119).
export interface MealsIo {
  read(
    file: string,
    validate: (raw: unknown) => MealsState | null,
  ): Promise<GuardedRead<MealsState>>;
  write(file: string, contents: string): Promise<void>;
  quarantine(file: string): Promise<string | null>;
  reportCorrupt(report: CorruptFileReport): void;
}

export const mealsIo: MealsIo = {
  read: readGuardedJson,
  write: writeTextAtomic,
  quarantine: quarantineFile,
  reportCorrupt: (report) => reportStoreError("corrupt-file", report),
};

/**
 * The state out of a parsed info-meals.json, or null when the bytes are not
 * this writer's shape at all — which is what readGuardedJson quarantines.
 *
 * Fields a newer build wrote ride through untouched: the objects are returned
 * as they were read, so a device on an older build does not delete them.
 */
export function parseMealsFile(raw: unknown): MealsState | null {
  if (!isObject(raw)) return null;
  const plan = validatePlan(raw.plan);
  const charter = validateCharter(raw.charter);
  const shopping = Array.isArray(raw.shopping)
    ? raw.shopping.filter(isShoppingItem)
    : [];
  const deviations = Array.isArray(raw.deviations)
    ? raw.deviations.filter(isDeviation)
    : [];
  return { charter, plan, shopping, deviations };
}

function validateCharter(raw: unknown): MealsCharter | null {
  if (!isObject(raw)) return null;
  if (typeof raw.text !== "string") return null;
  if (typeof raw.people !== "number") return null;
  return raw as unknown as MealsCharter;
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
export function mealsFileBody(state: MealsState): string {
  return JSON.stringify({ version: MEALS_VERSION, ...state }, null, 2);
}

// No file is an empty state: a reader who has never opened the screen has none.
// A file sitting there unread is not that — it raises, so the next write cannot
// put one drafted week over the reader's own.
async function readMeals(io: MealsIo): Promise<MealsState> {
  const read = await io.read(MEALS_FILE, parseMealsFile);
  if (read.status === "ok") return read.value;
  if (read.status === "missing") return { ...EMPTY_MEALS };
  if (read.savedAs === null) throw new Error(`${MEALS_FILE} could not be read`);
  return { ...EMPTY_MEALS };
}

/** Everything the meals screen shows, as one read. */
export async function loadMeals(io: MealsIo = mealsIo): Promise<MealsState> {
  return readMeals(io);
}

// Apply a change and write the file. Returns the state now on disk: the changed
// one when it was written, the one read otherwise, so a caller that renders
// what it gets back shows the file rather than a change that did not land.
async function mutate(
  io: MealsIo,
  change: (state: MealsState) => MealsState,
): Promise<MealsState> {
  const current = await readMeals(io);
  const next = change(current);
  await io.write(MEALS_FILE, mealsFileBody(next));
  return next;
}

/** Write the charter. Applying a second one replaces the first; it is one household. */
export async function saveCharter(
  charter: MealsCharter,
  io: MealsIo = mealsIo,
): Promise<MealsState> {
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
  io: MealsIo = mealsIo,
): Promise<MealsState> {
  return mutate(io, (s) => ({ ...s, plan, shopping: [...shopping] }));
}

/** Write the list alone — what ticking a line off in the shop does. */
export async function saveShopping(
  shopping: readonly ShoppingItem[],
  io: MealsIo = mealsIo,
): Promise<MealsState> {
  return mutate(io, (s) => ({ ...s, shopping: [...shopping] }));
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
  io: MealsIo = mealsIo,
): Promise<MealsState> {
  return mutate(io, (s) => ({
    ...s,
    plan,
    shopping: [...shopping],
    deviations: [...s.deviations, deviation],
  }));
}
