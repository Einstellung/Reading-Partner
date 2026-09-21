// The meals desk's tools and the standing instruction that goes with them
// (docs/73), modelled on info/briefer/lab-tool.ts: the two planning tools draft
// a card and write nothing, the card's Apply performs the write, and a
// synthetic user turn afterwards tells the model what landed.
//
// The other five write straight through. That is the harness principle, not an
// exception to it: a deviation, a line on the shopping list and a method are
// the reader's own instruction carried out, and there is nothing for them to
// approve about a sentence they just said (docs/AI harness principle).
//
// The model supplies dishes, ingredients, modes and prose. It supplies no
// dates, no shopping list and no arithmetic: a day is a number from one to
// seven exactly as the instruction printed it, and the program turns it into a
// date (docs/73 事实不经模型).

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import { mealWords, recordDeviation, refreshPhotos, type MealsPorts } from "./apply";
import type { MealsCard, MealsCharterCardData, MealsPlanCardData } from "./cards";
import {
  addReaderItem,
  currentList,
  isChecked,
  markShoppingDone,
  removeShoppingItem,
  replaceShoppingItem,
} from "./shopping";
import {
  CATEGORY_ORDER,
  KEEPS_ORDER,
  MEAL_KEYS,
  type Deviation,
  type Dish,
  type DishMethod,
  type Ingredient,
  type IngredientCategory,
  type KeepsClass,
  type Meal,
  type MealKey,
  type MealMode,
  type MealsState,
  type ShoppingItem,
  type WeekPlan,
} from "./types";
import { MAX_STEPS, MAX_STEP_CHARS } from "./method";
import {
  HANDS_ON_LIMITS,
  WEEK_DAYS,
  addDays,
  assembleWeekPlan,
  dishForMeal,
  type DayDraft,
  type DishDraft,
  type MealDraft,
} from "./week";

const MODES: readonly MealMode[] = [
  "cook",
  "reheat",
  "packed",
  "out",
  "delivery",
  "bought",
  "skip",
];

/** What the reader has in front of them when they open the conversation. */
export type MealsFocus =
  | { kind: "week" }
  | { kind: "shopping" }
  | { kind: "day"; date: string };

export interface MealsToolDeps {
  // The conversation the proposal was made in. Carried on the card so one read
  // back off disk still says which it was.
  threadId: string;
  // The charter, the week, the trip and the deviations, read when the tool is
  // called rather than when the desk was laid.
  state(): Promise<MealsState>;
  // Today's local date, from the host clock. Never asked of the model.
  today(): string;
  now(): number;
  // Surface the card. The host owns Apply; the planning tools never write.
  onMealsCard(card: MealsCard): void;
  // Pinned by a test so minted dish ids are an equality assertion.
  random?: () => number;
}

// --- the instruction ---------------------------------------------------------

function mealLine(plan: WeekPlan, meal: Meal): string {
  const dish = dishForMeal(plan, meal);
  switch (meal.mode) {
    case "cook":
      return dish ? `cook ${dish.name}` : "cook — no dish";
    case "reheat":
    case "packed": {
      const word = meal.mode === "packed" ? "carry" : "reheat";
      const what = dish ? ` ${dish.name}` : "";
      const of = meal.reheatOf
        ? ` (the base from ${meal.reheatOf.date} ${meal.reheatOf.meal})`
        : meal.note
          ? ` (${meal.note})`
          : " — nothing to eat, this meal needs a plan";
      return `${word}${what}${of}${meal.freshAdd ? `, plus ${meal.freshAdd}` : ""}`;
    }
    case "out":
      return meal.place ? `out at ${meal.place}` : "out";
    case "delivery":
      return meal.place ? `delivery from ${meal.place}` : "delivery";
    case "bought":
      return meal.place ? `bought on the way: ${meal.place}` : "bought on the way";
    case "skip":
      return meal.note || meal.place || "not eating";
  }
}

