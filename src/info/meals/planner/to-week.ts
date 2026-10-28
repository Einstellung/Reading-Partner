// A solved draft written as the stored plan (docs/671 数据模型), in the shape
// the day cards, the shopping list and the recipe page already read: one
// DayPlan per plan day, every meal a made meal at its solved grams. The draft
// rides along (`planner`), so a profile change solves it again through the same
// core instead of the old weekly solver, and the prep page can read its pots.
//
// A new plan replaces the old plan from today on (or from its own first day,
// when that is earlier); the old plan's days before that stay as the record,
// when the old plan ran up to them (docs/671 形态).

import { getLocale } from "../../../i18n";
import type { Dish, IngredientRole } from "../dishes/types";
import type { TemplateRole } from "../nutrition/solve";
import type { Profile, Targets } from "../nutrition/targets";
import { MEAL_KEYS, type DayPlan, type Meal, type MealKey, type PlannerRecord, type SolvedItem, type WeekPlan } from "../plan/types";
import { addDays, isoWeekday, weekId } from "../plan/week";
import { checkDraft, type DraftResult } from "./checks";
import { isBatchMain, parseDraft, type DraftMain, type PlanDraft } from "./draft";
import { planLibrary, type PlanLibrary } from "./library";
import { shownName } from "./packs";
import { planDayTargets, prepDayTargets, type PlanLine, type SolvedPlan } from "./solve";
import { foodById } from "../nutrition/foods";

const zh = () => getLocale() === "zh-CN";

function role(r: IngredientRole): TemplateRole {
  return r === "protein" || r === "staple" ? r : r === "oil" ? "fat" : "fixed";
}

function items(lines: readonly PlanLine[]): SolvedItem[] {
  return lines.map((l) => ({ foodId: l.food, role: role(l.role), grams: Math.round(l.grams) }));
}

function made(name: string, searchName: string, method: string, minutes: number, lines: readonly PlanLine[]): Meal {
  const solved = items(lines);
  return { mode: "make", name, searchName: searchName.toLowerCase(), method, minutes, items: solved, solved };
}

function dishMeal(d: Dish | undefined, id: string, minutes: number, lines: readonly PlanLine[], name?: { zh: string; en: string }): Meal {
  const n = name ?? (d ? { zh: d.name, en: d.nameEn } : { zh: id, en: id });
  return made(zh() ? n.zh : n.en, n.en, d ? (zh() ? d.summary : d.summaryEn) : "", minutes, lines);
}

/**
 * The plan days as stored meals, day 1 on `start`; before them the prep day
 * when the plan eats its dinner, covering only that dinner (DayPlan.planned).
 */
export function dayPlansFromSolved(plan: SolvedPlan, draft: PlanDraft, lib: PlanLibrary, start: string): DayPlan[] {
  const main = (m: DraftMain | undefined, lines: readonly PlanLine[]): Meal => {
    if (!m) return { mode: "skip" };
    if (isBatchMain(m)) {
      const batch = draft.batches.find((x) => x.id === m.batch);
      const dish = batch ? lib.dish(batch.dish) : undefined;
      const way = dish?.ways?.[m.way - 1];
      return dishMeal(dish, batch?.dish ?? m.batch, way?.activeMin ?? 5, lines, way ? { zh: way.name, en: way.nameEn } : undefined);
    }
    const dish = lib.dish(m.dish);
    return dishMeal(dish, m.dish, dish?.activeMin ?? 0, lines);
  };
  const days = plan.days.map((solved, i): DayPlan => {
    const d = draft.days[i];
    const b = d ? lib.dish(d.breakfast) : undefined;
    const extra = [...solved.fruit, ...solved.snack];
    const names = [...new Set(extra.map((l) => foodById(l.food)).flatMap((f) => (f ? [shownName(f)] : [])))];
    return {
      date: addDays(start, i),
      breakfast: dishMeal(b, d?.breakfast ?? "", b?.activeMin ?? 0, solved.meals.breakfast.lines),
      lunch: main(d?.lunch.main, solved.meals.lunch.lines),
      dinner: main(d?.dinner.main, solved.meals.dinner.lines),
      snack: extra.length ? made(names.join(zh() ? "、" : ", "), names.join(" "), "", 0, extra) : { mode: "skip" },
    };
  });
  if (!plan.prepDinner || !draft.prepDinner) return days;
  const prep: DayPlan = {
    date: addDays(start, -1),
    breakfast: { mode: "skip" },
    lunch: { mode: "skip" },
    dinner: main(draft.prepDinner.main, plan.prepDinner.lines),
    snack: { mode: "skip" },
    planned: ["dinner"],
  };
  return [prep, ...days];
}

