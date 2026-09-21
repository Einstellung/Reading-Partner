// The dinner desk's tools and the standing instruction that goes with them
// (docs/73), modelled on info/briefer/lab-tool.ts: each tool drafts a card and
// writes nothing, the card's Apply performs the write, and a synthetic user
// turn afterwards tells the model what landed.
//
// The model supplies dishes, ingredients, modes and prose. It supplies no
// dates, no shopping list and no arithmetic: a day is a number from one to
// seven exactly as the instruction printed it, and the program turns it into a
// date (docs/73 事实不经模型).

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../legion/execute/turn";
import { recordDeviation, type DinnerPorts } from "./apply";
import type { DinnerCard, DinnerCharterCardData, DinnerPlanCardData } from "./cards";
import {
  CATEGORY_ORDER,
  KEEPS_ORDER,
  type Deviation,
  type DinnerMode,
  type DinnerState,
  type Ingredient,
  type IngredientCategory,
  type KeepsClass,
  type WeekPlan,
} from "./types";
import {
  HANDS_ON_LIMIT,
  WEEK_DAYS,
  addDays,
  assembleWeekPlan,
  daysBetween,
  dishForDay,
  type DayDraft,
  type DishDraft,
} from "./week";

const MODES: readonly DinnerMode[] = ["cook", "reheat", "out", "delivery"];

export interface DinnerToolDeps {
  // The conversation the proposal was made in. Carried on the card so one read
  // back off disk still says which it was.
  threadId: string;
  // The charter, the week and the deviations, read when the tool is called
  // rather than when the desk was laid.
  state(): Promise<DinnerState>;
  // Today's local date, from the host clock. Never asked of the model.
  today(): string;
  now(): number;
  // Surface the card. The host owns Apply; the tool never writes.
  onDinnerCard(card: DinnerCard): void;
  // Pinned by a test so minted dish ids are an equality assertion.
  random?: () => number;
}

// --- the instruction ---------------------------------------------------------

function modeLine(plan: WeekPlan, index: number): string {
  const day = plan.days[index];
  if (!day) return "";
  const dish = dishForDay(plan, day);
  switch (day.mode) {
    case "cook":
      return dish ? `cook ${dish.name}` : "cook — no dish";
    case "reheat":
      return day.reheatOf
        ? `reheat the base from day ${(daysBetween(plan.startDate, day.reheatOf) ?? 0) + 1}${day.freshAdd ? `, plus ${day.freshAdd}` : ""}`
        : "reheat — nothing to reheat, this day needs a plan";
    case "out":
      return day.place ? `out at ${day.place}` : "out";
    case "delivery":
      return day.place ? `delivery from ${day.place}` : "delivery";
  }
}

/**
 * What the dinner desk is told before it says anything: the household, the
 * week as it stands with today marked, and the rules the program will hold it
 * to anyway.
 */
