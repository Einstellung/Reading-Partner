// Daily calorie and macro targets from the reader's body data
// (docs/research/健身饮食与快手三餐调研.md, 算法 steps 1–8).
//
// Every number here is the program's, never the model's: the plan shows them,
// the solver hits them, and the Method screen works them through with the
// reader's own values, which is why the intermediate steps are returned too.

export type Goal = "cut" | "gain" | "steady";
export type Sex = "m" | "f";
export type Work = "sit" | "stand" | "labor";
export type TrainTime = "morning" | "midday" | "evening";
export type Consent = "health" | "manual" | "no";
/** The BMI cut points and the fat range follow the region, which is never asked. */
export type Region = "CN" | "other";

/** What onboarding collects. Plain data, stored as it is. */
export interface Profile {
  consent: Consent;
  goal: Goal;
  sex: Sex;
  age: number;
  heightCm: number;
  weightKg: number;
  /** Percent, e.g. 18. Absent when unknown. */
  bodyFatPct?: number;
  /** Kept as a trend only; no formula reads it. */
  waistCm?: number;
  /** ISO weekdays, Monday 1 … Sunday 7. Empty when the reader does not train. */
  trainingDays: number[];
  /** Ignored when there are no training days. */
  trainTime: TrainTime;
  work: Work;
  minutesPerMeal: number;
  people: number;
  shops: string[];
  kitchen: string[];
  /** FoodTag values ("beef", "seafood", "spicy"…) are checked by the program; anything else is passed to the model as text. */
  dislikes: string[];
}

export type MealSlot = "breakfast" | "lunch" | "dinner" | "snack";
export type MainMeal = Exclude<MealSlot, "snack">;

export interface MealTarget {
  kcal: number;
  protein: number;
}

export interface DayTargets {
  kind: "training" | "rest";
  pal: number;
  tdee: number;
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
  /** max(0.5 g/kg, 20% of kcal), unrounded: the solver's fat check. */
  fatFloor: number;
  fatCap: number;
  carbFloor: number;
  /** True when the carb floor could only be met by raising kcal above the goal's number. */
  kcalRaisedForCarbs: boolean;
  /** The order the meals are eaten in; the snack follows training on a training day. */
  order: MealSlot[];
  /** The main meal right after training, which takes 5 more points of the day's kcal. */
  postWorkout: MainMeal | null;
  meals: Record<MealSlot, MealTarget>;
}

export type ProteinRule =
  | { kind: "ffm"; perKg: number; ffmKg: number }
  | { kind: "weight"; perKg: number; refWeightKg: number; usesReferenceWeight: boolean };

export interface Targets {
  region: Region;
  bmi: number;
  bmiCuts: { overweight: number; obese: number };
  bmiClass: "normal" | "overweight" | "obese";
  ffm: number | null;
  bmr: number;
  bmrFormula: "cunningham" | "mifflin";
  /** Always computed, so the Method screen can show what the other formula gives. */
  mifflin: number;
  trainingDaysPerWeek: number;
  palBase: number;
  palTraining: number;
  palRest: number;
  palAverage: number;
  tdeeTraining: number;
  tdeeRest: number;
  tdeeAverage: number;
  /** The goal's average daily kcal before the training/rest split and rounding. */
  weeklyKcal: number;
  /** kcal/day under the average TDEE; 0 unless cutting. */
  deficit: number;
  cutRule: "weight-percent" | "overweight-85" | "obese-80" | null;
  /** max(BMR, 1200 men / 1000 women); applied to each day when cutting. */
  kcalFloor: number;
  protein: number;
  proteinRule: ProteinRule;
  proteinFloor: number;
  proteinCap: number;
  fatDefaultPct: number;
  fatCapPct: number;
  training: DayTargets;
  rest: DayTargets;
  /** Average of the seven days' rounded targets. */
  weekAverageKcal: number;
  /** Expected change at the planned intake, kg a week; negative is a loss. */
  weightChangeKgPerWeek: number;
}

const BMI_CUTS: Record<Region, { overweight: number; obese: number }> = {
  CN: { overweight: 24, obese: 28 },
  other: { overweight: 25, obese: 30 },
};
const FAT_PCT: Record<Region, { default: number; cap: number }> = {
  CN: { default: 0.25, cap: 0.3 },
  other: { default: 0.3, cap: 0.35 },
};
const PAL_BASE: Record<Work, number> = { sit: 1.4, stand: 1.6, labor: 1.8 };
const KCAL_PER_KG = 7700;

/** Share of the day's kcal per meal before the post-workout shift. */
export const MEAL_SHARE: Readonly<Record<MealSlot, number>> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.3,
  snack: 0.1,
};
const POST_WORKOUT_SHIFT = 0.05;

