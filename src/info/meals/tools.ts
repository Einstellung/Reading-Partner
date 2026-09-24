// The meals desk's tools and the standing instruction that goes with them
// (docs/73), modelled on info/briefer/lab-tool.ts: the planning tool drafts a
// card and writes nothing, the card's Apply performs the write, and a
// synthetic user turn afterwards tells the model what landed.
//
// The others write straight through. That is the harness principle, not an
// exception to it: a profile change, a deviation, a line on the shopping list
// and a method line are the reader's own instruction carried out.
//
// The model chooses foods from the food table by id, their roles, a flavour, a
// one-line method and the minutes. It supplies no dates, no grams for the
// solved roles, no nutrition numbers and no shopping list: the program solves,
// checks and derives them (docs/73 事实不经模型).

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import { mealWords, recordDeviation, refreshPhotos, saveProfile, type MealsPorts } from "./apply";
import type { MealsCard, MealsPlanCardData } from "./cards";
import { checkPlan } from "./checks";
import { FOODS, foodAllowed } from "./nutrition/foods";
import type { TemplateItem, TemplateRole } from "./nutrition/solve";
import type { Goal, Profile, Region, Targets, TrainTime, Work } from "./nutrition/targets";
import {
  addReaderItem,
  currentList,
  isChecked,
  markShoppingDone,
  removeShoppingItem,
  replaceShoppingItem,
} from "./shopping";
import { targetsOf } from "./solve-week";
import {
  CATEGORY_ORDER,
  FLAVOURS,
  KEEPS_ORDER,
  MEAL_KEYS,
  MEAL_MODES,
  flavourOf,
  type Deviation,
  type IngredientCategory,
  type KeepsClass,
  type Meal,
  type MealKey,
  type MealMode,
  type MealsState,
  type ShoppingItem,
  type WeekPlan,
} from "./types";
import { WEEK_DAYS, addDays, assembleWeekPlan, dayOn, isoWeekday, type DayDraft, type MealDraft } from "./week";

/** What the reader has in front of them when they open the conversation. */
export type MealsFocus =
  | { kind: "week" }
  | { kind: "shopping" }
  | { kind: "day"; date: string };

export interface MealsToolDeps {
  // The conversation the proposal was made in.
  threadId: string;
  // The profile, the week, the trip and the deviations, read when the tool is
  // called rather than when the desk was laid.
  state(): Promise<MealsState>;
  // Today's local date, from the host clock. Never asked of the model.
  today(): string;
  now(): number;
  // Which BMI cut points and fat range apply (region.ts).
  region(): Region;
  // Surface the card. The host owns Apply; the planning tool never writes.
  onMealsCard(card: MealsCard): void;
}

// --- the instruction ---------------------------------------------------------

const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function templateLine(items: readonly TemplateItem[] | undefined): string {
  return (items ?? [])
    .map((i) => (i.role === "fixed" ? `${i.foodId} ${i.grams ?? "?"} g` : `${i.foodId} (${i.role})`))
    .join(", ");
}

function mealLine(meal: Meal): string {
  switch (meal.mode) {
    case "make": {
      const head = `${meal.name ?? "no foods yet"}${meal.flavour ? ` [${meal.flavour}]` : ""}`;
      const mins = meal.minutes ? `, ${meal.minutes} min` : "";
      return meal.items?.length ? `${head}${mins}: ${templateLine(meal.items)}` : `${head} — needs foods`;
    }
    case "out":
      return meal.place ? `out at ${meal.place}` : "out";
    case "delivery":
      return meal.place ? `delivery from ${meal.place}` : "delivery";
    case "bought":
      return meal.place ? `bought on the way: ${meal.place}` : "bought on the way";
    case "skip":
      return meal.note || "not eating";
  }
}

function dayHeading(plan: WeekPlan, index: number, profile: Profile | null, today: string): string {
  const day = plan.days[index];
  if (!day) return "";
  const wd = isoWeekday(day.date);
  const training = profile?.trainingDays.includes(wd) ? ", training" : profile ? ", rest" : "";
  return `- Day ${index + 1} (${day.date}, ${WEEKDAY_SHORT[wd] ?? ""}${training})${day.date === today ? "  <- today" : ""}`;
}

function focusLines(state: MealsState, focus: MealsFocus): string[] {
  if (focus.kind === "shopping") {
    const list = currentList(state.shopping);
    const left = list.filter((i) => !isChecked(state.shopping, i)).length;
    const done = state.shopping.doneOn;
    return [
      `They are looking at the shopping list: ${list.length} lines, ${left} not ticked off.`,
      done
        ? `The week's shop was done on ${done}. Anything new goes on next week's list, unless ` +
          "they say they are passing a shop today."
        : "The week's shop has not been done yet.",
    ];
  }
  if (focus.kind === "day") {
    const day = dayOn(state.plan, focus.date);
    if (!day) return [`They are looking at ${focus.date}, which this week does not cover.`];
    return [
      `They are looking at ${focus.date}. Its method lines are on their screen; do not read them back. ` +
        "Call write_meals_method only if they want one made another way.",
    ];
  }
  return ["They are looking at the week."];
}

