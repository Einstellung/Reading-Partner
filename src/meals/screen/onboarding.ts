// The Meals onboarding (docs/73 首次): a scripted, tap-only thread that asks
// for consent, the goal, the body, training, work and the week's logistics,
// then shows the daily targets. Every step's rule, its answer line and the
// profile it ends in are here, so MealsOnboarding.tsx only draws the thread
// and dispatches taps.
//
// Every line the reader sees comes from the meals catalog (meals.onboarding.*)
// and follows the UI language. The values the answers store (the shop and
// kitchen words, 无 for no dislikes) stay Chinese: they go to disk in the
// profile and planner/library.ts equipmentNamed reads them.

import { t, type MessageKey } from "../../i18n";
import type { FoodTag } from "../nutrition/foods";
import {
  DEFAULT_EFFORT,
  type Consent,
  type Effort,
  type Goal,
  type Profile,
  type Sex,
  type Targets,
  type TrainTime,
  type Work,
} from "../nutrition/targets";

export const STEPS = ["consent", "goal", "body", "train", "work", "logistics"] as const;
export type StepId = (typeof STEPS)[number];
/** The step index past the last question: the targets are showing. */
export const RESULT_STEP = STEPS.length;

export type StepperField = "age" | "heightCm" | "weightKg" | "bodyFatPct" | "waistCm";
export type ListField = "shops" | "kitchen" | "avoid";

export interface Answers {
  consent: Consent | null;
  goal: Goal | null;
  sex: Sex | null;
  age: number;
  heightCm: number;
  weightKg: number;
  bodyFatKnown: boolean;
  bodyFatPct: number;
  waistKnown: boolean;
  waistCm: number;
  trainingDays: number[];
  trainTime: TrainTime | null;
  // "现在不练" was tapped: training is answered with no days.
  noTraining: boolean;
  work: Work | null;
  // Never asked: a replay keeps the level the conversation set.
  effort: Effort;
  people: number;
  shops: string[];
  kitchen: string[];
  avoid: string[];
}

export interface OnboardingState {
  answers: Answers;
  // The step being asked; RESULT_STEP once every question is answered.
  step: number;
}

export const LIMITS: Readonly<Record<StepperField, readonly [number, number]>> = {
  age: [16, 90],
  heightCm: [130, 220],
  weightKg: [35, 200],
  bodyFatPct: [3, 60],
  waistCm: [50, 160],
};

export const STEP_SIZE: Readonly<Record<StepperField, number>> = {
  age: 1,
  heightCm: 1,
  weightKg: 0.5,
  bodyFatPct: 0.5,
  waistCm: 1,
};

/** A catalog key of the onboarding thread whose text has no placeholder. */
export type OnboardingKey = Exclude<
  Extract<MessageKey, `meals.onboarding.${string}`>,
  `meals.onboarding.answer.${string}` | `meals.onboarding.result.${"daily" | "mixed" | "cut" | "gain" | "join"}` | "meals.onboarding.daysJoined"
>;

const WEEKDAY_KEYS: readonly OnboardingKey[] = [
  "meals.onboarding.weekday.1",
  "meals.onboarding.weekday.2",
  "meals.onboarding.weekday.3",
  "meals.onboarding.weekday.4",
  "meals.onboarding.weekday.5",
  "meals.onboarding.weekday.6",
  "meals.onboarding.weekday.7",
];

/** The short weekday on a day button, 1 = Monday. */
export function weekdayLabel(day: number): string {
  const key = WEEKDAY_KEYS[day - 1];
  return key ? t(key) : "";
}

export const CONSENT_OPTIONS: readonly { value: Consent; label: OnboardingKey }[] = [
  { value: "manual", label: "meals.onboarding.agree" },
  { value: "no", label: "meals.onboarding.disagree" },
];
export const GOAL_OPTIONS: readonly { value: Goal; label: OnboardingKey; sub: OnboardingKey }[] = [
  { value: "cut", label: "meals.onboarding.goal.cut", sub: "meals.onboarding.goal.cutSub" },
  { value: "gain", label: "meals.onboarding.goal.gain", sub: "meals.onboarding.goal.gainSub" },
  { value: "steady", label: "meals.onboarding.goal.steady", sub: "meals.onboarding.goal.steadySub" },
];
export const SEX_OPTIONS: readonly { value: Sex; label: OnboardingKey }[] = [
  { value: "m", label: "meals.onboarding.sex.m" },
  { value: "f", label: "meals.onboarding.sex.f" },
];
export const TRAIN_TIME_OPTIONS: readonly { value: TrainTime; label: OnboardingKey; short: OnboardingKey }[] = [
  { value: "morning", label: "meals.onboarding.time.morning", short: "meals.onboarding.time.morningShort" },
  { value: "midday", label: "meals.onboarding.time.midday", short: "meals.onboarding.time.middayShort" },
  { value: "evening", label: "meals.onboarding.time.evening", short: "meals.onboarding.time.eveningShort" },
];
export const WORK_OPTIONS: readonly { value: Work; label: OnboardingKey; sub: OnboardingKey }[] = [
  { value: "sit", label: "meals.onboarding.work.sit", sub: "meals.onboarding.work.sitSub" },
  { value: "stand", label: "meals.onboarding.work.stand", sub: "meals.onboarding.work.standSub" },
  { value: "labor", label: "meals.onboarding.work.labor", sub: "meals.onboarding.work.laborSub" },
];
export const PEOPLE_OPTIONS: readonly { value: number; label: OnboardingKey }[] = [
  { value: 1, label: "meals.onboarding.people.n1" },
  { value: 2, label: "meals.onboarding.people.n2" },
  { value: 3, label: "meals.onboarding.people.n3" },
  { value: 4, label: "meals.onboarding.people.n4plus" },
];

