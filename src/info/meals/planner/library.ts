// The dish library as one user sees it (docs/671 菜库, 替换组): the seed
// dishes and their own, each dish made with foods they can get. A dish with a
// food they dislike cannot be planned; a dish with a food they cannot buy
// takes a member of the food's swap group (dishes/swap.ts), and cannot be
// planned when no member fits.

import { SEED_DISHES } from "../dishes/seed";
import { swapUnavailable, dishFoods, type FoodSwap } from "../dishes/swap";
import { DEFAULT_KITCHEN, EQUIPMENT, type Dish, type Equipment } from "../dishes/types";
import { foodAllowed, foodById } from "../nutrition/foods";
import type { Profile } from "../nutrition/targets";

export type DishBlock = { food: string; reason: "dislike" | "unavailable" };

export interface PlanLibrary {
  /** The dish as this user gets it, swaps applied; undefined for an unknown id or a blocked dish. */
  dish(id: string): Dish | undefined;
  /** The dish as stored, whether or not it can be planned. */
  stored(id: string): Dish | undefined;
  /** Why the dish cannot be planned for this user, or null. */
  blocked(id: string): DishBlock | null;
  /** The swaps made to a dish, empty when none. */
  swaps(id: string): FoodSwap[];
  /** A food they dislike or cannot get. */
  foodBlocked(foodId: string): boolean;
  /** Their equipment: the default kitchen plus whatever the profile records. */
  kitchen: ReadonlySet<Equipment>;
}

type LibraryProfile = Pick<Profile, "dislikes" | "kitchen" | "unavailable">;

/** The default kitchen and every equipment id the profile names (docs/671 目标用户). */
export function kitchenOf(profile: Pick<Profile, "kitchen">): Set<Equipment> {
  const named = profile.kitchen.filter((k): k is Equipment => (EQUIPMENT as readonly string[]).includes(k));
  return new Set([...DEFAULT_KITCHEN, ...named]);
}

export function planLibrary(profile: LibraryProfile, dishes: readonly Dish[] = SEED_DISHES): PlanLibrary {
  const byId = new Map(dishes.map((d) => [d.id, d]));
  const unavailable = new Set(profile.unavailable ?? []);
  const disliked = (id: string) => {
    const f = foodById(id);
    return f ? !foodAllowed(f, profile.dislikes) : false;
  };
  const foodBlocked = (id: string) => unavailable.has(id) || disliked(id);
  const stapleDishIds = new Set(dishes.filter((d) => d.role === "staple").map((d) => d.id));
  const resolved = new Map<string, { dish?: Dish; block: DishBlock | null; swaps: FoodSwap[] }>();

  const resolve = (id: string) => {
    const hit = resolved.get(id);
    if (hit) return hit;
    const stored = byId.get(id);
    let out: { dish?: Dish; block: DishBlock | null; swaps: FoodSwap[] } = { block: null, swaps: [] };
    if (stored) {
      const hated = dishFoods(stored).find(disliked);
      if (hated) out = { block: { food: hated, reason: "dislike" }, swaps: [] };
      else {
        const r = swapUnavailable(stored, foodBlocked, { stapleDishIds });
        out = r.ok ? { dish: r.dish, block: null, swaps: r.swaps } : { block: { food: r.food, reason: "unavailable" }, swaps: [] };
      }
    }
    resolved.set(id, out);
    return out;
  };

  return {
    dish: (id) => resolve(id).dish,
    stored: (id) => byId.get(id),
    blocked: (id) => resolve(id).block,
    swaps: (id) => resolve(id).swaps,
    foodBlocked,
    kitchen: kitchenOf(profile),
  };
}
