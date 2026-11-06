// The meals data the AI may change through the housekeeper (docs/platform/687
// 三餐): the unsaved draft, the saved plan and the reader's own dishes. Each
// entry hands the sandbox a copy, says which fields are inputs, holds the
// change to the planner's own checks, and lands it through the meals stores,
// recomputing grams, the shopping list and the picks on the way. Registered
// from the shells' bootDomains (registerMealsWritables).

import {
  appWriteIo,
  registerWritable,
  textBase,
  type Gate,
  type Landed,
  type Parsed,
  type Problem,
  type WritableEntry,
} from "../../housekeeper/write";
import { formatDateTime, t } from "../../i18n";
import { isObject } from "../../platform/std/json";
import { localDate } from "../../platform/std/day";
import { startPhotoSearch, type MealsPorts } from "./apply";
import { MEALS_DRAFT_FILE, MEALS_DRAFT_KIND, parseDraftFile, type MealsDraftFile } from "./draft-file";
import { MEALS_DISHES_FILE, deleteUserDish, libraryDishes, parseUserDishFile, saveUserDish, userDishIo, writeUserDish, type UserDishIo } from "./dishes/user-dishes";
import { SEED_DISHES } from "./dishes/seed";
import type { Dish } from "./dishes/types";
import { liveMealsPorts } from "./live";
import { foodById } from "./nutrition/foods";
import { freshShoppingList, reconcileShoppingList } from "./plan/shopping";
import { targetsOf } from "./plan/solve-week";
import { MEALS_FILE, parseMealsFile } from "./plan/store";
import { MEALS_VERSION, type DayPlan, type MealKey, type MealsState, type WeekPlan } from "./plan/types";
import { addDays, daysBetween } from "./plan/week";
import { checkDraft, type DraftProblem, type DraftResult } from "./planner/checks";
import { isBatchMain, parseDraft, PREP_DAY, type DraftMain, type PlanDraft } from "./planner/draft";
import { planLibrary } from "./planner/library";
import { draftContext, editedPicks } from "./planner/redraft";
import { checkPlannerRecord, plannerSolveOf, resolvePlannerWeek, weekFromDraft } from "./planner/to-week";
import { boughtName } from "./planner/packs";
import { plannerShoppingList } from "./planner/trip";

export const MEALS_PLAN_KIND = "info-meals";
export const MEALS_DISHES_KIND = "info-meals-dishes";

export interface MealsWriteDeps {
  /** The file's text as the housekeeper reads it, for the base. */
  readText(path: string): Promise<string | null>;
  /** The plan store, the clock and the draft file (`drafts` must be there). */
  ports: MealsPorts;
  dishIo: UserDishIo;
}

// --- shared --------------------------------------------------------------------

const PLAN_DRAFT_SHAPE = `interface PlanDraft {
  days: {
    breakfast: string;        // a breakfast dish id
    lunch: DraftMeal;
    dinner: DraftMeal;
    fruit: string[];          // fruit food ids, one per portion
  }[];
  batches: DraftBatch[];      // the pots cooked in the prep session
  sessions: { id: string; day: number /* 0 is the day before Day 1 */; part: "morning" | "afternoon" | "evening" }[];
  asked?: { breakfast?: string; staple?: string };
  prepDinner?: DraftMeal;     // the prep day's dinner, eaten from a pot
}
interface DraftMeal {
  // A share of a pot eaten one of its dish's ways (1-based), or a dish made at the meal.
  main: { batch: string; way: number } | { dish: string; staple?: string };
  sides: string[];            // side dish ids
}
interface DraftBatch {
  id: string;
  dish: string;               // a dish id: the planner's library or one of info-meals-dishes
  session: string;            // a sessions[].id
  meals: { day: number; slot: "lunch" | "dinner" }[];
  // Input. The total raw weight, in grams, of this pot's protein ingredients for everyone
  // eating: how much the pot cooks ("cook the 600 g of chicken breast I have" is rawG 600;
  // what is at home is info-meals shopping.have). Its meals share it evenly. Leave it out
  // and the program picks it from the protein target.
  rawG?: number;
}`;

