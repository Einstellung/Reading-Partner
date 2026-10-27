// Where the reader stands with batch cooking (docs/671 备餐页, docs/ui/22): the
// one state the Meals page's top card, the phone home's Meals tile and the
// prep row on a day card are all drawn from. Pure: the state, the date and the
// hour in, words and which way a tap goes out.
//
//   setup     no profile yet: the Meals page is the onboarding
//   plan      nothing planned: plan a batch cook
//   prep      a plan whose prep is still ahead: when, how long, open the prep
//   next      the prep is done or the plan has none: the next meal
//   planNext  the plan is used up: plan the next batch cook

import { formatDateTime, getLocale, t } from "../../../i18n";
import { prepMinutes } from "../planner/prep";
import type { MealKey, MealsState, WeekPlan } from "../plan/types";
import { addDays, planExhausted } from "../plan/week";
import { parseDraft, type DraftSession, type PlanDraft } from "../planner/draft";
import { planLibrary } from "../planner/library";
import { dayWord, mealLabel } from "./view";

export type PrepPart = DraftSession["part"];

/** The stored plan's one prep session (docs/671 形态), as the entry points show it. */
export interface PrepSlot {
  session: string;
  /** The session's date: Day 1's date for day 1, the day before it for the prep day. */
  date: string;
  part: PrepPart;
  activeMin: number;
  totalMin: number;
  /** The pots' dish names, in the reader's language. */
  pots: string[];
  /** Tapped Done, or its day is past (the plan is the record, docs/73). */
  done: boolean;
}

export interface NextMeal {
  date: string;
  key: MealKey;
  name: string;
}

export type BatchCookEntry =
  | { kind: "setup" }
  | { kind: "plan" }
  | { kind: "prep"; prep: PrepSlot }
  | { kind: "next"; next: NextMeal | null; prep: PrepSlot | null }
  | { kind: "planNext" };

/** Where a tap goes: the planning chat, the prep page, the next meal's day, or the Meals page. */
export type EntryAction = { kind: "plan" } | { kind: "prep"; session: string } | { kind: "day"; date: string } | { kind: "meals" };

/** Before this hour the next meal of today is lunch, before DINNER_UNTIL it is dinner, after that tomorrow's. */
export const LUNCH_UNTIL = 14;
export const DINNER_UNTIL = 21;

function draftOf(plan: WeekPlan): PlanDraft | null {
  if (!plan.planner) return null;
  try {
    return parseDraft(plan.planner.draft);
  } catch {
    return null;
  }
}

/** The plan's prep session, or null when the plan cooks nothing ahead or has no draft. */
export function planPrep(state: MealsState, today: string): PrepSlot | null {
  const plan = state.plan;
  const rec = plan?.planner;
  const profile = state.charter?.profile;
  if (!plan || !rec || !profile) return null;
  const draft = draftOf(plan);
  const s = draft?.sessions[0];
  if (!draft || !s) return null;
  const lib = planLibrary(profile);
  const dishes = draft.batches.filter((b) => b.session === s.id).flatMap((b) => lib.dish(b.dish) ?? []);
  if (!dishes.length) return null;
  const { activeMin, totalMin } = prepMinutes(dishes);
  const date = addDays(rec.start, s.day - 1);
  const zh = getLocale() === "zh-CN";
  return {
    session: s.id,
    date,
    part: s.part,
    activeMin,
    totalMin,
    pots: dishes.map((d) => (zh ? d.name : d.nameEn)),
    done: typeof rec.preppedAt === "number" || date < today,
  };
}

/** The first lunch or dinner still ahead, by the hour of today. */
export function nextMeal(plan: WeekPlan, today: string, hour: number): NextMeal | null {
  for (const day of plan.days) {
    if (day.date < today) continue;
    for (const key of ["lunch", "dinner"] as const) {
      if (day.planned && !day.planned.includes(key)) continue;
      if (day.date === today && hour >= (key === "lunch" ? LUNCH_UNTIL : DINNER_UNTIL)) continue;
      const meal = day[key];
      const name = meal.mode === "make" ? meal.name : meal.place;
      if (meal.mode === "skip" || !name) continue;
      return { date: day.date, key, name };
    }
  }
  return null;
}

export function batchCookEntry(state: MealsState | null, today: string, hour = 0): BatchCookEntry | null {
  if (!state) return null;
  if (!state.charter) return { kind: "setup" };
  const plan = state.plan;
  if (!plan || !plan.days.length) return { kind: "plan" };
  const prep = planPrep(state, today);
  if (prep && !prep.done) return { kind: "prep", prep };
  if (planExhausted(plan, today)) return { kind: "planNext" };
  return { kind: "next", next: nextMeal(plan, today, hour), prep };
}

// --- words -------------------------------------------------------------------

function partWord(part: PrepPart): string {
  return t(`meals.draft.part.${part}`);
}

/** 「今天 下午」, 「Sunday afternoon」. */
export function prepWhenText(prep: Pick<PrepSlot, "date" | "part">, today: string): string {
  return t("meals.entry.when", { day: dayWord(prep.date, today), part: partWord(prep.part) });
}

