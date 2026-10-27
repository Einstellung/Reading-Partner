// A draft a profile change reaches (docs/671 对话): a new dislike or a food
// they cannot get can take a dish, or one of a pot's ways, out of the draft on
// the card or the saved plan's. The program fills the model's picks again
// under the new profile. When that passes it is the new draft, and every meal
// that changed is listed for the model to say. When it does not, the draft
// stays as it was and the meals still holding the food are listed: only
// another pick of the model's can change them.

import { foodById } from "../nutrition/foods";
import type { Profile, Targets } from "../nutrition/targets";
import { isoWeekday } from "../plan/week";
import type { DraftContext, DraftResult } from "./checks";
import {
  draftMeal,
  draftMeals,
  isBatchMain,
  mealName,
  parseDraft,
  PREP_DAY,
  type DraftMain,
  type PlanDraft,
  type PlanSlot,
} from "./draft";
import { fillDraft } from "./fill";
import { planLibrary, type DishBlock, type PlanLibrary } from "./library";
import { planDayTargets, prepDayTargets } from "./solve";

/** What a draft is checked against: the profile's library and the targets of the days from `start`. */
export function draftContext(
  profile: Profile,
  targets: Targets,
  start: string,
  days: number,
  library: PlanLibrary = planLibrary(profile),
): DraftContext & { library: PlanLibrary } {
  return {
    profile,
    targets: planDayTargets(targets, profile, start, days),
    prepTarget: prepDayTargets(targets, profile, start),
    startWeekday: isoWeekday(start),
    people: profile.people,
    library,
  };
}

/** The picks a revision starts from, in propose_meal_plan's own shape. */
export interface RevisionPicks {
  days: { breakfast?: string; lunch: { main: DraftMain }; dinner: { main: DraftMain } }[];
  batches: PlanDraft["batches"];
  sessions: PlanDraft["sessions"];
  prepDinner?: { main: DraftMain };
  asked?: PlanDraft["asked"];
}

/**
 * The mains of a filled draft as they stand (a way the program changed
 * included), its pots and session, and from the picks it was filled from the
 * breakfasts and staples they asked for; the rest is the program's and is
 * filled again.
 */
export function revisionPicks(draft: PlanDraft, asked: PlanDraft | undefined): RevisionPicks {
  const main = (m: DraftMain, was: DraftMain | undefined): DraftMain => {
    if (isBatchMain(m)) return { batch: m.batch, way: m.way };
    const staple = was && !isBatchMain(was) && was.dish === m.dish ? was.staple : undefined;
    return staple ? { dish: m.dish, staple } : { dish: m.dish };
  };
  return {
    days: draft.days.map((d, i) => {
      const was = asked?.days[i];
      return {
        ...(was?.breakfast ? { breakfast: was.breakfast } : {}),
        lunch: { main: main(d.lunch.main, was?.lunch.main) },
        dinner: { main: main(d.dinner.main, was?.dinner.main) },
      };
    }),
    batches: draft.batches,
    sessions: draft.sessions,
    ...(draft.prepDinner ? { prepDinner: { main: main(draft.prepDinner.main, undefined) } } : {}),
    ...(asked?.asked ? { asked: asked.asked } : {}),
  };
}

/** A meal of the draft: a plan day's breakfast, lunch, dinner or fruit, or the prep day's dinner (day 0). */
export type MealSlot = PlanSlot | "fruit";

/** A meal that eats something they now refuse. */
export interface MealHeld {
  day: number;
  slot: MealSlot;
  /** The dish (a pot meal's way) holding it, by its Chinese name. */
  name: string;
  food: string;
}

/** A meal the program changed: what it was and what it is, by Chinese name. */
export interface MealChange {
  day: number;
  slot: MealSlot;
  before: string;
  after: string;
}

const SLOT_ORDER: Record<MealSlot, number> = { breakfast: 0, lunch: 1, dinner: 2, fruit: 3 };
const byMeal = (a: { day: number; slot: MealSlot }, b: { day: number; slot: MealSlot }) =>
  a.day - b.day || SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];

const shortName = (name: string) => name.replace(/（[^）]*）$/, "");

/** A dish or food ref by its Chinese name, as this library has it (a blocked dish by its stored name). */
function refName(lib: PlanLibrary, id: string): string {
  const d = lib.dish(id) ?? lib.stored(id);
  if (d) return shortName(d.name);
  const f = foodById(id);
  return f ? shortName(f.zh) : id;
}

function potDish(draft: PlanDraft, main: { batch: string }): string {
  return draft.batches.find((b) => b.id === main.batch)?.dish ?? "";
}

function mainName(draft: PlanDraft, lib: PlanLibrary, main: DraftMain): string {
  if (!isBatchMain(main)) return refName(lib, main.dish);
  const id = potDish(draft, main);
  const way = (lib.dish(id) ?? lib.stored(id))?.ways?.[main.way - 1];
  return way ? way.name : refName(lib, id);
}

function refBlock(lib: PlanLibrary, ref: string): DishBlock | null {
  if (foodById(ref)) return lib.foodBlocked(ref) ? { food: ref, reason: "dislike" } : null;
  return lib.blocked(ref);
}