function focusLines(state: MealsState, focus: MealsFocus): string[] {
  const plan = state.plan;
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
    if (!plan) return ["They are looking at a day, but no week is planned."];
    const day = plan.days.find((d) => d.date === focus.date);
    if (!day) return [`They are looking at ${focus.date}, which this week does not cover.`];
    const out = [`They are looking at ${focus.date}:`];
    for (const key of MEAL_KEYS) out.push(`- ${key}: ${mealLine(plan, day[key])}`);
    const written = [
      ...new Set(
        MEAL_KEYS.map((k) => dishForMeal(plan, day[k]))
          .filter((d): d is Dish => Boolean(d?.method))
          .map((d) => d.name),
      ),
    ];
    if (written.length) {
      out.push(
        `The steps for ${written.join(" and ")} are already written and on their screen. ` +
          "Do not read them back; call write_meals_method only if they want them changed.",
      );
    }
    return out;
  }
  return ["They are looking at the week."];
}

/**
 * What the meals desk is told before it says anything: the household, the week
 * as it stands with today marked, what the reader is looking at, and the rules
 * the program will hold it to anyway.
 */
export function mealsGuidance(
  state: MealsState,
  today: string,
  opts: { focus?: MealsFocus } = {},
): string {
  const out: string[] = ["MEALS", `Today is ${today}.`, ""];

  if (state.charter) {
    const c = state.charter;
    out.push(
      "The household, in their words:",
      c.text,
      `${c.people} eating. Shops: ${c.stores.join(", ") || "none named"}. Kitchen: ${c.kitchen || "not said"}.`,
      `Never cook: ${c.dislikes.join(", ") || "nothing named"}.`,
      `A normal week: ${c.nightsCooking} cooking, ${c.nightsOut} out, ${c.nightsDelivery} delivery.`,
      "Correct any of this with propose_meals_charter when they say something that changes it.",
    );
  } else {
    out.push(
      "You do not know this household yet. Before planning anything, ask two or three questions",
      "in one message — how many are eating, where they shop, what breakfast and lunch normally",
      "are, how many dinners they want to cook, anything they will not eat — and then call",
      "propose_meals_charter with what they said. Never show them a form and never ask a fourth",
      "question; the rest is learned by talking.",
    );
  }
  out.push("");

  if (state.plan) {
    const plan = state.plan;
    if (plan.breakfastLine) out.push(`Breakfasts this week: ${plan.breakfastLine}`, "");
    out.push("This week:");
    for (let i = 0; i < plan.days.length; i++) {
      const day = plan.days[i];
      if (!day) continue;
      const mark = day.date === today ? "  <- today" : "";
      out.push(`- Day ${i + 1} (${day.date})${mark}`);
      for (const key of MEAL_KEYS) out.push(`    ${key}: ${mealLine(plan, day[key])}`);
    }
    out.push(
      "",
      "Refer to a meal by its day number and which meal it is when you call propose_meals_plan.",
      "Never write a date yourself and never work one out — the program owns every date, the",
      "shopping list and the freeze-on-arrival marks, and it will contradict you.",
    );
  } else {
    out.push("No week is planned. Call propose_meals_plan when they ask what to eat this week.");
  }

  out.push("", ...focusLines(state, opts.focus ?? { kind: "week" }));

  if (state.deviations.length) {
    const recent = state.deviations.slice(-3);
    out.push("", "What they have told you went differently:");
    for (const d of recent) out.push(`- ${d.date} ${d.meal}: ${d.said}`);
  }

  out.push(
    "",
    "HOW TO PLAN",
    "Seven days, three meals each. Breakfast is a habit rather than seven decisions: give the",
    "week one breakfast line in their own words and then repeat the two or three breakfasts it",
    "names across the days, as real dishes, so their oats are on the shopping list.",
    `One pot, hands-on at most ${HANDS_ON_LIMITS.dinner} minutes for lunch and dinner and`,
    `${HANDS_ON_LIMITS.breakfast} for breakfast, and no more washing up than a single meal.`,
    "Cook once, eat twice: a cooked dish is a base that keeps a day plus a fresh part added at",
    "serving, so a cooked dinner can be followed by the next day's packed lunch out of the same",
    "pot, or by a reheat with something fresh on it. A dish that does not keep a day feeds one",
    "meal only.",
    "A packed lunch must point at the meal that cooked its base, or say in `note` where the box",
    "came from when it was cooked before this week.",
    "List a dish's ingredients for every serving it is planned for, the packed lunch included.",
    "Give every ingredient its English common name in `en` beside the name in their own language,",
    "singular and lower case — it is what puts a photograph on their shopping list.",
    "Give every dish a `searchName`: the English name someone would type into an image search.",
    "Vegetables heavy, whole grains, lean protein, little oil, salt and refined carbohydrate.",
    "Never count calories, never give grams of anything nutritional, never talk about nutrition",
    "numbers at all — health is a filter on what you propose, not a subject.",
    "Out, delivery, bought and skip are ordinary plans, from the places they actually go. Do not",
    "apologise for them and do not dress them up as the healthy option.",
    "Do not repeat a dish from the week already planned unless they asked for it.",
    "",
    "WHEN A MEAL GOES DIFFERENTLY",
    "They will say one sentence ('didn't take lunch, ate at the canteen'). That moves the next",
    "meal or two and nothing else: call record_meals_deviation, then propose_meals_plan with",
    "adjustment set, naming only the meals the program told you to look at. Never re-plan the",
    "week over one meal.",
    "Boredom and 'too much hassle' are not adjustments — remember them for the next week.",
    "",
    "THE SHOPPING LIST",
    "One trip a week. Before it is done, add, remove and swap lines as they ask. Once it is",
    "done, the list is what is in the fridge: something new is next week's business, unless they",
    "say they are passing a shop today, and then add_shopping_items with today set puts it in",
    "their 'still to get'. Never read the list back to them — it is on their screen.",
  );
  return out.join("\n");
}

