import { describe, expect, test } from "bun:test";

import type { BodyMeasurements } from "../../../src/platform/app/health";
import { computeTargets } from "../../../src/info/meals/nutrition/targets";
import {
  RESULT_STEP,
  STEPS,
  answerText,
  bodyFromHealth,
  initialOnboarding,
  onboardingReducer,
  questionText,
  resultLine,
  toProfile,
  weightRangeLabel,
  type OnboardingAction,
  type OnboardingState,
} from "../../../src/info/meals/onboarding";
import { profile } from "./fixtures/week";

const run = (actions: OnboardingAction[], s: OnboardingState = initialOnboarding()) =>
  actions.reduce(onboardingReducer, s);

const HEALTH: BodyMeasurements = {
  heightCm: 175.4,
  weightKg: 72.26,
  weightFrom: "2026-09-16",
  weightTo: "2026-09-22",
  bodyFatPct: 18,
  waistCm: null,
  sex: "m",
  age: 30,
};

// The prototype's example: a man cutting, training Mon/Wed/Fri evenings.
const EXAMPLE: OnboardingAction[] = [
  { type: "consent", value: "manual" },
  { type: "goal", value: "cut" },
  { type: "sex", value: "m" },
  { type: "next" },
  { type: "toggleDay", day: 5 },
  { type: "toggleDay", day: 1 },
  { type: "toggleDay", day: 3 },
  { type: "trainTime", value: "evening" },
  { type: "next" },
  { type: "work", value: "sit" },
  { type: "minutes", value: 10 },
  { type: "toggle", field: "shops", value: "超市" },
  { type: "toggle", field: "kitchen", value: "微波炉" },
  { type: "toggle", field: "avoid", value: "不吃牛肉" },
  { type: "next" },
];

describe("onboarding steps", () => {
  test("single-tap steps move on, Next steps wait for their answer", () => {
    let s = run([{ type: "consent", value: "manual" }]);
    expect(STEPS[s.step]).toBe("goal");
    s = run([{ type: "goal", value: "gain" }], s);
    expect(STEPS[s.step]).toBe("body");
    expect(run([{ type: "next" }], s).step).toBe(s.step); // no sex yet
    s = run([{ type: "sex", value: "f" }, { type: "next" }], s);
    expect(STEPS[s.step]).toBe("train");
  });

  test("不同意 stays on consent and asks for no Apple Health read", () => {
    const s = run([{ type: "consent", value: "no" }]);
    expect(s.step).toBe(0);
    expect(s.health).toBe("idle");
    expect(toProfile(s.answers)).toBeNull();
  });

  test("the example runs to the result and makes a profile", () => {
    const s = run(EXAMPLE);
    expect(s.step).toBe(RESULT_STEP);
    const p = toProfile(s.answers);
    expect(p).toMatchObject({
      consent: "manual",
      goal: "cut",
      sex: "m",
      trainingDays: [1, 3, 5],
      trainTime: "evening",
      work: "sit",
      minutesPerMeal: 10,
      dislikes: ["beef"],
      bodyFatPct: 20,
    });
    expect(p && "waistCm" in p).toBe(false);
  });

  test("tapping an earlier answer returns to that step and keeps the answers", () => {
    const s = run([...EXAMPLE, { type: "goto", step: 1 }]);
    expect(STEPS[s.step]).toBe("goal");
    expect(s.answers.work).toBe("sit");
    // A later step cannot be jumped to.
    expect(run([{ type: "goto", step: 5 }], s).step).toBe(1);
  });

  test("现在不练 answers training with no days", () => {
    const s = run([
      { type: "consent", value: "manual" },
      { type: "goal", value: "steady" },
      { type: "sex", value: "f" },
      { type: "next" },
      { type: "toggleDay", day: 2 },
      { type: "noTraining" },
      { type: "next" },
    ]);
    expect(STEPS[s.step]).toBe("work");
    expect(s.answers.trainingDays).toEqual([]);
    expect(answerText(s.answers, "train")).toBe("现在不练");
  });

  test("无 and a real dislike exclude each other", () => {
    let s = run([{ type: "toggle", field: "avoid", value: "不吃辣" }]);
    s = run([{ type: "toggle", field: "avoid", value: "无" }], s);
    expect(s.answers.avoid).toEqual(["无"]);
    s = run([{ type: "toggle", field: "avoid", value: "不吃海鲜" }], s);
    expect(s.answers.avoid).toEqual(["不吃海鲜"]);
  });

  test("steppers clamp to their range", () => {
    const s = run(Array.from({ length: 200 }, () => ({ type: "step", field: "age", dir: -1 }) as const));
    expect(s.answers.age).toBe(16);
    expect(run([{ type: "step", field: "weightKg", dir: 1 }]).answers.weightKg).toBe(65.5);
  });

  test("a replay starts its steppers at the last profile, its choices blank", () => {
    const s = initialOnboarding(profile({ heightCm: 181, weightKg: 80, bodyFatPct: 15 }));
    expect(s.answers.heightCm).toBe(181);
    expect(s.answers.weightKg).toBe(80);
    expect(s.answers.bodyFatPct).toBe(15);
    expect(s.answers.goal).toBeNull();
  });
});

