// The meals desk's tools and the standing instruction that goes with them
// (docs/671 对话, docs/73), modelled on info/briefer/lab-tool.ts: the planning
// tool raises a draft card and writes nothing; 「就这样」 on the card, or
// apply_meal_plan when the reader confirms in words, performs the write, and a
// row afterwards tells the model what landed.
//
// The others write straight through. That is the harness principle, not an
// exception to it: a profile change, a deviation, a line on the shopping list
// and a method line are the reader's own instruction carried out.
//
// The model picks dishes from the library by id, the pots and the prep
// session. It supplies no dates, no grams, no minutes and no shopping list:
// the program checks the draft, solves and derives them (docs/671 事实不经模型).

import { Type } from "@earendil-works/pi-ai";
import { getLocale, t } from "../../i18n";
import type { AgentTool } from "../../legion/durable/contract";
import { asStrings } from "../../platform/std/json";
import {
  checkNote,
  mealWords,
  recordDeviation,
  refreshPhotos,
  saveProfile,
  type Applied,
  type MealsPorts,
  type PlanCheck,
} from "./apply";
import type { MealsCard, MealsDraftCardData } from "./cards";
import { boxName, profileFieldsLine } from "./screen/view";
import { FOOD_TAGS, FOODS, foodAllowed, foodById } from "./nutrition/foods";
import {
  COOK_PARTS,
  EFFORTS,
  type Goal,
  type Profile,
  type Region,
  type Targets,
  type TrainTime,
  type Work,
} from "./nutrition/targets";
import {
  addReaderItem,
  currentList,
  isChecked,
  markShoppingDone,
  removeShoppingItem,
  replaceShoppingItem,
} from "./plan/shopping";
import { dayTargetsOn, targetsOf } from "./plan/solve-week";
import {
  CATEGORY_ORDER,
  KEEPS_ORDER,
  MEAL_KEYS,
  MEAL_MODES,
  type Deviation,
  type IngredientCategory,
  type KeepsClass,
  type Meal,
  type MealKey,
  type MealMode,
  type MealsState,
  type ShoppingItem,
  type WeekPlan,
} from "./plan/types";
import { WEEK_DAYS, addDays, dayOn, isoWeekday, lastDate, planExhausted } from "./plan/week";
import { buildDraftCard } from "./build-draft-card";
import { SEED_DISHES } from "./dishes/seed";
import { fillDraft } from "./planner/fill";
import { readerPortions } from "./planner/portions";
import { FRIDGE_DAYS_AFTER_COOK } from "./dishes/methods";
import { isBatchMain, MAX_DRAFT_ROUNDS, MAX_PLAN_DAYS, parseDraft, PREP_DAY, type DraftMain } from "./planner/draft";
import { planLibrary } from "./planner/library";
import { libraryListing } from "./planner/listing";
import { planDayTargets, prepDayTargets } from "./planner/solve";

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
  // Surface the card, or replace the draft card it revises. The host owns
  // Apply; the planning tool never writes.
  onMealsCard(card: MealsCard): void;
  // The draft card still waiting in this conversation, which the next draft
  // revises in place. Absent where no card is drawn.
  currentDraft?(): MealsDraftCardData | null;
  // Apply that card, as its button does. Null when there is none.
  applyDraft?(): Promise<Applied | null>;
  // What the draft rules found in the week a profile change re-solved, null
  // when nothing was checked: the meals page's note (screen/plan-note.ts).
  onPlanCheck?(check: PlanCheck | null): void;
}

// --- the instruction ---------------------------------------------------------

const WEEKDAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PART_WORDS = { morning: "morning", afternoon: "afternoon", evening: "evening" } as const;

function mealLine(meal: Meal): string {
  switch (meal.mode) {
    case "make":
      return `${meal.name ?? "no dish yet"}${meal.minutes ? `, ${meal.minutes} min` : ""}`;
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
        ? `The shop was done on ${done}. Anything new goes on the next plan's list, unless ` +
          "they say they are passing a shop today."
        : "The shop has not been done yet.",
    ];
  }
  if (focus.kind === "day") {
    const day = dayOn(state.plan, focus.date);
    if (!day) return [`They are looking at ${focus.date}, which the plan does not cover.`];
    return [
      `They are looking at ${focus.date}. Its method lines are on their screen; do not read them back. ` +
        "Call write_meals_method only if they want one made another way.",
    ];
  }
  return ["They are looking at the plan."];
}