/** The meals of a draft that eat a food the library refuses, in time order. */
export function heldMeals(draft: PlanDraft, lib: PlanLibrary): MealHeld[] {
  const out: MealHeld[] = [];
  const add = (day: number, slot: MealSlot, name: string, block: DishBlock | null) => {
    if (block) out.push({ day, slot, name, food: block.food });
  };
  draft.days.forEach((d, i) => {
    if (d.breakfast) add(i + 1, "breakfast", refName(lib, d.breakfast), lib.blocked(d.breakfast));
    for (const f of d.fruit) add(i + 1, "fruit", refName(lib, f), refBlock(lib, f));
  });
  for (const { day, slot, meal } of draftMeals(draft)) {
    const m = meal.main;
    if (isBatchMain(m)) {
      const id = potDish(draft, m);
      add(day, slot, mainName(draft, lib, m), lib.blocked(id) ?? lib.wayBlocked(id, m.way));
    } else {
      add(day, slot, mainName(draft, lib, m), lib.blocked(m.dish) ?? (m.staple ? refBlock(lib, m.staple) : null));
    }
    for (const s of meal.sides) add(day, slot, refName(lib, s), lib.blocked(s));
  }
  return out.sort(byMeal);
}

/** One meal of a draft as words: the main (a pot meal's way), a fresh main's staple, the sides; fruit by name. */
function mealWords(draft: PlanDraft, lib: PlanLibrary, day: number, slot: MealSlot): string {
  if (slot === "breakfast") return draft.days[day - 1]?.breakfast ? refName(lib, draft.days[day - 1]?.breakfast as string) : "";
  if (slot === "fruit") return (draft.days[day - 1]?.fruit ?? []).map((f) => refName(lib, f)).join("、");
  const meal = draftMeal(draft, day, slot);
  if (!meal) return "";
  const main = meal.main;
  const staple = !isBatchMain(main) && main.staple ? [refName(lib, main.staple)] : [];
  return [mainName(draft, lib, main), ...staple, ...meal.sides.map((s) => refName(lib, s))].join(" + ");
}

/** Every meal that reads differently in `after` than in `before`, in time order. */
export function draftChanges(before: PlanDraft, beforeLib: PlanLibrary, after: PlanDraft, afterLib: PlanLibrary): MealChange[] {
  const out: MealChange[] = [];
  const at: { day: number; slot: MealSlot }[] = [];
  if (before.prepDinner || after.prepDinner) at.push({ day: PREP_DAY, slot: "dinner" });
  const days = Math.max(before.days.length, after.days.length);
  for (let day = 1; day <= days; day++) {
    for (const slot of ["breakfast", "lunch", "dinner", "fruit"] as const) at.push({ day, slot });
  }
  for (const { day, slot } of at) {
    const was = mealWords(before, beforeLib, day, slot);
    const now = mealWords(after, afterLib, day, slot);
    if (was !== now) out.push({ day, slot, before: was, after: now });
  }
  return out;
}

export type Redraft =
  /** Nothing in it eats what they refuse. */
  | { kind: "kept" }
  /** Filled again around what they refuse; `result` passes. */
  | { kind: "redrafted"; result: DraftResult; picks: PlanDraft; changes: MealChange[] }
  /** The program could not: these meals still eat it, and the fill's reasons when they are not the whole story. */
  | { kind: "stuck"; held: MealHeld[]; unfilled: string[] };

/**
 * The draft under a changed profile. `ctx` carries the new profile's library,
 * `before` the library the draft was filled under, for naming what changed.
 */
export function redraft(
  draft: PlanDraft,
  asked: PlanDraft | undefined,
  ctx: DraftContext & { library: PlanLibrary },
  before: PlanLibrary,
): Redraft {
  const lib = ctx.library;
  const held = heldMeals(draft, lib);
  if (!held.length) return { kind: "kept" };
  const picks = parseDraft(revisionPicks(draft, asked));
  const filled = fillDraft(picks, ctx);
  if (!filled.result.problems.length && filled.result.plan) {
    return { kind: "redrafted", result: filled.result, picks, changes: draftChanges(draft, before, filled.result.draft, lib) };
  }
  // The fill's best draft still eats it where the model's picks do; when it
  // got round every one of those and failed on another rule, that rule is why.
  const left = heldMeals(filled.result.draft, lib);
  return left.length ? { kind: "stuck", held: left, unfilled: [] } : { kind: "stuck", held, unfilled: filled.unfilled };
}

/** How a meal is named to the model: "Day 2 lunch" on a card, a date for the saved plan. */
export type MealLabel = (day: number, slot: MealSlot) => string;

export const cardMealLabel: MealLabel = (day, slot) => (slot === "fruit" ? `Day ${day} fruit` : mealName(day, slot));

/** "Day 2 lunch: 鸡丁豆子炖菜配土豆和西兰花 → 鸡丁豆子炖菜配玉米饼"; one per change, joined. */
export function changesWords(changes: readonly MealChange[], label: MealLabel): string {
  return changes.map((c) => `${label(c.day, c.slot)}: ${c.before || "nothing"} → ${c.after || "nothing"}`).join("; ");
}

/** "Day 2 dinner 香煎三文鱼配西兰花 (冷冻西兰花)"; one per meal, joined. */
export function heldWords(held: readonly MealHeld[], label: MealLabel): string {
  return held.map((h) => `${label(h.day, h.slot)} ${h.name} (${shortName(foodById(h.food)?.zh ?? h.food)})`).join("; ");
}
