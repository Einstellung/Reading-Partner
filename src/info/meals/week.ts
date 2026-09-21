// The week read as a week (docs/73): which day is today, which meal is the
// next one, whether the plan has run out, and what one deviation does to the
// meals that leaned on it. Pure, unit-tested; the file is store.ts next door.
//
// Every one of these is a fact the program owns. None of it is ever asked of
// the model: a model that is told today's date still counts days wrong, and
// being wrong about which meal is next is the one mistake this screen cannot
// survive.

import {
  MEAL_KEYS,
  type Deviation,
  type DayPlan,
  type Dish,
  type Ingredient,
  type Meal,
  type MealKey,
  type MealMode,
  type MealRef,
  type WeekPlan,
} from "./types";

export const WEEK_DAYS = 7;

// The hard constraint on a cooked meal (diet.md 省事的约束写死): one pot, a
// quarter of an hour hands on, no more washing up than one meal. The first of
// the three is the only one a program can check, and breakfast gets less of it
// than the other two: a morning that takes a quarter of an hour is a morning
// nobody has.
export const HANDS_ON_LIMITS: Record<MealKey, number> = {
  breakfast: 10,
  lunch: 15,
  dinner: 15,
};

/** The most hands-on minutes a meal may cost. */
export const HANDS_ON_LIMIT = HANDS_ON_LIMITS.dinner;

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

/** One meal of one day, or null when the plan does not cover that date. */
export function mealOn(plan: WeekPlan | null, date: string, meal: MealKey): Meal | null {
  return dayOn(plan, date)?.[meal] ?? null;
}

/** Two refs pointing at the same meal. */
export function sameMeal(a: MealRef | undefined, b: MealRef | undefined): boolean {
  return Boolean(a && b && a.date === b.date && a.meal === b.meal);
}

/** Every meal of the week in the order they are eaten, each with its ref. */
export function mealsInOrder(plan: WeekPlan): { ref: MealRef; meal: Meal }[] {
  const out: { ref: MealRef; meal: Meal }[] = [];
  for (const day of plan.days) {
    for (const key of MEAL_KEYS) {
      out.push({ ref: { date: day.date, meal: key }, meal: day[key] });
    }
  }
  return out;
}

/**
 * The dish a meal eats: its own when it cooks, and the base's when it reheats
 * or carries a box. Null for out, delivery, bought, skip, and for a meal whose
 * base was never made.
 */
export function dishForMeal(plan: WeekPlan, meal: Meal | null | undefined): Dish | null {
  if (!meal) return null;
  const id =
    meal.dishId ??
    (meal.reheatOf ? (mealOn(plan, meal.reheatOf.date, meal.reheatOf.meal)?.dishId ?? null) : null);
  return id ? (plan.dishes.find((d) => d.id === id) ?? null) : null;
}

/** The dish a whole day leads with: the cooked meal latest in the day. */
export function dishForDay(plan: WeekPlan, day: DayPlan): Dish | null {
  for (const key of ["dinner", "lunch", "breakfast"] as const) {
    const meal = day[key];
    if (meal.mode !== "cook" && meal.mode !== "reheat") continue;
    const dish = dishForMeal(plan, meal);
    if (dish) return dish;
  }
  return null;
}

/**
 * Today and tomorrow — the two days the screen leads with. Either is null when
 * the plan does not cover that date, which is an ordinary state at the end of a
 * week rather than an error.
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

// Which modes eat a base somebody else cooked. Both of them go stale when that
// somebody stops cooking.
function eatsABase(mode: MealMode): boolean {
  return mode === "reheat" || mode === "packed";
}

// What a meal keeps when it becomes something else. A mode that eats nothing
// from the fridge carries no dish and no pointer; a mode that is not somewhere
// carries no place.
function settle(meal: Meal, became: MealMode, place: string | undefined): Meal {
  const next: Meal = { ...meal, mode: became };
  if (became === "cook") {
    delete next.reheatOf;
    delete next.place;
  } else if (eatsABase(became)) {
    delete next.place;
  } else {
    delete next.dishId;
    delete next.reheatOf;
    delete next.freshAdd;
    if (place) next.place = place;
    else delete next.place;
  }
  return next;
}

/**
 * What one deviation does to the plan.
 *
 * It moves the meal it is about and, at most, the one or two meals that leaned
 * on it. Nothing else: a week is not re-planned because one lunch went
 * differently (docs/73 偏离). The refs that come back are the meals the model
 * should now look at — at most two, and usually none.
 *
 * Two cases, and they are the two the prototype's adjustedDays shows:
 *
 *  - the base was not made. A meal that was going to cook is now out or
 *    delivery, so every later meal pointing at its base loses that pointer and
 *    that dish. It keeps its mode — it is still a meal with no cooking in it —
 *    and it goes in `attention`.
 *  - the base was not eaten. A packed lunch or a reheat that became something
 *    else leaves a box in the fridge that will not keep. The next meal that
 *    cooks, today or tomorrow, goes in `attention` untouched: it is still a
 *    good plan, and it is the one the model should offer to swap for the box.
 *
 * A deviation about a date the plan does not cover changes nothing and asks for
 * nothing; the reader saying what they ate on a day off the plan is not a
 * reason to invent one.
 */
