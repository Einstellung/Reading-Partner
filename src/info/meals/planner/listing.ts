// The dish library as the model picks from it (docs/671 菜库, 对话): every dish
// this user can have, by id, grouped by what a draft uses it for. Dishes with
// a food they dislike or cannot get swapped are left out, and so are dishes
// their kitchen cannot make; a swapped dish goes by its swapped name. The
// model hands these ids to propose_meal_plan and never a gram.

import { SEED_DISHES } from "../dishes/seed";
import type { Dish } from "../dishes/types";
import { FOODS, foodById } from "../nutrition/foods";
import type { PlanLibrary } from "./library";

function foodWord(id: string): string {
  const f = foodById(id);
  return f ? `${id} ${f.zh}` : id;
}

/** A staple ref (food or staple dish) as the listing names it. */
function stapleWord(lib: PlanLibrary, id: string): string {
  const d = lib.dish(id);
  return d ? `${id} ${d.name}` : foodWord(id);
}

/** The protein foods' categories (poultry, meat, seafood, soy...), for the variety rules. */
function proteinWords(d: Dish): string {
  const cats = new Set<string>();
  for (const line of d.ingredients) {
    if (line.role !== "protein") continue;
    const cat = foodById(line.food)?.proteinCategory;
    if (cat) cats.add(cat);
  }
  return [...cats].join("+") || "-";
}

function head(d: Dish): string {
  return `${d.id} ${d.name} / ${d.nameEn} [${d.cuisine}; ${d.equipment.join(",")}]`;
}

/** The lines of the LIBRARY section, for this user's library and kitchen. */
export function libraryListing(lib: PlanLibrary, dishes: readonly Dish[] = SEED_DISHES): string[] {
  const usable = dishes
    .map((d) => lib.dish(d.id))
    .filter((d): d is Dish => !!d && d.equipment.every((e) => lib.kitchen.has(e)));
  const of = (pred: (d: Dish) => boolean) => usable.filter(pred);
  const out: string[] = [];

  out.push("BATCH MAINS (cooked in the prep session; `ways` are numbered from 1, each with its staple)");
  for (const d of of((d) => d.role === "main" && d.prep === "batch")) {
    const ways = (d.ways ?? [])
      .map((w, i) => `${i + 1} ${w.name}${w.staple ? ` (${stapleWord(lib, w.staple)})` : ""}`)
      .join("; ");
    out.push(`- ${head(d)} protein ${proteinWords(d)}, hands-on ${d.activeMin} / total ${d.totalMin} min. ways: ${ways}`);
  }
  out.push("", "FRESH MAINS (made at the meal; pick one of its staples)");
  for (const d of of((d) => d.role === "main" && d.prep === "fresh")) {
    const staples = d.staples.length ? d.staples.map((s) => stapleWord(lib, s)).join(", ") : "carries its own";
    out.push(`- ${head(d)} protein ${proteinWords(d)}, ${d.activeMin} min. staples: ${staples}`);
  }
  out.push("", "BREAKFASTS");
  for (const d of of((d) => d.role === "breakfast")) out.push(`- ${d.id} ${d.name} / ${d.nameEn}`);
  out.push("", "STAPLE DISHES (a staple a fresh main or a way names)");
  for (const d of of((d) => d.role === "staple")) out.push(`- ${d.id} ${d.name} / ${d.nameEn}`);
  out.push("", "SIDES (vegetable dishes added to a lunch or dinner)");
  for (const d of of((d) => d.role === "side")) out.push(`- ${d.id} ${d.name} / ${d.nameEn}, ${d.activeMin} min`);
  out.push("", "FRUIT (food ids for `fruit`, one id per portion)");
  out.push(
    FOODS.filter((f) => f.roles.includes("fruit") && !lib.foodBlocked(f.id))
      .map((f) => `${f.id} ${f.zh}`)
      .join(", "),
  );
  return out;
}