export function dinnerGuidance(
  state: DinnerState,
  today: string,
  opts: { imageSearch?: boolean } = {},
): string {
  const out: string[] = ["DINNER", `Today is ${today}.`, ""];

  if (state.charter) {
    const c = state.charter;
    out.push(
      "The household, in their words:",
      c.text,
      `${c.people} eating. Shops: ${c.stores.join(", ") || "none named"}. Kitchen: ${c.kitchen || "not said"}.`,
      `Never cook: ${c.dislikes.join(", ") || "nothing named"}.`,
      `A normal week: ${c.nightsCooking} cooking, ${c.nightsOut} out, ${c.nightsDelivery} delivery.`,
      "Correct any of this with propose_dinner_charter when they say something that changes it.",
    );
  } else {
    out.push(
      "You do not know this household yet. Before planning anything, ask two or three questions",
      "in one message — how many are eating, where they shop, how many nights they want to cook,",
      "anything they will not eat — and then call propose_dinner_charter with what they said.",
      "Never show them a form and never ask a fourth question; the rest is learned by talking.",
    );
  }
  out.push("");

  if (state.plan) {
    const plan = state.plan;
    out.push("This week:");
    for (let i = 0; i < plan.days.length; i++) {
      const day = plan.days[i];
      if (!day) continue;
      const mark = day.date === today ? "  <- today" : "";
      out.push(`- Day ${i + 1} (${day.date}): ${modeLine(plan, i)}${mark}`);
    }
    out.push(
      "",
      "Refer to a night by its day number when you call propose_dinner_plan. Never write a date",
      "yourself and never work one out — the program owns every date, the shopping list and the",
      "freeze-on-arrival marks, and it will contradict you.",
    );
  } else {
    out.push("No week is planned. Call propose_dinner_plan when they ask what to eat this week.");
  }

  if (state.deviations.length) {
    const recent = state.deviations.slice(-3);
    out.push("", "What they have told you went differently:");
    for (const d of recent) out.push(`- ${d.date}: ${d.said}`);
  }

  out.push(
    "",
    "HOW TO PLAN",
    `One pot, no more than ${HANDS_ON_LIMIT} minutes hands-on, and no more washing up than a`,
    "single meal. Cook once, eat twice: a cooked dish is a base that keeps a day plus a fresh",
    "part added at serving, so a cook day can be followed by a reheat day that eats that base",
    "with something fresh on it. A dish that does not keep a day is a one-night dish.",
    "List a dish's ingredients for every serving it is planned for, the reheat night included.",
    "Give every ingredient its English common name in `en` beside the name in their own language,",
    "singular and lower case — it is what puts a photograph on their shopping list.",
    // With a web image search configured any name finds a picture, so the
    // sentence that narrows the menu is only true without one (docs/73 图片).
    ...(opts.imageSearch
      ? [
          "Give every dish a `searchName` in English, the way people say it — it is what puts a",
          "photograph of the dish on their screen.",
        ]
      : [
          "Prefer dishes that have a common name over combinations you make up: the reader is shown a",
          "photograph of a named dish and nothing at all of an invented one. Give that name in",
          "`searchName`, in English and the way people say it.",
        ]),
    "Vegetables heavy, whole grains, lean protein, little oil, salt and refined carbohydrate.",
    "Never count calories, never give grams of anything nutritional, never talk about nutrition",
    "numbers at all — health is a filter on what you propose, not a subject.",
    "Out and delivery are ordinary plans, from the places they actually go. Do not apologise for",
    "them and do not dress them up as the healthy option.",
    "Do not repeat a dish from the week already planned unless they asked for it.",
    "",
    "WHEN A NIGHT GOES DIFFERENTLY",
    "They will say one sentence ('ordered in tonight'). That moves the next day or two and",
    "nothing else: call propose_dinner_plan with adjustment set, naming only the days the",
    "program told you were left without a dinner. Never re-plan the week over one night.",
    "Boredom and 'too much hassle' are not adjustments — remember them for the next week.",
  );
  return out.join("\n");
}

// --- the charter -------------------------------------------------------------