// --- the charter -------------------------------------------------------------

export function buildProposeMealsCharterTool(deps: MealsToolDeps): AgentTool {
  return {
    name: "propose_meals_charter",
    label: () => "Drafting what your meals have to fit",
    effect: "write",
    gate: "card",
    description:
      "Record what the household is, after they have answered your two or three questions: how " +
      "many are eating, where they shop, what the kitchen is, what they will not eat, what " +
      "breakfast and lunch normally are, and how a normal week splits between cooking, eating " +
      "out and delivery. `text` is one paragraph in their own words — it is what you will read " +
      "next week, so keep their phrasing. Call it again whenever something they say changes it. " +
      "It files nothing: the user sees a card and applies it.",
    parameters: Type.Object({
      people: Type.Number({ description: "How many people eat." }),
      stores: Type.Array(Type.String(), {
        description: "The shops they actually buy food in, as they name them.",
      }),
      kitchen: Type.String({
        description: "One line: what there is to cook with, and what there is not.",
      }),
      dislikes: Type.Array(Type.String(), {
        description: "What they will not eat, allergies included.",
      }),
      nightsCooking: Type.Number({ description: "Dinners a normal week cooks." }),
      nightsOut: Type.Number({ description: "Dinners a normal week eats out." }),
      nightsDelivery: Type.Number({ description: "Dinners a normal week orders delivery." }),
      text: Type.String({
        description:
          "One paragraph in the user's own words: what breakfast, lunch and dinner have to " +
          "fit around.",
      }),
    }),
    execute: async (args) => {
      const text = String(args.text ?? "").trim();
      if (!text) throw new Error("propose_meals_charter needs the paragraph in their words.");
      const card: MealsCharterCardData = {
        kind: "meals-charter",
        threadId: deps.threadId,
        people: toCount(args.people, 1),
        stores: toStrings(args.stores),
        kitchen: String(args.kitchen ?? "").trim(),
        dislikes: toStrings(args.dislikes),
        nightsCooking: toCount(args.nightsCooking, 0),
        nightsOut: toCount(args.nightsOut, 0),
        nightsDelivery: toCount(args.nightsDelivery, 0),
        text,
        phase: "proposed",
      };
      deps.onMealsCard(card);
      return {
        text:
          "A card now shows the user what you understood about their meals. Nothing is saved " +
          "until they apply it, and they can have you change any of it first.",
        receipt: { label: "Drafted the meals basics", summary: text },
      };
    },
  };
}

// --- the week ----------------------------------------------------------------

const mealSchema = (which: MealKey) =>
  Type.Object({
    mode: Type.String({
      description: `What this ${which} is: ${MODES.join(", ")}.`,
    }),
    dish: Type.String({ description: "For a cook meal: the dish's name." }),
    reheatOf: Type.Object(
      {
        day: Type.Number({ description: "1 to 7: the day whose meal cooked the base." }),
        meal: Type.String({ description: "breakfast, lunch or dinner." }),
      },
      {
        description:
          "For reheat and packed: which meal cooked the base this one eats. Leave it out " +
          "only for a box cooked before this week, and then say so in `note`.",
      },
    ),
    freshAdd: Type.String({ description: "What is added to the base at serving." }),
    place: Type.String({
      description: "For out, delivery and bought: where, in the user's own words.",
    }),
    note: Type.String({
      description: "One short line of theirs about this meal. Not a second description of the dish.",
    }),
  });