/** The label of a head count; 4 and up read "4 or more". */
export function peopleLabel(n: number): string {
  const o = PEOPLE_OPTIONS.find((p) => p.value === Math.min(4, n)) ?? PEOPLE_OPTIONS[0]!;
  return t(o.label);
}

// The words a shop or kitchen pick is stored as, in the profile. They stay
// Chinese whatever the UI language; OPTION_LABELS is how each reads on screen.
export const SHOP_OPTIONS: readonly string[] = ["超市", "网上", "菜市场", "便利店"];
// Every appliance past the default stove and microwave (planner/library.ts
// equipmentNamed reads these words) counts only when it is picked here or
// named in the conversation.
export const KITCHEN_OPTIONS: readonly string[] = ["一口锅", "微波炉", "电饭煲", "电压力锅", "蒸锅", "豆浆机", "烤箱", "空气炸锅"];
export const NO_DISLIKES = "无";
// Each dislike (stored by its Chinese word) and the food tag the program checks it by.
export const AVOID_OPTIONS: readonly { value: string; label: OnboardingKey; tag: FoodTag | null }[] = [
  { value: NO_DISLIKES, label: "meals.onboarding.avoid.none", tag: null },
  { value: "不吃牛肉", label: "meals.onboarding.avoid.beef", tag: "beef" },
  { value: "不吃海鲜", label: "meals.onboarding.avoid.seafood", tag: "seafood" },
  { value: "不吃辣", label: "meals.onboarding.avoid.spicy", tag: "spicy" },
];
const OPTION_LABELS: Readonly<Record<string, OnboardingKey>> = {
  超市: "meals.onboarding.shop.supermarket",
  网上: "meals.onboarding.shop.online",
  菜市场: "meals.onboarding.shop.market",
  便利店: "meals.onboarding.shop.convenience",
  一口锅: "meals.onboarding.kitchen.pot",
  微波炉: "meals.onboarding.kitchen.microwave",
  电饭煲: "meals.onboarding.kitchen.riceCooker",
  电压力锅: "meals.onboarding.kitchen.pressureCooker",
  蒸锅: "meals.onboarding.kitchen.steamer",
  豆浆机: "meals.onboarding.kitchen.soyMilk",
  烤箱: "meals.onboarding.kitchen.oven",
  空气炸锅: "meals.onboarding.kitchen.airFryer",
};

/** How a stored shop, kitchen or dislike word reads in the UI language. */
export function optionLabel(value: string): string {
  const key = OPTION_LABELS[value] ?? AVOID_OPTIONS.find((o) => o.value === value)?.label;
  return key ? t(key) : value;
}

const DEFAULT_BODY = { age: 30, heightCm: 170, weightKg: 65, bodyFatPct: 20, waistCm: 80 };

/**
 * A fresh thread. Choices start blank, as on a first run; the steppers start
 * at the reader's last numbers when there is a profile, else at plain defaults.
 */
export function initialOnboarding(existing?: Profile | null): OnboardingState {
  const p = existing ?? null;
  return {
    answers: {
      consent: null,
      goal: null,
      sex: null,
      age: p?.age ?? DEFAULT_BODY.age,
      heightCm: p?.heightCm ?? DEFAULT_BODY.heightCm,
      weightKg: p?.weightKg ?? DEFAULT_BODY.weightKg,
      bodyFatKnown: true,
      bodyFatPct: p?.bodyFatPct ?? DEFAULT_BODY.bodyFatPct,
      waistKnown: false,
      waistCm: p?.waistCm ?? DEFAULT_BODY.waistCm,
      trainingDays: [],
      trainTime: null,
      noTraining: false,
      work: null,
      effort: p?.effort ?? DEFAULT_EFFORT,
      people: 1,
      shops: [],
      kitchen: [],
      avoid: [],
    },
    step: 0,
  };
}