export function applyDeviation(
  plan: WeekPlan,
  deviation: Deviation,
): { plan: WeekPlan; attention: MealRef[] } {
  const target = dayOn(plan, deviation.date);
  const before = target?.[deviation.meal];
  if (!target || !before) return { plan, attention: [] };

  const ref: MealRef = { date: deviation.date, meal: deviation.meal };
  const settled = settle(before, deviation.became, deviation.place);
  const baseMade = settled.mode === "cook" && Boolean(settled.dishId);
  const baseLeft = eatsABase(before.mode) && !eatsABase(settled.mode);

  const attention: MealRef[] = [];
  const days: DayPlan[] = plan.days.map((day) => {
    const next: DayPlan = { ...day };
    for (const key of MEAL_KEYS) {
      if (day.date === ref.date && key === ref.meal) {
        next[key] = settled;
        continue;
      }
      const meal = day[key];
      if (baseMade || !sameMeal(meal.reheatOf, ref)) continue;
      const orphan: Meal = { ...meal };
      delete orphan.reheatOf;
      delete orphan.dishId;
      delete orphan.freshAdd;
      next[key] = orphan;
      attention.push({ date: day.date, meal: key });
    }
    return next;
  });

  const next: WeekPlan = { ...plan, days, revision: plan.revision + 1 };
  if (baseLeft && attention.length === 0) {
    const cook = nextCookAfter(next, ref);
    if (cook) attention.push(cook);
  }
  return { plan: next, attention: attention.slice(0, 2) };
}

