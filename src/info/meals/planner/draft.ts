// The plan draft the model hands in (docs/671 对话, 一锅): which library dish
// each meal eats, which meals share a pot, and when the pots are cooked. It
// never carries grams or dates: days are numbered from 1, and the program
// solves every amount (solve.ts) and holds the draft to its rules (checks.ts).

import type { CookPart } from "../nutrition/targets";

/** A plan covers 1 to 3 days; a user who wants longer plans again after it. */
export const MAX_PLAN_DAYS = 3;
/** A pot feeds 1 to 3 meals, the meal it is cooked at counted. */
export const POT_MEALS = { min: 1, max: 3 } as const;
/** Every pot of a plan is cooked in one prep session. */
export const MAX_PREP_SESSIONS = 1;
/**
 * Drafts sent back to the model in one turn before it has to tell the user
 * (docs/671 对话). The turn's own round cap (legion DEFAULT_MAX_ROUNDS) is above
 * it, so the explanation after the last refusal still reaches them.
 */
export const MAX_DRAFT_ROUNDS = 4;

export type PlanSlot = "breakfast" | "lunch" | "dinner";
export type MainSlot = "lunch" | "dinner";
export const PLAN_SLOTS: readonly PlanSlot[] = ["breakfast", "lunch", "dinner"];
export const MAIN_SLOTS: readonly MainSlot[] = ["lunch", "dinner"];

/** A lunch or dinner, by day number (1-based). */
export interface MealAt {
  day: number;
  slot: MainSlot;
}

/**
 * A lunch or dinner's main: a share of a pot eaten one of the batch dish's
 * ways (1-based), or a fresh main made at the meal with one of its staples. A
 * fresh main that carries its own staple line names none.
 */
export type DraftMain = { batch: string; way: number } | { dish: string; staple?: string };

export interface DraftMeal {
  main: DraftMain;
  /** Side dish ids (role side). */
  sides: string[];
}

export interface DraftDay {
  /** A breakfast template's dish id; empty in the model's picks unless they asked for one (fill.ts picks it). */
  breakfast: string;
  lunch: DraftMeal;
  dinner: DraftMeal;
  /** Fruit food ids, one per portion, eaten after a meal or as the afternoon snack. */
  fruit: string[];
}

/** One batch dish cooked once in a prep session and eaten over its meals. */
export interface DraftBatch {
  /** The model's own short id, unique in the draft. */
  id: string;
  dish: string;
  session: string;
  meals: MealAt[];
}

export interface DraftSession {
  id: string;
  day: number;
  part: CookPart;
}

/**
 * What they asked for that the program otherwise picks, for the whole plan: a
 * breakfast for every day that names none, a staple for every fresh main that
 * takes it and names none (fill.ts holds to them).
 */
export interface DraftAsked {
  breakfast?: string;
  staple?: string;
}

export interface PlanDraft {
  days: DraftDay[];
  batches: DraftBatch[];
  sessions: DraftSession[];
  asked?: DraftAsked;
}

export function isBatchMain(main: DraftMain): main is { batch: string; way: number } {
  return "batch" in main;
}

/** "Day 2 lunch". */
export function mealName(day: number, slot: PlanSlot): string {
  return `Day ${day} ${slot}`;
}

// --- reading the tool's arguments --------------------------------------------

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : Number.NaN);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function toMain(raw: unknown): DraftMain {
  const m = obj(raw);
  if (str(m.batch)) return { batch: str(m.batch), way: int(m.way) };
  const staple = str(m.staple);
  return staple ? { dish: str(m.dish), staple } : { dish: str(m.dish) };
}

function toMeal(raw: unknown): DraftMeal {
  const m = obj(raw);
  return { main: toMain(m.main), sides: list(m.sides).map(str).filter(Boolean) };
}

/**
 * The draft as the tool received it, shapes coerced and nothing judged:
 * a missing id stays empty and an unreadable number becomes NaN, for the
 * checks to name.
 */
export function parseDraft(raw: unknown): PlanDraft {
  const r = obj(raw);
  const asked = { breakfast: str(obj(r.asked).breakfast), staple: str(obj(r.asked).staple) };
  return {
    ...(asked.breakfast || asked.staple
      ? { asked: { ...(asked.breakfast ? { breakfast: asked.breakfast } : {}), ...(asked.staple ? { staple: asked.staple } : {}) } }
      : {}),
    days: list(r.days).map((d) => {
      const day = obj(d);
      return {
        breakfast: str(day.breakfast),
        lunch: toMeal(day.lunch),
        dinner: toMeal(day.dinner),
        fruit: list(day.fruit).map(str).filter(Boolean),
      };
    }),
    batches: list(r.batches).map((b) => {
      const batch = obj(b);
      return {
        id: str(batch.id),
        dish: str(batch.dish),
        session: str(batch.session),
        meals: list(batch.meals).map((m) => ({ day: int(obj(m).day), slot: str(obj(m).slot) as MainSlot })),
      };
    }),
    sessions: list(r.sessions).map((s) => {
      const session = obj(s);
      return { id: str(session.id), day: int(session.day), part: str(session.part) as CookPart };
    }),
  };
}