function targetsLine(label: string, t: Targets["training"]): string {
  return `${label}: ${t.kcal} kcal, protein ${t.protein} g, fat ${t.fat} g, carbs ${t.carbs} g`;
}

const GOAL_WORDS: Record<Goal, string> = {
  cut: "lose fat",
  gain: "build muscle",
  steady: "steady energy",
};

const GOAL_ADVICE: Record<Goal, string> = {
  cut:
    "Losing fat: lean protein foods (chicken breast, shrimp, white fish, egg whites, tofu, Greek " +
    "yogurt), plenty of vegetables, whole-grain or root staples, one spoon of oil.",
  gain:
    "Building muscle: a protein food at every meal including the snack, denser staples (rice, " +
    "oats, noodles, bread), fattier fish and nuts are fine.",
  steady:
    "Steady energy: slow staples (whole grains, oats, sweet potato), a protein food at every " +
    "meal, vegetables at lunch and dinner.",
};

/** The food table as the model chooses from it: id, name, roles, tags. */
export function foodListing(dislikes: readonly string[]): string[] {
  return FOODS.filter((f) => foodAllowed(f, dislikes)).map(
    (f) => `${f.id} ${f.zh} ${f.roles.join("/")}${f.tags.length ? ` [${f.tags.join(",")}]` : ""}`,
  );
}

/**
 * What the meals desk is told before it says anything: the reader's profile
 * and the program's targets, the week as it stands with today marked, what
 * they are looking at, and the rules the program will hold a plan to anyway.
 */
export function mealsGuidance(
  state: MealsState,
  today: string,
  opts: { focus?: MealsFocus; region?: Region } = {},
): string {
  const out: string[] = ["MEALS", `Today is ${today}.`, ""];
  const charter = state.charter;
  const profile = charter?.profile ?? null;
  const targets = targetsOf(charter, opts.region ?? "other");

  if (!profile) {
    out.push(
      "They have not answered the opening questions yet. Nothing can be planned until they do:",
      "ask them to go through them on the Meals screen. Do not ask the questions yourself.",
    );
  } else {
    const days = profile.trainingDays.map((d) => WEEKDAY_SHORT[d]).join(", ");
    out.push(
      `Goal: ${GOAL_WORDS[profile.goal]}. ${days ? `Trains ${days} (${profile.trainTime}).` : "Does not train."}`,
      `At most ${profile.minutesPerMeal} minutes hands-on a meal. ${profile.people} eating.`,
      `Shops: ${profile.shops.join(", ") || "none named"}. Kitchen: ${profile.kitchen.join(", ") || "not said"}.`,
      `Never use: ${profile.dislikes.join(", ") || "nothing named"}.`,
    );
    if (charter?.text) out.push(`In their words: ${charter.text}`);
    if (targets) {
      out.push(
        "Daily targets, computed by the program from their body data. Never restate, round or " +
          "recompute them; the screen shows them.",
        targetsLine("Training day", targets.training),
        targetsLine("Rest day", targets.rest),
      );
    } else {
      out.push(
        "They chose not to share body data, so there are no targets and the program cannot solve " +
          "portions. A plan needs them: if they want one, ask them to replay the opening questions.",
      );
    }
    out.push(
      "When they state a change — a new weight ('称了 71'), another goal, other training days, a " +
        "new dislike — call update_meals_profile with just that. It writes at once and re-solves " +
        "the week; say one line.",
    );
  }
  out.push("");

  if (state.plan) {
    const plan = state.plan;
    out.push("This week:");
    for (let i = 0; i < plan.days.length; i++) {
      const day = plan.days[i];
      if (!day) continue;
      out.push(dayHeading(plan, i, profile, today));
      for (const key of MEAL_KEYS) out.push(`    ${key}: ${mealLine(day[key])}`);
    }
    out.push(
      "",
      "Refer to a meal by its day number and which meal it is. Never write a date yourself — the",
      "program owns every date, every gram and the shopping list, and it will contradict you.",
    );
  } else {
    out.push("No week is planned. Call propose_meals_plan when they ask what to eat this week.");
  }

  out.push("", ...focusLines(state, opts.focus ?? { kind: "week" }));

  if (state.deviations.length) {
    out.push("", "What they have told you went differently:");
    for (const d of state.deviations.slice(-3)) out.push(`- ${d.date} ${d.meal}: ${d.said}`);
  }

  const limit = profile?.minutesPerMeal ?? 10;
  out.push(
    "",
    "HOW TO PLAN",
    "Seven days, four meals each: breakfast, lunch, dinner and a snack. A made meal is about ten",
    `minutes of hands-on work, never more than ${limit}, assembled mostly from ready foods —`,
    "ready-to-eat chicken breast, frozen shrimp, eggs, tofu, Greek yogurt, frozen vegetables,",
    "microwave grain rice, oats. Not cooked dishes.",
    "A made meal is a list of foods from FOODS by id, each with a role: exactly one `protein` and",
    "exactly one `staple`, whose grams the program solves (a fruit can be the staple of a snack or a",
    "breakfast); at most one `fat` (an oil, nuts, a fatty spread), which the program moves; and any",
    "number of `fixed` items with grams you give — vegetables (150–250 g at lunch and dinner, 80 g",
    "or more at breakfast), a sauce (10–30 g), a second protein. Give no grams for the solved roles",
    "and never a calorie or protein number: the program computes every one.",
    profile ? GOAL_ADVICE[profile.goal] : "",
    "Each made meal has a `flavour` from FLAVOURS. Two main meals in a row — dinner and the next",
    "breakfast included — never share one; rotate through the list over the week.",
    "Fish or seafood in at least two meals a week. Nothing they do not eat. Only what their kitchen",
    "can do and their shops sell.",
    "The snack is small: yogurt, milk, fruit, a few nuts. On a training day it is eaten right after",
    "training.",
    "Out, delivery, bought and skip are ordinary plans, from the places they actually go. They have",
    "no foods and no grams. Do not apologise for them.",
    "Give each made meal a `name` in their language, a `searchName` (the dish's common English",
    "name, what an image search would find), a one-line `method` in their language and `minutes`.",
    "The program solves the grams and checks the week: foods in the table, roles, minutes,",
    "dislikes, flavours in a row, fish twice, and whether the protein reaches the meal's target.",
    "What fails comes back to you: fix those meals and send the whole week again (an adjustment",
    "sends only its own meals).",
    "",
    "FLAVOURS",
    FLAVOURS.map((f) => `${f.id} (${f.zh})`).join(", "),
    "",
    "FOODS (id, name, roles, [tags])",
    ...foodListing(profile?.dislikes ?? []),
    "",
    "WHEN A MEAL GOES DIFFERENTLY",
    "They will say one sentence ('中午没带饭，食堂吃的'). Call record_meals_deviation. It answers",
    "with at most two meals to re-pick; call propose_meals_plan with adjustment set for those",
    "meals only. Never re-plan the week over one meal. Boredom and 'too much hassle' are not",
    "adjustments — remember them for the next week.",
    "",
    "THE SHOPPING LIST",
    "Derived by the program from the solved grams, one trip a week. Before it is done, add,",
    "remove and swap lines as they ask. Once it is done, the list is what is in the fridge:",
    "something new is next week's business, unless they say they are passing a shop today, and",
    "then add_shopping_items with today set. Never read the list back to them.",
  );
  return out.filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}