/** Whether a step has what it needs to move on. */
export function stepDone(a: Answers, id: StepId): boolean {
  switch (id) {
    case "consent":
      return a.consent === "manual";
    case "goal":
      return a.goal !== null;
    case "body":
      return a.sex !== null;
    case "train":
      return (a.trainingDays.length > 0 && a.trainTime !== null) || a.noTraining;
    case "work":
      return a.work !== null;
    case "logistics":
      return a.shops.length > 0 && a.kitchen.length > 0 && a.avoid.length > 0;
  }
}

/** Steps a single tap answers; they move on by themselves. The rest have Next. */
export function stepAdvancesOnPick(id: StepId): boolean {
  return id === "consent" || id === "goal" || id === "work";
}

export type OnboardingAction =
  | { type: "consent"; value: Consent }
  | { type: "goal"; value: Goal }
  | { type: "sex"; value: Sex }
  | { type: "work"; value: Work }
  | { type: "trainTime"; value: TrainTime }
  | { type: "people"; value: number }
  | { type: "toggleDay"; day: number }
  | { type: "noTraining" }
  | { type: "toggle"; field: ListField; value: string }
  | { type: "flag"; field: "bodyFatKnown" | "waistKnown" }
  | { type: "step"; field: StepperField; dir: 1 | -1 }
  | { type: "next" }
  | { type: "goto"; step: number };

const round1 = (x: number) => Math.round(x * 10) / 10;
const clampTo = (field: StepperField, v: number) => {
  const [lo, hi] = LIMITS[field];
  return round1(Math.min(hi, Math.max(lo, v)));
};

function advance(s: OnboardingState): OnboardingState {
  return { ...s, step: Math.min(RESULT_STEP, s.step + 1) };
}

// A pick on the step being asked moves on when it completes it; a pick that
// does not (不同意) stays and shows its reply.
function picked(s: OnboardingState, answers: Answers): OnboardingState {
  const next = { ...s, answers };
  const id = STEPS[s.step];
  return id && stepAdvancesOnPick(id) && stepDone(answers, id) ? advance(next) : next;
}

function toggled(list: readonly string[], value: string): string[] {
  return list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
}

export function onboardingReducer(s: OnboardingState, action: OnboardingAction): OnboardingState {
  const a = s.answers;
  switch (action.type) {
    case "consent":
      return picked(s, { ...a, consent: action.value });
    case "goal":
      return picked(s, { ...a, goal: action.value });
    case "work":
      return picked(s, { ...a, work: action.value });
    case "sex":
      return { ...s, answers: { ...a, sex: action.value } };
    case "trainTime":
      return { ...s, answers: { ...a, trainTime: action.value } };
    case "people":
      return { ...s, answers: { ...a, people: action.value } };
    case "toggleDay": {
      const days = a.trainingDays.includes(action.day)
        ? a.trainingDays.filter((d) => d !== action.day)
        : [...a.trainingDays, action.day].sort((x, y) => x - y);
      return { ...s, answers: { ...a, trainingDays: days, noTraining: false } };
    }
    case "noTraining":
      return { ...s, answers: { ...a, trainingDays: [], trainTime: null, noTraining: true } };
    case "toggle": {
      let list = toggled(a[action.field], action.value);
      if (action.field === "avoid") {
        // 无 and a real dislike exclude each other.
        list =
          action.value === NO_DISLIKES && list.includes(NO_DISLIKES)
            ? [NO_DISLIKES]
            : list.filter((x) => x !== NO_DISLIKES || action.value === NO_DISLIKES);
      }
      return { ...s, answers: { ...a, [action.field]: list } };
    }
    case "flag":
      return { ...s, answers: { ...a, [action.field]: !a[action.field] } };
    case "step": {
      const field = action.field;
      const value = clampTo(field, a[field] + action.dir * STEP_SIZE[field]);
      return { ...s, answers: { ...a, [field]: value } };
    }
    case "next": {
      const id = STEPS[s.step];
      return id && stepDone(a, id) ? advance(s) : s;
    }
    case "goto":
      return action.step >= 0 && action.step < s.step ? { ...s, step: action.step } : s;
  }
}

