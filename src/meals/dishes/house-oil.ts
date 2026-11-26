// The household's cooking oil (docs/671 菜库). A dish line marked
// `cookingOil` is only the fat the pan is greased with, so it takes the oil
// the profile names; a line where the oil is the taste (olive oil on a salad,
// sesame oil on greens) keeps its own. Grams stay as written: the three oils
// weigh and burn the same within a gram, and the solver reads the new food's
// own nutrition.

import { foodAllowed, foodById } from "../nutrition/foods";
import type { CookingOil, Profile } from "../nutrition/targets";
import type { Dish, DishIngredient } from "./types";

/** The whole foods an oil is pressed from: disliking one of them refuses the oil too. */
const PRESSED_FROM: Readonly<Record<CookingOil, readonly string[]>> = {
  peanut_oil: ["peanuts"],
  canola_oil: [],
  olive_oil: [],
};

/** Whether their dislikes keep this oil out: the oil itself, its tag, or the food it is pressed from. */
export function oilRefused(oil: CookingOil, dislikes: readonly string[]): boolean {
  return [oil, ...PRESSED_FROM[oil]].some((id) => {
    const food = foodById(id);
    return !!food && !foodAllowed(food, dislikes);
  });
}

/** The oil the planner cooks with for this profile: theirs when set and nothing refuses it, else null. */
export function houseOil(profile: Pick<Profile, "cookingOil" | "dislikes" | "unavailable">): CookingOil | null {
  const oil = profile.cookingOil;
  if (!oil || !foodById(oil)) return null;
  if (profile.unavailable?.includes(oil) || oilRefused(oil, profile.dislikes)) return null;
  return oil;
}

const lines = (ls: readonly DishIngredient[], oil: string) => ls.map((l) => (l.cookingOil && l.food !== oil ? { ...l, food: oil } : l));

/** The dish with every cooking-fat line on the household oil; the same object when nothing changes. */
export function withHouseOil(dish: Dish, oil: string | null): Dish {
  if (!oil) return dish;
  const touches = (ls: readonly DishIngredient[]) => ls.some((l) => l.cookingOil && l.food !== oil);
  if (!touches(dish.ingredients) && !(dish.ways ?? []).some((w) => touches(w.addOns))) return dish;
  return {
    ...dish,
    ingredients: lines(dish.ingredients, oil),
    ...(dish.ways ? { ways: dish.ways.map((w) => ({ ...w, addOns: lines(w.addOns, oil) })) } : {}),
  };
}