/** A stored day with a fresh one's planned meals put in; with `onlyMade`, only over the meals still made. */
function overlay(old: DayPlan, next: DayPlan, onlyMade: boolean): DayPlan {
  const keys = next.planned ?? MEAL_KEYS;
  const pick = (k: MealKey) => (keys.includes(k) && (!onlyMade || old[k].mode === "make") ? next[k] : old[k]);
  return { ...old, breakfast: pick("breakfast"), lunch: pick("lunch"), dinner: pick("dinner"), snack: pick("snack") };
}

export interface WeekFromDraft {
  /** A passing check (`plan` solved). */
  result: DraftResult;
  lib: PlanLibrary;
  start: string;
  now: number;
  previous: WeekPlan | null;
  /** The host's local date: the old plan's days from here on are replaced. */
  today: string;
  /** The model's picks the draft was filled from, kept for a redraft. */
  picks?: PlanDraft;
}

/**
 * The plan to store: the draft's days (the prep day first when it eats its
 * dinner), after the old plan's days before today. Nothing of the old plan
 * from today on stays, so a day the new plan covers only in part (the prep
 * day) shows just what the new plan gives it. The old plan's past days stay
 * only when it ran up to yesterday or into the new plan; an older plan is
 * replaced whole.
 */
export function weekFromDraft(input: WeekFromDraft): WeekPlan {
  const { result, previous, start, today } = input;
  if (!result.plan) throw new Error("weekFromDraft needs a solved draft.");
  const fresh = dayPlansFromSolved(result.plan, result.draft, input.lib, start);
  const first = fresh[0]?.date ?? start;
  const cut = today < first ? today : first;
  const ran = !!previous?.days.some((d) => d.date >= addDays(cut, -1));
  const kept = ran && previous ? previous.days.filter((d) => d.date < cut) : [];
  const days = [...kept, ...fresh];
  const startDate = days[0]?.date ?? start;
  return {
    id: kept.length && previous ? previous.id : weekId(startDate),
    startDate,
    days,
    createdAt: input.now,
    revision: (previous?.revision ?? 0) + 1,
    planner: { start, draft: result.draft, ...(input.picks ? { picks: input.picks } : {}) },
  };
}

/** A stored plan's draft checked and solved for a profile; null when it has none or it no longer solves. */
export interface PlannerSolve {
  draft: PlanDraft;
  lib: PlanLibrary;
  solved: SolvedPlan;
}

/** A stored plan's draft checked for a profile, problems and all; null when the plan has no draft. */
export interface PlannerCheck {
  draft: PlanDraft;
  lib: PlanLibrary;
  result: DraftResult;
}

export function checkPlannerRecord(plan: WeekPlan, profile: Profile, targets: Targets): PlannerCheck | null {
  const rec: PlannerRecord | undefined = plan.planner;
  if (!rec) return null;
  const draft = parseDraft(rec.draft);
  const lib = planLibrary(profile);
  const result = checkDraft(draft, {
    profile,
    targets: planDayTargets(targets, profile, rec.start, draft.days.length),
    prepTarget: prepDayTargets(targets, profile, rec.start),
    startWeekday: isoWeekday(rec.start),
    people: profile.people,
    library: lib,
  });
  return { draft, lib, result };
}

/** The solve out of a check; null when it did not solve. */
export function plannerSolveOf(check: PlannerCheck | null): PlannerSolve | null {
  return check?.result.plan ? { draft: check.draft, lib: check.lib, solved: check.result.plan } : null;
}

export function solvePlannerRecord(plan: WeekPlan, profile: Profile, targets: Targets): PlannerSolve | null {
  return plannerSolveOf(checkPlannerRecord(plan, profile, targets));
}

/**
 * A stored plan's draft solved again for a changed profile, its meals that
 * went differently (any mode but make) kept as they were. The plan as it was
 * when the draft no longer solves (a new dislike breaks its structure): the
 * next plan picks other dishes.
 */
export function resolvePlannerWeek(
  plan: WeekPlan,
  profile: Profile,
  targets: Targets,
  again: PlannerSolve | null = solvePlannerRecord(plan, profile, targets),
): WeekPlan {
  const rec = plan.planner;
  if (!rec || !again) return plan;
  const { draft, lib } = again;
  const fresh = dayPlansFromSolved(again.solved, draft, lib, rec.start);
  const byDate = new Map(fresh.map((d) => [d.date, d]));
  const days = plan.days.map((old) => {
    const next = byDate.get(old.date);
    return next ? overlay(old, next, true) : old;
  });
  return { ...plan, days };
}