function targetsLine(label: string, t: Targets["training"]): string {
  return `${label}: ${t.kcal} kcal, protein ${t.protein} g, fat ${t.fat} g, carbs ${t.carbs} g`;
}

const GOAL_WORDS: Record<Goal, string> = {
  cut: "lose fat",
  gain: "build muscle",
  steady: "steady energy",
};

/** The standing habits a plan is drafted around, and which of them nobody has asked yet. */
export function habitsLine(profile: Profile): string {
  const slots = profile.cookSlots?.length
    ? profile.cookSlots.map((s) => `${WEEKDAY_SHORT[s.weekday] ?? s.weekday} ${PART_WORDS[s.part]}`).join(", ")
    : "not said";
  const boxes = profile.boxes === undefined ? "not asked yet" : profile.boxes ? "yes" : "no";
  const burners = profile.burners ? String(profile.burners) : "not said";
  const gone = profile.unavailable?.length ? profile.unavailable.join(", ") : "nothing named";
  return `Can cook a prep session: ${slots}. Packs meals into boxes: ${boxes}. Burners: ${burners}. Cannot get: ${gone}.`;
}

/** The food table by id and name, for dislikes and foods they cannot get. */
export function foodListing(dislikes: readonly string[]): string[] {
  return FOODS.filter((f) => foodAllowed(f, dislikes)).map(
    (f) => `${f.id} ${f.zh}${f.tags.length ? ` [${f.tags.join(",")}]` : ""}`,
  );
}