// --- the week ----------------------------------------------------------------

// Only `mode` is on every meal. The rest belong to made meals or to the other
// modes, so they are optional: a required property the model has nothing to
// put in fails validation and the loop retries for ever (docs/pitfall/379).
const mealSchema = (which: MealKey) =>
  Type.Object({
    mode: Type.String({ description: `What this ${which} is: ${MEAL_MODES.join(", ")}.` }),
    name: Type.Optional(Type.String({ description: "For make: the meal's name in their language." })),
    searchName: Type.Optional(
      Type.String({
        description:
          "For make: the dish's common English name as people search for it, lower case " +
          "('shrimp fried rice', 'greek yogurt bowl'). It finds the photograph.",
      }),
    ),
    flavour: Type.Optional(Type.String({ description: "For make: one id from FLAVOURS." })),
    method: Type.Optional(
      Type.String({ description: "For make: one line on how it is put together, in their language." }),
    ),
    minutes: Type.Optional(Type.Number({ description: "For make: hands-on minutes." })),
    items: Type.Optional(
      Type.Array(
        Type.Object({
          food: Type.String({ description: "A food id from FOODS." }),
          role: Type.String({ description: "protein, staple, fat or fixed." }),
          grams: Type.Optional(Type.Number({ description: "For fixed items only: the grams." })),
        }),
        { description: "For make: the foods, one protein, one staple, at most one fat, any fixed." },
      ),
    ),
    place: Type.Optional(
      Type.String({ description: "For out, delivery and bought: where, in their own words." }),
    ),
    note: Type.Optional(Type.String({ description: "One short line of theirs about this meal." })),
  });