/** Where a planner problem sits in the copy. */
function draftProblemPath(p: DraftProblem, draft: PlanDraft, prefix: string): string {
  if (p.batch) {
    const i = draft.batches.findIndex((b) => b.id === p.batch);
    if (i >= 0) return `${prefix}.batches.${i}`;
  }
  if (p.day === PREP_DAY && p.slot) return `${prefix}.prepDinner`;
  if (p.day !== undefined && p.slot) return `${prefix}.days.${p.day - 1}.${p.slot}`;
  if (p.day !== undefined) return `${prefix}.days.${p.day - 1}`;
  return prefix;
}

/**
 * The planner's sentences name a day by its number ("Day 2 lunch"). The model
 * reading them back through edit_data gets the date beside it, "2026-11-07
 * (Day 2)", so it need not count from the start date; propose_meal_plan's own
 * texts are not run through this. Day 0 is the prep day, the one before Day 1.
 */
export function datedDays(text: string, start: string): string {
  return text.replace(/\b([Dd]ay) (\d+)\b( \(the prep day\))?/g, (_whole, word: string, n: string, prep?: string) => {
    const date = addDays(start, Number(n) - 1);
    return prep ? `${date} (${word} ${n}, the prep day)` : `${date} (${word} ${n})`;
  });
}

/** A check that did not solve: the structure rules it broke, which stop the write. */
function structureProblems(result: DraftResult, prefix: string, start: string): Problem[] {
  if (result.plan) return [];
  if (!result.problems.length) return [{ path: prefix, message: "the plan has more days than there are targets for" }];
  return result.problems.map((p) => ({ path: draftProblemPath(p, result.draft, prefix), message: datedDays(p.message, start) }));
}

/** What the program added and the nutrition rules a solved draft still breaks: written all the same, said after. */
function solvedNotes(result: DraftResult, start: string): string[] {
  const out = result.notes.map((n) => datedDays(n, start));
  if (result.problems.length) {
    out.push("Written all the same; the planner's rules still find these, say them to the reader:");
    out.push(...result.problems.map((p) => `- ${datedDays(p.message, start)}`));
  }
  return out;
}

function dishOf(id: string): Dish | undefined {
  return libraryDishes().find((d) => d.id === id);
}

function mainWords(draft: PlanDraft, main: DraftMain): string {
  if (isBatchMain(main)) {
    const batch = draft.batches.find((b) => b.id === main.batch);
    const dish = batch ? dishOf(batch.dish) : undefined;
    return dish?.ways?.[main.way - 1]?.name ?? `${dish?.name ?? main.batch} (way ${main.way})`;
  }
  return dishOf(main.dish)?.name ?? main.dish;
}

/** A local date as the reader reads it, "November 7" / "11月7日". */
function shown(date: string): string {
  return formatDateTime(new Date(`${date}T00:00:00Z`), { month: "long", day: "numeric", timeZone: "UTC" });
}

const dayDate = (start: string, day: number) => shown(addDays(start, day - 1));

const SLOT_WORD = {
  breakfast: "meals.meal.breakfast",
  lunch: "meals.meal.lunch",
  dinner: "meals.meal.dinner",
  snack: "meals.meal.snack",
} as const;

const PART_WORD = {
  morning: "meals.draft.part.morning",
  afternoon: "meals.draft.part.afternoon",
  evening: "meals.draft.part.evening",
} as const;

/**
 * One line per change to the draft in the reader's terms, each with its date:
 * the first day, the days the plan covers, pots, prep sessions, the prep day's
 * dinner and the meals. They go to the confirmation card and to the model.
 */
