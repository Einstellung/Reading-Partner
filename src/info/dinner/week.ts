// The week read as a week (docs/73): which day is tonight, which is tomorrow,
// whether the plan has run out, and what one deviation does to the days after
// it. Pure, unit-tested; the file is store.ts next door.
//
// Every one of these is a fact the program owns. None of it is ever asked of
// the model: a model that is told today's date still counts days wrong, and
// being wrong about which night is tonight is the one mistake this screen
// cannot survive.

import type { Deviation, DayPlan, DinnerMode, Dish, Ingredient, WeekPlan } from "./types";

export const WEEK_DAYS = 7;

// The hard constraint on a cooked dinner (diet.md 省事的约束写死): one pot,
// hands on for a quarter of an hour, no more washing up than one meal. The
// first of the three is the only one a program can check.
export const HANDS_ON_LIMIT = 15;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Local "YYYY-MM-DD" as a day number, through UTC so a DST boundary cannot add
// or lose an hour mid-week. The string is a calendar day, not an instant.
function dayNumber(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86_400_000);
}

function fromDayNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

/** The local date `n` days after `date`. Returns `date` unchanged if unparseable. */
export function addDays(date: string, n: number): string {
  const d = dayNumber(date);
  return d === null ? date : fromDayNumber(d + n);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. Null if either is not a date. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** The seven local dates a week starting on `startDate` covers. */
export function weekDates(startDate: string): string[] {
  return Array.from({ length: WEEK_DAYS }, (_, i) => addDays(startDate, i));
}

/** The plan's last day, or "" when it has none. */
export function lastDate(plan: WeekPlan): string {
  return plan.days.length ? (plan.days[plan.days.length - 1]?.date ?? "") : "";
}

/** The day the plan has for this date, or null. */
export function dayOn(plan: WeekPlan | null, date: string): DayPlan | null {
  return plan?.days.find((d) => d.date === date) ?? null;
}

/**
 * The dish a day eats: its own on a cook day, and the base's on a reheat day.
 * Null for out, delivery, and a reheat day whose base was never made.
 */
export function dishForDay(plan: WeekPlan, day: DayPlan): Dish | null {
  const id = day.dishId ?? (day.reheatOf ? (dayOn(plan, day.reheatOf)?.dishId ?? null) : null);
  return id ? (plan.dishes.find((d) => d.id === id) ?? null) : null;
}

/**
 * Tonight and tomorrow night — the two the screen leads with. Either is null
 * when the plan does not cover that date, which is an ordinary state at the end
 * of a week rather than an error.
 */
export function todayAndTomorrow(
  plan: WeekPlan | null,
  localDate: string,
): { today: DayPlan | null; tomorrow: DayPlan | null } {
  return {
    today: dayOn(plan, localDate),
    tomorrow: dayOn(plan, addDays(localDate, 1)),
  };
}

/**
 * Whether the week has been eaten through: there is no plan at all, or the date
 * is past its last day. The screen asks this to offer "Plan this week"; nothing
 * re-plans on its own.
 */
export function planExhausted(plan: WeekPlan | null, localDate: string): boolean {
  if (!plan || plan.days.length === 0) return true;
  const diff = daysBetween(lastDate(plan), localDate);
  return diff === null ? true : diff > 0;
}

/**
 * What one deviation does to the plan.
 *
 * It moves the day it is about and, at most, the day that was going to eat that
 * day's base. Nothing else: a week is not re-planned because one night went
 * differently (docs/73 偏离). The dates that come back are the ones now left
 * without a dinner, for the model to propose an adjustment card for — at most
 * two, and usually none.
 *
 * A deviation about a date the plan does not cover changes nothing and asks for
 * nothing; the reader saying what they ate on a day off the plan is not a
 * reason to invent one.
 */
export function applyDeviation(
  plan: WeekPlan,
  deviation: Deviation,
): { plan: WeekPlan; attention: string[] } {
  const target = dayOn(plan, deviation.date);
  if (!target) return { plan, attention: [] };

  const settled: DayPlan = { ...target, mode: deviation.became };
  if (deviation.became === "out" || deviation.became === "delivery") {
    delete settled.dishId;
    delete settled.reheatOf;
    delete settled.freshAdd;
    if (deviation.place) settled.place = deviation.place;
  } else {
    delete settled.place;
  }

  // The base that was going to be made is not going to be made. A day pointed
  // at it keeps its mode — it is still a night with no cooking in it — but it
  // is pointed at nothing, so nothing downstream reads a base that does not
  // exist.
  const baseMade = settled.mode === "cook" && Boolean(settled.dishId);
  const attention: string[] = [];
  const days = plan.days.map((day) => {
    if (day.date === settled.date) return settled;
    if (day.reheatOf !== settled.date || baseMade) return day;
    const orphan: DayPlan = { ...day };
    delete orphan.reheatOf;
    delete orphan.dishId;
    attention.push(day.date);
    return orphan;
  });

  return {
    plan: { ...plan, days, revision: plan.revision + 1 },
    attention: attention.sort().slice(0, 2),
  };
}

const HEX = "0123456789abcdef";

/**
 * A fresh dish id. `random` is a parameter so a test can pin the id rather than
 * match it with a regex; production passes nothing.
 */
export function newDishId(random: () => number = Math.random): string {
  let out = "dish-";
  for (let i = 0; i < 8; i++) out += HEX[Math.floor(random() * 16) % 16];
  return out;
}

/** A week's id. One week per start date, so the date is the id. */
export function weekId(startDate: string): string {
  return `week-${startDate}`;
}

// --- assembling a week out of what the model drafted -------------------------

// A dish as the model hands it over: no id and no dates. Ids are minted here
// and dates are counted here, because neither is the model's to get wrong
// (docs/73 事实不经模型).
export interface DishDraft {
  name: string;
  // The dish's common English name, what the photograph is searched for by.
  searchName: string;
  oneLine: string;
  base: string;
  fresh: string;
  keepsADay: boolean;
  handsOnMinutes: number;
  ingredients: Ingredient[];
}

// One night as the model hands it over. `day` is 1..7, the position in the week
// exactly as the model was shown it; it never writes a date.
export interface DayDraft {
  day: number;
  mode: DinnerMode;
  // A dish by name, from this same draft or from the week already planned.
  dish?: string;
  // The day number whose base this reheats.
  reheatOfDay?: number;
  freshAdd?: string;
  place?: string;
}

export interface WeekDraft {
  dishes: DishDraft[];
  days: DayDraft[];
}

export interface AssembleOptions {
  // Day one of the week. The host's, not the model's.
  startDate: string;
  createdAt: number;
  // The week already on disk, when this draft adjusts it rather than replacing
  // it. Its dates, its untouched days and its dishes are kept.
  previous?: WeekPlan | null;
  // Pinned by a test so minted dish ids are an equality assertion.
  random?: () => number;
}

export interface AssembledWeek {
  plan: WeekPlan;
  // The dates this draft actually writes. Every day of a fresh week; only the
  // days supplied, for an adjustment.
  changedDates: string[];
  // What the model got wrong, in sentences it can act on. An empty list is a
  // clean draft; the caller shows a non-empty one to the model rather than the
  // reader.
  problems: string[];
}

function fold(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * The plan a draft becomes: dates counted from day one, dish ids minted, a
 * reheat pointed at the date whose base it eats.
 *
 * An adjustment keeps every day it does not mention and every dish those days
 * still name, which is what "a deviation moves the next day or two, never the
 * week" means once it reaches the data (docs/73).
 */
export function assembleWeekPlan(draft: WeekDraft, opts: AssembleOptions): AssembledWeek {
  const previous = opts.previous ?? null;
  const startDate = previous?.startDate ?? opts.startDate;
  const problems: string[] = [];

  const minted = new Map<string, Dish>();
  for (const d of draft.dishes) {
    const name = d.name.trim();
    if (!name) continue;
    if (d.handsOnMinutes > HANDS_ON_LIMIT) {
      problems.push(
        `"${name}" is ${d.handsOnMinutes} minutes hands-on; the limit is ${HANDS_ON_LIMIT}.`,
      );
    }
    minted.set(fold(name), {
      id: newDishId(opts.random),
      name,
      searchName: d.searchName,
      oneLine: d.oneLine,
      base: d.base,
      fresh: d.fresh,
      keepsADay: d.keepsADay,
      handsOnMinutes: d.handsOnMinutes,
      ingredients: d.ingredients,
    });
  }

  const dishIdByName = (name: string): string | null => {
    const key = fold(name);
    const fresh = minted.get(key);
    if (fresh) return fresh.id;
    const old = previous?.dishes.find((d) => fold(d.name) === key);
    return old?.id ?? null;
  };

  const days: DayPlan[] = weekDates(startDate).map((date) => {
    const kept = previous?.days.find((d) => d.date === date);
    return kept ? { ...kept } : { date, mode: "out" as DinnerMode };
  });

  const changedDates: string[] = [];
  for (const entry of draft.days) {
    const index = Math.round(entry.day) - 1;
    if (index < 0 || index >= WEEK_DAYS) {
      problems.push(`Day ${entry.day} is not one of the seven days of the week.`);
      continue;
    }
    const date = addDays(startDate, index);
    const day: DayPlan = { date, mode: entry.mode };
    if (entry.mode === "cook") {
      const id = entry.dish ? dishIdByName(entry.dish) : null;
      if (!id) problems.push(`Day ${entry.day} cooks, but names no dish that exists.`);
      else day.dishId = id;
    } else if (entry.mode === "reheat") {
      const ofIndex = Math.round(entry.reheatOfDay ?? 0) - 1;
      const of = ofIndex >= 0 && ofIndex < WEEK_DAYS ? addDays(startDate, ofIndex) : null;
      if (!of) problems.push(`Day ${entry.day} reheats, but says nothing about whose base.`);
      else day.reheatOf = of;
      if (entry.freshAdd) day.freshAdd = entry.freshAdd;
    } else if (entry.place) {
      day.place = entry.place;
    }
    days[index] = day;
    if (!changedDates.includes(date)) changedDates.push(date);
  }

  const everyDish = [...minted.values(), ...(previous?.dishes ?? [])];

  // A reheat has to eat something, and it has to be something that keeps.
  // Checked after every day is placed, because a draft may name the cook day
  // after the reheat day that eats it.
  for (const day of days) {
    if (day.mode !== "reheat" || !day.reheatOf) continue;
    const base = days.find((d) => d.date === day.reheatOf);
    if (!base || base.mode !== "cook" || !base.dishId) {
      problems.push(`${day.date} reheats a base that ${day.reheatOf} does not cook.`);
      delete day.reheatOf;
      continue;
    }
    const known = everyDish.find((d) => d.id === base.dishId);
    if (known && !known.keepsADay) {
      problems.push(`${day.date} reheats "${known.name}", which does not keep a day.`);
    }
  }

  const named = new Set(
    days.flatMap((d) => (d.dishId ? [d.dishId] : [])),
  );
  const dishes = [...(previous?.dishes ?? []), ...minted.values()].filter(
    (d, i, all) => named.has(d.id) && all.findIndex((o) => o.id === d.id) === i,
  );

  return {
    plan: {
      id: weekId(startDate),
      startDate,
      days,
      dishes,
      createdAt: previous?.createdAt ?? opts.createdAt,
      revision: (previous?.revision ?? 0) + 1,
    },
    changedDates: changedDates.sort(),
    problems,
  };
}