export function buildProposeMealsPlanTool(deps: MealsToolDeps): AgentTool {
  return {
    name: "propose_meals_plan",
    label: (args) => (args.adjustment ? "Reworking a meal" : "Drafting this week's meals"),
    effect: "write",
    gate: "card",
    description:
      "Propose the week's meals, or re-pick the one or two meals a change left open. `days` gives " +
      "a day per entry, `day` being its number from 1 to 7 exactly as your instructions print " +
      "them — never a date — each with `breakfast`, `lunch`, `dinner` and `snack`. A `make` meal " +
      "lists its foods by id with roles, plus name, searchName, flavour, method and minutes; " +
      "`out`, `delivery` and `bought` give `place`. Set `adjustment` to rework meals of the week " +
      "they already have — then send only those meals. The program solves every gram, checks the " +
      "week and derives the shopping list; anything that fails comes back to you. It files " +
      "nothing: the user sees a card and applies it.",
    parameters: Type.Object({
      adjustment: Type.Optional(
        Type.Boolean({ description: "True when this reworks meals of the week already planned." }),
      ),
      days: Type.Array(
        Type.Object({
          day: Type.Number({ description: "1 to 7, the day number from your instructions." }),
          breakfast: Type.Optional(mealSchema("breakfast")),
          lunch: Type.Optional(mealSchema("lunch")),
          dinner: Type.Optional(mealSchema("dinner")),
          snack: Type.Optional(mealSchema("snack")),
        }),
        { description: "The days this call plans." },
      ),
    }),
    execute: async (args) => {
      const state = await deps.state();
      const charter = state.charter;
      const targets = targetsOf(charter, deps.region());
      if (!charter || !targets) {
        return {
          receipt: null,
          text: charter
            ? "They withheld body data, so nothing can be solved. Ask them to replay the opening questions if they want a plan."
            : "They have not answered the opening questions, so there is nothing to plan against. Ask them to go through them on the Meals screen.",
        };
      }
      const adjustment = args.adjustment === true;
      if (adjustment && !state.plan) {
        return {
          receipt: null,
          text: "There is no week planned yet, so there is nothing to adjust. Propose a whole week instead.",
        };
      }
      const days = toDayDrafts(args.days);
      if (days.length === 0) throw new Error("propose_meals_plan needs at least one day.");
      if (!adjustment) {
        if (days.length < WEEK_DAYS) {
          return {
            receipt: null,
            text:
              `A fresh week needs all ${WEEK_DAYS} days; you sent ${days.length}. Send the whole ` +
              "week, or set adjustment if you meant to rework meals of the week they have.",
          };
        }
        const thin = days.filter((d) => MEAL_KEYS.some((k) => !d[k]));
        if (thin.length) {
          return {
            receipt: null,
            text:
              `A fresh week needs breakfast, lunch, dinner and snack on every day; day ` +
              `${thin.map((d) => d.day).join(", ")} is missing one. Send all four.`,
          };
        }
      }

      const assembled = assembleWeekPlan(
        { days },
        { startDate: deps.today(), createdAt: deps.now(), previous: adjustment ? state.plan : null },
      );
      const checked = assembled.problems.length
        ? { plan: assembled.plan, problems: assembled.problems }
        : checkPlan({
            plan: assembled.plan,
            profile: charter.profile,
            targets,
            changed: adjustment ? assembled.changed : null,
            previous: adjustment ? state.plan : null,
          });
      // A refusal, not a thrown error: the model can fix every one of these in
      // the same turn, and the user should never see the attempt.
      if (checked.problems.length) {
        return {
          receipt: null,
          text:
            "Nothing was proposed — the plan does not hold up:\n" +
            checked.problems.map((p) => `- ${p}`).join("\n") +
            // Nothing of a refused draft is kept, so a fresh week goes back
            // whole: the model otherwise sends just the fixed day and is
            // refused again for being short.
            (adjustment
              ? "\nFix only those meals and call propose_meals_plan again."
              : "\nFix those meals and call propose_meals_plan again with the whole week, all " +
                `${WEEK_DAYS} days — nothing of this draft was kept.`),
        };
      }

      const card: MealsPlanCardData = {
        kind: "meals-plan",
        threadId: deps.threadId,
        startDate: checked.plan.startDate,
        days: checked.plan.days,
        adjustment,
        changed: adjustment ? assembled.changed : [],
        changedDates: adjustment ? assembled.changedDates : [],
        phase: "proposed",
      };
      deps.onMealsCard(card);
      return {
        text:
          (adjustment
            ? `Proposed a change to ${assembled.changed.length} meal(s).`
            : "Proposed the week's meals.") +
          " A card now shows the user the days with the grams the program solved. Nothing is " +
          "saved until they apply it. Do not recite amounts or the shopping list — they are on the card.",
        receipt: {
          label: adjustment ? "Reworked a meal" : "Drafted the week",
          summary: adjustment
            ? assembled.changed.map(mealWords).join("; ")
            : checked.plan.days.map((d) => `${d.date}: ${d.dinner.name ?? d.dinner.mode}`).join("; "),
        },
      };
    },
  };
}

// --- the profile -------------------------------------------------------------

const GOALS: readonly Goal[] = ["cut", "gain", "steady"];
const TRAIN_TIMES: readonly TrainTime[] = ["morning", "midday", "evening"];
const WORKS: readonly Work[] = ["sit", "stand", "labor"];

function positive(raw: unknown, max: number): number | null {
  const n = Number(raw);
  return raw !== undefined && raw !== null && Number.isFinite(n) && n > 0 && n <= max ? n : null;
}

function oneOf<T extends string>(raw: unknown, list: readonly T[]): T | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (list as readonly string[]).includes(v) ? (v as T) : null;
}

/**
 * The profile with the fields the reader just stated, or null when none of
 * them was usable. Pure; the tool below writes it.
 */
export function patchProfile(profile: Profile, args: Record<string, unknown>): Profile | null {
  const next: Profile = { ...profile };
  let touched = false;
  const set = <K extends keyof Profile>(key: K, value: Profile[K] | null) => {
    if (value === null) return;
    next[key] = value;
    touched = true;
  };
  set("weightKg", positive(args.weightKg, 400));
  set("heightCm", positive(args.heightCm, 260));
  set("bodyFatPct", positive(args.bodyFatPct, 70));
  set("waistCm", positive(args.waistCm, 250));
  set("goal", oneOf(args.goal, GOALS));
  set("trainTime", oneOf(args.trainTime, TRAIN_TIMES));
  set("work", oneOf(args.work, WORKS));
  const minutes = positive(args.minutesPerMeal, 120);
  set("minutesPerMeal", minutes === null ? null : Math.round(minutes));
  const people = positive(args.people, 20);
  set("people", people === null ? null : Math.round(people));
  if (Array.isArray(args.trainingDays)) {
    const days = [...new Set(args.trainingDays.map((d) => Math.round(Number(d))))]
      .filter((d) => d >= 1 && d <= 7)
      .sort();
    set("trainingDays", days);
  }
  if (Array.isArray(args.dislikes)) set("dislikes", toStrings(args.dislikes));
  if (Array.isArray(args.shops)) set("shops", toStrings(args.shops));
  if (Array.isArray(args.kitchen)) set("kitchen", toStrings(args.kitchen));
  return touched ? next : null;
}