export function buildProposeMealsPlanTool(deps: MealsToolDeps): AgentTool {
  return {
    name: "propose_meals_plan",
    label: (args) => (args.adjustment ? "Reworking a meal" : "Drafting this week's meals"),
    effect: "write",
    gate: "card",
    description:
      "Propose the week's meals, or rework the one or two meals a change left open. `days` " +
      "gives a day per entry, `day` being its number from 1 to 7 exactly as your instructions " +
      "print them — never a date — and each day carrying `breakfast`, `lunch` and `dinner`. A " +
      "`cook` meal names a dish from `dishes`; `reheat` and `packed` give `reheatOf`, the meal " +
      "whose base they eat; `out`, `delivery` and `bought` give `place` in the user's own " +
      "words. `breakfastLine` is the week's breakfast pattern in their words. Set `adjustment` " +
      "when you are reworking meals of the week they already have — then send only those days, " +
      "and only the meals on them that change; every other meal stays exactly as it is. A fresh " +
      "week sends all seven days with all three meals. The program dates the days and derives " +
      "the shopping list; do not write either. It files nothing: the user sees a card and " +
      "applies it.",
    parameters: Type.Object({
      adjustment: Type.Boolean({
        description: "True when this reworks meals of the week already planned.",
      }),
      breakfastLine: Type.String({
        description:
          "The week's breakfasts as one line in their own words ('oats and egg on toast, " +
          "Friday I buy something on the way'). Required on a fresh week.",
      }),
      dishes: Type.Array(
        Type.Object({
          name: Type.String({ description: "The dish, named the way it would be said." }),
          searchName: Type.String({
            description:
              "The dish's common English name as people search for it, singular and lower " +
              "case: 'mapo tofu', 'shakshuka', 'overnight oats', 'dal', 'sheet pan salmon'. " +
              "Not a description of your own invention — it is what finds the dish's " +
              "photograph, and a name nobody else uses finds nothing.",
          }),
          oneLine: Type.String({ description: "One line: what it is and why this meal." }),
          base: Type.String({
            description: "The part cooked ahead that keeps a day. Empty if there is none.",
          }),
          fresh: Type.String({
            description: "The part added at serving and not kept. Empty if there is none.",
          }),
          keepsADay: Type.Boolean({
            description:
              "Whether the base is as good the next day. Stews and grains yes; stir-fried " +
              "greens, fried food, noodles and dressed salad no.",
          }),
          handsOnMinutes: Type.Number({
            description:
              `Minutes of hands-on work. ${HANDS_ON_LIMITS.dinner} at the very most for a ` +
              `lunch or a dinner, ${HANDS_ON_LIMITS.breakfast} for a breakfast.`,
          }),
          ingredients: Type.Array(
            Type.Object({
              name: Type.String(),
              en: Type.String({
                description:
                  "The same thing's English common name, singular and lower case " +
                  "('bok choy', 'eggplant', 'ground pork'). It is what finds its photograph.",
              }),
              qty: Type.String({ description: "Free text, e.g. '2 handfuls', '400g'." }),
              category: Type.String({
                description: `One of: ${CATEGORY_ORDER.join(", ")}.`,
              }),
              keeps: Type.String({
                description:
                  "How long it keeps refrigerated, one of: d1-2 (raw poultry, mince, fish), " +
                  "d3-5 (whole cuts, leafy greens, mushrooms, berries, herbs), w1 (broccoli, " +
                  "peppers, cucumber, tomato), w2plus (roots, cabbage, onion, potato, apples, " +
                  "citrus), pantry (dry goods, tins, oil).",
              }),
            }),
            { description: "Everything to buy for every meal this dish is planned for." },
          ),
        }),
        { description: "The dishes this call introduces. Empty when nothing new is cooked." },
      ),
      days: Type.Array(
        Type.Object({
          day: Type.Number({ description: "1 to 7, the day number from your instructions." }),
          breakfast: mealSchema("breakfast"),
          lunch: mealSchema("lunch"),
          dinner: mealSchema("dinner"),
        }),
        { description: "The days this call plans." },
      ),
    }),
    execute: async (args) => {
      const state = await deps.state();
      const adjustment = args.adjustment === true;
      if (adjustment && !state.plan) {
        return {
          receipt: null,
          text:
            "There is no week planned yet, so there is nothing to adjust. Propose a whole week " +
            "instead, with all seven days.",
        };
      }
      const draft = {
        dishes: toDishDrafts(args.dishes),
        days: toDayDrafts(args.days),
        breakfastLine: String(args.breakfastLine ?? "").trim(),
      };
      if (draft.days.length === 0) throw new Error("propose_meals_plan needs at least one day.");
      if (!adjustment) {
        if (draft.days.length < WEEK_DAYS) {
          return {
            receipt: null,
            text:
              `A fresh week needs all ${WEEK_DAYS} days; you sent ${draft.days.length}. Send the ` +
              `whole week, or set adjustment if you meant to rework meals of the week they have.`,
          };
        }
        const thin = draft.days.filter((d) => !d.breakfast || !d.lunch || !d.dinner);
        if (thin.length) {
          return {
            receipt: null,
            text:
              `A fresh week needs breakfast, lunch and dinner on every day; day ` +
              `${thin.map((d) => d.day).join(", ")} is missing one. Send all three.`,
          };
        }
        if (!draft.breakfastLine) {
          return {
            receipt: null,
            text:
              "A fresh week needs breakfastLine: the week's breakfasts in their own words. Say " +
              "it the way they said it and call propose_meals_plan again.",
          };
        }
      }

      const assembled = assembleWeekPlan(draft, {
        startDate: deps.today(),
        createdAt: deps.now(),
        previous: adjustment ? state.plan : null,
        random: deps.random,
      });
      // A refusal, not a thrown error: the model can fix every one of these in
      // the same turn, and the user should never see the attempt.
      if (assembled.problems.length) {
        return {
          receipt: null,
          text:
            `Nothing was proposed — the plan does not hold up:\n` +
            assembled.problems.map((p) => `- ${p}`).join("\n") +
            `\nFix those and call propose_meals_plan again.`,
        };
      }

      const card: MealsPlanCardData = {
        kind: "meals-plan",
        threadId: deps.threadId,
        startDate: assembled.plan.startDate,
        days: assembled.plan.days,
        dishes: assembled.plan.dishes,
        breakfastLine: assembled.plan.breakfastLine,
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
          " A card now shows the user the days and the shopping list the program derived from " +
          "them. Nothing is saved until they apply it. Do not tell them what to buy — the list " +
          "is on the card.",
        receipt: {
          label: adjustment ? "Reworked a meal" : "Drafted the week",
          summary: adjustment
            ? assembled.changed.map(mealWords).join("; ")
            : assembled.plan.days.map((d) => `${d.date}: ${d.dinner.mode}`).join("; "),
        },
      };
    },
  };
}

