// The reader's own dishes: info-meals-dishes.json (docs/platform/687 三餐,
// docs/671 菜库). A dish the seed library does not have, written by the model
// and passed through the same intake check as every seed dish (check.ts
// checkDish), then planned like one: planner/library.ts reads the seed
// dishes and these together (libraryDishes).
//
// Each dish is a record under its id, merged per id (palace/kinds.ts), so a
// dish added on one device and another changed on the other both survive a
// crossing sync. An id is never a seed dish's: a user's dish adds to the
// library, it does not replace a seed dish.
//
// The planner reads the library synchronously, so the dishes are held in
// memory here: loaded when the shell boots, replaced by every write of this
// module and by every pull of the file (MEALS_DISHES_PULL_ROUTE).

import { appGuardedFileIo, readGuardedFile, type GuardedFileIo } from "../../../platform/app/guarded-file";
import { isObject } from "../../../platform/std/json";
import { registerPullRoute, type PullMatcher } from "../../../platform/sync/pull-routes";
import { checkDish } from "./check";
import { SEED_DISHES } from "./seed";
import { DISH_ROLES, type Dish } from "./types";

export const MEALS_DISHES_FILE = "info-meals-dishes.json";
const DISHES_VERSION = 1;

/** What the file holds: the reader's dishes by id. */
export interface UserDishes {
  dishes: Record<string, Dish>;
}

export type UserDishIo = GuardedFileIo<UserDishes>;

export const userDishIo: UserDishIo = appGuardedFileIo();

const SEED_IDS: ReadonlySet<string> = new Set(SEED_DISHES.map((d) => d.id));

function isDish(raw: unknown): raw is Dish {
  return (
    isObject(raw) &&
    typeof raw.id === "string" &&
    typeof raw.name === "string" &&
    typeof raw.nameEn === "string" &&
    DISH_ROLES.includes(raw.role as never) &&
    Array.isArray(raw.ingredients) &&
    Array.isArray(raw.equipment) &&
    Array.isArray(raw.staples)
  );
}

/** The dishes out of a parsed file, or null when the bytes are not this shape. A record that does not read, or that names a seed id, is skipped. */
export function parseUserDishFile(raw: unknown): UserDishes | null {
  if (!isObject(raw)) return null;
  const dishes: Record<string, Dish> = {};
  if (isObject(raw.dishes)) {
    for (const [id, dish] of Object.entries(raw.dishes)) {
      if (!isDish(dish) || dish.id !== id || SEED_IDS.has(id)) continue;
      dishes[id] = { ...dish, origin: "user" };
    }
  }
  return { dishes };
}

/** The file body to write. */
export function userDishFileBody(state: UserDishes): string {
  return JSON.stringify({ version: DISHES_VERSION, dishes: state.dishes }, null, 2);
}

export type UserDishWrite =
  | { ok: true; dishes: Record<string, Dish>; dish: Dish }
  /** One English line per problem, for the model to fix the dish. */
  | { ok: false; problems: string[] };

/**
 * Add a dish of the reader's or change one of theirs: the dishes after the
 * write, or why it is refused. Refused when the id is empty or a seed dish's,
 * and when the dish fails any rule of the intake check. The dish is stored as
 * the reader's (`origin: "user"`), keeping the first write's `createdAt`.
 */
export function writeUserDish(current: Readonly<Record<string, Dish>>, dish: Dish, now: string): UserDishWrite {
  const id = dish.id.trim();
  if (!id) return { ok: false, problems: ["the dish needs an id"] };
  if (SEED_IDS.has(id)) return { ok: false, problems: [`${id} is a seed dish; give the reader's dish an id of its own`] };
  const stored: Dish = { ...dish, id, origin: "user", createdAt: current[id]?.createdAt ?? now };
  const others = Object.values(current).filter((d) => d.id !== id);
  const stapleDishIds = new Set([...SEED_DISHES, ...others, stored].filter((d) => d.role === "staple").map((d) => d.id));
  const check = checkDish(stored, { stapleDishIds });
  if (!check.ok) return { ok: false, problems: check.failures.map((f) => `${id}: ${f.message}`) };
  return { ok: true, dishes: { ...current, [id]: stored }, dish: stored };
}

export type UserDishRemoval = { ok: true; dishes: Record<string, Dish> } | { ok: false; problems: string[] };

/** Take one of the reader's dishes out: the dishes after, or why not (a seed dish, or no such dish of theirs). */
export function removeUserDish(current: Readonly<Record<string, Dish>>, id: string): UserDishRemoval {
  if (SEED_IDS.has(id)) return { ok: false, problems: [`${id} is a seed dish; only the reader's own dishes can be removed`] };
  if (!current[id]) return { ok: false, problems: [`the reader has no dish ${id}`] };
  const { [id]: _gone, ...rest } = current;
  return { ok: true, dishes: rest };
}

let held: readonly Dish[] = [];
// Bumped by every write here, so a read that started before it does not hold
// the older copy when it lands (pitfall 484).
let writes = 0;

/** The reader's dishes as last read or written on this device. */
export function userDishes(): readonly Dish[] {
  return held;
}

/** The library the planner reads: the seed dishes, then the reader's. */
export function libraryDishes(): readonly Dish[] {
  return held.length ? [...SEED_DISHES, ...held] : SEED_DISHES;
}

/** Replace what is held; for the store and for tests. */
export function holdUserDishes(dishes: readonly Dish[]): void {
  held = [...dishes];
}

/** The file as it is on disk, held from now on. */
export async function loadUserDishes(io: UserDishIo = userDishIo): Promise<UserDishes> {
  const before = writes;
  const state = (await readGuardedFile(io, MEALS_DISHES_FILE, parseUserDishFile)) ?? { dishes: {} };
  if (writes === before) holdUserDishes(Object.values(state.dishes));
  return state;
}

/** Check and write one dish of the reader's (writeUserDish), merged into what is on disk. Nothing is written when it is refused. */
export async function saveUserDish(dish: Dish, io: UserDishIo = userDishIo, now: number = Date.now()): Promise<UserDishWrite> {
  const current = await loadUserDishes(io);
  const out = writeUserDish(current.dishes, dish, new Date(now).toISOString());
  if (!out.ok) return out;
  await io.write(MEALS_DISHES_FILE, userDishFileBody({ dishes: out.dishes }));
  writes++;
  holdUserDishes(Object.values(out.dishes));
  return out;
}

/** Remove one dish of the reader's from disk (removeUserDish). The caller asks the reader first. */
export async function deleteUserDish(id: string, io: UserDishIo = userDishIo): Promise<UserDishRemoval> {
  const current = await loadUserDishes(io);
  const out = removeUserDish(current.dishes, id);
  if (!out.ok) return out;
  await io.write(MEALS_DISHES_FILE, userDishFileBody({ dishes: out.dishes }));
  writes++;
  holdUserDishes(Object.values(out.dishes));
  return out;
}

/** The file arriving from the other device: what is held is read again. */
export const MEALS_DISHES_PULL_ROUTE: PullMatcher = {
  id: "meals-dishes",
  matches: (path) => path === MEALS_DISHES_FILE,
};

let started = false;

/** Read the reader's dishes now and on every pull of the file. Idempotent; called once from the shells' bootDomains. */
export function startMealsUserDishes(): void {
  if (started) return;
  started = true;
  const read = () => void loadUserDishes().catch((e) => console.warn("failed to read the reader's dishes", e));
  registerPullRoute({ ...MEALS_DISHES_PULL_ROUTE, onPulled: read });
  read();
}
