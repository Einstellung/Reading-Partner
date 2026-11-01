// The wording rules both cooking prompts share (recipe.ts, prep-steps.ts):
// doneness by sight and touch with no thermometer, the pressure cooker's
// water as a measure, no "to taste". Stored steps said "confirm the chicken's
// centre reaches 74 C", "the minimum water the manual asks for" and "salt to
// taste".
// Run: scripts/t.sh tests/info/meals/recipe/prompt-wording.test.ts

import { describe, expect, test } from "bun:test";
import { PREP_STEPS_PROMPT_VERSION, prepStepsSystemPrompt } from "../../../../src/info/meals/recipe/prep-steps";
import { ownsThermometer, RECIPE_PROMPT_VERSION, recipeSystemPrompt } from "../../../../src/info/meals/recipe/recipe";

const PROMPTS = {
  recipe: recipeSystemPrompt({ effort: "simple", language: "en", kitchen: ["一口锅", "电压力锅"] }),
  prep: prepStepsSystemPrompt({ language: "en", burners: 2, thermometer: false }),
};

describe.each(Object.entries(PROMPTS))("the %s prompt", (_, prompt) => {
  test("judges doneness by sight and touch, with no temperature or thermometer", () => {
    expect(prompt).toContain("juices run clear");
    expect(prompt).toContain("no pink");
    expect(prompt).toContain("flakes easily");
    expect(prompt).toContain("Never give an internal temperature and never ask for a thermometer");
    expect(prompt).not.toMatch(/\b7[45] ?°?C\b|165 ?°?F/);
  });

  test("gives the pressure cooker's water as a measure, once, and never sends the reader to the manual", () => {
    expect(prompt).toContain("1 cup (250 ml)");
    expect(prompt).toContain("Say it once");
    expect(prompt).toContain('Never write "the minimum the manual asks for"');
  });

  test("never writes 'to taste'", () => {
    expect(prompt).toContain('Never write "to taste"');
    expect(prompt).not.toContain("only to taste");
  });
});

test("a kitchen that names a thermometer may get a temperature after the sign", () => {
  expect(ownsThermometer(["一口锅", "肉类温度计"])).toBe(true);
  expect(ownsThermometer(["instant-read thermometer"])).toBe(true);
  expect(ownsThermometer(["一口锅", "微波炉", "电压力锅", "豆浆机", "带蒸架的小锅"])).toBe(false);
  expect(ownsThermometer(undefined)).toBe(false);
  const withOne = recipeSystemPrompt({ effort: "simple", language: "en", kitchen: ["meat thermometer"] });
  expect(withOne).toContain("juices run clear");
  expect(withOne).toContain("may add the safe internal temperature");
  expect(prepStepsSystemPrompt({ language: "en", burners: 2, thermometer: true })).toContain("may add the safe internal temperature");
  expect(prepStepsSystemPrompt({ language: "en", burners: 2 })).toContain("never ask for a thermometer");
});

test("both prompt versions were raised, so stored steps are written again once", () => {
  expect(RECIPE_PROMPT_VERSION).toBe(3);
  expect(PREP_STEPS_PROMPT_VERSION).toBe(3);
});