// --- a meal that went differently --------------------------------------------

/**
 * Record what actually happened at a meal, from the reader's own sentence.
 *
 * It writes: a deviation is the reader saying what they did, which is the
 * explicit instruction gate of the harness principle, and there is nothing for
 * them to approve about their own sentence. What the program did with it comes
 * back in the result, `attention` included, so the model can follow with
 * propose_meals_plan as an adjustment for exactly those meals.
 */
export function buildRecordDeviationTool(
  deps: MealsToolDeps & { ports: MealsPorts },
): AgentTool {
  return {
    name: "record_meals_deviation",
    label: () => "Recording what you ate instead",
    effect: "write",
    description:
      "Call this the moment they say a meal went differently from the plan ('we ordered in', " +
      "'didn't take lunch'). It writes that meal down and clears whatever depended on it. It " +
      "answers with the meals to look at next: plan only those, with propose_meals_plan and " +
      "adjustment set. Do not call it for boredom or 'too much hassle' — that is next week's " +
      "business.",
    parameters: Type.Object({
      day: Type.String({
        description:
          "Which day: 'today', 'yesterday', or the day number 1 to 7 from your instructions.",
      }),
      meal: Type.String({ description: "breakfast, lunch or dinner." }),
      became: Type.String({
        description: `What the meal actually was: ${MODES.join(", ")}.`,
      }),
      place: Type.String({ description: "Where, for out, delivery or bought, in their words." }),
      said: Type.String({ description: "Their own sentence, as they said it." }),
    }),
    execute: async (args) => {
      const state = await deps.state();
      if (!state.plan) {
        return {
          receipt: null,
          text: "There is no week planned, so there is nothing to record a change against.",
        };
      }
      const date = resolveDeviationDate(String(args.day ?? ""), state.plan.startDate, deps.today());
      if (!date) {
        return {
          receipt: null,
          text: "That is not a day of this week. Say 'today', 'yesterday', or the day number 1 to 7.",
        };
      }
      const meal = toMealKey(args.meal);
      if (!meal) {
        return { receipt: null, text: `meal must be one of: ${MEAL_KEYS.join(", ")}.` };
      }
      const mode = String(args.became ?? "").trim().toLowerCase();
      if (!(MODES as readonly string[]).includes(mode)) {
        return { receipt: null, text: `became must be one of: ${MODES.join(", ")}.` };
      }
      const said = String(args.said ?? "").trim();
      if (!said) throw new Error("record_meals_deviation needs their sentence.");
      const place = String(args.place ?? "").trim();
      const deviation: Deviation = {
        date,
        meal,
        said,
        became: mode as MealMode,
        ...(place ? { place } : {}),
        changed: "",
        at: deps.now(),
      };
      const { ok, attention } = await recordDeviation(deviation, deps.ports);
      if (!ok) {
        return { receipt: null, text: "The change could not be written. Nothing was recorded." };
      }
      return {
        text: attention.length
          ? `Recorded. ${attention.map(mealWords).join(" and ")} now needs another look — call ` +
            `propose_meals_plan with adjustment set for those meals only.`
          : "Recorded. Nothing else in the week moved, so there is nothing to re-plan.",
        receipt: { label: "Recorded a change of plan", summary: `${date} ${meal}: ${said}` },
      };
    },
  };
}