const HOW_TO_PLAN = [
  "HOW TO PLAN",
  `A plan covers 1 to ${MAX_PLAN_DAYS} days, from today unless they name another day, with one shopping trip and one`,
  `prep session. Longer is two plans: say you will plan ${MAX_PLAN_DAYS} days now and the next one after they are eaten.`,
  "Before the first draft, ask what you do not know yet, a question or two at a time, and nothing the profile",
  "already answers:",
  `- How many days, 1 to ${MAX_PLAN_DAYS}.`,
  "- When they can cook the prep session: which day, and morning (before lunch), afternoon (before dinner) or",
  "  evening (after dinner). A standing habit goes into the profile with update_meals_profile (cookSlots).",
  "  The session may be on the day before Day 1 ('明天晚饭后备餐，吃后面三天', '前一天晚上做'): that is day 0, the",
  "  prep day, not a plan day, so start the plan the day after it. When they cook on it before dinner and eat",
  "  that dinner from the pots ('今晚做今晚就吃，再吃三天'), that dinner is `prepDinner`. The prep day has no",
  "  breakfast or lunch from the plan.",
  "- Whether they pack meals into boxes to eat later. Ask it before the first plan even though the program",
  "  assumes boxes while it is unset, and record the answer with update_meals_profile (boxes). Never assume it.",
  "- What they feel like eating lately and what they do not want. This plan's tastes stay with this draft; only",
  "  standing dislikes and foods they cannot buy go into the profile.",
  "Never infer a cuisine, a taste or a dislike from where they live, their name or the language they write in.",
  "Tastes come only from what they have said and from the profile.",
  "",
  "THE DRAFT (propose_meal_plan)",
  "Days are numbered from 1. Never write a date, a gram or a minute: the program owns them.",
  "You pick what takes taste, from the LIBRARY and what they said: the main of each lunch and dinner, which",
  "mains are pots, and the prep session. The program fills in the rest: breakfasts, the staple of each fresh",
  "main, sides and fruit, chosen to meet the plan rules (legumes, whole grains, vegetables, fruit, a calcium",
  "source each day, sodium, the day's protein and calories, every fresh pack used up).",
  "- Each day: lunch and dinner, each a `main`. Name a `breakfast` only when they asked for a particular one.",
  "- `asked`: a breakfast or a staple they named for the whole plan ('早餐都吃燕麦', '主食想吃面'), by id; the program",
  "  holds to it on every day and fresh main that takes it. Keep what they asked for in every revision.",
  "- A main is a share of a pot, {batch, way} with the way's number in that dish's ways (a different way for each",
  "  meal of one pot), or a fresh main made at the meal, {dish}; add `staple` only when they asked for one.",
  "- `batches`: a pot is one batch main from the library with a short id of yours, cooked in the session and",
  "  eaten at 1 to 3 lunches or dinners listed in `meals`: none before the session, all within the cook day and",
  `  the ${FRIDGE_DAYS_AFTER_COOK} days after it. One pot per dish; lunch and dinner of one day never the same dish. Fish and seafood are`,
  "  always fresh.",
  "- `sessions`: exactly one when there are pots, {id, day, part}, at a time they said they can cook. `day` is a",
  `  plan day, or ${PREP_DAY} for the prep day before Day 1.`,
  "- `prepDinner`: only with a day-0 session in the morning or afternoon, when they eat that dinner from it:",
  "  {main: {batch, way}}, with {day: 0, slot: 'dinner'} in that pot's `meals`. At most 7 lunches and dinners in",
  `  all: ${MAX_PLAN_DAYS} days and the prep day's dinner.`,
  "- Lean on the pots: most lunches and dinners eat from them, and the fresh ones are quick. About an hour",
  "  hands-on for the session unless they said otherwise.",
  "- What only your picks decide: red meat at most 3 meals a week, fish at least once in 3 days, at least 2",
  "  protein kinds, one protein food in at most 3 meals; each day's lunch and dinner within the sodium the",
  "  LIBRARY gives; and the PACKS ONLY MAINS USE UP, finished between the mains you pick.",
  "The program may change a pot meal's way or a fresh main's staple when that is all a rule needs; it says so.",
  "When it cannot fill the plan around your picks, it says which rule fails and which of your picks to change:",
  `change them and send the whole draft again. After ${MAX_DRAFT_ROUNDS} refused drafts in a turn, stop and tell them in plain`,
  "words what keeps failing and what they could change.",
  "",
  "THE CARD",
  "A passing draft shows on a card in the chat: each meal by name, which meals share a pot, the prep session. It",
  "has no grams; they come once the plan is confirmed. Do not repeat the meals in your reply: say in a sentence",
  "or two what the plan is built around and what the program changed on its own.",
  "When they want a change ('第二天晚饭不想吃牛肉'), take THE DRAFT ON THE CARD, change only what they asked, and",
  "call propose_meal_plan again with the whole revised draft. The card above changes in place to the new",
  "version. Your reply only says that the draft above was changed; do not list the meals again.",
  "When they confirm in words ('就这样', '可以', 'looks good'), call apply_meal_plan. The card's button does the",
  "same. Nothing is saved before that. Don't name the button or tell them to press it; the card shows it.",
];

/**
 * The draft card waiting for 「就这样」, as the picks a revision starts from,
 * in propose_meal_plan's own shape. The mains as the card shows them (a way
 * the program changed included), the pots and the session, and the
 * breakfasts and staples they asked for (the picks the card was filled from);
 * the rest is the program's and is filled again.
 */
export function draftOnCard(card: MealsDraftCardData): string[] {
  const asked = card.picks;
  const main = (m: DraftMain, was: DraftMain | undefined): DraftMain => {
    if (isBatchMain(m)) return { batch: m.batch, way: m.way };
    const staple = was && !isBatchMain(was) && was.dish === m.dish ? was.staple : undefined;
    return staple ? { dish: m.dish, staple } : { dish: m.dish };
  };
  const picks = {
    days: card.draft.days.map((d, i) => {
      const was = asked?.days[i];
      return {
        ...(was?.breakfast ? { breakfast: was.breakfast } : {}),
        lunch: { main: main(d.lunch.main, was?.lunch.main) },
        dinner: { main: main(d.dinner.main, was?.dinner.main) },
      };
    }),
    batches: card.draft.batches,
    sessions: card.draft.sessions,
    ...(card.draft.prepDinner ? { prepDinner: { main: main(card.draft.prepDinner.main, undefined) } } : {}),
    ...(asked?.asked ? { asked: asked.asked } : {}),
  };
  return [
    `THE DRAFT ON THE CARD (version ${card.version}, not confirmed yet)`,
    "Your picks as the card shows them, with what they asked for. A change keeps everything they did not ask to change.",
    JSON.stringify(picks),
  ];
}

