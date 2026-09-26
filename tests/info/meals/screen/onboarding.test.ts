import { describe, expect, test } from "bun:test";

import { computeTargets } from "../../../../src/info/meals/nutrition/targets";
import {
  RESULT_STEP,
  STEPS,
  answerText,
  initialOnboarding,
  onboardingReducer,
  resultLine,
  toProfile,
  type OnboardingAction,
  type OnboardingState,
} from "../../../../src/info/meals/screen/onboarding";
import { profile } from "../fixtures/week";

const run = (actions: OnboardingAction[], s: OnboardingState = initialOnboarding()) =>
  actions.reduce(onboardingReducer, s);

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

  test("不同意 stays on consent", () => {
    const s = run([{ type: "consent", value: "no" }]);
    expect(s.step).toBe(0);
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

describe("answer lines", () => {
  test("each step's answer reads as in the prototype", () => {
    const a = run(EXAMPLE).answers;
    expect(answerText(a, "consent")).toBe("同意");
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