export function buildProposeDinnerCharterTool(deps: DinnerToolDeps): AgentTool {
  return {
    name: "propose_dinner_charter",
    label: () => "Drafting what your dinners have to fit",
    effect: "write",
    gate: "card",
    description:
      "Record what the household is, after they have answered your two or three questions: how " +
      "many are eating, where they shop, what the kitchen is, what they will not eat, and how a " +
      "normal week splits between cooking, eating out and delivery. `text` is one paragraph in " +
      "their own words — it is what you will read next week, so keep their phrasing. Call it " +
      "again whenever something they say changes it. It files nothing: the user sees a card and " +
      "applies it.",
    parameters: Type.Object({
      people: Type.Number({ description: "How many people eat dinner." }),
      stores: Type.Array(Type.String(), {
        description: "The shops they actually buy food in, as they name them.",
      }),
      kitchen: Type.String({
        description: "One line: what there is to cook with, and what there is not.",
      }),
      dislikes: Type.Array(Type.String(), {
        description: "What they will not eat, allergies included.",
      }),
      nightsCooking: Type.Number({ description: "Nights a normal week cooks." }),
      nightsOut: Type.Number({ description: "Nights a normal week eats out." }),
      nightsDelivery: Type.Number({ description: "Nights a normal week orders delivery." }),
      text: Type.String({
        description: "One paragraph in the user's own words: what dinner has to fit around.",
      }),
    }),
    execute: async (args) => {
      const text = String(args.text ?? "").trim();
      if (!text) throw new Error("propose_dinner_charter needs the paragraph in their words.");
      const card: DinnerCharterCardData = {
        kind: "dinner-charter",
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
      deps.onDinnerCard(card);
      return {
        text:
          "A card now shows the user what you understood about their dinners. Nothing is saved " +
          "until they apply it, and they can have you change any of it first.",
        receipt: { label: "Drafted the dinner basics", summary: text },
      };
    },
  };
}

// --- the week ----------------------------------------------------------------

export function buildProposeDinnerPlanTool(deps: DinnerToolDeps): AgentTool {
  return {
    name: "propose_dinner_plan",
    label: (args) => (args.adjustment ? "Reworking a night" : "Drafting this week's dinners"),
    effect: "write",
    gate: "card",
    description:
      "Propose the week's dinners, or rework the one or two nights a change left open. `days` " +
      "gives a night per entry, `day` being its number from 1 to 7 exactly as your instructions " +
      "print them — never a date. A `cook` day names a dish from `dishes`; a `reheat` day gives " +
      "`reheatOfDay`, the day whose base it eats, and `freshAdd`, what goes on it at serving; " +
      "`out` and `delivery` give `place` in the user's own words. Set `adjustment` when you are " +
      "reworking nights of the week they already have — then send only those days, and every " +
      "other night stays exactly as it is. A fresh week sends all seven. The program dates the " +
      "days and derives the shopping list; do not write either. It files nothing: the user sees " +
      "a card and applies it.",
    parameters: Type.Object({
      adjustment: Type.Boolean({
        description: "True when this reworks nights of the week already planned.",
      }),
      dishes: Type.Array(
        Type.Object({
          name: Type.String({ description: "The dish, named the way it would be said." }),
          searchName: Type.String({
            description:
              "The dish's common English name as people search for it, singular and lower " +
              "case: 'mapo tofu', 'shakshuka', 'minestrone', 'dal', 'ratatouille', 'sheet pan " +
              "salmon'. Not a description of your own invention — it is what finds the dish's " +
              "photograph, and a name nobody else uses finds nothing.",
          }),
          oneLine: Type.String({ description: "One line: what it is and why tonight." }),
          base: Type.String({
            description: "The part cooked ahead that keeps a day. Empty if there is none.",
          }),
          fresh: Type.String({
            description: "The part added at serving and not kept. Empty if there is none.",
          }),
          keepsADay: Type.Boolean({
            description: "Whether the base is as good the next day. Stews and grains yes; " +
              "stir-fried greens, fried food, noodles and dressed salad no.",
          }),
          handsOnMinutes: Type.Number({
            description: `Minutes of hands-on work. ${HANDS_ON_LIMIT} at the very most.`,
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
            { description: "Everything to buy for every serving this dish is planned for." },
          ),
        }),
        { description: "The dishes this call introduces. Empty when no night cooks." },
      ),
      days: Type.Array(
        Type.Object({
          day: Type.Number({ description: "1 to 7, the day number from your instructions." }),
          mode: Type.String({ description: "cook, reheat, out or delivery." }),
          dish: Type.String({ description: "For a cook day: the dish's name." }),
          reheatOfDay: Type.Number({
            description: "For a reheat day: the day number whose base it eats.",
          }),
          freshAdd: Type.String({
            description: "For a reheat day: what is added at serving.",
          }),
          place: Type.String({
            description: "For out or delivery: where, in the user's own words.",
          }),
        }),
        { description: "The nights this call plans." },
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
      const draft = { dishes: toDishDrafts(args.dishes), days: toDayDrafts(args.days) };
      if (draft.days.length === 0) throw new Error("propose_dinner_plan needs at least one day.");
      if (!adjustment && draft.days.length < WEEK_DAYS) {
        return {
          receipt: null,
          text:
            `A fresh week needs all ${WEEK_DAYS} days; you sent ${draft.days.length}. Send the ` +
            `whole week, or set adjustment if you meant to rework nights of the week they have.`,
        };
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
            `\nFix those and call propose_dinner_plan again.`,
        };
      }

      const card: DinnerPlanCardData = {
        kind: "dinner-plan",
        threadId: deps.threadId,
        startDate: assembled.plan.startDate,
        days: assembled.plan.days,
        dishes: assembled.plan.dishes,
        adjustment,
        changedDates: adjustment ? assembled.changedDates : [],
        phase: "proposed",
      };
      deps.onDinnerCard(card);
      return {
        text:
          (adjustment
            ? `Proposed a change to ${assembled.changedDates.length} night(s).`
            : "Proposed the week's dinners.") +
          " A card now shows the user the days and the shopping list the program derived from " +
          "them. Nothing is saved until they apply it. Do not tell them what to buy — the list " +
          "is on the card.",
        receipt: {
          label: adjustment ? "Reworked a night" : "Drafted the week",
          summary: assembled.plan.days
            .map((d) => `${d.date}: ${d.mode}`)
            .join("; "),
        },
      };
    },
  };
}

// --- a night that went differently -------------------------------------------

/**
 * Record what actually happened on a night, from the reader's own sentence.
 *
 * The only tool of the three that writes. It is not a card and does not need
 * one: a deviation is the reader saying what they did, which is the explicit
 * instruction gate of the harness principle, and there is nothing for them to
 * approve about their own sentence. What the program did with it comes back in
 * the result, `attention` included, so the model can follow with
 * propose_dinner_plan as an adjustment for exactly those days.
 */
export function buildRecordDeviationTool(
  deps: DinnerToolDeps & { ports: DinnerPorts },
): AgentTool {
  return {
    name: "record_dinner_deviation",
    label: () => "Recording what you ate instead",
    effect: "write",
    description:
      "Call this the moment they say a night went differently from the plan ('we ordered in', " +
      "'ended up at the noodle place'). It writes that night down and clears whatever depended " +
      "on it. It answers with the days that are now without a dinner: plan only those, with " +
      "propose_dinner_plan and adjustment set. Do not call it for boredom or 'too much hassle' " +
      "— that is next week's business, not tonight's.",
    parameters: Type.Object({
      day: Type.String({
        description:
          "Which night: 'today', 'yesterday', or the day number 1 to 7 from your instructions.",
      }),
      became: Type.String({ description: "What the night actually was: cook, reheat, out or delivery." }),
      place: Type.String({ description: "Where, for out or delivery, in their words." }),
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
          text:
            "That is not a night of this week. Say 'today', 'yesterday', or the day number 1 to 7.",
        };
      }
      const mode = String(args.became ?? "").trim().toLowerCase();
      if (!(MODES as readonly string[]).includes(mode)) {
        return {
          receipt: null,
          text: `became must be one of: ${MODES.join(", ")}.`,
        };
      }
      const said = String(args.said ?? "").trim();
      if (!said) throw new Error("record_dinner_deviation needs their sentence.");
      const place = String(args.place ?? "").trim();
      const deviation: Deviation = {
        date,
        said,
        became: mode as DinnerMode,
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
          ? `Recorded. ${attention.join(" and ")} now has nothing planned — call ` +
            `propose_dinner_plan with adjustment set for those days only.`
          : "Recorded. Nothing else in the week moved, so there is nothing to re-plan.",
        receipt: { label: "Recorded a change of plan", summary: `${date}: ${said}` },
      };
    },
  };
}

/**
 * The date a night's name stands for. "today" and "yesterday" are the two the
 * reader actually says out loud; a number is the day of the week exactly as
 * dinnerGuidance printed it. Null for anything outside the planned week, which
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

export function toDayDrafts(raw: unknown): DayDraft[] {
  if (!Array.isArray(raw)) return [];
  const out: DayDraft[] = [];
  for (const entry of raw) {
    const e = record(entry);
    const mode = String(e.mode ?? "").trim().toLowerCase();
    if (!(MODES as readonly string[]).includes(mode)) continue;
    const day: DayDraft = { day: toCount(e.day, 0), mode: mode as DinnerMode };
    const dish = String(e.dish ?? "").trim();
    if (dish) day.dish = dish;
    const of = Number(e.reheatOfDay);
    if (Number.isFinite(of) && of > 0) day.reheatOfDay = Math.round(of);
    const fresh = String(e.freshAdd ?? "").trim();
    if (fresh) day.freshAdd = fresh;
    const place = String(e.place ?? "").trim();
    if (place) day.place = place;
    out.push(day);
  }
  return out;
}
