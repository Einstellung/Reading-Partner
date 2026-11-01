// The meals data as read-only tools (read.ts shapes it): the saved plan at its
// grams, the prep session, the shopping list, the recipes, the charter and the
// food table. Each answers JSON, for the model and for the scripts that call
// it, so a question like "how much chicken breast does this plan need" is
// answered from the program's numbers rather than from memory.
//
// Mounted on the meals desk with the rest (tools.ts buildMealsCatalogTools),
// and on its own wherever meals questions are answered out of sight: the voice
// call's think run at the meals place and the tasking worker.

import { Type } from "@earendil-works/pi-ai";
import { getLocale } from "../../i18n";
import type { Locale } from "../../i18n/locale";
import type { AgentTool } from "../../legion/durable/contract";
import type { Region } from "./nutrition/targets";
import { MEAL_KEYS, type MealKey, type MealsState } from "./plan/types";
import { readCharter, readFoods, readPlan, readPrep, readRecipes, readShopping } from "./read";
import type { MealsRecipes } from "./recipe/recipe-store";

export interface MealsReadDeps {
  // Read at every call, so a plan applied earlier in the turn is the one read.
  state(): Promise<MealsState>;
  // The host's local date.
  today(): string;
  region(): Region;
  // The stored recipes and prep steps. Absent where they are not on this device: the steps read as null.
  recipes?(): Promise<MealsRecipes | null>;
  // The language recipes are written in (recipe-live.ts recipeLanguageNow). The UI's when absent.
  recipeLanguage?(): Promise<Locale>;
}

/** The names of the read tools, for the guidance and the desks that mount them. */
export const MEALS_READ_TOOLS = [
  "meals_read_plan",
  "meals_read_prep",
  "meals_read_shopping",
  "meals_read_recipes",
  "meals_read_charter",
  "meals_read_foods",
] as const;

/** What a run holding only these tools is told about them (the think run, the tasking worker). */
export const MEALS_READ_PROMPT = [
  "The reader's meals are readable with the meals_read_* tools, which answer JSON: the saved plan with",
  "every food at its grams (meals_read_plan), the batch-cooking session and each pot's raw weights",
  "(meals_read_prep), the shopping list (meals_read_shopping), the recipes (meals_read_recipes), their",
  "profile and targets (meals_read_charter) and the food table (meals_read_foods). Any question about what",
  "they eat, how much of something the plan takes or what to buy is answered from them: read, add up if",
  "needed, and give the program's numbers. Never estimate one.",
].join("\n");

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateArg(raw: unknown): string | undefined | null {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const s = String(raw).trim();
  return DATE.test(s) ? s : null;
}

const json = (value: unknown) => JSON.stringify(value);

const badDate = json({ error: "from and to are local dates, YYYY-MM-DD." });

const rangeParams = {
  from: Type.Optional(Type.String({ description: "First date to include, YYYY-MM-DD. Omit for the plan's first day." })),
  to: Type.Optional(Type.String({ description: "Last date to include, YYYY-MM-DD. Omit for the plan's last day." })),
};

async function languageOf(deps: MealsReadDeps): Promise<Locale> {
  return deps.recipeLanguage ? deps.recipeLanguage() : getLocale();
}