function draftLines(before: PlanDraft, after: PlanDraft, starts: { before: string; after: string }): string[] {
  const out: string[] = [];
  const start = starts.after;
  if (starts.before !== start) out.push(t("meals.edit.startMoves", { was: shown(starts.before), now: shown(start) }));
  if (before.days.length !== after.days.length) {
    out.push(
      t("meals.edit.range", {
        from: shown(start),
        to: dayDate(start, after.days.length),
        oldFrom: shown(starts.before),
        oldTo: dayDate(starts.before, before.days.length),
      }),
    );
  }
  for (const b of after.batches) {
    const was = before.batches.find((x) => x.id === b.id);
    if (was && was.dish === b.dish && was.rawG === b.rawG) continue;
    const dish = dishOf(b.dish)?.name ?? b.dish;
    out.push(b.rawG !== undefined ? t("meals.edit.potRaw", { dish, g: b.rawG }) : t("meals.edit.pot", { dish }));
  }
  for (const s of after.sessions) {
    const was = before.sessions.find((x) => x.id === s.id);
    if (was && was.day === s.day && was.part === s.part) continue;
    out.push(t("meals.edit.session", { date: dayDate(start, s.day), part: t(PART_WORD[s.part]) }));
  }
  for (const s of before.sessions) {
    if (!after.sessions.some((x) => x.id === s.id)) out.push(t("meals.edit.sessionGone"));
  }
  if (!before.prepDinner !== !after.prepDinner) {
    out.push(t(after.prepDinner ? "meals.edit.prepDinnerOn" : "meals.edit.prepDinnerOff", { date: dayDate(start, PREP_DAY) }));
  } else if (before.prepDinner && after.prepDinner && mainWords(before, before.prepDinner.main) !== mainWords(after, after.prepDinner.main)) {
    out.push(t("meals.edit.prepDinner", { date: dayDate(start, PREP_DAY), name: mainWords(after, after.prepDinner.main) }));
  }
  after.days.forEach((d, i) => {
    const was = before.days[i];
    const date = dayDate(start, i + 1);
    if (!was || was.breakfast !== d.breakfast) {
      out.push(t("meals.edit.meal", { date, slot: t(SLOT_WORD.breakfast), name: dishOf(d.breakfast)?.name ?? d.breakfast }));
    }
    for (const slot of ["lunch", "dinner"] as const) {
      const now = mainWords(after, d[slot].main);
      if (!was || mainWords(before, was[slot].main) !== now) out.push(t("meals.edit.meal", { date, slot: t(SLOT_WORD[slot]), name: now }));
    }
  });
  return out;
}

async function opened<T>(deps: MealsWriteDeps, file: string, read: (raw: unknown) => T | null): Promise<{ value: T; base: string } | null> {
  const text = await deps.readText(file);
  if (text === null) return null;
  const value = read(JSON.parse(text) as unknown);
  return value === null ? null : { value, base: await textBase(text) };
}

function profileTargets(state: MealsState, ports: MealsPorts) {
  const targets = targetsOf(state.charter, ports.region());
  return state.charter && targets ? { profile: state.charter.profile, targets } : null;
}

const NO_TARGETS = "there are no targets to solve against: the reader has to finish the opening questions with body data";

// --- the draft not saved yet ----------------------------------------------------

export function mealsDraftEntry(deps: MealsWriteDeps): WritableEntry<MealsDraftFile> {
  const { ports } = deps;
  const context = async (file: MealsDraftFile) => {
    const pt = profileTargets(await ports.current(), ports);
    return pt ? draftContext(pt.profile, pt.targets, file.startDate, file.draft.days.length) : null;
  };
  return {
    kind: MEALS_DRAFT_KIND,
    open: () => opened(deps, MEALS_DRAFT_FILE, parseDraftFile),
    shape: `// The meal plan drafted in the meals conversation and not saved yet. Its card shows it;
// the reader's 「就这样」 or apply_meal_plan saves it as the plan.
interface MealsDraft {
  draftId: string;            // locked
  threadId: string;           // locked
  version: number;            // locked: the app adds one on every write
  startDate: string;          // input: Day 1's local date, today to six days on
  draft: PlanDraft;           // input
  picks?: PlanDraft;          // computed from draft: change draft
  previous?: PlanDraft;       // locked
  updatedAt: number;          // locked
  phase: "proposed" | "applied"; // locked
}
${PLAN_DRAFT_SHAPE}`,
    parse(value): Parsed<MealsDraftFile> {
      const file = parseDraftFile(value);
      return file ? { ok: true, value: file } : { ok: false, reason: "not a meals draft: it needs draftId, startDate, version and a draft with days" };
    },
    computed: [{ path: "picks", input: "draft" }],
    locked: ["draftId", "threadId", "version", "previous", "updatedAt", "phase"],
    async check(before, after) {
      if (before.phase === "applied") {
        return [{ path: "phase", message: "this draft is already the saved plan: change info-meals, or draft a new plan with propose_meal_plan" }];
      }
      const ahead = daysBetween(ports.today(), after.startDate);
      if (ahead === null || ahead < 0 || ahead > 6) return [{ path: "startDate", message: "Day 1 is today or one of the six days after it" }];
      const ctx = await context(after);
      if (!ctx) return [{ path: "draft", message: NO_TARGETS }];
      return structureProblems(checkDraft(after.draft, ctx, { storage: false }), "draft", after.startDate);
    },
    gate: () => null,
    async land(before, after, ctx): Promise<Landed> {
      const drafts = ports.drafts;
      const checkCtx = await context(after);
      if (!drafts || !checkCtx) return { ok: false, reason: NO_TARGETS };
      const result = checkDraft(after.draft, checkCtx);
      if (!result.plan) return { ok: false, reason: "the draft no longer solves" };
      await drafts.save({
        ...before,
        startDate: after.startDate,
        draft: result.draft,
        picks: editedPicks(before.draft, after.draft, before.picks),
        previous: before.draft,
        version: before.version + 1,
        updatedAt: ctx.now,
      });
      return { ok: true, notes: ["The draft card in the conversation shows the new version.", ...solvedNotes(result, after.startDate)] };
    },
    describe: (before, after) => draftLines(before.draft, after.draft, { before: before.startDate, after: after.startDate }),
  };
}

