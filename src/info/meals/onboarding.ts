// The Meals onboarding (docs/73 首次): a scripted, tap-only thread that asks
// for consent, the goal, the body, training, work, minutes per meal and the
// week's logistics, then shows the daily targets. Every step's rule, its answer
// line and the profile it ends in are here, so MealsOnboarding.tsx only draws
// the thread and dispatches taps.

import type { BodyMeasurements } from "../../platform/app/health";
import type { FoodTag } from "./nutrition/foods";
import type { Consent, Goal, Profile, Sex, Targets, TrainTime, Work } from "./nutrition/targets";

export const STEPS = ["consent", "goal", "body", "train", "work", "minutes", "logistics"] as const;
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
  minutesPerMeal: number | null;
  people: number;
  shops: string[];
  kitchen: string[];
  avoid: string[];
}

/** Which body fields came from Apple Health and are still as it gave them. */
export type HealthFields = Partial<Record<StepperField | "sex", true>>;

export interface OnboardingState {
  answers: Answers;
  // The step being asked; RESULT_STEP once every question is answered.
  step: number;
  // "pending" from the moment the reader agrees to Apple Health until the one
  // read has come back; the screen makes that read when it sees "pending".
  health: "idle" | "pending" | "done";
  fromHealth: HealthFields;
  // The days the 7-day weight mean covers, when it came from Apple Health.
  weightFrom: string | null;
  weightTo: string | null;
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

export const ZH_WEEKDAY = ["", "一", "二", "三", "四", "五", "六", "日"];

export const CONSENT_OPTIONS: readonly { value: Consent; label: string }[] = [
  { value: "health", label: "同意，从 Apple 健康读" },
  { value: "manual", label: "同意，我自己填" },
  { value: "no", label: "不同意" },
];
export const GOAL_OPTIONS: readonly { value: Goal; label: string; sub: string }[] = [
  { value: "cut", label: "减脂", sub: "每周掉体重的 0.5% 左右，蛋白拉高保肌肉" },
  { value: "gain", label: "增肌", sub: "比维持量多吃 10%，练的那天多给" },
  { value: "steady", label: "精力稳", sub: "吃够维持量，三餐匀开，不犯困" },
];
export const SEX_OPTIONS: readonly { value: Sex; label: string }[] = [
  { value: "m", label: "男" },
  { value: "f", label: "女" },
];
export const TRAIN_TIME_OPTIONS: readonly { value: TrainTime; label: string; short: string }[] = [
  { value: "morning", label: "早上上班前", short: "早上" },
  { value: "midday", label: "午休", short: "午休" },
  { value: "evening", label: "下班后", short: "下班后" },
];
export const WORK_OPTIONS: readonly { value: Work; label: string; sub: string }[] = [
  { value: "sit", label: "大多坐着", sub: "办公室、开车" },
  { value: "stand", label: "常站或走", sub: "店员、老师、护士" },
  { value: "labor", label: "体力活", sub: "搬运、工地、农活" },
];
export const MINUTES_OPTIONS: readonly number[] = [5, 10, 15];
export const PEOPLE_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1, label: "1 人" },
  { value: 2, label: "2 人" },
  { value: 3, label: "3 人" },
  { value: 4, label: "4 人以上" },
];
export const SHOP_OPTIONS: readonly string[] = ["超市", "网上", "菜市场", "便利店"];
export const KITCHEN_OPTIONS: readonly string[] = ["一口锅", "微波炉", "电压力锅", "烤箱", "空气炸锅"];
export const NO_DISLIKES = "无";
// Each dislike and the food tag the program checks it by.
export const AVOID_OPTIONS: readonly { label: string; tag: FoodTag | null }[] = [
  { label: NO_DISLIKES, tag: null },
  { label: "不吃牛肉", tag: "beef" },
  { label: "不吃海鲜", tag: "seafood" },
  { label: "不吃辣", tag: "spicy" },
];

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
      minutesPerMeal: null,
      people: 1,
      shops: [],
      kitchen: [],
      avoid: [],
    },
    step: 0,
    health: "idle",
    fromHealth: {},
    weightFrom: null,
    weightTo: null,
  };
}

/** Whether a step has what it needs to move on. */
export function stepDone(a: Answers, id: StepId): boolean {
  switch (id) {
    case "consent":
      return a.consent === "health" || a.consent === "manual";
    case "goal":
      return a.goal !== null;
    case "body":
      return a.sex !== null;
    case "train":
      return (a.trainingDays.length > 0 && a.trainTime !== null) || a.noTraining;
    case "work":
      return a.work !== null;
    case "minutes":
      return a.minutesPerMeal !== null;
    case "logistics":
      return a.shops.length > 0 && a.kitchen.length > 0 && a.avoid.length > 0;
  }
}