/**
 * The date a day's name stands for. "today" and "yesterday" are the two the
 * reader actually says out loud; a number is the day of the week exactly as
 * mealsGuidance printed it. Null for anything outside the planned week, which
 * the tool refuses rather than guessing at.
 */
export function resolveDeviationDate(
  raw: string,
  startDate: string,
  today: string,
): string | null {
  const word = raw.trim().toLowerCase();
  if (word === "today") return today;
  if (word === "yesterday") return addDays(today, -1);
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
      today: Type.Boolean({
        description:
          "True only when the shop is done and they said they are passing a shop today anyway.",
      }),
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
      qty: Type.String({ description: "How much, if it changes. May be empty." }),
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

// --- how a dish is made ------------------------------------------------------

/**
 * Rewrite a dish's steps, because the reader wants them different ("do it
 * without the oven").
 *
 * The steps are normally written by method.ts on their own, headless, the first
 * time a day is opened. This is the one place the model writes them, and it
 * writes straight through for the same reason the shopping tools do.
 */
export function buildWriteMethodTool(
  deps: MealsToolDeps & { ports: MealsPorts },
): AgentTool {
  return {
    name: "write_meals_method",
    label: () => "Rewriting the steps",
    effect: "write",
    description:
      "Write the steps for one dish, when they want them different from what is on the screen " +
      "('do it without the oven', 'I only have one pan'). One pot, hands-on inside the limit, " +
      "no more washing up than one meal, no quantities and no nutrition numbers. It replaces " +
      "whatever was there.",
    parameters: Type.Object({
      dishId: Type.String({
        description: "The dish, by the id your instructions gave for the day they are looking at.",
      }),
      steps: Type.Array(Type.String(), {
        description: `One line each, in order. Between 1 and ${MAX_STEPS}.`,
      }),
      note: Type.String({
        description: "The one thing worth knowing that is not a step. May be empty.",
      }),
    }),
    execute: async (args) => {
      const state = await deps.state();
      const dishId = String(args.dishId ?? "").trim();
      const dish = state.plan?.dishes.find((d) => d.id === dishId) ?? null;
      if (!dish) {
        return {
          receipt: null,
          text: "That dish is not in the week they have. Nothing was written.",
        };
      }
      const steps = toStrings(args.steps);
      if (!steps.length || steps.length > MAX_STEPS) {
        return {
          receipt: null,
          text: `The steps have to be between 1 and ${MAX_STEPS} lines. Nothing was written.`,
        };
      }
      if (steps.some((s) => s.length > MAX_STEP_CHARS)) {
        return {
          receipt: null,
          text: `A step is a line, not a paragraph: ${MAX_STEP_CHARS} characters at most.`,
        };
      }
      const note = String(args.note ?? "").trim();
      const method: DishMethod = { steps, writtenAt: deps.now(), ...(note ? { note } : {}) };
      try {
        await deps.ports.saveDishMethod(dish.id, method);
      } catch {
        return { receipt: null, text: "The steps could not be written. Nothing changed." };
      }
      deps.ports.changed();
      return {
        text:
          `The steps for ${dish.name} are rewritten and on their screen. Say what changed in a ` +
          "line; do not read the steps back.",
        receipt: { label: "Rewrote the steps", summary: dish.name },
      };
    },
  };
}

/**
 * Search this week's photographs again (docs/73 图片).
 *
 * The one thing the reader can ask about the pictures. The search is a run on
 * whichever machine has a hidden webview, so this writes the ask and says so;
 * the pictures appear on the screen as they land, without another turn.
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
      const asked = await refreshPhotos(deps.ports);
      if (!asked) {
        return {
          receipt: null,
          text:
            "Nothing could be searched for: this device cannot run the image search and no " +
            "other one is about.",
        };
      }
      return {
        receipt: null,
        text:
          `Searching again for ${asked} ${asked === 1 ? "photograph" : "photographs"}. They ` +
          "appear on their screen as they are found; nothing else has to be done.",
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

function toCount(raw: unknown, min: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(min, Math.round(n)) : min;
}

function record(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
}

function toCategory(raw: unknown): IngredientCategory {
  const v = String(raw ?? "").trim().toLowerCase();
  return (CATEGORY_ORDER as readonly string[]).includes(v)
    ? (v as IngredientCategory)
    : "other";
}

function toKeeps(raw: unknown): KeepsClass {
  const v = String(raw ?? "").trim().toLowerCase();
  return (KEEPS_ORDER as readonly string[]).includes(v) ? (v as KeepsClass) : "d3-5";
}

/** breakfast, lunch or dinner, or null for anything else. */
export function toMealKey(raw: unknown): MealKey | null {
  const v = String(raw ?? "").trim().toLowerCase();
  return (MEAL_KEYS as readonly string[]).includes(v) ? (v as MealKey) : null;
}

function toIngredients(raw: unknown): Ingredient[] {
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
      };
    })
    .filter((i) => i.name !== "");
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

