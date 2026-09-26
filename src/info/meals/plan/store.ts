// The meals file on disk (docs/73): one JSON under AppData holding the
// reader's profile, the week being eaten, the one shopping trip derived from it
// and the meals that went differently.
//
// Read through readGuardedJson for the reason info-labs.json is: every
// mutation here is load-modify-save, so a read that failed must not become the
// file that gets written (docs/13).
//
// One file rather than four, and merged opaque rather than by field: the plan,
// the trip derived from it and the deviations applied to it are not independent
// of each other, and a per-field merge would assemble a state that never
// existed on either device (pitfall 237).

import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../../platform/app/guarded-file";
import { isObject } from "../../../platform/std/json";
import type { Profile } from "../nutrition/targets";
import {
  EMPTY_MEALS,
  EMPTY_SHOPPING,
  MEAL_KEYS,
  MEALS_VERSION,
  type Deviation,
  type MealKey,
  type MealsCharter,
  type MealsState,
  type ShoppingItem,
  type ShoppingState,
  type WeekPlan,
} from "./types";

export const MEALS_FILE = "info-meals.json";

// The file access this store needs, as a parameter (platform/app/guarded-file).
export type MealsIo = GuardedFileIo<MealsState>;

export const mealsIo: MealsIo = appGuardedFileIo();

/**
 * The state out of a parsed info-meals.json, or null when the bytes are not
 * this writer's shape at all — which is what readGuardedJson quarantines.
 *
 * A file of an earlier schema (no `version`, or version 1: a charter of free
 * text and dishes with free-text ingredients) is read as empty apart from the
 * photo ask. The reader goes through onboarding and plans afresh; the file is
 * left as it is until the next write replaces it.
 *
 * Fields a newer build wrote ride through untouched: the objects are returned
 * as they were read.
 */
export function parseMealsFile(raw: unknown): MealsState | null {
  if (!isObject(raw)) return null;
  const asked = typeof raw.photosAskedAt === "number" ? raw.photosAskedAt : undefined;
  const photos = asked === undefined ? {} : { photosAskedAt: asked };
  if (!(typeof raw.version === "number" && raw.version >= MEALS_VERSION)) {
    return { ...EMPTY_MEALS, shopping: { ...EMPTY_SHOPPING }, ...photos };
  }
  return {
    charter: validateCharter(raw.charter),
    plan: validatePlan(raw.plan),
    shopping: validateShopping(raw.shopping),
    deviations: Array.isArray(raw.deviations) ? raw.deviations.filter(isDeviation) : [],
    ...photos,
  };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/** A profile as onboarding wrote it, or null. */
export function validateProfile(raw: unknown): Profile | null {
  if (!isObject(raw)) return null;
  const ok =
    typeof raw.consent === "string" &&
    typeof raw.goal === "string" &&
    typeof raw.sex === "string" &&
    isNum(raw.age) &&
    isNum(raw.heightCm) &&
    isNum(raw.weightKg) &&
    Array.isArray(raw.trainingDays) &&
    raw.trainingDays.every(isNum) &&
    typeof raw.trainTime === "string" &&
    typeof raw.work === "string" &&
    isNum(raw.minutesPerMeal) &&
    isNum(raw.people) &&
    isStrings(raw.shops) &&
    isStrings(raw.kitchen) &&
    isStrings(raw.dislikes);
  return ok ? (raw as unknown as Profile) : null;
}

function validateCharter(raw: unknown): MealsCharter | null {
  if (!isObject(raw)) return null;
  const profile = validateProfile(raw.profile);
  if (!profile) return null;
  return { ...(raw as unknown as MealsCharter), profile, text: typeof raw.text === "string" ? raw.text : "" };
}

function validatePlan(raw: unknown): WeekPlan | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string" || typeof raw.startDate !== "string") return null;
  if (typeof raw.revision !== "number" || !Array.isArray(raw.days)) return null;
  const dayOk = (d: unknown) =>
    isObject(d) && typeof d.date === "string" && MEAL_KEYS.every((k) => isObject(d[k]) && typeof d[k].mode === "string");
  if (!raw.days.every(dayOk)) return null;
  return raw as unknown as WeekPlan;
}

