// How the pot a meal eats from is cooked, for that meal's page (docs/671): the
// prep session's stored steps of the meal's batch, and of the session's rice
// when the meal's rice is that rice. Read from the stored steps only, never a
// call; before they are written, the pot's one-line method from the plan.

import type { Locale } from "../../../i18n/locale";
import { foodWord } from "../finish/finishing";
import { foodById } from "../nutrition/foods";
import type { Profile } from "../nutrition/targets";
import { planLibrary } from "../planner/library";
import { isRiceStaple } from "../planner/rice";
import type { PrepStepsStatus } from "../screen/prep-timeline";
import type { MealView } from "../screen/view";
import { RICE_POT, type PrepStep } from "../timeline/steps";

export interface PotCookGroup {
  /** The pot's name, or the rice's. */
  name: string;
  steps: string[];
}

export type PotCooking =
  | { kind: "steps"; groups: PotCookGroup[] }
  // The prep steps are not written yet, or not read yet: the plan's line for the pot.
  | { kind: "method"; name: string; method: string };

const byOrder = (a: PrepStep, b: PrepStep) => Number(a.id) - Number(b.id);

/**
 * The cooking of the batch a meal eats from, or null for a meal that is not
 * of a prep batch. A step the model gave to no pot (shared by several) goes
 * with the batch's own.
 */
export function potCooking(
  view: Pick<MealView, "mode" | "pot">,
  status: PrepStepsStatus,
  profile: Profile,
  language: Locale,
): PotCooking | null {
  const portion = view.mode === "make" ? view.pot : null;
  const batch = portion?.batch;
  if (!portion || !batch) return null;
  const steps = status.kind === "ready" ? status.steps : [];
  const own = steps.filter((s) => s.pot === batch);
  if (!own.length) {
    const method = portion.pot.method?.trim();
    return method ? { kind: "method", name: portion.pot.name, method } : null;
  }
  const groups: PotCookGroup[] = [
    { name: portion.pot.name, steps: steps.filter((s) => s.pot === batch || s.pot === null).sort(byOrder).map((s) => s.text) },
  ];
  const eat = portion.eat;
  const lib = planLibrary(profile);
  const staple = eat?.staple ?? null;
  // Rice kept from the session's pot, or ladled from it at the session's own meal.
  const sessionRice = !!eat && (!!eat.rice || (eat.hot && isRiceStaple(lib, staple)));
  const rice = sessionRice ? steps.filter((s) => s.pot === RICE_POT).sort(byOrder) : [];
  if (rice.length && staple) groups.push({ name: stapleName(lib, staple, language === "zh-CN"), steps: rice.map((s) => s.text) });
  return { kind: "steps", groups };
}

function stapleName(lib: ReturnType<typeof planLibrary>, id: string, zh: boolean): string {
  const dish = lib.dish(id) ?? lib.stored(id);
  if (dish) return zh ? dish.name : dish.nameEn;
  const food = foodById(id);
  return food ? foodWord(food, zh) : id;
}