/** Steps a single tap answers; they move on by themselves. The rest have Next. */
export function stepAdvancesOnPick(id: StepId): boolean {
  return id === "consent" || id === "goal" || id === "work" || id === "minutes";
}

export type OnboardingAction =
  | { type: "consent"; value: Consent }
  | { type: "goal"; value: Goal }
  | { type: "sex"; value: Sex }
  | { type: "work"; value: Work }
  | { type: "minutes"; value: number }
  | { type: "trainTime"; value: TrainTime }
  | { type: "people"; value: number }
  | { type: "toggleDay"; day: number }
  | { type: "noTraining" }
  | { type: "toggle"; field: ListField; value: string }
  | { type: "flag"; field: "bodyFatKnown" | "waistKnown" }
  | { type: "step"; field: StepperField; dir: 1 | -1 }
  | { type: "next" }
  | { type: "goto"; step: number }
  | { type: "health"; measurements: BodyMeasurements | null };

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

/** Apple Health's numbers into the body step, each within the stepper's range. */
function withHealth(s: OnboardingState, m: BodyMeasurements | null): OnboardingState {
  if (!m) return { ...s, health: "done" };
  const a = { ...s.answers };
  const from: HealthFields = {};
  if (m.heightCm !== null) {
    a.heightCm = clampTo("heightCm", Math.round(m.heightCm));
    from.heightCm = true;
  }
  if (m.weightKg !== null) {
    a.weightKg = clampTo("weightKg", m.weightKg);
    from.weightKg = true;
  }
  if (m.bodyFatPct !== null) {
    a.bodyFatPct = clampTo("bodyFatPct", m.bodyFatPct);
    a.bodyFatKnown = true;
    from.bodyFatPct = true;
  }
  if (m.waistCm !== null) {
    a.waistCm = clampTo("waistCm", Math.round(m.waistCm));
    a.waistKnown = true;
    from.waistCm = true;
  }
  if (m.age !== null) {
    a.age = clampTo("age", m.age);
    from.age = true;
  }
  if (m.sex !== null) {
    a.sex = m.sex;
    from.sex = true;
  }
  return {
    ...s,
    answers: a,
    health: "done",
    fromHealth: from,
    weightFrom: from.weightKg ? m.weightFrom : null,
    weightTo: from.weightKg ? m.weightTo : null,
  };
}

export function onboardingReducer(s: OnboardingState, action: OnboardingAction): OnboardingState {
  const a = s.answers;
  switch (action.type) {
    case "consent": {
      const next = picked(s, { ...a, consent: action.value });
      return action.value === "health" && s.health === "idle" ? { ...next, health: "pending" } : next;
    }
    case "goal":
      return picked(s, { ...a, goal: action.value });
    case "work":
      return picked(s, { ...a, work: action.value });
    case "minutes":
      return picked(s, { ...a, minutesPerMeal: action.value });
    case "sex": {
      const { sex: _dropped, ...rest } = s.fromHealth;
      return { ...s, answers: { ...a, sex: action.value }, fromHealth: action.value === a.sex ? s.fromHealth : rest };
    }
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
      const { [field]: _dropped, ...rest } = s.fromHealth;
      return { ...s, answers: { ...a, [field]: value }, fromHealth: rest };
    }
    case "next": {
      const id = STEPS[s.step];
      return id && stepDone(a, id) ? advance(s) : s;
    }
    case "goto":
      return action.step >= 0 && action.step < s.step ? { ...s, step: action.step } : s;
    case "health":
      return withHealth(s, action.measurements);
  }
}