export function toDishDrafts(raw: unknown): DishDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => {
      const e = record(entry);
      return {
        name: String(e.name ?? "").trim(),
        searchName: String(e.searchName ?? "").trim().toLowerCase(),
        oneLine: String(e.oneLine ?? "").trim(),
        base: String(e.base ?? "").trim(),
        fresh: String(e.fresh ?? "").trim(),
        keepsADay: e.keepsADay === true,
        handsOnMinutes: toCount(e.handsOnMinutes, 0),
        ingredients: toIngredients(e.ingredients),
      };
    })
    .filter((d) => d.name !== "");
}

function toMealDraft(raw: unknown): MealDraft | null {
  const e = record(raw);
  const mode = String(e.mode ?? "").trim().toLowerCase();
  if (!(MODES as readonly string[]).includes(mode)) return null;
  const draft: MealDraft = { mode: mode as MealMode };
  const dish = String(e.dish ?? "").trim();
  if (dish) draft.dish = dish;
  const of = record(e.reheatOf);
  const day = Number(of.day);
  const meal = toMealKey(of.meal);
  if (Number.isFinite(day) && day > 0 && meal) draft.reheatOf = { day: Math.round(day), meal };
  const fresh = String(e.freshAdd ?? "").trim();
  if (fresh) draft.freshAdd = fresh;
  const place = String(e.place ?? "").trim();
  if (place) draft.place = place;
  const note = String(e.note ?? "").trim();
  if (note) draft.note = note;
  return draft;
}

export function toDayDrafts(raw: unknown): DayDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: DayDraft[] = [];
  for (const entry of raw) {
    const e = record(entry);
    const day: DayDraft = { day: toCount(e.day, 0) };
    for (const key of MEAL_KEYS) {
      const meal = toMealDraft(e[key]);
      if (meal) day[key] = meal;
    }
    out.push(day);
  }
  return out;
}
