import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { getLocale, LOCALES, setLocale, type Locale } from "../../../src/i18n";
import { AREAS } from "../../../src/i18n/areas";
import { computeTargets } from "../../../src/meals/nutrition/targets";
import {
  AVOID_OPTIONS,
  KITCHEN_OPTIONS,
  RESULT_STEP,
  SHOP_OPTIONS,
  STEPS,
  answerText,
  initialOnboarding,
  introLine,
  noConsentReply,
  onboardingReducer,
  optionLabel,
  questionText,
  resultLine,
  toProfile,
  type OnboardingAction,
  type OnboardingState,
} from "../../../src/meals/screen/onboarding";
import { profile } from "../fixtures/week";

// The tests up to "the thread follows the UI language" pin the original
// Chinese lines, so they run in zh-CN; the rest switch the locale themselves.
const initialLocale: Locale = getLocale();
beforeEach(() => setLocale("zh-CN"));
afterEach(() => setLocale(initialLocale));

const run =(actions: OnboardingAction[], s: OnboardingState = initialOnboarding()) =>
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
      effort: "simple",
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

  test("nothing asks for minutes: work leads to the logistics, and the level starts simple", () => {
    expect(STEPS as readonly string[]).not.toContain("minutes");
    const s = run(EXAMPLE.slice(0, EXAMPLE.findIndex((a) => a.type === "work") + 1));
    expect(STEPS[s.step]).toBe("logistics");
    expect(toProfile(run(EXAMPLE).answers)?.effort).toBe("simple");
  });

  test("a replay keeps the effort level the conversation set", () => {
    const s = initialOnboarding(profile({ effort: "homestyle" }));
    expect(toProfile(run(EXAMPLE, s).answers)?.effort).toBe("homestyle");
  });
});

describe("answer lines", () => {
  test("each step's answer reads as in the prototype", () => {
    const a = run(EXAMPLE).answers;
    expect(answerText(a, "consent")).toBe("同意");
    expect(answerText(a, "goal")).toBe("减脂");
    expect(answerText(a, "body")).toBe("男 · 30 岁 · 170 cm · 65.0 kg · 体脂 20.0%");
    expect(answerText(a, "train")).toBe("周一、三、五 · 下班后");
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

describe("the thread follows the UI language", () => {
  const CJK = /[㐀-鿿぀-ヿ가-힯]/;
  const answers = run(EXAMPLE).answers;
  const exampleProfile = () => {
    const p = toProfile(answers);
    if (!p) throw new Error("no profile");
    return p;
  };

  test("zh-CN keeps the original lines", () => {
    expect(introLine()).toBe("先问几个问题，都是点选，一两分钟。答完我算出你每天的热量和蛋白，再排这一周。");
    expect(noConsentReply()).toBe("好，不存身体数据。那就算不了热量，只能按份量给你排。改主意了点上面那条回答。");
    expect(questionText("consent")).toBe("排之前要用到你的体重和体脂。这两项属于健康信息，先单独问你要不要给。");
    expect(questionText("logistics")).toBe("最后几件杂事，一屏点完。");
    expect(optionLabel("不吃辣")).toBe("不吃辣");
    expect(optionLabel("电压力锅")).toBe("电压力锅");
    expect(answerText({ ...answers, avoid: ["无"] }, "logistics")).toBe("1 人 · 超市 · 微波炉 · 无忌口");
  });

  test("English shows English everywhere, and the stored words do not change", () => {
    setLocale("en");
    expect(introLine()).toContain("A few questions first");
    expect(noConsentReply()).toContain("I won't keep any body data");
    for (const id of STEPS) expect(questionText(id)).not.toMatch(CJK);
    expect(answerText(answers, "consent")).toBe("Agree");
    expect(answerText(answers, "goal")).toBe("Lose fat");
    expect(answerText(answers, "body")).toBe("Male · 30 yr · 170 cm · 65.0 kg · Body fat 20.0%");
    expect(answerText(answers, "train")).toBe("Mon, Wed, Fri · After work");
    expect(answerText(answers, "logistics")).toBe("1 person · Supermarket · Microwave · No beef");
    expect(answerText({ ...answers, trainingDays: [], noTraining: true }, "train")).toBe("Not training right now");
    expect(answerText({ ...answers, avoid: ["无"], people: 6 }, "logistics")).toBe(
      "4 or more · Supermarket · Microwave · No dislikes",
    );
    const p = exampleProfile();
    expect(p.shops).toEqual(["超市"]);
    expect(p.kitchen).toEqual(["微波炉"]);
    const line = resultLine(computeTargets(p, "CN"), p);
    expect(line).toContain("Done. ");
    expect(line).toContain("below maintenance");
    expect(line).not.toMatch(CJK);
  });

  test("every line reads in every language, with no placeholder left and no Chinese in the Latin and Cyrillic ones", () => {
    const p = exampleProfile();
    for (const locale of LOCALES) {
      setLocale(locale);
      const lines = [
        introLine(),
        noConsentReply(),
        ...STEPS.map(questionText),
        ...[...SHOP_OPTIONS, ...KITCHEN_OPTIONS, ...AVOID_OPTIONS.map((o) => o.value)].map(optionLabel),
        ...STEPS.map((id) => answerText(answers, id)),
        resultLine(computeTargets(p, "CN"), p),
      ];
      const cjkOk = locale === "zh-CN" || locale === "ja" || locale === "ko";
      for (const line of lines) {
        expect({ locale, line, empty: line.length === 0 }).toEqual({ locale, line, empty: false });
        expect({ locale, line, open: /\{\w+\}/.test(line) }).toEqual({ locale, line, open: false });
        if (!cjkOk) expect({ locale, line, cjk: CJK.test(line) }).toEqual({ locale, line, cjk: false });
      }
    }
  });

  test("the catalog has every onboarding line in every language", () => {
    const meals = AREAS.meals as unknown as Record<Locale, Record<string, unknown>>;
    const keys = Object.keys(meals.en).filter((k) => k.startsWith("onboarding."));
    expect(keys.length).toBeGreaterThan(60);
    for (const locale of LOCALES) {
      expect(Object.keys(meals[locale]).filter((k) => k.startsWith("onboarding.")).sort()).toEqual([...keys].sort());
    }
  });
});