/**
 * What the meals desk is told before it says anything: the reader's profile
 * and the program's targets, the plan as it stands with today marked, what
 * they are looking at, how a plan is drafted, and the library to draft from.
 */
export function mealsGuidance(
  state: MealsState,
  today: string,
  opts: { focus?: MealsFocus; region?: Region; draft?: MealsDraftCardData | null } = {},
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
      `${profile.people} eating. Shops: ${profile.shops.join(", ") || "none named"}. Kitchen beyond the default: ${profile.kitchen.join(", ") || "nothing said"}.`,
      `Never use: ${profile.dislikes.join(", ") || "nothing named"}.`,
      habitsLine(profile),
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
        "new dislike, when they can cook, whether they box meals — call update_meals_profile with just " +
        "that. It writes at once and re-solves the plan; say one line.",
    );
  }
  out.push("");

  if (state.plan && !planExhausted(state.plan, today)) {
    const plan = state.plan;
    out.push("The plan they have:");
    for (let i = 0; i < plan.days.length; i++) {
      const day = plan.days[i];
      if (!day) continue;
      out.push(dayHeading(plan, i, profile, today));
      for (const key of day.planned ?? MEAL_KEYS) out.push(`    ${key}: ${mealLine(day[key])}`);
    }
    out.push(
      "Refer to a meal by its day number and which meal it is. A new plan replaces the days it covers.",
    );
  } else if (state.plan) {
    out.push(`Their last plan ended on ${lastDate(state.plan)}. Nothing is planned from today on.`);
  } else {
    out.push("Nothing is planned yet.");
  }

  out.push("", ...focusLines(state, opts.focus ?? { kind: "week" }));

  if (state.deviations.length) {
    out.push("", "What they have told you went differently:");
    for (const d of state.deviations.slice(-3)) out.push(`- ${d.date} ${d.meal}: ${d.said}`);
  }

  out.push("", ...HOW_TO_PLAN);
  if (opts.draft?.phase === "proposed") out.push("", ...draftOnCard(opts.draft));
  if (profile) {
    const lib = planLibrary(profile);
    const portions = targets ? readerPortions(lib, SEED_DISHES, dayTargetsOn(targets, profile, today)) : undefined;
    out.push("", "LIBRARY (dish ids for the draft; only what they can have and their kitchen can make)", ...libraryListing(lib, SEED_DISHES, portions));
  }
  out.push(
    "",
    "FOODS (ids for dislikes and for foods they cannot get)",
    ...foodListing(profile?.dislikes ?? []),
    "",
    "WHEN A MEAL GOES DIFFERENTLY",
    "They will say one sentence ('中午没带饭，食堂吃的'). Call record_meals_deviation. Never re-plan over one",
    "meal. When they want the rest of their days planned again, draft a new plan from today with",
    "propose_meal_plan; it replaces the days it covers. Boredom and 'too much hassle' are not deviations:",
    "remember them for the next plan.",
    "",
    "THE SHOPPING LIST",
    "Derived by the program from the solved grams, one trip a plan. Before it is done, add,",
    "remove and swap lines as they ask. Once it is done, the list is what is in the fridge:",
    "something new is the next plan's business, unless they say they are passing a shop today, and",
    "then add_shopping_items with today set. Never read the list back to them.",
  );
  return out.filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
}

// --- the draft ---------------------------------------------------------------

// Every property the model may have nothing for is optional: a required one
// fails validation and the loop retries for ever (docs/pitfall/379).
const draftMealSchema = Type.Object({
  main: Type.Object(
    {
      batch: Type.Optional(Type.String({ description: "For a meal eating from a pot: the pot's id from `batches`." })),
      way: Type.Optional(Type.Number({ description: "With batch: the way's number, from 1, in that dish's ways." })),
      dish: Type.Optional(Type.String({ description: "For a fresh main: its dish id." })),
      staple: Type.Optional(
        Type.String({ description: "With dish, only when they asked for it: one of its staples. Otherwise the program picks." }),
      ),
    },
    { description: "A share of a pot ({batch, way}) or a fresh main ({dish})." },
  ),
});

