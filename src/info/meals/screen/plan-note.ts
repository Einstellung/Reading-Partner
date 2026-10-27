// The note on the meals page when a plan was written although the draft rules
// (planner/checks.ts) still find something in it: after Apply on a draft
// checked against an older profile, or after a profile change re-solved the
// stored plan (docs/73 写入后的检查). It only informs: nothing is blocked and
// nothing is re-planned.
//
// The checker's messages are written for the model; the reader gets one short
// line per rule, the days by weekday, at most PLAN_NOTE_MAX_LINES lines.
// The note itself is held in memory until the reader dismisses it, and the
// same problems do not bring it back.

import { getLocale, t, translate } from "../../../i18n";
import type { DraftRule } from "../planner/checks";
import { addDays } from "../plan/week";
import { weekdayName } from "./view";

/** The checker's problems as the note reads them: the rule and the plan day (0 the prep day). */
export interface PlanNoteCheck {
  /** The date Day 1 falls on. */
  start: string;
  problems: readonly { rule: DraftRule; day?: number }[];
}

export const PLAN_NOTE_MAX_LINES = 3;

// Rules a reader can read as a day's problem; the rest are said once for the plan.
const BY_DAY: ReadonlySet<DraftRule> = new Set<DraftRule>([
  "calcium",
  "vegetables",
  "veg_variety",
  "fruit",
  "sodium",
  "protein",
  "kcal",
  "dish_blocked",
  "equipment",
]);

type RuleWords =
  | "calcium"
  | "vegetables"
  | "veg_variety"
  | "fruit"
  | "sodium"
  | "protein"
  | "kcal"
  | "red_meat"
  | "legumes"
  | "whole_grain"
  | "protein_variety"
  | "same_protein"
  | "fish"
  | "leftover"
  | "dish_blocked"
  | "equipment"
  | "cook_slot"
  | "other";

function wordsFor(rule: DraftRule): RuleWords {
  switch (rule) {
    case "calcium":
    case "vegetables":
    case "veg_variety":
    case "fruit":
    case "sodium":
    case "protein":
    case "kcal":
    case "red_meat":
    case "legumes":
    case "whole_grain":
    case "protein_variety":
    case "same_protein":
    case "fish":
    case "leftover":
    case "dish_blocked":
    case "equipment":
    case "cook_slot":
      return rule;
    default:
      return "other";
  }
}

interface Group {
  words: RuleWords;
  dates: string[];
}

function groups(check: PlanNoteCheck, today?: string): Group[] {
  const out = new Map<RuleWords, { dates: Set<string>; anyDay: boolean; past: boolean }>();
  for (const p of check.problems) {
    const words = wordsFor(p.rule);
    const g = out.get(words) ?? { dates: new Set<string>(), anyDay: false, past: false };
    out.set(words, g);
    if (!BY_DAY.has(p.rule) || p.day === undefined) {
      g.anyDay = true;
      continue;
    }
    const date = addDays(check.start, p.day - 1);
    // A day already eaten is past fixing.
    if (today && date < today) g.past = true;
    else g.dates.add(date);
  }
  const list: Group[] = [];
  for (const [words, g] of out) {
    if (!g.anyDay && g.dates.size === 0) continue; // only days already gone
    list.push({ words, dates: [...g.dates].sort() });
  }
  // Calcium first: it has its own way out. The rest in the checker's order.
  return [...list.filter((g) => g.words === "calcium"), ...list.filter((g) => g.words !== "calcium")];
}

function line(g: Group): string {
  const days = g.dates.map(weekdayName).join(t("meals.listJoin"));
  if (g.words === "calcium") return t("meals.planNote.calcium", { days });
  const what = translate(getLocale(), `meals.planNote.rule.${g.words}`);
  return days ? t("meals.planNote.onDays", { what, days }) : t("meals.planNote.plain", { what });
}

/**
 * The note's lines, one per rule, calcium first; days before `today` left out.
 * Empty when there is nothing to say.
 */
export function planNoteLines(check: PlanNoteCheck | null | undefined, today?: string): string[] {
  if (!check?.problems.length) return [];
  const all = groups(check, today);
  if (all.length <= PLAN_NOTE_MAX_LINES) return all.map(line);
  const shown = all.slice(0, PLAN_NOTE_MAX_LINES - 1);
  return [...shown.map(line), t("meals.planNote.more", { count: all.length - shown.length })];
}

/** Which problems a note is about, in no language: the same key is the same note. */
export function planNoteKey(check: PlanNoteCheck | null | undefined): string {
  if (!check?.problems.length) return "";
  const parts = new Set(check.problems.map((p) => `${p.rule}:${p.day ?? ""}`));
  return `${check.start}|${[...parts].sort().join(",")}`;
}

// --- the note in memory ------------------------------------------------------

export interface PlanNoteStore {
  /** The check a write just came back with; one with no problems takes the note down. */
  show(check: PlanNoteCheck | null | undefined): void;
  /** The reader wiped it away: these problems stay hidden until they change. */
  dismiss(): void;
  /** What to show, or null. */
  current(): PlanNoteCheck | null;
  subscribe(listener: () => void): () => void;
}

export function createPlanNoteStore(): PlanNoteStore {
  let check: PlanNoteCheck | null = null;
  let dismissed = "";
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };
  return {
    show(next) {
      const key = planNoteKey(next);
      const shown = key && key !== dismissed ? (next ?? null) : null;
      if (shown === check) return;
      check = shown;
      emit();
    },
    dismiss() {
      if (!check) return;
      dismissed = planNoteKey(check);
      check = null;
      emit();
    },
    current: () => check,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** This app's note: written by the plan's writes, read by the meals page. */
export const planNote: PlanNoteStore = createPlanNoteStore();