/**
 * Change the profile because the reader said so (docs/73 体重变化). Direct
 * write, no card: the program re-solves the week against the new targets and
 * the model says one line.
 */
export function buildUpdateProfileTool(deps: MealsToolDeps & { ports: MealsPorts }): AgentTool {
  return {
    name: "update_meals_profile",
    label: () => "Updating your meal targets",
    effect: "write",
    description:
      "Call this the moment they state a change to what the plan is built on: a new weight " +
      "('这周称了 71'), another goal ('改成增肌'), other training days ('周二也练'), a new dislike, " +
      "more people eating. Send only the fields that changed. Lists (trainingDays, dislikes, " +
      "shops, kitchen) replace the whole list, so send the full list as it now stands. `notes` " +
      "replaces what they have said about their meals in their own words. It writes at once and " +
      "re-solves the week.",
    parameters: Type.Object({
      weightKg: Type.Optional(Type.Number()),
      heightCm: Type.Optional(Type.Number()),
      bodyFatPct: Type.Optional(Type.Number({ description: "Percent, e.g. 18." })),
      waistCm: Type.Optional(Type.Number()),
      goal: Type.Optional(Type.String({ description: `One of: ${GOALS.join(", ")}.` })),
      trainingDays: Type.Optional(
        Type.Array(Type.Number(), { description: "ISO weekdays, Monday 1 to Sunday 7. Empty when they stop training." }),
      ),
      trainTime: Type.Optional(Type.String({ description: `One of: ${TRAIN_TIMES.join(", ")}.` })),
      work: Type.Optional(Type.String({ description: `One of: ${WORKS.join(", ")}.` })),
      minutesPerMeal: Type.Optional(Type.Number()),
      people: Type.Optional(Type.Number()),
      dislikes: Type.Optional(Type.Array(Type.String())),
      shops: Type.Optional(Type.Array(Type.String())),
      kitchen: Type.Optional(Type.Array(Type.String())),
      notes: Type.Optional(Type.String({ description: "Their meals in their own words, one paragraph." })),
    }),
    execute: async (args) => {
      const state = await deps.state();
      if (!state.charter) {
        return {
          receipt: null,
          text: "They have not answered the opening questions, so there is no profile to change.",
        };
      }
      const notes = typeof args.notes === "string" ? args.notes.trim() : undefined;
      const profile = patchProfile(state.charter.profile, args as Record<string, unknown>);
      if (!profile && notes === undefined) {
        return { receipt: null, text: "None of those fields was usable, so nothing changed." };
      }
      const { ok, targets } = await saveProfile(profile ?? state.charter.profile, deps.ports, notes);
      if (!ok) return { receipt: null, text: "The change could not be written. Nothing changed." };
      const numbers = targets
        ? ` Daily targets now — ${targetsLine("training day", targets.training)}; ${targetsLine("rest day", targets.rest)}.`
        : "";
      return {
        text:
          `Saved.${numbers}${state.plan ? " The week's grams are re-solved and the list follows." : ""}` +
          " Say it in one line; the numbers are on their screen.",
        receipt: { label: "Updated your profile", summary: Object.keys(args).join(", ") },
      };
    },
  };
}

// --- a meal that went differently --------------------------------------------

/**
 * Record what actually happened at a meal, from the reader's own sentence. It
 * writes; what the program did with it comes back in the result, so the model
 * can follow with propose_meals_plan for exactly the meals named.
 */