function refusal(problems: readonly string[], refused: number): string {
  const lines = ["Nothing was shown — the program could not fill the plan around these picks:", ...problems.map((p) => `- ${p}`)];
  lines.push(
    refused >= MAX_DRAFT_ROUNDS
      ? `That is ${refused} refused drafts this turn. Stop drafting and tell them in plain words, in two or three lines, what keeps failing and which of their wishes they could change.`
      : "Fix those and call propose_meal_plan again with the whole draft.",
  );
  return lines.join("\n");
}

const pickName = (n: { zh: string; en: string }) => (getLocale() === "zh-CN" ? n.zh : n.en);

export function buildProposeMealPlanTool(deps: MealsToolDeps): AgentTool {
  // Drafts refused this turn. Tools are built per turn, so this goes when the turn does.
  let refused = 0;
  return {
    name: "propose_meal_plan",
    label: () => t("meals.tool.draftingPlan"),
    effect: "write",
    gate: "card",
    description:
      `Draft a plan of 1 to ${MAX_PLAN_DAYS} days from the library: each day's lunch and dinner main by dish id, the ` +
      "pots cooked in the one prep session and which meals eat from them. Days are numbered from 1; never a " +
      "date, a gram or a minute. The program fills in breakfasts, staples, sides and fruit to meet the plan " +
      "rules, or sends back which picks to change; a filled draft shows on a card, and a later call in this " +
      "conversation replaces that card in place with the revised version. It files nothing: they confirm on " +
      "the card or in words.",
    parameters: Type.Object({
      start: Type.Optional(
        Type.Number({ description: "Days from today the plan starts: 0 today (the default), 1 tomorrow, at most 6." }),
      ),
      asked: Type.Optional(
        Type.Object(
          {
            breakfast: Type.Optional(Type.String({ description: "A breakfast dish id they named for every day." })),
            staple: Type.Optional(Type.String({ description: "A staple food or staple dish id they named, for every fresh main that takes it." })),
          },
          { description: "Only what they named for the whole plan; the program picks the rest." },
        ),
      ),
      days: Type.Array(
        Type.Object({
          breakfast: Type.Optional(Type.String({ description: "A breakfast dish id, only when they asked for it; otherwise the program picks." })),
          lunch: draftMealSchema,
          dinner: draftMealSchema,
        }),
        { description: `Day 1 first, 1 to ${MAX_PLAN_DAYS} days.` },
      ),
      batches: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String({ description: "A short id of yours, unique in the draft." }),
            dish: Type.String({ description: "A batch main's dish id." }),
            session: Type.String({ description: "The session it is cooked in." }),
            meals: Type.Array(
              Type.Object({
                day: Type.Number({ description: "A plan day, or 0 for the prep day's dinner (prepDinner)." }),
                slot: Type.String({ description: "lunch or dinner." }),
              }),
              { description: "1 to 3 meals eating from it." },
            ),
          }),
          { description: "The pots." },
        ),
      ),
      sessions: Type.Optional(
        Type.Array(
          Type.Object({
            id: Type.String(),
            day: Type.Number({ description: "The day number it is cooked on: a plan day, or 0 for the day before Day 1." }),
            part: Type.String({ description: `One of: ${COOK_PARTS.join(", ")}.` }),
          }),
          { description: "The one prep session, when there are pots." },
        ),
      ),
      prepDinner: Type.Optional(
        Type.Object(
          { main: draftMealSchema.properties.main },
          { description: "The prep day's dinner, only when a day-0 session before dinner feeds it: a share of a pot, {batch, way}." },
        ),
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
      if (refused >= MAX_DRAFT_ROUNDS) return { receipt: null, text: refusal([], refused) };
      const offset = Math.min(6, Math.max(0, Math.round(Number(args.start ?? 0)) || 0));
      const start = addDays(deps.today(), offset);
      const draft = parseDraft(args);
      if (offset === 0 && draft.sessions.some((s) => s.day === PREP_DAY)) {
        refused += 1;
        return {
          receipt: null,
          text: refusal(
            [
              "The session is on day 0, the day before Day 1, but the plan starts today, so day 0 is yesterday. To cook today and eat from tomorrow, start the plan tomorrow (start 1); otherwise put the session on a plan day.",
            ],
            refused,
          ),
        };
      }
      const profile = charter.profile;
      const lib = planLibrary(profile);
      const filled = fillDraft(draft, {
        profile,
        targets: planDayTargets(targets, profile, start, Math.min(MAX_PLAN_DAYS, Math.max(1, draft.days.length))),
        prepTarget: prepDayTargets(targets, profile, start),
        startWeekday: isoWeekday(start),
        people: profile.people,
        library: lib,
      });
      const result = filled.result;
      // A refusal, not a thrown error: the model can fix every one of these in
      // the same turn, and the reader never sees the attempt.
      if (result.problems.length || !result.plan) {
        refused += 1;
        return { receipt: null, text: refusal(filled.unfilled, refused) };
      }
      const card = buildDraftCard({
        result,
        lib,
        startDate: start,
        threadId: deps.threadId,
        previous: deps.currentDraft?.() ?? null,
        newId: String(deps.now()),
        picks: draft,
      });
      deps.onMealsCard(card);
      const when = offset === 0 ? "today" : offset === 1 ? "tomorrow" : `in ${offset} days`;
      const said = [...filled.changed, ...result.notes];
      const notes = said.length ? `\nThe program changed on its own; tell them in a few words:\n${said.map((n) => `- ${n}`).join("\n")}` : "";
      return {
        text:
          (card.version > 1
            ? `The draft card above now shows version ${card.version}. Say in one short line that the draft above was changed; do not list the meals again.`
            : `A draft card now shows the ${card.days.length}-day plan starting ${when}${card.prepDay ? `, cooked the day before${card.prepDay.dinner ? " with that dinner from the pots" : ""}` : ""}. Do not repeat its meals. Nothing is saved until they confirm it.`) +
          notes,
        receipt: {
          label: card.version > 1 ? t("meals.receipt.revisedPlan") : t("meals.receipt.draftedPlan"),
          summary: card.pots.map((p) => pickName(p.name)).join(" · "),
        },
      };
    },
  };
}