// The first meal after `ref` that cooks something, within today and tomorrow.
// Further out than that the box in the fridge is not the reason to re-plan it.
function nextCookAfter(plan: WeekPlan, ref: MealRef): MealRef | null {
  const limit = addDays(ref.date, 1);
  let seen = false;
  for (const { ref: at, meal } of mealsInOrder(plan)) {
    if (!seen) {
      seen = sameMeal(at, ref);
      continue;
    }
    if (at.date > limit) return null;
    if (meal.mode === "cook" && meal.dishId) return at;
  }
  return null;
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

// One meal as the model hands it over. It names a dish by name and a base by
// day number and meal; it never writes a date.
export interface MealDraft {
  mode: MealMode;
  // A dish by name, from this same draft or from the week already planned.
  dish?: string;
  // The meal whose base this one eats: a day number 1..7 and which meal of it.
  reheatOf?: { day: number; meal: MealKey };
  freshAdd?: string;
  place?: string;
  note?: string;
}

// One day as the model hands it over. `day` is 1..7, the position in the week
// exactly as the model was shown it.
export interface DayDraft {
  day: number;
  breakfast?: MealDraft;
  lunch?: MealDraft;
  dinner?: MealDraft;
}

export interface WeekDraft {
  dishes: DishDraft[];
  days: DayDraft[];
  // The week's breakfast pattern in the reader's words. Empty on an adjustment
  // that says nothing about it, and the week then keeps the one it has.
  breakfastLine?: string;
}

export interface AssembleOptions {
  // Day one of the week. The host's, not the model's.
  startDate: string;
  createdAt: number;
  // The week already on disk, when this draft adjusts it rather than replacing
  // it. Its dates, its untouched meals and its dishes are kept.
  previous?: WeekPlan | null;
  // Pinned by a test so minted dish ids are an equality assertion.
  random?: () => number;
}

export interface AssembledWeek {
  plan: WeekPlan;
  // The meals this draft actually writes. Every meal of a fresh week; only the
  // meals supplied, for an adjustment.
  changed: MealRef[];
  // The dates those meals fall on, for the card to highlight.
  changedDates: string[];
  // What the model got wrong, in sentences it can act on. An empty list is a
  // clean draft; the caller shows a non-empty one to the model rather than the
  // reader.
  problems: string[];
}

function fold(s: string): string {
  return s.trim().toLowerCase();
}

function emptyDay(date: string): DayPlan {
  return {
    date,
    breakfast: { mode: "skip" },
    lunch: { mode: "out" },
    dinner: { mode: "out" },
  };
}

/**
 * The plan a draft becomes: dates counted from day one, dish ids minted, a
 * reheat or a packed box pointed at the meal whose base it eats.
 *
 * An adjustment keeps every meal it does not mention and every dish those meals
 * still name, which is what "a deviation moves the next meal or two, never the
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

  const dishByName = (name: string): Dish | null => {
    const key = fold(name);
    return minted.get(key) ?? previous?.dishes.find((d) => fold(d.name) === key) ?? null;
  };

  const days: DayPlan[] = weekDates(startDate).map((date) => {
    const kept = previous?.days.find((d) => d.date === date);
    return kept ? { ...kept } : emptyDay(date);
  });

  const changed: MealRef[] = [];
  for (const entry of draft.days) {
    const index = Math.round(entry.day) - 1;
    if (index < 0 || index >= WEEK_DAYS) {
      problems.push(`Day ${entry.day} is not one of the seven days of the week.`);
      continue;
    }
    const date = addDays(startDate, index);
    const day = days[index] ?? emptyDay(date);
    for (const key of MEAL_KEYS) {
      const drafted = entry[key];
      if (!drafted) continue;
      const meal: Meal = { mode: drafted.mode };
      if (drafted.mode === "cook") {
        const dish = drafted.dish ? dishByName(drafted.dish) : null;
        if (!dish) problems.push(`Day ${entry.day} ${key} cooks, but names no dish that exists.`);
        else {
          meal.dishId = dish.id;
          const limit = HANDS_ON_LIMITS[key];
          if (dish.handsOnMinutes > limit) {
            problems.push(
              `"${dish.name}" is ${dish.handsOnMinutes} minutes hands-on; ${key} allows ${limit}.`,
            );
          }
        }
        if (drafted.freshAdd) meal.freshAdd = drafted.freshAdd;
      } else if (eatsABase(drafted.mode)) {
        const of = drafted.reheatOf;
        const ofIndex = of ? Math.round(of.day) - 1 : -1;
        if (of && ofIndex >= 0 && ofIndex < WEEK_DAYS) {
          meal.reheatOf = { date: addDays(startDate, ofIndex), meal: of.meal };
        } else if (drafted.mode === "reheat") {
          problems.push(`Day ${entry.day} ${key} reheats, but says nothing about whose base.`);
        } else if (!drafted.note) {
          problems.push(
            `Day ${entry.day} lunch is packed, but names neither the meal whose base it eats ` +
              `nor, in note, where the box came from.`,
          );
        }
        if (drafted.freshAdd) meal.freshAdd = drafted.freshAdd;
        const dish = drafted.dish ? dishByName(drafted.dish) : null;
        if (dish) meal.dishId = dish.id;
      } else if (drafted.place) {
        meal.place = drafted.place;
      }
      if (drafted.note) meal.note = drafted.note;
      day[key] = meal;
      changed.push({ date, meal: key });
    }
    days[index] = day;
  }

  const everyDish = [...minted.values(), ...(previous?.dishes ?? [])];

  // A base has to be cooked somewhere, and it has to keep. Checked after every
  // meal is placed, because a draft may name the meal that cooks after the one
  // that eats it.
  for (const day of days) {
    for (const key of MEAL_KEYS) {
      const meal = day[key];
      if (!eatsABase(meal.mode) || !meal.reheatOf) continue;
      const of = meal.reheatOf;
      const base = days.find((d) => d.date === of.date)?.[of.meal];
      if (!base || base.mode !== "cook" || !base.dishId) {
        problems.push(`${day.date} ${key} eats a base that ${of.date} ${of.meal} does not cook.`);
        delete meal.reheatOf;
        delete meal.dishId;
        continue;
      }
      meal.dishId = base.dishId;
      const known = everyDish.find((d) => d.id === base.dishId);
      if (known && !known.keepsADay) {
        problems.push(`${day.date} ${key} eats "${known.name}", which does not keep a day.`);
      }
    }
  }

  const named = new Set<string>();
  for (const day of days) {
    for (const key of MEAL_KEYS) {
      const id = day[key].dishId;
      if (id) named.add(id);
    }
  }
  const dishes = [...(previous?.dishes ?? []), ...minted.values()].filter(
    (d, i, all) => named.has(d.id) && all.findIndex((o) => o.id === d.id) === i,
  );

  const changedDates = [...new Set(changed.map((c) => c.date))].sort();

  return {
    plan: {
      id: weekId(startDate),
      startDate,
      days,
      dishes,
      breakfastLine: draft.breakfastLine?.trim() || previous?.breakfastLine || "",
      createdAt: previous?.createdAt ?? opts.createdAt,
      revision: (previous?.revision ?? 0) + 1,
    },
    changed,
    changedDates,
    problems,
  };
}