/** 「动手 72 分 · 共约 95 分」. */
export function prepTimeText(prep: Pick<PrepSlot, "activeMin" | "totalMin">): string {
  return t("meals.draft.prepTime", { active: prep.activeMin, total: prep.totalMin });
}

/** The row a prep day's card carries: 「备餐 · 下午 · 动手 72 分 · 共 95 分」. */
export function prepRowText(prep: Pick<PrepSlot, "part" | "activeMin" | "totalMin">): string {
  return t("meals.entry.prepRow", { part: partWord(prep.part), active: prep.activeMin, total: prep.totalMin });
}

/** The day whose card carries the prep row, or null. */
export function prepRowDate(entry: BatchCookEntry | null): string | null {
  if (!entry) return null;
  if (entry.kind === "prep") return entry.prep.date;
  if (entry.kind === "next" && entry.prep) return entry.prep.date;
  return null;
}

export interface EntryButton {
  label: string;
  action: EntryAction;
}

/** The top card on the Meals page. Null for setup, where the page is the onboarding. */
export interface EntryCardView {
  kind: Exclude<BatchCookEntry["kind"], "setup">;
  kicker: string;
  title: string;
  lines: string[];
  /** Tapping the title: the next meal's day, or nothing. */
  open: EntryAction | null;
  primary: EntryButton | null;
  secondary: EntryButton[];
}

const PLAN: EntryAction = { kind: "plan" };

export function entryCardView(entry: BatchCookEntry | null, today: string): EntryCardView | null {
  if (!entry || entry.kind === "setup") return null;
  const kicker = t("meals.entry.kicker");
  switch (entry.kind) {
    case "plan":
      return {
        kind: "plan",
        kicker,
        title: t("meals.entry.noneTitle"),
        lines: [t("meals.entry.noneLine")],
        open: null,
        primary: { label: t("meals.entry.plan"), action: PLAN },
        secondary: [],
      };
    case "prep": {
      const p = entry.prep;
      return {
        kind: "prep",
        kicker,
        title: prepWhenText(p, today),
        lines: [prepTimeText(p), p.pots.join(t("meals.listJoin"))],
        open: { kind: "prep", session: p.session },
        primary: { label: t("meals.entry.openPrep"), action: { kind: "prep", session: p.session } },
        secondary: [{ label: t("meals.entry.replan"), action: PLAN }],
      };
    }
    case "next": {
      const n = entry.next;
      return {
        kind: "next",
        kicker: t("meals.entry.nextKicker"),
        title: n ? n.name : t("meals.entry.nothingNext"),
        lines: n ? [t("meals.entry.nextWhen", { day: dayWord(n.date, today), meal: mealLabel(n.key) })] : [],
        open: n ? { kind: "day", date: n.date } : null,
        primary: null,
        secondary: [
          ...(entry.prep ? [{ label: t("meals.entry.prepList"), action: { kind: "prep", session: entry.prep.session } as EntryAction }] : []),
          { label: t("meals.entry.planNext"), action: PLAN },
        ],
      };
    }
    case "planNext":
      return {
        kind: "planNext",
        kicker,
        title: t("meals.entry.usedUpTitle"),
        lines: [t("meals.entry.noneLine")],
        open: null,
        primary: { label: t("meals.entry.planNext"), action: PLAN },
        secondary: [],
      };
  }
}

/** The phone home's Meals tile: the middle line, the foot, and where a tap goes. */
export interface EntryTileView {
  mid: string;
  foot: string;
  action: EntryAction;
}

export function entryTileView(entry: BatchCookEntry | null, today: string): EntryTileView | null {
  if (!entry) return null;
  switch (entry.kind) {
    case "setup":
      return { mid: t("meals.entry.setup"), foot: t("meals.entry.setupFoot"), action: { kind: "meals" } };
    case "plan":
      return { mid: t("meals.entry.plan"), foot: t("meals.entry.planFoot"), action: PLAN };
    case "prep":
      return {
        mid: t("meals.entry.tilePrep", { when: prepWhenText(entry.prep, today) }),
        foot: prepTimeText(entry.prep),
        action: { kind: "prep", session: entry.prep.session },
      };
    case "next":
      return entry.next
        ? {
            mid: entry.next.name,
            foot: t("meals.entry.nextWhen", { day: dayWord(entry.next.date, today), meal: mealLabel(entry.next.key) }),
            action: { kind: "meals" },
          }
        : { mid: t("meals.entry.nothingNext"), foot: t("meals.entry.planNext"), action: PLAN };
    case "planNext":
      return { mid: t("meals.entry.planNext"), foot: t("meals.entry.usedUpTitle"), action: PLAN };
  }
}

/** 「备餐 · 周日 11/1」: the prep page's title. */
export function prepTitle(date: string): string {
  const day = formatDateTime(new Date(`${date}T00:00:00Z`), { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
  return t("meals.prep.title", { date: day });
}