/** The reader's confirmation in words: the same write as the card's 「就这样」. */
export function buildApplyMealPlanTool(deps: MealsToolDeps): AgentTool {
  return {
    name: "apply_meal_plan",
    label: () => t("meals.tool.applyingPlan"),
    effect: "write",
    description:
      "Save the draft on the card, only when they confirm it in words ('就这样', '可以', 'looks good'). The " +
      "program solves the grams and writes the plan and the shopping list; the card collapses to say so. " +
      "The plan is checked again against their profile as it is now; when it breaks a plan rule, it is " +
      "saved all the same and the result names the rules.",
    parameters: Type.Object({}),
    execute: async () => {
      const applied = deps.applyDraft ? await deps.applyDraft() : null;
      if (!applied) {
        return { receipt: null, text: "No draft card is waiting to be confirmed. Draft one with propose_meal_plan first." };
      }
      if (!applied.ok) return { receipt: null, text: "The plan could not be saved. Nothing changed; tell them so." };
      const broken = checkNote(applied.check);
      return {
        text: `${applied.note} Say it in one line.${broken ? ` ${broken}` : ""}`,
        receipt: { label: t("meals.receipt.appliedPlan"), summary: "" },
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
  set("effort", oneOf(args.effort, EFFORTS));
  const people = positive(args.people, 20);
  set("people", people === null ? null : Math.round(people));
  if (Array.isArray(args.trainingDays)) {
    const days = [...new Set(args.trainingDays.map((d) => Math.round(Number(d))))]
      .filter((d) => d >= 1 && d <= 7)
      .sort();
    set("trainingDays", days);
  }
  if (Array.isArray(args.dislikes)) set("dislikes", asStrings(args.dislikes));
  if (Array.isArray(args.shops)) set("shops", asStrings(args.shops));
  if (Array.isArray(args.kitchen)) set("kitchen", asStrings(args.kitchen));
  if (Array.isArray(args.unavailable)) set("unavailable", asStrings(args.unavailable).filter((id) => foodById(id)));
  if (typeof args.boxes === "boolean") set("boxes", args.boxes);
  const burners = positive(args.burners, 10);
  set("burners", burners === null ? null : Math.round(burners));
  if (Array.isArray(args.cookSlots)) {
    const slots = args.cookSlots.flatMap((raw) => {
      const s = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
      const weekday = Math.round(Number(s.weekday));
      const part = oneOf(s.part, COOK_PARTS);
      return weekday >= 1 && weekday <= 7 && part ? [{ weekday, part }] : [];
    });
    set("cookSlots", slots);
  }
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
    label: () => t("meals.tool.updatingTargets"),
    effect: "write",
    description:
      "Call this the moment they state a change to what the plan is built on: a new weight " +
      "('这周称了 71'), another goal ('改成增肌'), other training days ('周二也练'), a new dislike, " +
      "more people eating, or the effort level when they keep saying the meals are too sloppy or " +
      "too much work. Send only the fields that changed. Lists (trainingDays, dislikes, " +
      "shops, kitchen) replace the whole list, so send the full list as it now stands. `notes` " +
      "replaces what they have said about their meals in their own words. It writes at once and " +
      "re-solves the week; when the re-solved week breaks a plan rule, it is kept all the same and the " +
      "result names the rules.",
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
      effort: Type.Optional(
        Type.String({
          description:
            "simple: one pot, microwave or assembly, about 20 minutes hands-on. homestyle: ordinary " +
            "home cooking, up to about 45 minutes.",
        }),
      ),
      people: Type.Optional(Type.Number()),
      dislikes: Type.Optional(
        Type.Array(Type.String(), {
          description:
            `Each one a food tag where one fits (${FOOD_TAGS.join(", ")}), else a food id from the ` +
            "listing; free text only for what neither covers, since the program cannot check it.",
        }),
      ),
      shops: Type.Optional(Type.Array(Type.String())),
      kitchen: Type.Optional(Type.Array(Type.String())),
      unavailable: Type.Optional(
        Type.Array(Type.String(), {
          description:
            "Food ids from the listing they cannot buy where they live or do not want (canned kidney beans, " +
            "pita), kept beside dislikes. The planner swaps them for another food of the same group.",
        }),
      ),
      cookSlots: Type.Optional(
        Type.Array(
          Type.Object({
            weekday: Type.Number({ description: "ISO weekday, Monday 1 to Sunday 7." }),
            part: Type.String({ description: `One of: ${COOK_PARTS.join(", ")}.` }),
          }),
          { description: "When they can cook a prep session, as a standing habit." },
        ),
      ),
      boxes: Type.Optional(Type.Boolean({ description: "They pack meals into boxes." })),
      burners: Type.Optional(Type.Number({ description: "Burners on their stove." })),
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
      const { ok, targets, check } = await saveProfile(profile ?? state.charter.profile, deps.ports, notes);
      if (!ok) return { receipt: null, text: "The change could not be written. Nothing changed." };
      deps.onPlanCheck?.(check ?? null);
      const numbers = targets
        ? ` Daily targets now — ${targetsLine("training day", targets.training)}; ${targetsLine("rest day", targets.rest)}.`
        : "";
      const broken = checkNote(check);
      return {
        text:
          `Saved.${numbers}${state.plan ? " The week's grams are re-solved and the list follows." : ""}` +
          " Say it in one line; the numbers are on their screen." +
          (broken ? ` ${broken}` : ""),
        receipt: { label: t("meals.receipt.updatedProfile"), summary: profileFieldsLine(Object.keys(args)) },
      };
    },
  };
}

// --- a meal that went differently --------------------------------------------

/**
 * Record what actually happened at a meal, from the reader's own sentence. It
 * writes; what the program did with it comes back in the result, so the model
 * can say which meals are left without food.
 */
export function buildRecordDeviationTool(deps: MealsToolDeps & { ports: MealsPorts }): AgentTool {
  return {
    name: "record_meals_deviation",
    label: () => t("meals.tool.recordingDeviation"),
    effect: "write",
    description:
      "Call this the moment they say a meal went differently from the plan ('we ordered in', " +
      "'didn't take lunch'). It writes that meal down and re-solves the plan. It answers with the " +
      "meals left without food; a new plan from today (propose_meal_plan) replaces the days it covers. " +
      "Do not call it for boredom or 'too much hassle' — that is the next plan's business.",
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
          ? `Recorded. ${attention.map(mealWords).join(" and ")} is left without food. If they want it ` +
            "planned again, draft a new plan from today with propose_meal_plan."
          : "Recorded. Nothing else in the plan moved, so there is nothing to re-plan.",
        receipt: { label: t("meals.receipt.recordedDeviation"), summary: `${boxName({ date, meal })}: ${said}` },
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
    label: () => t("meals.tool.addingToList"),
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
      return { text: note, receipt: { label: t("meals.receipt.addedToList"), summary: added.join(t("meals.listJoin")) } };
    },
  };
}