describe("Apple Health", () => {
  test("agreeing to Apple Health asks for one read", () => {
    let s = run([{ type: "consent", value: "health" }]);
    expect(s.health).toBe("pending");
    s = run([{ type: "goto", step: 0 }, { type: "consent", value: "health" }], { ...s, health: "done" });
    expect(s.health).toBe("done");
  });

  test("its numbers prefill the body step with badges and the 7-day range", () => {
    const s = run([{ type: "consent", value: "health" }, { type: "health", measurements: HEALTH }]);
    expect(s.answers).toMatchObject({ heightCm: 175, weightKg: 72.3, bodyFatPct: 18, sex: "m", age: 30 });
    expect(s.fromHealth).toEqual({ heightCm: true, weightKg: true, bodyFatPct: true, sex: true, age: true });
    expect(bodyFromHealth(s)).toBe(true);
    expect(questionText(s, "body")).toContain("Apple 健康");
    expect(weightRangeLabel(s.weightFrom, s.weightTo)).toBe("7-day avg, Sep 16–22");
  });

  test("changing a prefilled number drops its badge", () => {
    const s = run([
      { type: "consent", value: "health" },
      { type: "health", measurements: HEALTH },
      { type: "step", field: "weightKg", dir: -1 },
    ]);
    expect(s.answers.weightKg).toBe(71.8);
    expect(s.fromHealth.weightKg).toBeUndefined();
    expect(s.fromHealth.heightCm).toBe(true);
  });

  test("nothing from Health leaves the manual values and no badge", () => {
    const s = run([{ type: "consent", value: "health" }, { type: "health", measurements: null }]);
    expect(s.health).toBe("done");
    expect(s.answers.heightCm).toBe(170);
    expect(bodyFromHealth(s)).toBe(false);
    expect(questionText(s, "body")).not.toContain("Apple 健康");
  });

  test("the range label spans months and single days", () => {
    expect(weightRangeLabel("2026-08-30", "2026-09-05")).toBe("7-day avg, Aug 30–Sep 5");
    expect(weightRangeLabel("2026-09-22", "2026-09-22")).toBe("7-day avg, Sep 22");
    expect(weightRangeLabel(null, "2026-09-22")).toBeNull();
  });
});

describe("answer lines", () => {
  test("each step's answer reads as in the prototype", () => {
    const a = run(EXAMPLE).answers;
    expect(answerText(a, "consent")).toBe("同意，我自己填");
    expect(answerText(a, "goal")).toBe("减脂");
    expect(answerText(a, "body")).toBe("男 · 30 岁 · 170 cm · 65.0 kg · 体脂 20.0%");
    expect(answerText(a, "train")).toBe("周一、三、五 · 下班后");
    expect(answerText(a, "minutes")).toBe("10 分钟");
    expect(answerText(a, "logistics")).toBe("1 人 · 超市 · 微波炉 · 不吃牛肉");
  });

  test("the result line gives both days and the weekly gap", () => {
    const p = toProfile(run(EXAMPLE).answers);
    if (!p) throw new Error("no profile");
    const t = computeTargets(p, "CN");
    const line = resultLine(t, p);
    expect(line).toContain(`练的那天 ${t.training.kcal} kcal`);
    expect(line).toContain(`休息日 ${t.rest.kcal} kcal`);
    expect(line).toContain("比维持量少");
  });
});