// --- the saved plan -------------------------------------------------------------

/** "家里有鸡胸 600 克，少买" for each food whose grams at home the change sets, one line for each it clears. */
function haveLines(before: Record<string, number>, after: Record<string, number>): string[] {
  const name = (id: string) => {
    const food = foodById(id);
    return food ? boughtName(food) : id;
  };
  const out: string[] = [];
  for (const [id, g] of Object.entries(after)) {
    if (before[id] !== g) out.push(t("meals.edit.have", { food: name(id), g: Math.round(g) }));
  }
  for (const id of Object.keys(before)) {
    if (!(id in after)) out.push(t("meals.edit.haveGone", { food: name(id) }));
  }
  return out;
}

function draftOfPlan(plan: WeekPlan | null): PlanDraft | null {
  return plan?.planner ? parseDraft(plan.planner.draft) : null;
}

/** Whether the change moves what the plan covers: its days, its prep session, the prep day's dinner. */
function replacesPlan(before: PlanDraft, after: PlanDraft): boolean {
  const sessions = (d: PlanDraft) => JSON.stringify(d.sessions.map((s) => [s.id, s.day, s.part]));
  return before.days.length !== after.days.length || sessions(before) !== sessions(after) || !!before.prepDinner !== !!after.prepDinner;
}

const MEAL_KEYS: readonly MealKey[] = ["breakfast", "lunch", "dinner", "snack"];

/** A day as solved, its notes as the program returned them. */
function withNotes(day: DayPlan, from: DayPlan | undefined): DayPlan {
  if (!from) return day;
  const next: DayPlan = { ...day };
  for (const k of MEAL_KEYS) {
    const note = from[k].note;
    const { note: _old, ...meal } = day[k];
    next[k] = note === undefined ? meal : { ...meal, note };
  }
  return next;
}

const PLAN_DRAFT_INPUT = "plan.planner.draft (a pot's rawG for its grams, a meal's main or way for what is eaten)";

