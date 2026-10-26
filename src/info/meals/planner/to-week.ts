// A solved draft written as the stored plan (docs/671 数据模型), in the shape
// the day cards, the shopping list and the recipe page already read: one
// DayPlan per plan day, every meal a made meal at its solved grams. The draft
// rides along (`planner`), so a profile change solves it again through the same
// core instead of the old weekly solver, and the prep page can read its pots.
//
// A new plan replaces the days it covers; the days of the old plan before its
// first day stay when they run straight into it (docs/671 形态).

import { getLocale } from "../../../i18n";
import type { Dish, IngredientRole } from "../dishes/types";
import type { TemplateRole } from "../nutrition/solve";
import type { Profile, Targets } from "../nutrition/targets";
import type { DayPlan, Meal, PlannerRecord, SolvedItem, WeekPlan } from "../plan/types";
import { addDays, isoWeekday, weekId } from "../plan/week";
import { checkDraft, type DraftResult } from "./checks";
import { isBatchMain, parseDraft, type PlanDraft } from "./draft";
import { planLibrary, type PlanLibrary } from "./library";
import { shownName } from "./packs";
import { planDayTargets, type PlanLine, type SolvedPlan } from "./solve";
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

/** The plan days as stored meals, day 1 on `start`. */
export function dayPlansFromSolved(plan: SolvedPlan, draft: PlanDraft, lib: PlanLibrary, start: string): DayPlan[] {
  return plan.days.map((solved, i) => {
    const d = draft.days[i];
    const b = d ? lib.dish(d.breakfast) : undefined;
    const main = (slot: "lunch" | "dinner"): Meal => {
      const lines = solved.meals[slot].lines;
      const m = d?.[slot].main;
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
    const extra = [...solved.fruit, ...solved.snack];
    const names = [...new Set(extra.map((l) => foodById(l.food)).flatMap((f) => (f ? [shownName(f)] : [])))];
    return {
      date: addDays(start, i),
      breakfast: dishMeal(b, d?.breakfast ?? "", b?.activeMin ?? 0, solved.meals.breakfast.lines),
      lunch: main("lunch"),
      dinner: main("dinner"),
      snack: extra.length ? made(names.join(zh() ? "、" : ", "), names.join(" "), "", 0, extra) : { mode: "skip" },
    };
  });
}

export interface WeekFromDraft {
  /** A passing check (`plan` solved). */
  result: DraftResult;
  lib: PlanLibrary;
  start: string;
  now: number;
  previous: WeekPlan | null;
}

/** The plan to store: the draft's days, after the old plan's days that run straight into them. */
export function weekFromDraft(input: WeekFromDraft): WeekPlan {
  const { result, previous, start } = input;
  if (!result.plan) throw new Error("weekFromDraft needs a solved draft.");
  const fresh = dayPlansFromSolved(result.plan, result.draft, input.lib, start);
  const joins = !!previous?.days.some((d) => d.date === addDays(start, -1));
  const kept = joins && previous ? previous.days.filter((d) => d.date < start) : [];
  const startDate = kept[0]?.date ?? start;
  return {
    id: kept.length && previous ? previous.id : weekId(start),
    startDate,
    days: [...kept, ...fresh],
    createdAt: input.now,
    revision: (previous?.revision ?? 0) + 1,
    planner: { start, draft: result.draft },
  };
}

/** A stored plan's draft checked and solved for a profile; null when it has none or it no longer solves. */
export interface PlannerSolve {
  draft: PlanDraft;
  lib: PlanLibrary;
  solved: SolvedPlan;
}

export function solvePlannerRecord(plan: WeekPlan, profile: Profile, targets: Targets): PlannerSolve | null {
  const rec: PlannerRecord | undefined = plan.planner;
  if (!rec) return null;
  const draft = parseDraft(rec.draft);
  const lib = planLibrary(profile);
  const result = checkDraft(draft, {
    profile,
    targets: planDayTargets(targets, profile, rec.start, draft.days.length),
    startWeekday: isoWeekday(rec.start),
    people: profile.people,
    library: lib,
  });
  return result.plan ? { draft, lib, solved: result.plan } : null;
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
    if (!next) return old;
    const keep = (k: "breakfast" | "lunch" | "dinner" | "snack") => (old[k].mode === "make" ? next[k] : old[k]);
    return { date: old.date, breakfast: keep("breakfast"), lunch: keep("lunch"), dinner: keep("dinner"), snack: keep("snack") };
  });
  return { ...plan, days };
}