// The trip, with every half defaulted.
function validateShopping(raw: unknown): ShoppingState {
  if (!isObject(raw)) return { ...EMPTY_SHOPPING };
  return {
    items: Array.isArray(raw.items) ? raw.items.filter(isShoppingItem) : [],
    reader: Array.isArray(raw.reader) ? raw.reader.filter(isShoppingItem) : [],
    dropped: isObject(raw.dropped) ? (raw.dropped as Record<string, true>) : {},
    replaced: isObject(raw.replaced) ? (raw.replaced as ShoppingState["replaced"]) : {},
    checked: isObject(raw.checked) ? (raw.checked as Record<string, true>) : {},
    doneOn: typeof raw.doneOn === "string" ? raw.doneOn : null,
  };
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

// No file is an empty state. A file sitting there unread is not that — it
// raises, so the next write cannot put one drafted week over the reader's own.
async function readMeals(io: MealsIo): Promise<MealsState> {
  const state = await readGuardedFile(io, MEALS_FILE, parseMealsFile);
  return state ?? { ...EMPTY_MEALS, shopping: { ...EMPTY_SHOPPING } };
}

/** Everything the meals screen shows, as one read. */
export async function loadMeals(io: MealsIo = mealsIo): Promise<MealsState> {
  return readMeals(io);
}

// Apply a change and write the file. Returns the state now on disk.
async function mutate(
  io: MealsIo,
  change: (state: MealsState) => MealsState,
): Promise<MealsState> {
  const current = await readMeals(io);
  const next = change(current);
  await io.write(MEALS_FILE, mealsFileBody(next));
  return next;
}

/**
 * Write the charter, and with it the week re-solved against it and the trip
 * re-derived, in one write: a profile change moves every gram (docs/73 体重变化).
 */
export async function saveCharter(
  charter: MealsCharter,
  week: { plan: WeekPlan; shopping: ShoppingState } | null = null,
  io: MealsIo = mealsIo,
): Promise<MealsState> {
  return mutate(io, (s) => ({ ...s, charter, ...(week ? { plan: week.plan, shopping: week.shopping } : {}) }));
}

/**
 * Write the week and the trip derived from it, in one write: two writes would
 * leave a window in which the screen shows a list for a week no longer planned.
 */
export async function savePlan(
  plan: WeekPlan,
  shopping: ShoppingState,
  io: MealsIo = mealsIo,
): Promise<MealsState> {
  return mutate(io, (s) => ({ ...s, plan, shopping }));
}

/** Write the trip alone — what ticking a line off in the shop does. */
export async function saveShopping(
  shopping: ShoppingState,
  io: MealsIo = mealsIo,
): Promise<MealsState> {
  return mutate(io, (s) => ({ ...s, shopping }));
}

/**
 * Record a meal that went differently, with the plan and trip it produced. The
 * caller has already run applyDeviation and re-solved.
 */
export async function saveDeviation(
  deviation: Deviation,
  plan: WeekPlan,
  shopping: ShoppingState,
  io: MealsIo = mealsIo,
): Promise<MealsState> {
  return mutate(io, (s) => ({ ...s, plan, shopping, deviations: [...s.deviations, deviation] }));
}

/** Write down that the reader asked for the photographs again (docs/73 图片). */
export async function savePhotosAsked(at: number, io: MealsIo = mealsIo): Promise<MealsState> {
  return mutate(io, (s) => ({ ...s, photosAskedAt: at }));
}

/**
 * Rewrite one made meal's method line, because the reader asked for another
 * way to make it. A meal that is no longer made is left alone.
 */
export async function saveMealMethod(
  date: string,
  meal: MealKey,
  method: string,
  io: MealsIo = mealsIo,
): Promise<MealsState> {
  return mutate(io, (s) => {
    const day = s.plan?.days.find((d) => d.date === date);
    if (!s.plan || !day || day[meal].mode !== "make") return s;
    const days = s.plan.days.map((d) => (d.date === date ? { ...d, [meal]: { ...d[meal], method } } : d));
    return { ...s, plan: { ...s.plan, days } };
  });
}