export function mealsPlanEntry(deps: MealsWriteDeps): WritableEntry<MealsState> {
  const { ports } = deps;
  const checked = (state: MealsState) => {
    const pt = profileTargets(state, ports);
    return state.plan && pt ? { pt, check: checkPlannerRecord(state.plan, pt.profile, pt.targets) } : null;
  };
  return {
    kind: MEALS_PLAN_KIND,
    open: () => opened(deps, MEALS_FILE, parseMealsFile),
    shape: `// The reader's saved meals: the plan being eaten, its shopping list, their profile.
interface Meals {
  charter: unknown;           // locked: the profile changes through update_meals_profile
  plan: {
    id: string; startDate: string; createdAt: number; revision: number; // locked
    // Computed from planner.draft, except each meal's note, which is an input. Days before
    // today stay as they were: the plan is the record of what was eaten.
    days: { date: string; breakfast: Meal; lunch: Meal; dinner: Meal; snack: Meal; planned?: string[] }[];
    planner: {
      start: string;          // locked: Day 1's date
      draft: PlanDraft;       // input: the plan is solved again from it
      picks?: PlanDraft;      // computed from draft
      preppedAt?: number; prepRun?: unknown; // locked
    };
  } | null;
  shopping: {
    items: unknown[];         // computed from the solved grams and have: change plan.planner.draft or have
    // Input. What the reader already has at home, grams by food id (an items[].foodId), weighed
    // as the list weighs it: "I have 600 g of chicken breast" is { chicken_breast: 600 }. The
    // list buys only what is missing. Not how much a pot cooks: that is the pot's rawG.
    // Delete a key when it is used up or bought. A new plan starts without it.
    have: Record<string, number>;
    reader: unknown[]; dropped: unknown[]; replaced: unknown[]; checked: unknown[]; doneOn?: string; // locked
  };
  deviations: unknown[];      // locked
  photosAskedAt?: number;     // locked
}
interface Meal {
  mode: string; name?: string; method?: string; minutes?: number; // computed
  solved?: { foodId: string; role: string; grams: number }[];        // computed: the grams
  items?: unknown[];          // computed
  note?: string;              // input
}
${PLAN_DRAFT_SHAPE}`,
    parse(value): Parsed<MealsState> {
      // The copy is the state, not the file: it carries no schema version of its own.
      const state = isObject(value) ? parseMealsFile({ ...value, version: MEALS_VERSION }) : null;
      return state ? { ok: true, value: state } : { ok: false, reason: "not the meals file: it needs charter, plan, shopping and deviations" };
    },
    computed: [
      ...["solved", "items", "name", "method", "minutes"].map((f) => ({ path: `plan.days.*.*.${f}`, input: PLAN_DRAFT_INPUT })),
      { path: "plan.planner.picks", input: "plan.planner.draft" },
      { path: "shopping.items", input: `${PLAN_DRAFT_INPUT}, or shopping.have for what is at home` },
    ],
    locked: [
      "charter",
      "plan.id",
      "plan.startDate",
      "plan.createdAt",
      "plan.revision",
      "plan.pots",
      "plan.planner.start",
      "plan.planner.preppedAt",
      "plan.planner.prepRun",
      "plan.days.*.date",
      "plan.days.*.planned",
      ...["mode", "pot", "place", "searchName", "flavour", "proper"].map((f) => `plan.days.*.*.${f}`),
      "shopping.reader",
      "shopping.dropped",
      "shopping.replaced",
      "shopping.checked",
      "shopping.doneOn",
      "deviations",
      "photosAskedAt",
    ],
    async check(_before, after) {
      if (!after.plan?.planner) return [{ path: "plan.planner", message: "only a plan the planner drafted can be changed here" }];
      const c = checked(after);
      if (!c?.check) return [{ path: "plan.planner.draft", message: NO_TARGETS }];
      return structureProblems(c.check.result, "plan.planner.draft", after.plan.planner.start);
    },
    gate(before, after): Gate | null {
      const a = draftOfPlan(before.plan);
      const b = draftOfPlan(after.plan);
      return a && b && replacesPlan(a, b) ? "replace" : null;
    },
    async land(before, after, ctx): Promise<Landed> {
      const was = before.plan;
      const draft = draftOfPlan(after.plan);
      const pt = profileTargets(before, ports);
      if (!was?.planner || !after.plan || !draft || !pt) return { ok: false, reason: NO_TARGETS };
      const { profile, targets } = pt;
      const people = profile.people;
      const beforeDraft = parseDraft(was.planner.draft);
      const picks = editedPicks(beforeDraft, draft, was.planner.picks ? parseDraft(was.planner.picks) : undefined);
      const today = ports.today();
      // What is at home belongs to this trip: a new plan's trip keeps only what this change says.
      const have = after.shopping.have;
      const haveChanged = !same(before.shopping.have, have);
      let plan: WeekPlan;
      let shopping: MealsState["shopping"];
      let result: DraftResult;
      if (replacesPlan(beforeDraft, draft)) {
        const lib = planLibrary(profile);
        result = checkDraft(draft, draftContext(profile, targets, was.planner.start, draft.days.length, lib));
        if (!result.plan) return { ok: false, reason: "the draft no longer solves" };
        plan = weekFromDraft({ result, lib, start: was.planner.start, now: ctx.now, today, previous: was, picks });
        const kept = haveChanged ? have : {};
        shopping = freshShoppingList(before.shopping, plannerShoppingList(result.plan, result.draft, plan, people, kept), kept);
      } else {
        const record: WeekPlan = { ...was, planner: { ...was.planner, draft, picks } };
        const check = checkPlannerRecord(record, profile, targets);
        const again = plannerSolveOf(check);
        if (!check || !again) return { ok: false, reason: "the draft no longer solves" };
        result = check.result;
        const solved = resolvePlannerWeek(record, profile, targets, again);
        const days = solved.days.map((d) => {
          const old = was.days.find((x) => x.date === d.date);
          const kept = old && d.date < today ? old : d;
          return withNotes(kept, after.plan?.days.find((x) => x.date === d.date));
        });
        plan = { ...solved, days, revision: was.revision + 1 };
        shopping = reconcileShoppingList({ ...before.shopping, have }, plannerShoppingList(again.solved, again.draft, plan, people, have));
      }
      await ports.savePlan(plan, shopping);
      ports.changed();
      void ports.drawDishes?.().catch(() => {});
      const cache = ports.photos ? await ports.photos().catch(() => ({})) : {};
      void startPhotoSearch(plan, cache, ports, before.photosAskedAt ?? 0).catch(() => {});
      const offList = Object.keys(shopping.have).filter((id) => !shopping.items.some((i) => i.foodId === id));
      return {
        ok: true,
        notes: [
          "The plan, its prep and the shopping list follow the new grams.",
          ...offList.map((id) => `Nothing on the shopping list is ${id}: what is at home of it takes nothing off.`),
          ...solvedNotes(result, was.planner.start),
        ],
      };
    },
    // The plan and the list as they were, not solved again: a solve under today's
    // profile would not give back the grams that were written. A replaced plan
    // put back is confirmed now, or the sync would let the one it replaced win
    // on its older createdAt.
    async restore(beforeText, ctx): Promise<Landed> {
      const old = parseMealsFile(JSON.parse(beforeText) as unknown);
      if (!old?.plan) return { ok: false, reason: "the earlier version has no plan to put back" };
      const now = (await ports.current()).plan;
      const replaced = !now || now.id !== old.plan.id || now.createdAt !== old.plan.createdAt;
      const plan: WeekPlan = { ...old.plan, revision: (now?.revision ?? old.plan.revision) + 1, ...(replaced ? { createdAt: ctx.now } : {}) };
      await ports.savePlan(plan, old.shopping);
      ports.changed();
      return { ok: true, notes: ["The plan and the shopping list are as they were before that change."] };
    },
    describe(before, after) {
      const a = draftOfPlan(before.plan);
      const b = draftOfPlan(after.plan);
      const lines = a && b && before.plan && after.plan ? draftLines(a, b, { before: before.plan.planner?.start ?? before.plan.startDate, after: after.plan.planner?.start ?? after.plan.startDate }) : [];
      for (const day of after.plan?.days ?? []) {
        const old = before.plan?.days.find((d) => d.date === day.date);
        for (const k of MEAL_KEYS) {
          if (!old || old[k].note === day[k].note) continue;
          const note = day[k].note;
          const slot = t(SLOT_WORD[k]);
          lines.push(note === undefined ? t("meals.edit.noteGone", { date: shown(day.date), slot }) : t("meals.edit.note", { date: shown(day.date), slot, note }));
        }
      }
      return [...lines, ...haveLines(before.shopping.have, after.shopping.have)];
    },
  };
}