const r5 = (x: number) => Math.round(x / 5) * 5;
const r50 = (x: number) => Math.round(x / 50) * 50;
const ceil5 = (x: number) => Math.ceil(x / 5) * 5;
const floor5 = (x: number) => Math.floor(x / 5) * 5;

function bodyFatInRange(sex: Sex, pct: number | undefined): pct is number {
  if (pct == null || !Number.isFinite(pct)) return false;
  return sex === "m" ? pct >= 5 && pct <= 45 : pct >= 10 && pct <= 55;
}

export function isTrainingDay(profile: Pick<Profile, "trainingDays">, isoWeekday: number): boolean {
  return profile.trainingDays.includes(isoWeekday);
}

/** Meal order for one day and which main meal follows training. */
export function dayPlan(
  isTraining: boolean,
  trainTime: TrainTime,
): { order: MealSlot[]; postWorkout: MainMeal | null } {
  if (!isTraining) return { order: ["breakfast", "lunch", "snack", "dinner"], postWorkout: null };
  if (trainTime === "morning") return { order: ["snack", "breakfast", "lunch", "dinner"], postWorkout: "breakfast" };
  if (trainTime === "midday") return { order: ["breakfast", "snack", "lunch", "dinner"], postWorkout: "lunch" };
  return { order: ["breakfast", "lunch", "snack", "dinner"], postWorkout: "dinner" };
}

/**
 * One day's kcal and protein split over the four meals. The snack gets
 * min(10 g, 10%) of the protein and the three meals share the rest evenly;
 * the post-workout meal takes 5 points of kcal from the other two main meals
 * in proportion to their shares.
 */
export function mealTargets(
  day: { kcal: number; protein: number },
  postWorkout: MainMeal | null,
): Record<MealSlot, MealTarget> {
  const snackP = Math.min(10, day.protein * 0.1);
  const mainP = (day.protein - snackP) / 3;
  const share: Record<MealSlot, number> = { ...MEAL_SHARE };
  if (postWorkout) {
    const others = (["breakfast", "lunch", "dinner"] as const).filter((m) => m !== postWorkout);
    const pool = others.reduce((s, m) => s + MEAL_SHARE[m], 0);
    for (const m of others) share[m] = MEAL_SHARE[m] - (POST_WORKOUT_SHIFT * MEAL_SHARE[m]) / pool;
    share[postWorkout] = MEAL_SHARE[postWorkout] + POST_WORKOUT_SHIFT;
  }
  const t = (m: MealSlot): MealTarget => ({ kcal: day.kcal * share[m], protein: m === "snack" ? snackP : mainP });
  return { breakfast: t("breakfast"), lunch: t("lunch"), dinner: t("dinner"), snack: t("snack") };
}

