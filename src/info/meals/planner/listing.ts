// The dish library as the model picks from it (docs/671 菜库, 对话): the mains
// this user can have, by id, and the breakfasts it may name when they asked
// for one. Dishes with a food they dislike or cannot get swapped are left out,
// and so are dishes their kitchen cannot make; a swapped dish goes by its
// swapped name. The model hands these ids to propose_meal_plan and never a
// gram; sides, staples of fresh mains, fruit and the other breakfasts are the
// program's (fill.ts).
//
// With the reader's portions it also says what only the model's picks decide:
// each main's sodium at one meal, and the fresh packs no side or breakfast
// uses, which the mains picked have to use up between them.

import { SEED_DISHES } from "../dishes/seed";
import type { Dish } from "../dishes/types";
import { foodById } from "../nutrition/foods";
import type { PlanLibrary } from "./library";
import { leftoverChecked, LEFTOVER_IGNORE } from "./packs";
import { mainsUsing, sodiumOf, type ReaderPortions } from "./portions";
import { DAY_SODIUM_MG } from "./solve";

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

/** The lines of the LIBRARY section, for this user's library and kitchen; sodium and packs when `portions` is given. */
export function libraryListing(lib: PlanLibrary, dishes: readonly Dish[] = SEED_DISHES, portions?: ReaderPortions): string[] {
  const usable = dishes
    .map((d) => lib.dish(d.id))
    .filter((d): d is Dish => !!d && d.equipment.every((e) => lib.kitchen.has(e)));
  const of = (pred: (d: Dish) => boolean) => usable.filter(pred);
  const out: string[] = [];
  const mg = (n: number) => (portions ? ` ${n} mg` : "");

  if (portions) {
    const breakfasts = of((d) => d.role === "breakfast").map((d) => sodiumOf(portions.breakfast(d)));
    // The program picks the less salty breakfasts: the lower quartile.
    const typical = breakfasts.sort((a, b) => a - b)[Math.floor(breakfasts.length / 4)] ?? 0;
    out.push(
      `Sodium: a day holds at most ${DAY_SODIUM_MG} mg. A breakfast comes to about ${typical} mg, so one day's lunch and`,
      `dinner together have about ${DAY_SODIUM_MG - typical} mg. The mg after each way and fresh main is one meal of it at their`,
      "portions (a way with its staple; a fresh main before the staple the program picks, which adds 0 to 400 mg).",
      "",
    );
  }
  out.push("BATCH MAINS (cooked in the prep session; `ways` are numbered from 1, each with its staple)");
  for (const d of of((d) => d.role === "main" && d.prep === "batch")) {
    // A way they cannot eat is left out; the others keep their numbers.
    const ways = (d.ways ?? [])
      .flatMap((w, i) => {
        if (lib.wayBlocked(d.id, i + 1)) return [];
        const na = portions ? sodiumOf([...portions.main(d, i + 1), ...(w.staple ? portions.staple(w.staple) : [])]) : 0;
        return [`${i + 1} ${w.name}${w.staple ? ` (${stapleWord(lib, w.staple)})` : ""}${mg(na)}`];
      })
      .join("; ");
    out.push(`- ${head(d)} protein ${proteinWords(d)}, hands-on ${d.activeMin} / total ${d.totalMin} min. ways: ${ways}`);
  }
  out.push("", "FRESH MAINS (made at the meal; the program picks the staple unless they asked for one of these)");
  for (const d of of((d) => d.role === "main" && d.prep === "fresh")) {
    const staples = d.staples.length ? d.staples.map((s) => stapleWord(lib, s)).join(", ") : "carries its own";
    out.push(`- ${head(d)} protein ${proteinWords(d)}, ${d.activeMin} min.${mg(portions ? sodiumOf(portions.main(d)) : 0)} staples: ${staples}`);
  }
  out.push("", "BREAKFASTS (the program picks them; name one only when they asked for it)");
  for (const d of of((d) => d.role === "breakfast")) out.push(`- ${d.id} ${d.name} / ${d.nameEn}`);

  if (portions) {
    const absorbers = of((d) => d.role === "side" || d.role === "breakfast");
    const mains = of((d) => d.role === "main");
    const packs: string[] = [];
    const seen = new Set<string>();
    for (const d of mains) {
      const ways = (d.ways ?? []).filter((_, i) => !lib.wayBlocked(d.id, i + 1));
      const foods = [...d.ingredients, ...ways.flatMap((w) => w.addOns)].map((l) => l.food);
      for (const w of ways) if (w.staple) foods.push(w.staple, ...(lib.dish(w.staple)?.ingredients.map((l) => l.food) ?? []));
      for (const id of foods) {
        if (seen.has(id)) continue;
        seen.add(id);
        const food = foodById(id);
        if (!food?.pack || !leftoverChecked(food) || absorbers.some((a) => a.ingredients.some((l) => l.food === id))) continue;
        const ok = Math.max(LEFTOVER_IGNORE.share * food.pack.grams, LEFTOVER_IGNORE.grams);
        const users = mainsUsing(portions, mains, id, lib).map((u) => `${u.id} ${u.grams}`);
        packs.push(`- ${foodWord(id)}: ${food.pack.grams} g a ${food.pack.kind}, under ${Math.round(ok)} g left is fine. ${users.join(", ")}`);
      }
    }
    if (packs.length) {
      out.push(
        "",
        "PACKS ONLY MAINS USE UP (no side or breakfast uses these fresh foods, so the mains you pick use up every pack",
        "they open; a pot uses its share at each meal it feeds. One meal's share at their portions follows each pack.)",
        ...packs,
      );
    }
  }
  return out;
}