/** The reader's answer to a step, as the bubble under the question shows it. */
export function answerText(a: Answers, id: StepId): string {
  const sep = t("meals.onboarding.listSep");
  switch (id) {
    case "consent": {
      const o = CONSENT_OPTIONS.find((c) => c.value === a.consent);
      return o ? t(o.label) : "";
    }
    case "goal": {
      const o = GOAL_OPTIONS.find((g) => g.value === a.goal);
      return o ? t(o.label) : "";
    }
    case "body":
      return [
        t(a.sex === "f" ? "meals.onboarding.sex.f" : "meals.onboarding.sex.m"),
        `${a.age} ${t("meals.yearsUnit")}`,
        `${a.heightCm} cm`,
        `${a.weightKg.toFixed(1)} kg`,
        a.bodyFatKnown
          ? t("meals.onboarding.answer.bodyFat", { pct: a.bodyFatPct.toFixed(1) })
          : t("meals.onboarding.answer.bodyFatUnknown"),
        ...(a.waistKnown ? [t("meals.onboarding.answer.waist", { cm: a.waistCm })] : []),
      ].join(" · ");
    case "train": {
      if (!a.trainingDays.length) return t("meals.noTrainingNow");
      const days = t("meals.onboarding.daysJoined", { days: a.trainingDays.map(weekdayLabel).join(sep) });
      const o = TRAIN_TIME_OPTIONS.find((x) => x.value === a.trainTime);
      return `${days} · ${o ? t(o.short) : ""}`;
    }
    case "work": {
      const o = WORK_OPTIONS.find((w) => w.value === a.work);
      return o ? t(o.label) : "";
    }
    case "logistics": {
      const none = a.avoid.length === 1 && a.avoid[0] === NO_DISLIKES;
      return [
        peopleLabel(a.people),
        a.shops.map(optionLabel).join(sep),
        a.kitchen.map(optionLabel).join(sep),
        none ? t("meals.onboarding.avoid.noneAnswer") : a.avoid.map(optionLabel).join(sep),
      ].join(" · ");
    }
  }
}

/** The profile the answers make, or null while any of it is missing or consent was withheld. */
export function toProfile(a: Answers): Profile | null {
  if (a.consent !== "manual") return null;
  if (!a.goal || !a.sex || !a.work) return null;
  if (!stepDone(a, "train") || !stepDone(a, "logistics")) return null;
  const dislikes = a.avoid.flatMap((label) => {
    const tag = AVOID_OPTIONS.find((o) => o.value === label)?.tag;
    return tag ? [tag] : [];
  });
  return {
    consent: a.consent,
    goal: a.goal,
    sex: a.sex,
    age: a.age,
    heightCm: a.heightCm,
    weightKg: a.weightKg,
    ...(a.bodyFatKnown ? { bodyFatPct: a.bodyFatPct } : {}),
    ...(a.waistKnown ? { waistCm: a.waistCm } : {}),
    trainingDays: [...a.trainingDays],
    trainTime: a.trainTime ?? "evening",
    work: a.work,
    effort: a.effort,
    people: a.people,
    shops: [...a.shops],
    kitchen: [...a.kitchen],
    dislikes,
  };
}

/** What the thread says above the targets card. */
export function resultLine(tg: Targets, p: Profile): string {
  let first: string;
  if (tg.trainingDaysPerWeek === 0)
    first = t("meals.onboarding.result.daily", { kcal: tg.rest.kcal, protein: tg.rest.protein });
  else if (tg.trainingDaysPerWeek === 7)
    first = t("meals.onboarding.result.daily", { kcal: tg.training.kcal, protein: tg.training.protein });
  else
    first = t("meals.onboarding.result.mixed", {
      trainingKcal: tg.training.kcal,
      restKcal: tg.rest.kcal,
      protein: tg.training.protein,
    });
  const gap = Math.round(Math.abs(tg.tdeeAverage - tg.weekAverageKcal));
  let second: string;
  if (p.goal === "cut")
    second = t("meals.onboarding.result.cut", { gap, kg: Math.abs(tg.weightChangeKgPerWeek).toFixed(2) });
  else if (p.goal === "gain") second = t("meals.onboarding.result.gain", { gap });
  else second = t("meals.onboarding.result.steady");
  return t("meals.onboarding.result.join", { first, second, third: t("meals.onboarding.result.closing") });
}

/** What the thread opens with. */
export function introLine(): string {
  return t("meals.onboarding.intro");
}

/** The reply to a withheld consent. */
export function noConsentReply(): string {
  return t("meals.onboarding.noConsentReply");
}

/** What the thread asks at a step. */
export function questionText(id: StepId): string {
  switch (id) {
    case "consent":
      return t("meals.onboarding.q.consent");
    case "goal":
      return t("meals.onboarding.q.goal");
    case "body":
      return t("meals.onboarding.q.body");
    case "train":
      return t("meals.onboarding.q.train");
    case "work":
      return t("meals.onboarding.q.work");
    case "logistics":
      return t("meals.onboarding.q.logistics");
  }
}