export function computeTargets(profile: Profile, region: Region): Targets {
  const W = profile.weightKg;
  const H = profile.heightCm;
  const male = profile.sex === "m";
  const cuts = BMI_CUTS[region];
  const fatPct = FAT_PCT[region];

  // 1. BMR
  const bmi = W / (H / 100) ** 2;
  const bfOk = bodyFatInRange(profile.sex, profile.bodyFatPct);
  const ffm = bfOk ? W * (1 - (profile.bodyFatPct as number) / 100) : null;
  const mifflin = 10 * W + 6.25 * H - 5 * profile.age + (male ? 5 : -161);
  const bmr = ffm != null ? 22 * ffm + 500 : mifflin;

  // 2. Activity
  const nTrain = new Set(profile.trainingDays.filter((d) => d >= 1 && d <= 7)).size;
  const palBase = PAL_BASE[profile.work];
  const palTraining = Math.min(2.0, palBase + 0.2);
  const palRest = palBase;
  const palAverage = (nTrain * palTraining + (7 - nTrain) * palRest) / 7;
  const tdeeTraining = bmr * palTraining;
  const tdeeRest = bmr * palRest;
  const tdeeAverage = bmr * palAverage;

  // 3. Calories
  const bmiClass = bmi < cuts.overweight ? "normal" : bmi < cuts.obese ? "overweight" : "obese";
  let weeklyKcal = tdeeAverage;
  let deficit = 0;
  let cutRule: Targets["cutRule"] = null;
  if (profile.goal === "cut") {
    if (bmiClass === "normal") {
      deficit = (0.005 * W * KCAL_PER_KG) / 7;
      weeklyKcal = tdeeAverage - deficit;
      cutRule = "weight-percent";
    } else {
      weeklyKcal = tdeeAverage * (bmiClass === "overweight" ? 0.85 : 0.8);
      deficit = tdeeAverage - weeklyKcal;
      cutRule = bmiClass === "overweight" ? "overweight-85" : "obese-80";
    }
  } else if (profile.goal === "gain") {
    weeklyKcal = tdeeAverage * 1.1;
  }
  const kcalFloor = Math.max(bmr, male ? 1200 : 1000);
  const dayKcal = (pal: number) => {
    let k = (weeklyKcal * pal) / palAverage;
    if (profile.goal === "cut") k = Math.max(k, kcalFloor);
    return r50(k);
  };

  // 4. Protein
  const trains = nTrain >= 2;
  const overweightRef = cuts.overweight * (H / 100) ** 2;
  const usesReferenceWeight = bmi >= cuts.overweight;
  const refWeightKg = usesReferenceWeight ? overweightRef : W;
  let proteinRule: ProteinRule;
  let rawProtein: number;
  if (profile.goal === "cut" && trains && ffm != null) {
    proteinRule = { kind: "ffm", perKg: 2.3, ffmKg: ffm };
    rawProtein = 2.3 * ffm;
  } else {
    const perKg =
      profile.goal === "cut" ? (trains ? 1.8 : 1.4) : profile.goal === "gain" ? (trains ? 1.8 : 1.6) : trains ? 1.4 : 1.2;
    proteinRule = { kind: "weight", perKg, refWeightKg, usesReferenceWeight };
    rawProtein = perKg * refWeightKg;
  }
  const proteinFloor = male ? 65 : 55;
  const proteinCap = Math.min(2.2 * W, ffm != null ? 3.1 * ffm : Infinity);
  const protein = r5(Math.min(proteinCap, Math.max(proteinFloor, rawProtein)));

  // 5–6. Fat and carbs, 8. meal split
  const carbFloor = profile.goal === "gain" && trains ? Math.max(130, 3 * W) : 130;
  const day = (kind: "training" | "rest"): DayTargets => {
    const pal = kind === "training" ? palTraining : palRest;
    let kcal = dayKcal(pal);
    const fatFloor = Math.max(0.5 * W, (0.2 * kcal) / 9);
    const fatCap = (fatPct.cap * kcal) / 9;
    const fatMin = ceil5(fatFloor);
    let fat = Math.max(fatMin, Math.min(r5((fatPct.default * kcal) / 9), fatCap));
    let carbs = (kcal - 4 * protein - 9 * fat) / 4;
    let kcalRaisedForCarbs = false;
    if (carbs < carbFloor) {
      // Rounded down, so the rounding cannot undo the room just made for carbs.
      fat = Math.max(fatMin, floor5((kcal - 4 * protein - 4 * carbFloor) / 9));
      carbs = (kcal - 4 * protein - 9 * fat) / 4;
      if (carbs < carbFloor) {
        kcal = Math.ceil((4 * protein + 9 * fat + 4 * carbFloor) / 50) * 50;
        carbs = (kcal - 4 * protein - 9 * fat) / 4;
        kcalRaisedForCarbs = true;
      }
    }
    const { order, postWorkout } = dayPlan(kind === "training", profile.trainTime);
    return {
      kind,
      pal,
      tdee: bmr * pal,
      kcal,
      protein,
      fat,
      carbs: r5(carbs),
      fatFloor,
      fatCap,
      carbFloor,
      kcalRaisedForCarbs,
      order,
      postWorkout,
      meals: mealTargets({ kcal, protein }, postWorkout),
    };
  };
  const training = day("training");
  const rest = day("rest");
  const weekAverageKcal = (nTrain * training.kcal + (7 - nTrain) * rest.kcal) / 7;

  return {
    region,
    bmi,
    bmiCuts: cuts,
    bmiClass,
    ffm,
    bmr,
    bmrFormula: ffm != null ? "cunningham" : "mifflin",
    mifflin,
    trainingDaysPerWeek: nTrain,
    palBase,
    palTraining,
    palRest,
    palAverage,
    tdeeTraining,
    tdeeRest,
    tdeeAverage,
    weeklyKcal,
    deficit,
    cutRule,
    kcalFloor,
    protein,
    proteinRule,
    proteinFloor,
    proteinCap,
    fatDefaultPct: fatPct.default,
    fatCapPct: fatPct.cap,
    training,
    rest,
    weekAverageKcal,
    weightChangeKgPerWeek: ((weekAverageKcal - tdeeAverage) * 7) / KCAL_PER_KG,
  };
}

/** The targets for one calendar day, by ISO weekday. */
export function targetsForWeekday(targets: Targets, profile: Pick<Profile, "trainingDays">, isoWeekday: number): DayTargets {
  return isTrainingDay(profile, isoWeekday) ? targets.training : targets.rest;
}
