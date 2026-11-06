// The dish library as one user sees it (docs/671 菜库, 替换组): the seed
// dishes and their own (dishes/user-dishes.ts), each dish made with foods they can get. A dish with a
// food they dislike in the pan or among its staples cannot be planned; a pot's
// way with one on the plate (an add-on, its staple) cannot be eaten, and the
// pot keeps its other ways. A dish with a food they cannot buy takes a member
// of the food's swap group (dishes/swap.ts), and cannot be planned when no
// member fits. A line of cooking fat takes the household's oil first
// (dishes/house-oil.ts), so every dish read through here, and everything
// solved, bought and cooked from it, uses that oil.

import { libraryDishes } from "../dishes/user-dishes";
import { houseOil, withHouseOil } from "../dishes/house-oil";
import { swapUnavailable, type FoodSwap } from "../dishes/swap";
import { DEFAULT_KITCHEN, EQUIPMENT, type Dish, type DishWay, type Equipment } from "../dishes/types";
import { foodAllowed, foodById } from "../nutrition/foods";
import type { Profile } from "../nutrition/targets";

export type DishBlock = { food: string; reason: "dislike" | "unavailable" };

export interface PlanLibrary {
  /** Every dish the library was built from, as stored: the seed dishes, then the reader's own. */
  all(): readonly Dish[];
  /** The dish as this user gets it, swaps applied; undefined for an unknown id or a blocked dish. */
  dish(id: string): Dish | undefined;
  /** The dish as stored, whether or not it can be planned. */
  stored(id: string): Dish | undefined;
  /** Why the dish cannot be planned for this user, or null. */
  blocked(id: string): DishBlock | null;
  /** Why one of a batch dish's ways (numbered from 1) cannot be eaten, or null when it can. */
  wayBlocked(id: string, way: number): DishBlock | null;
  /** The swaps made to a dish, empty when none. */
  swaps(id: string): FoodSwap[];
  /** A food they dislike or cannot get. */
  foodBlocked(foodId: string): boolean;
  /** The household's cooking oil when it is in use, the fat a solve adds and every cooking-fat line takes. */
  houseOil?: string;
  /** Their equipment: the default kitchen plus whatever the profile names. */
  kitchen: ReadonlySet<Equipment>;
}

type LibraryProfile = Pick<Profile, "dislikes" | "kitchen" | "unavailable" | "cookingOil">;

// What a profile's kitchen entry names, in the words people use: the
// onboarding's options are Chinese (一口锅, 电压力锅, 带蒸架的小锅), the
// conversation writes whatever the reader said, and an equipment id counts too.
const EQUIPMENT_WORDS: readonly [Equipment, RegExp][] = [
  ["oven", /(?<!microwave |dutch )oven|烤箱/],
  ["air_fryer", /air ?fryer|空气炸锅|空气锅/],
  ["rice_cooker", /rice ?cooker|电饭煲|电饭锅/],
  ["pressure_cooker", /pressure ?cooker|instant ?pot|multi ?cooker|压力锅|高压锅/],
  ["slow_cooker", /slow ?cooker|crock ?pot|慢炖锅|电炖锅/],
  ["steamer", /steam|蒸/],
  ["microwave", /microwave|微波/],
  ["kettle", /kettle|水壶/],
  ["soy_milk_maker", /soy ?milk|soymilk|豆浆机/],
  ["toaster", /toaster|烤面包机|多士炉/],
];

/** The equipment one kitchen entry names, none when it names nothing the planner knows ("一口锅" is the default stove). */
export function equipmentNamed(entry: string): Equipment[] {
  const text = entry.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if ((EQUIPMENT as readonly string[]).includes(entry)) return [entry as Equipment];
  return EQUIPMENT_WORDS.filter(([, re]) => re.test(text)).map(([id]) => id);
}

/** The default kitchen and every appliance the profile names (docs/671 目标用户). */
export function kitchenOf(profile: Pick<Profile, "kitchen">): Set<Equipment> {
  return new Set([...DEFAULT_KITCHEN, ...profile.kitchen.flatMap(equipmentNamed)]);
}

/**
 * The dish cooked the first way the kitchen fits: its own equipment, else the
 * first route that fits, its minutes and summary taken over. A dish no way
 * fits comes back as it is, and the callers that check the kitchen leave it out.
 */
export function fitKitchen(dish: Dish, kitchen: ReadonlySet<Equipment>): Dish {
  const fits = (eq: readonly Equipment[]) => eq.every((e) => kitchen.has(e));
  if (fits(dish.equipment)) return dish;
  const route = dish.routes?.find((r) => fits(r.equipment));
  if (!route) return dish;
  return {
    ...dish,
    equipment: [...route.equipment],
    activeMin: route.activeMin,
    totalMin: route.totalMin,
    summary: route.summary,
    summaryEn: route.summaryEn,
  };
}

interface Resolved {
  dish?: Dish;
  block: DishBlock | null;
  swaps: FoodSwap[];
  ways: (DishBlock | null)[];
}

export function planLibrary(profile: LibraryProfile, dishes: readonly Dish[] = libraryDishes()): PlanLibrary {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const unavailable = new Set(profile.unavailable ?? []);
  const disliked = (id: string) => {
    const f = foodById(id);
    return f ? !foodAllowed(f, profile.dislikes) : false;
  };
  const foodBlocked = (id: string) => unavailable.has(id) || disliked(id);
  const stapleDishIds = new Set(dishes.filter((d) => d.role === "staple").map((d) => d.id));
  const resolved = new Map<string, Resolved>();
  const oil = houseOil(profile);
  const kitchen = kitchenOf(profile);

  const wayBlock = (w: DishWay): DishBlock | null => {
    const hated = [...w.addOns.map((l) => l.food), ...(w.staple ? [w.staple] : [])].find(disliked);
    if (hated) return { food: hated, reason: "dislike" };
    return w.staple && stapleDishIds.has(w.staple) ? resolve(w.staple).block : null;
  };

  const resolve = (id: string): Resolved => {
    const hit = resolved.get(id);
    if (hit) return hit;
    const raw = byId.get(id);
    let out: Resolved = { block: null, swaps: [], ways: [] };
    if (raw) {
      const stored = withHouseOil(raw, oil);
      const ways = (stored.ways ?? []).map(wayBlock);
      const hated = [...stored.ingredients.map((l) => l.food), ...stored.staples].find(disliked);
      if (hated) out = { block: { food: hated, reason: "dislike" }, swaps: [], ways };
      else if (ways.length && ways.every(Boolean)) out = { block: ways[0] ?? null, swaps: [], ways };
      else {
        // A food they dislike is never swapped: its way is not eaten instead.
        const r = swapUnavailable(stored, foodBlocked, { stapleDishIds }, (f) => unavailable.has(f) && !disliked(f));
        out = r.ok
          ? { dish: fitKitchen(r.dish, kitchen), block: null, swaps: r.swaps, ways }
          : { block: { food: r.food, reason: "unavailable" }, swaps: [], ways };
      }
    }
    resolved.set(id, out);
    return out;
  };

  return {
    all: () => dishes,
    dish: (id) => resolve(id).dish,
    stored: (id) => byId.get(id),
    blocked: (id) => resolve(id).block,
    wayBlocked: (id, way) => resolve(id).ways[way - 1] ?? null,
    swaps: (id) => resolve(id).swaps,
    foodBlocked,
    ...(oil ? { houseOil: oil } : {}),
    kitchen,
  };
}