/** Whether the body step shows Apple Health's numbers. */
export function bodyFromHealth(s: OnboardingState): boolean {
  return s.answers.consent === "health" && Object.keys(s.fromHealth).length > 0;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthDay(date: string): { month: string; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return { month: MONTHS[Number(m[2]) - 1] ?? "", day: Number(m[3]) };
}

/** "7-day avg, Sep 16–22" under the weight from Apple Health. */
export function weightRangeLabel(from: string | null, to: string | null): string | null {
  const a = from ? monthDay(from) : null;
  const b = to ? monthDay(to) : null;
  if (!a || !b) return null;
  const range =
    from === to
      ? `${a.month} ${a.day}`
      : a.month === b.month
        ? `${a.month} ${a.day}–${b.day}`
        : `${a.month} ${a.day}–${b.month} ${b.day}`;
  return `7-day avg, ${range}`;
}

/** The reader's answer to a step, as the bubble under the question shows it. */
export function answerText(a: Answers, id: StepId): string {
  switch (id) {
    case "consent":
      return CONSENT_OPTIONS.find((o) => o.value === a.consent)?.label ?? "";
    case "goal":
      return GOAL_OPTIONS.find((o) => o.value === a.goal)?.label ?? "";
    case "body":
      return (
        `${a.sex === "f" ? "女" : "男"} · ${a.age} 岁 · ${a.heightCm} cm · ${a.weightKg.toFixed(1)} kg` +
        (a.bodyFatKnown ? ` · 体脂 ${a.bodyFatPct.toFixed(1)}%` : " · 体脂不知道") +
        (a.waistKnown ? ` · 腰围 ${a.waistCm} cm` : "")
      );
    case "train": {
      if (!a.trainingDays.length) return "现在不练";
      const days = a.trainingDays.map((d) => ZH_WEEKDAY[d]).join("、");
      const time = TRAIN_TIME_OPTIONS.find((o) => o.value === a.trainTime)?.short ?? "";
      return `周${days} · ${time}`;
    }
    case "work":
      return WORK_OPTIONS.find((o) => o.value === a.work)?.label ?? "";
    case "minutes":
      return `${a.minutesPerMeal ?? ""} 分钟`;
    case "logistics": {
      const people = a.people >= 4 ? "4 人以上" : `${a.people} 人`;
      const avoid = a.avoid.length === 1 && a.avoid[0] === NO_DISLIKES ? "无忌口" : a.avoid.join("、");
      return `${people} · ${a.shops.join("、")} · ${a.kitchen.join("、")} · ${avoid}`;
    }
  }
}

/** The profile the answers make, or null while any of it is missing or consent was withheld. */
export function toProfile(a: Answers): Profile | null {
  if (a.consent !== "health" && a.consent !== "manual") return null;
  if (!a.goal || !a.sex || !a.work || a.minutesPerMeal === null) return null;
  if (!stepDone(a, "train") || !stepDone(a, "logistics")) return null;
  const dislikes = a.avoid.flatMap((label) => {
    const tag = AVOID_OPTIONS.find((o) => o.label === label)?.tag;
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
    minutesPerMeal: a.minutesPerMeal,
    people: a.people,
    shops: [...a.shops],
    kitchen: [...a.kitchen],
    dislikes,
  };
}

/** What the thread says above the targets card. */
export function resultLine(t: Targets, p: Profile): string {
  let say: string;
  if (t.trainingDaysPerWeek === 0) say = `算好了。每天 ${t.rest.kcal} kcal，蛋白 ${t.rest.protein} g。`;
  else if (t.trainingDaysPerWeek === 7) say = `算好了。每天 ${t.training.kcal} kcal，蛋白 ${t.training.protein} g。`;
  else
    say = `算好了。练的那天 ${t.training.kcal} kcal，休息日 ${t.rest.kcal} kcal，蛋白每天都是 ${t.training.protein} g。`;
  const gap = Math.round(Math.abs(t.tdeeAverage - t.weekAverageKcal));
  if (p.goal === "cut")
    say += `一周平均每天比维持量少 ${gap} kcal，大约每周掉 ${Math.abs(t.weightChangeKgPerWeek).toFixed(2)} kg。`;
  else if (p.goal === "gain") say += `一周平均每天比维持量多 ${gap} kcal。`;
  else say += "按维持量吃。";
  return say + "体重变了在对话里说一声，我重算。";
}

export const INTRO_LINE = "先问几个问题，都是点选，一两分钟。答完我算出你每天的热量和蛋白，再排这一周。";
export const NO_CONSENT_REPLY = "好，不存身体数据。那就算不了热量，只能按份量给你排。改主意了点上面那条回答。";

/** What the thread asks at a step. */
export function questionText(s: OnboardingState, id: StepId): string {
  switch (id) {
    case "consent":
      return "排之前要用到你的体重和体脂。这两项属于健康信息，先单独问你要不要给。";
    case "goal":
      return "这段时间主要想要什么？";
    case "body":
      return bodyFromHealth(s)
        ? "身体数据。身高、体重和体脂我从 Apple 健康读到了（体重和体脂取最近 7 天平均），不对就改。体脂和腰围不知道可以不填。"
        : "身体数据。点加减调到你的数。体脂和腰围不知道可以不填。";
    case "train":
      return "每周哪几天练？一般什么时候练？练的那天加餐会挪到练完之后。";
    case "work":
      return "不算训练，平时上班大多是什么状态？";
    case "minutes":
      return "每顿最多肯花几分钟动手？我按这个挑菜，超过的不排。";
    case "logistics":
      return "最后几件杂事，一屏点完。";
  }
}