// --- the reader's own dishes ----------------------------------------------------

/** The dishes file as the sandbox gets it: the reader's dishes to change, the seed library to copy from. */
export interface DishesCopy {
  dishes: Record<string, Dish>;
  seed: Record<string, Dish>;
}

const SEED_BY_ID: Record<string, Dish> = Object.fromEntries(SEED_DISHES.map((d) => [d.id, d]));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function changedDishes(before: DishesCopy, after: DishesCopy): { written: Dish[]; removed: string[] } {
  return {
    written: Object.entries(after.dishes)
      .filter(([id, dish]) => !same(before.dishes[id], dish))
      .map(([, dish]) => dish),
    removed: Object.keys(before.dishes).filter((id) => !(id in after.dishes)),
  };
}

export function mealsDishesEntry(deps: MealsWriteDeps): WritableEntry<DishesCopy> {
  return {
    kind: MEALS_DISHES_KIND,
    async open() {
      const text = await deps.readText(MEALS_DISHES_FILE);
      const file = text === null ? { dishes: {} } : parseUserDishFile(JSON.parse(text) as unknown);
      if (!file) return null;
      return { value: { dishes: file.dishes, seed: SEED_BY_ID }, base: await textBase(text) };
    },
    shape: `// The reader's own dishes, planned beside the library. Add one by copying a seed dish
// under a new id and changing what differs; then use its id in a draft's batches[].dish.
interface Dishes {
  dishes: Record<string, Dish>; // input: keyed by the dish's id, which no seed dish has
  seed: Record<string, Dish>;   // locked: the planner's library, to copy from
}
interface Dish {
  id: string;
  name: string; nameEn: string;          // the dish's name, Chinese and English
  summary: string;                       // one Chinese sentence, at most 40 characters, on how it is cooked
  summaryEn: string;
  role: "main" | "side" | "staple" | "breakfast";
  cuisine: string;                       // as the seed dishes name them
  method: string;                        // how it is cooked: "braise", "stir_fry", "pressure_cook", "stew", ...
  equipment: string[];                   // what it needs beyond a stove with a pot and a pan: [] or e.g. ["pressure_cooker"]
  activeMin: number; totalMin: number;   // hands-on minutes and minutes in all, for one pot
  prep: "batch" | "fresh";               // a pot cooked in the prep session, or made at the meal
  staples: string[];
  ingredients: { food: string; grams: number; role: string }[]; // grams for one reference serving
  ways?: { name: string; nameEn: string; staple: string | null; addOns: { food: string; grams: number; role: string }[]; activeMin?: number }[];
  origin: "user";                        // set by the app
  createdAt: string;                     // set by the app
}`,
    parse(value): Parsed<DishesCopy> {
      if (!isObject(value) || !isObject(value.dishes) || Object.values(value.dishes).some((d) => !isObject(d))) {
        return { ok: false, reason: "not the dishes copy: it needs dishes, a record of dishes by id" };
      }
      return { ok: true, value: value as unknown as DishesCopy };
    },
    computed: [],
    locked: ["seed"],
    check(before, after) {
      const out: Problem[] = [];
      let current: Record<string, Dish> = { ...before.dishes };
      const at = new Date(deps.ports.now()).toISOString();
      for (const dish of changedDishes(before, after).written) {
        const key = Object.keys(after.dishes).find((k) => after.dishes[k] === dish) ?? dish.id;
        if (dish.id !== key) {
          out.push({ path: `dishes.${key}.id`, message: `the dish is kept under its own id: ${key} holds a dish whose id is ${dish.id}` });
          continue;
        }
        const written = writeUserDish(current, dish, at);
        if (written.ok) current = written.dishes;
        else out.push(...written.problems.map((message) => ({ path: `dishes.${key}`, message })));
      }
      return out;
    },
    gate: (before, after) => (changedDishes(before, after).removed.length ? "delete" : null),
    async land(before, after, ctx): Promise<Landed> {
      const { written, removed } = changedDishes(before, after);
      for (const id of removed) {
        const out = await deleteUserDish(id, deps.dishIo);
        if (!out.ok) return { ok: false, reason: out.problems.join("; ") };
      }
      for (const dish of written) {
        const out = await saveUserDish(dish, deps.dishIo, ctx.now);
        if (!out.ok) return { ok: false, reason: out.problems.join("; ") };
      }
      return {
        ok: true,
        notes: written.length ? ["A new dish is planned only once a draft names it: put its id in a pot with edit_data on info-meals-draft."] : [],
      };
    },
    describe(before, after) {
      const { written, removed } = changedDishes(before, after);
      return [
        ...written.map((d) => t(before.dishes[d.id] ? "meals.edit.dishChanged" : "meals.edit.dishAdded", { name: d.name, id: d.id })),
        ...removed.map((id) => t("meals.edit.dishRemoved", { name: before.dishes[id]?.name ?? id, id })),
      ];
    },
  };
}

// --- registration ----------------------------------------------------------------

const editListeners = new Set<() => void>();

/** Hear every meals write edit_data lands, for a screen showing the plan. Returns the undo. */
export function watchMealsEdits(listener: () => void): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

function mealsEdited(): void {
  for (const listener of [...editListeners]) listener();
}

export function liveMealsWriteDeps(): MealsWriteDeps {
  return {
    readText: (path) => appWriteIo.readText(path),
    ports: liveMealsPorts({ today: () => localDate(Date.now()), changed: mealsEdited }),
    dishIo: userDishIo,
  };
}

/** Register the three meals kinds with the housekeeper. Called once from the shells' bootDomains; returns the undo. */
export function registerMealsWritables(deps: MealsWriteDeps = liveMealsWriteDeps()): () => void {
  const offs = [
    registerWritable(mealsDraftEntry(deps)),
    registerWritable(mealsPlanEntry(deps)),
    registerWritable(mealsDishesEntry(deps)),
  ];
  return () => offs.forEach((off) => off());
}