export function buildRecordDeviationTool(deps: MealsToolDeps & { ports: MealsPorts }): AgentTool {
  return {
    name: "record_meals_deviation",
    label: () => "Recording what you ate instead",
    effect: "write",
    description:
      "Call this the moment they say a meal went differently from the plan ('we ordered in', " +
      "'didn't take lunch'). It writes that meal down and re-solves the week. It answers with the " +
      "meals whose foods to pick again: plan only those, with propose_meals_plan and adjustment " +
      "set. Do not call it for boredom or 'too much hassle' — that is next week's business.",
    parameters: Type.Object({
      day: Type.String({
        description: "Which day: 'today', 'yesterday', or the day number 1 to 7 from your instructions.",
      }),
      meal: Type.String({ description: `${MEAL_KEYS.join(", ")}.` }),
      became: Type.String({ description: `What the meal actually was: ${MEAL_MODES.join(", ")}.` }),
      place: Type.Optional(Type.String({ description: "Where, for out, delivery or bought, in their words." })),
      said: Type.String({ description: "Their own sentence, as they said it." }),
    }),
    execute: async (args) => {
      const state = await deps.state();
      if (!state.plan) {
        return { receipt: null, text: "There is no week planned, so there is nothing to record a change against." };
      }
      const date = resolveDeviationDate(String(args.day ?? ""), state.plan.startDate, deps.today());
      if (!date) {
        return {
          receipt: null,
          text: "That is not a day of this week. Say 'today', 'yesterday', or the day number 1 to 7.",
        };
      }
      const meal = toMealKey(args.meal);
      if (!meal) return { receipt: null, text: `meal must be one of: ${MEAL_KEYS.join(", ")}.` };
      const mode = oneOf<MealMode>(args.became, MEAL_MODES);
      if (!mode) return { receipt: null, text: `became must be one of: ${MEAL_MODES.join(", ")}.` };
      const said = String(args.said ?? "").trim();
      if (!said) throw new Error("record_meals_deviation needs their sentence.");
      const place = String(args.place ?? "").trim();
      const deviation: Deviation = {
        date,
        meal,
        said,
        became: mode,
        ...(place ? { place } : {}),
        changed: "",
        at: deps.now(),
      };
      const { ok, attention } = await recordDeviation(deviation, deps.ports);
      if (!ok) return { receipt: null, text: "The change could not be written. Nothing was recorded." };
      return {
        text: attention.length
          ? `Recorded. ${attention.map(mealWords).join(" and ")} needs its foods picked again — call ` +
            "propose_meals_plan with adjustment set for those meals only."
          : "Recorded. Nothing else in the week moved, so there is nothing to re-plan.",
        receipt: { label: "Recorded a change of plan", summary: `${date} ${meal}: ${said}` },
      };
    },
  };
}

/**
 * The date a day's name stands for: "today", "yesterday", "tomorrow", or the
 * day of the week exactly as mealsGuidance printed it. Null for anything
 * outside the planned week.
 */
export function resolveDeviationDate(raw: string, startDate: string, today: string): string | null {
  const word = raw.trim().toLowerCase();
  if (word === "today") return today;
  if (word === "yesterday") return addDays(today, -1);
  if (word === "tomorrow") return addDays(today, 1);
  const n = Number(word);
  if (!Number.isFinite(n) || n < 1 || n > WEEK_DAYS) return null;
  return addDays(startDate, Math.round(n) - 1);
}

// --- the shopping list -------------------------------------------------------
//
// Three tools that write straight through, no card. The reader said "add
// washing-up liquid"; a card asking them to confirm that they said it is the
// homework this line exists not to be.

/** Add lines the reader asked for. */
export function buildAddShoppingItemsTool(
  deps: MealsToolDeps & { ports: MealsPorts },
): AgentTool {
  return {
    name: "add_shopping_items",
    label: () => "Adding to the shopping list",
    effect: "write",
    description:
      "Put things on the shopping list because they asked for them ('add washing-up liquid and " +
      "two cartons of milk'). Only what the week's cooking does not already buy — the planned " +
      "ingredients are derived and already there. Once the week's shop has been done this " +
      "writes nothing and tells you to say it goes on next week's list; pass `today` only when " +
      "they say they are passing a shop today anyway.",
    parameters: Type.Object({
      items: Type.Array(
        Type.Object({
          name: Type.String({ description: "What it is, in their language." }),
          en: Type.String({
            description: "Its English common name, singular and lower case. It finds the picture.",
          }),
          qty: Type.String({ description: "Free text, e.g. 'two cartons'. May be empty." }),
          category: Type.String({ description: `One of: ${CATEGORY_ORDER.join(", ")}.` }),
          keeps: Type.String({
            description: `How long it keeps: ${KEEPS_ORDER.join(", ")}.`,
          }),
        }),
        { description: "The lines to add." },
      ),
      today: Type.Optional(
        Type.Boolean({
          description:
            "True only when the shop is done and they said they are passing a shop today anyway.",
        }),
      ),
    }),
    execute: async (args) => {
      const state = await deps.state();
      const items = toReaderItems(args.items);
      if (!items.length) throw new Error("add_shopping_items needs at least one line.");
      const done = state.shopping.doneOn;
      if (done && args.today !== true) {
        return {
          receipt: null,
          text:
            `The week's shop was done on ${done}, so nothing was added. Tell them it goes on ` +
            "next week's list and that this week is whatever is in the fridge. If they say they " +
            "are passing a shop today, call this again with today set.",
        };
      }
      let shopping = state.shopping;
      const added: string[] = [];
      for (const item of items) {
        const next = addReaderItem(shopping, item);
        if (next !== shopping) added.push(item.name);
        shopping = next;
      }
      if (!added.length) {
        return { receipt: null, text: "Those are already on the list; nothing was added." };
      }
      try {
        await deps.ports.saveShopping(shopping);
      } catch {
        return { receipt: null, text: "The list could not be written. Nothing was added." };
      }
      deps.ports.changed();
      const note = done
        ? `Added ${added.join(", ")} under "still to get" — they are passing a shop today. ` +
          "Everything else still waits for next week."
        : `Added ${added.join(", ")} to the list, apart from the planned ingredients. Say so in ` +
          "one line; the list itself is on their screen.";
      return { text: note, receipt: { label: "Added to the shopping list", summary: added.join(", ") } };
    },
  };
}