/** Take one line off. */
export function buildRemoveShoppingItemTool(
  deps: MealsToolDeps & { ports: MealsPorts },
): AgentTool {
  return {
    name: "remove_shopping_item",
    label: () => t("meals.tool.removingFromList"),
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
        receipt: { label: t("meals.receipt.removedFromList"), summary: hit.removed.name },
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
    label: () => t("meals.tool.swappingLine"),
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
        receipt: { label: t("meals.receipt.swappedLine"), summary: `${from} → ${hit.line.name}` },
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
    label: () => t("meals.tool.rewritingMethod"),
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
        receipt: { label: t("meals.receipt.rewroteMethod"), summary: boxName({ date, meal: key }) },
      };
    },
  };
}

/**
 * Picture this week again (docs/73 图片): draw its dishes anew where the
 * provider can, search the rest again.
 *
 * The one thing the reader can ask about the pictures. What this writes is the
 * moment they asked: every picture older than it is drawn or looked up again
 * wherever that can be done — the dishes on any device whose provider draws,
 * the ingredients on the machine with a hidden webview. The pictures appear on
 * the screen as they land, without another turn.
 */
export function buildRefreshMealsPhotosTool(
  deps: MealsToolDeps & { ports: MealsPorts },
): AgentTool {
  return {
    name: "refresh_meals_photos",
    label: () => t("meals.tool.refreshingPhotos"),
    effect: "write",
    description:
      "Call this when they say a picture on the meals screen is wrong or is not the dish they " +
      "meant. It redoes this week's dish and ingredient pictures from scratch: dishes are " +
      "drawn where the AI provider can make pictures and otherwise show their ingredients. There is nothing to choose and nothing to confirm; say it is on it and move on.",
    parameters: Type.Object({}),
    execute: async () => {
      const state = await deps.state();
      if (!state.plan) {
        return {
          receipt: null,
          text: "There is no week planned, so there are no pictures to redo.",
        };
      }
      const { queries, searching, dishes } = await refreshPhotos(deps.ports);
      if (!queries && !dishes) {
        return {
          receipt: null,
          text: "Nothing could be asked for: the request could not be written down.",
        };
      }
      const lines: string[] = [];
      if (dishes) {
        const many = `${dishes} ${dishes === 1 ? "dish" : "dishes"}`;
        lines.push(`Drawing ${many} again.`);
      }
      if (queries) {
        const many = `${queries} ${queries === 1 ? "photograph" : "photographs"}`;
        lines.push(
          searching
            ? `Searching again for ${many}.`
            : `Asked for ${many} to be looked for again. The search runs on the computer, which may be asleep.`,
        );
      }
      lines.push("They appear on their screen as they arrive; nothing else has to be done.");
      return { receipt: null, text: lines.join(" ") };
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

/** Every meals tool over `deps`: the desk mounts them through live.ts, the durable catalog registers them. */
export function buildMealsCatalogTools(deps: MealsToolDeps & { ports: MealsPorts }): AgentTool[] {
  return [
    buildProposeMealPlanTool(deps),
    buildApplyMealPlanTool(deps),
    buildUpdateProfileTool(deps),
    buildRecordDeviationTool(deps),
    buildAddShoppingItemsTool(deps),
    buildRemoveShoppingItemTool(deps),
    buildReplaceShoppingItemTool(deps),
    buildWriteMethodTool(deps),
    buildRefreshMealsPhotosTool(deps),
  ];
}
