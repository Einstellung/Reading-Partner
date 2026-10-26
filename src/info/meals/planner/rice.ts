// The plan's rice (docs/671 一锅): every rice-cooker staple in a plan is the
// same rice, cooked as one batch at the prep session and kept like a pot.
// Staple variety comes from the staples that are not rice.

import { draftMeal, draftMeals, isBatchMain, type MainSlot, type MealAt, type PlanDraft } from "./draft";
import type { PlanLibrary } from "./library";

/** The staple eaten with a lunch or dinner (the prep day's dinner at day 0): a food or staple dish id. */
export function stapleOf(draft: PlanDraft, lib: PlanLibrary, day: number, slot: MainSlot): string | null {
  const main = draftMeal(draft, day, slot)?.main;
  if (!main) return null;
  if (!isBatchMain(main)) return main.staple ?? null;
  const batch = draft.batches.find((b) => b.id === main.batch);
  return lib.dish(batch?.dish ?? "")?.ways?.[main.way - 1]?.staple ?? null;
}

/** True for a staple cooked in the rice cooker (white, brown, multigrain, millet rice). */
export function isRiceStaple(lib: PlanLibrary, ref: string | null): ref is string {
  return !!ref && !!lib.dish(ref)?.equipment.includes("rice_cooker");
}

/** The lunches and dinners whose staple is a rice, in time order, the prep day's dinner first. */
export function riceMeals(draft: PlanDraft, lib: PlanLibrary): { meal: MealAt; staple: string }[] {
  const out: { meal: MealAt; staple: string }[] = [];
  for (const { day, slot } of draftMeals(draft)) {
    const staple = stapleOf(draft, lib, day, slot);
    if (isRiceStaple(lib, staple)) out.push({ meal: { day, slot }, staple });
  }
  return out;
}

/** The plan's one rice: the rice most of its rice meals have, the earliest on a tie; null when no meal has rice. */
export function planRice(draft: PlanDraft, lib: PlanLibrary): string | null {
  const counts = new Map<string, number>();
  for (const r of riceMeals(draft, lib)) counts.set(r.staple, (counts.get(r.staple) ?? 0) + 1);
  let best: string | null = null;
  for (const [staple, n] of counts) if (best === null || n > (counts.get(best) ?? 0)) best = staple;
  return best;
}