export function buildMealsReadTools(deps: MealsReadDeps): AgentTool[] {
  return [
    {
      name: "meals_read_plan",
      label: () => "Reading the meal plan",
      effect: "read",
      replay: "safe",
      description:
        "The saved meal plan as JSON: every day (date, ISO weekday, training or rest, the day's targets and " +
        "totals) and every meal on it (mode, dish name, method, minutes, the pot it eats from, and each food " +
        "by id and name at its saved grams with kcal, protein, fat, carbs and sodium), plus the deviations " +
        "they reported. Grams are raw weights as bought, per person; `people` says how many eat. Read this " +
        "before answering any question about what is planned or how much of something a meal or the plan " +
        "takes.",
      parameters: Type.Object(rangeParams),
      execute: async (args) => {
        const from = dateArg(args.from);
        const to = dateArg(args.to);
        if (from === null || to === null) return badDate;
        return json(readPlan(await deps.state(), { today: deps.today(), region: deps.region(), from, to }));
      },
    },
    {
      name: "meals_read_prep",
      label: () => "Reading the prep session",
      effect: "read",
      replay: "safe",
      description:
        "The plan's batch-cooking session as JSON, as the prep page builds it: when it is, each pot (its dish, " +
        "the meals that eat from it with their dates, and every food the whole pot takes, raw grams for " +
        "everyone eating), the foods of all pots added up (potTotals), the rice batch, the storage plan " +
        "(containers, boxes, fridge, freezer, cupboard, the evenings' jobs, by plan day; dayDates maps a day " +
        "to its date) and the written steps with devices and minutes. found is false, with a reason, when " +
        "there is no session.",
      parameters: Type.Object({}),
      execute: async () => {
        const recipes = deps.recipes ? await deps.recipes() : null;
        return json(
          readPrep(await deps.state(), { today: deps.today(), region: deps.region(), language: await languageOf(deps), recipes }),
        );
      },
    },
    {
      name: "meals_read_shopping",
      label: () => "Reading the shopping list",
      effect: "read",
      replay: "safe",
      description:
        "Every line of the shopping list as JSON: the food id, neededG (what the plan needs, times the people " +
        "eating) apart from qty (what is bought, e.g. a whole pack: '1 盒（约 600 g）'), aisle, shelf life, " +
        "neededBy date, whether it is kept at home, bought frozen or frozen on arrival, the leftover of a pack, " +
        "and the reader's flags: dropped, replacedBy, checked. Dropped lines are included with dropped true; " +
        "the screen leaves them out. doneOn is the date the shop was done, or null.",
      parameters: Type.Object({}),
      execute: async () => json(readShopping(await deps.state())),
    },
    {
      name: "meals_read_recipes",
      label: () => "Reading the recipes",
      effect: "read",
      replay: "safe",
      description:
        "The step-by-step recipe of each made meal in the range as JSON: date, meal, dish name, the pot it " +
        "eats from, and the steps as written, or null when not written yet. The grams are in meals_read_plan.",
      parameters: Type.Object({
        ...rangeParams,
        meal: Type.Optional(Type.String({ description: `Only this meal: ${MEAL_KEYS.join(", ")}.` })),
      }),
      execute: async (args) => {
        const from = dateArg(args.from);
        const to = dateArg(args.to);
        if (from === null || to === null) return badDate;
        const meal = MEAL_KEYS.includes(args.meal as MealKey) ? (args.meal as MealKey) : undefined;
        if (args.meal && !meal) return json({ error: `meal is one of ${MEAL_KEYS.join(", ")}.` });
        const recipes = deps.recipes ? await deps.recipes() : null;
        return json(
          readRecipes(await deps.state(), {
            today: deps.today(),
            region: deps.region(),
            language: await languageOf(deps),
            recipes,
            from,
            to,
            meal,
          }),
        );
      },
    },
    {
      name: "meals_read_charter",
      label: () => "Reading their meals profile",
      effect: "read",
      replay: "safe",
      description:
        "Their meals profile as JSON: the profile as saved (goal, body data, training days, people, shops, " +
        "kitchen, effort, boxes, burners, cook slots), what they said about their meals in their own words, " +
        "each dislike with the food ids it keeps out, the foods they cannot get, and the program's daily " +
        "targets for a training and a rest day.",
      parameters: Type.Object({}),
      execute: async () => json(readCharter(await deps.state(), deps.region())),
    },
    {
      name: "meals_read_foods",
      label: () => "Reading the food table",
      effect: "read",
      replay: "safe",
      description:
        "Foods from the program's food table as JSON: id, names, aisle, shelf life, tags, nutrition per 100 g " +
        "(kcal, protein, fat, carbs, sodium mg, added sugar), the unit or piece it is counted in and its " +
        "retail pack. With no arguments, the foods the saved plan and list use; `ids` for those foods, " +
        "`query` to match an id, name or alias, `all` for the whole table.",
      parameters: Type.Object({
        ids: Type.Optional(Type.Array(Type.String(), { description: "Food ids." })),
        query: Type.Optional(Type.String({ description: "Part of an id, a name or an alias, e.g. '鸡胸' or 'beef'." })),
        all: Type.Optional(Type.Boolean({ description: "The whole table." })),
      }),
      execute: async (args) => {
        const ids = Array.isArray(args.ids) ? args.ids.map(String) : undefined;
        const query = typeof args.query === "string" ? args.query : undefined;
        return json(readFoods(await deps.state(), { ids, query, all: args.all === true }));
      },
    },
  ];
}
