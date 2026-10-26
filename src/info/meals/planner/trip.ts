// The shopping list of a plan made by the planner (docs/671 整包与开封, 给用户看的量):
// the whole-pack list (packs.ts) written as the stored list lines the shopping
// screen already reads, so ticks, the reader's own lines and their swaps work
// the same as on a week from the old weekly card. The quantity is packs,
// pieces and "about" weights; grams stay inside the program.
//
// A meal that went differently (any mode but make) is not shopped for.

import { t } from "../../../i18n";
import { foodById } from "../nutrition/foods";
import { CATEGORY_ORDER, KEEPS_ORDER, type PackNote, type ShoppingItem, type WeekPlan } from "../plan/types";
import { addDays } from "../plan/week";
import type { PlanDraft } from "./draft";
import { boughtName, buyText, leftoverMatters, packList, type PackLine } from "./packs";
import type { SolvedPlan } from "./solve";

const about = (g: number) => Math.max(10, Math.round(g / 10) * 10);

/** One whole-pack line as a stored list line, day 1 on `start` (a line first needed at a prep-day session is needed the day before). */
export function packItem(line: PackLine, start: string): ShoppingItem | null {
  const food = foodById(line.food);
  if (!food) return null;
  const item: ShoppingItem = {
    name: boughtName(food),
    en: food.en,
    // A food with no pack, piece or unit is bought by an "about" weight: 「约 300 g」.
    qty: line.buy.by === "weight" ? t("meals.pack.aboutWeight", { grams: about(line.grams) }) : buyText(line),
    category: food.category,
    keeps: food.keeps,
    foodId: food.id,
    grams: Math.round(line.grams),
    freezeOnArrival: line.freeze,
    neededBy: addDays(start, line.firstDay - 1),
  };
  const pack: PackNote = {};
  if (line.frozen) pack.frozen = true;
  if (line.buy.by === "onHand") pack.onHand = true;
  if (line.leftover && leftoverMatters(line)) {
    pack.leftover = { grams: about(line.leftover.grams), useBy: addDays(start, line.leftover.spoilsDay - 1) };
  }
  return { ...item, pack };
}

/** The solved plan with the meals the stored plan no longer makes taken out. */
function madeOnly(solved: SolvedPlan, plan: WeekPlan, start: string): SolvedPlan {
  const byDate = new Map(plan.days.map((d) => [d.date, d]));
  const prepDay = byDate.get(addDays(start, -1));
  const prep = solved.prepDinner;
  return {
    ...solved,
    ...(prep && prepDay && prepDay.dinner.mode !== "make" ? { prepDinner: { ...prep, lines: [] } } : {}),
    days: solved.days.map((d) => {
      const stored = byDate.get(addDays(start, d.day - 1));
      if (!stored) return d;
      const made = (k: "breakfast" | "lunch" | "dinner") => stored[k].mode === "make";
      return {
        ...d,
        meals: {
          breakfast: made("breakfast") ? d.meals.breakfast : { ...d.meals.breakfast, lines: [] },
          lunch: made("lunch") ? d.meals.lunch : { ...d.meals.lunch, lines: [] },
          dinner: made("dinner") ? d.meals.dinner : { ...d.meals.dinner, lines: [] },
        },
        fruit: stored.snack.mode === "make" ? d.fruit : [],
        snack: stored.snack.mode === "make" ? d.snack : [],
      };
    }),
  };
}

/**
 * The list lines of a planner plan: whole packs for every meal it still makes,
 * times the people eating, in aisle order and the shortest shelf life first.
 */
export function plannerShoppingList(solved: SolvedPlan, draft: PlanDraft, plan: WeekPlan, people = 1): ShoppingItem[] {
  const start = plan.planner?.start ?? plan.startDate;
  const times = Math.max(1, Math.round(people));
  const items = packList(madeOnly(solved, plan, start), draft, times).flatMap((l) => packItem(l, start) ?? []);
  return items.sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      KEEPS_ORDER.indexOf(a.keeps) - KEEPS_ORDER.indexOf(b.keeps) ||
      (a.neededBy < b.neededBy ? -1 : a.neededBy > b.neededBy ? 1 : 0) ||
      a.name.localeCompare(b.name),
  );
}