/** Take one line off. */
export function buildRemoveShoppingItemTool(
  deps: MealsToolDeps & { ports: MealsPorts },
): AgentTool {
  return {
    name: "remove_shopping_item",
    label: () => "Taking a line off the shopping list",
    effect: "write",
    description:
      "Take one line off the shopping list because they said they do not need it ('drop the " +
      "milk'). Works on a derived line and on one they added. It does not change the week: a " +
      "meal that wanted that ingredient still wants it.",
    parameters: Type.Object({
      name: Type.String({ description: "The line, as it reads on the list." }),
    }),
    execute: async (args) => {
      const state = await deps.state();
      const name = String(args.name ?? "").trim();
      if (!name) throw new Error("remove_shopping_item needs a name.");
      const hit = removeShoppingItem(state.shopping, name);
      if (!hit) {
        return { receipt: null, text: `Nothing on the list is called "${name}", so nothing changed.` };
      }
      try {
        await deps.ports.saveShopping(hit.state);
      } catch {
        return { receipt: null, text: "The list could not be written. Nothing was removed." };
      }
      deps.ports.changed();
      return {
        text: `${hit.removed.name} is off the list. One line back, nothing else.`,
        receipt: { label: "Took a line off the list", summary: hit.removed.name },
      };
    },
  };
}

/** Swap one line for another. */
export function buildReplaceShoppingItemTool(
  deps: MealsToolDeps & { ports: MealsPorts },
): AgentTool {
  return {
    name: "replace_shopping_item",
    label: () => "Swapping a line on the shopping list",
    effect: "write",
    description:
      "Swap one line of the shopping list for something else because they said so ('coriander " +
      "for spring onions'). The line keeps its aisle, its shelf life and the day it is needed " +
      "by; only what goes in the basket changes.",
    parameters: Type.Object({
      from: Type.String({ description: "The line as it reads now." }),
      to: Type.String({ description: "What it becomes, in their language." }),
      en: Type.String({
        description: "The new thing's English common name, singular and lower case.",
      }),
      qty: Type.Optional(
        Type.String({ description: "How much, if it changes. May be empty." }),
      ),
    }),
    execute: async (args) => {
      const state = await deps.state();
      const from = String(args.from ?? "").trim();
      const to = String(args.to ?? "").trim();
      if (!from || !to) throw new Error("replace_shopping_item needs both names.");
      const hit = replaceShoppingItem(state.shopping, from, {
        name: to,
        en: String(args.en ?? "").trim(),
        qty: String(args.qty ?? "").trim(),
      });
      if (!hit) {
        return {
          receipt: null,
          text: `Nothing on the list is called "${from}", so there is nothing to swap.`,
        };
      }
      try {
        await deps.ports.saveShopping(hit.state);
      } catch {
        return { receipt: null, text: "The list could not be written. Nothing was swapped." };
      }
      deps.ports.changed();
      return {
        text: `${from} is now ${hit.line.name}, in the same group and keeping the same time.`,
        receipt: { label: "Swapped a line on the list", summary: `${from} → ${hit.line.name}` },
      };
    },
  };
}


// --- how a meal is made ------------------------------------------------------

/** The longest a method line may be. It is a line, not a recipe. */
export const MAX_METHOD_CHARS = 160;

/**
 * Rewrite one made meal's method line, because the reader wants it made
 * another way ("没有微波炉"). The line normally comes with the plan; this is
 * the one place it changes afterwards, and it writes straight through.
 */
export function buildWriteMethodTool(deps: MealsToolDeps & { ports: MealsPorts }): AgentTool {
  return {
    name: "write_meals_method",
    label: () => "Rewriting how it's made",
    effect: "write",
    description:
      "Rewrite the one-line method of one made meal, when they want it done another way ('no " +
      "microwave', 'I only have one pan'). Same foods, same minutes or fewer, no amounts and no " +
      "nutrition numbers. It replaces whatever was there.",
    parameters: Type.Object({
      day: Type.String({ description: "'today', 'tomorrow', or the day number 1 to 7 from your instructions." }),
      meal: Type.String({ description: `${MEAL_KEYS.join(", ")}.` }),
      method: Type.String({ description: "One line, in their language." }),
    }),
    execute: async (args) => {
      const state = await deps.state();
      const plan = state.plan;
      const date = plan ? resolveDeviationDate(String(args.day ?? ""), plan.startDate, deps.today()) : null;
      const key = toMealKey(args.meal);
      const meal = date && key ? dayOn(plan, date)?.[key] : null;
      if (!date || !key || !meal || meal.mode !== "make") {
        return { receipt: null, text: "That is not a made meal of the week they have. Nothing was written." };
      }
      const method = String(args.method ?? "").trim();
      if (!method || method.length > MAX_METHOD_CHARS) {
        return {
          receipt: null,
          text: `The method is one line of at most ${MAX_METHOD_CHARS} characters. Nothing was written.`,
        };
      }
      try {
        await deps.ports.saveMealMethod(date, key, method);
      } catch {
        return { receipt: null, text: "The method could not be written. Nothing changed." };
      }
      deps.ports.changed();
      return {
        text: `The method for ${meal.name ?? key} is rewritten and on their screen. Do not read it back.`,
        receipt: { label: "Rewrote how it's made", summary: `${date} ${key}` },
      };
    },
  };
}

