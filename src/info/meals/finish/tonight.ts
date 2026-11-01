// What to do this evening for tomorrow's meals (docs/671 吃的那天): raw meat
// or fish waiting in the freezer moves to the fridge, and the soy milk maker
// is loaded for breakfast. Read off the plan's storage (planner/storage.ts
// nights), the same reminders the prep page lists; cooked boxes are only ever
// in the fridge, so none of them thaws.

import { translate, type Locale } from "../../../i18n";
import { daysBetween } from "../../../platform/std/day";
import { foodById } from "../nutrition/foods";
import type { Region } from "../nutrition/targets";
import type { MealsState } from "../plan/types";
import { targetsOf } from "../plan/solve-week";
import { addDays } from "../plan/week";
import { checkPlannerRecord } from "../planner/to-week";
import { finishLanguage, foodWord } from "./finishing";

/**
 * One short sentence per thing to do tonight for the meals eaten tomorrow,
 * in Chinese for zh-CN and English otherwise; empty when there is nothing,
 * when the plan has no planner draft, or for a meal tomorrow that went
 * differently. `region` is the screen's (info/meals/region.ts hostRegion):
 * the plan is solved with it to read its storage, which the notes do not
 * otherwise depend on.
 */
export function tonightNotes(state: MealsState, today: string, language: Locale, region: Region = "other"): string[] {
  const plan = state.plan;
  const profile = state.charter?.profile;
  const rec = plan?.planner;
  if (!plan || !profile || !rec) return [];
  const targets = targetsOf(state.charter, region);
  const between = daysBetween(rec.start, today);
  if (!targets || between === null) return [];
  const storage = checkPlannerRecord(plan, profile, targets)?.result.storage;
  if (!storage) return [];
  const lang = finishLanguage(language);
  const zh = lang === "zh-CN";
  const tomorrow = plan.days.find((d) => d.date === addDays(today, 1));
  // The evening of plan day N is the night before day N + 1; today is day `between + 1`.
  const items = storage.nights.filter((n) => n.day === between + 1).flatMap((n) => n.items);
  const name = (id: string) => {
    const f = foodById(id);
    return f ? foodWord(f, zh) : id;
  };
  const out: string[] = [];
  for (const item of items) {
    if (item.kind === "soyMilk") {
      if (tomorrow?.breakfast.mode !== "make") continue;
      const foods = item.foods.map(name).join(translate(lang, "meals.listJoin"));
      out.push(translate(lang, "meals.finish.tonightSoyMilk", { foods }));
      continue;
    }
    const slot = item.meal.slot;
    if (slot && slot !== "prep" && tomorrow && tomorrow[slot].mode !== "make") continue;
    const meal = slot === "prep" ? translate(lang, "meals.finish.prepSession") : slot ? translate(lang, `meals.meal.${slot}`) : "";
    out.push(translate(lang, "meals.finish.tonightThaw", { food: name(item.food), meal: zh ? meal : meal.toLowerCase() }));
  }
  return out;
}