/**
 * Search this week's photographs again (docs/73 图片).
 *
 * The one thing the reader can ask about the pictures. The searching happens on
 * the machine with a hidden webview, which is usually not the one they are
 * holding, so what this writes is the moment they asked: every picture older
 * than it is looked up again wherever the search runs. The pictures appear on
 * the screen as they land, without another turn.
 */
export function buildRefreshMealsPhotosTool(
  deps: MealsToolDeps & { ports: MealsPorts },
): AgentTool {
  return {
    name: "refresh_meals_photos",
    label: () => "Looking for better photographs",
    effect: "write",
    description:
      "Call this when they say a picture on the meals screen is wrong or is not the dish they " +
      "meant. It searches this week's dishes and ingredients again from scratch. There is " +
      "nothing to choose and nothing to confirm; say it is looking and move on.",
    parameters: Type.Object({}),
    execute: async () => {
      const state = await deps.state();
      if (!state.plan) {
        return {
          receipt: null,
          text: "There is no week planned, so there are no photographs to look for.",
        };
      }
      const { queries, searching } = await refreshPhotos(deps.ports);
      if (!queries) {
        return {
          receipt: null,
          text: "Nothing could be asked for: the request could not be written down.",
        };
      }
      const many = `${queries} ${queries === 1 ? "photograph" : "photographs"}`;
      return {
        receipt: null,
        text: searching
          ? `Searching again for ${many}. They appear on their screen as they are found; ` +
            "nothing else has to be done."
          : `Asked for ${many} to be looked for again. The search runs on the computer, which ` +
            "may be asleep; they appear on their screen as they arrive.",
      };
    },
  };
}

/** Call the week's shop done. The host's gesture, not a tool: exported for it. */
export async function markShoppingTripDone(
  ports: MealsPorts,
  date: string,
): Promise<boolean> {
  const state = await ports.current();
  try {
    await ports.saveShopping(markShoppingDone(state.shopping, date));
  } catch {
    return false;
  }
  ports.changed();
  return true;
}


// --- reading what the model sent ---------------------------------------------

function toStrings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((v) => String(v ?? "").trim()).filter((v) => v !== "");
}

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function toCategory(raw: unknown): IngredientCategory {
  return oneOf(raw, CATEGORY_ORDER) ?? "other";
}

function toKeeps(raw: unknown): KeepsClass {
  return oneOf(raw, KEEPS_ORDER) ?? "d3-5";
}

/** A meal key, or null for anything else. */
export function toMealKey(raw: unknown): MealKey | null {
  return oneOf(raw, MEAL_KEYS);
}

function toReaderItems(raw: unknown): ShoppingItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const e = record(entry);
      return {
        name: String(e.name ?? "").trim(),
        en: String(e.en ?? "").trim().toLowerCase(),
        qty: String(e.qty ?? "").trim(),
        category: toCategory(e.category),
        keeps: toKeeps(e.keeps),
        freezeOnArrival: false,
        neededBy: "",
      };
    })
    .filter((i) => i.name !== "");
}

const ROLES: readonly TemplateRole[] = ["protein", "staple", "fat", "fixed"];

// The foods as the model sent them. An id the table does not know is kept as
// written, so the check can name it back; a role off the list becomes fixed
// with no grams, which the check also names.
function toItems(raw: unknown): TemplateItem[] {
  if (!Array.isArray(raw)) return [];
  const out: TemplateItem[] = [];
  for (const entry of raw) {
    const e = record(entry);
    const foodId = String(e.food ?? e.foodId ?? "").trim();
    if (!foodId) continue;
    const role = oneOf(e.role, ROLES) ?? "fixed";
    const grams = Number(e.grams);
    out.push(role === "fixed" && Number.isFinite(grams) && grams > 0 ? { foodId, role, grams: Math.round(grams) } : { foodId, role });
  }
  return out;
}

function toMealDraft(raw: unknown): MealDraft | null {
  const e = record(raw);
  const mode = oneOf(e.mode, MEAL_MODES);
  if (!mode) return null;
  const draft: MealDraft = { mode };
  const text = (k: string) => String(e[k] ?? "").trim();
  if (mode === "make") {
    draft.items = toItems(e.items);
    if (text("name")) draft.name = text("name");
    if (text("searchName")) draft.searchName = text("searchName").toLowerCase();
    const flavour = flavourOf(e.flavour);
    if (flavour) draft.flavour = flavour;
    if (text("method")) draft.method = text("method");
    const minutes = Number(e.minutes);
    if (Number.isFinite(minutes) && minutes > 0) draft.minutes = Math.round(minutes);
  } else if (text("place")) {
    draft.place = text("place");
  }
  if (text("note")) draft.note = text("note");
  return draft;
}

export function toDayDrafts(raw: unknown): DayDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: DayDraft[] = [];
  for (const entry of raw) {
    const e = record(entry);
    const n = Number(e.day);
    const day: DayDraft = { day: Number.isFinite(n) ? Math.round(n) : 0 };
    for (const key of MEAL_KEYS) {
      const meal = toMealDraft(e[key]);
      if (meal) day[key] = meal;
    }
    out.push(day);
  }
  return out;
}
