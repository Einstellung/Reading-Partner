import { describe, expect, test } from "bun:test";
import { FRIDGE_DAYS_AFTER_COOK } from "../../../../src/info/meals/dishes/methods";
import {
  checkDraft,
  fishMinimum,
  proteinKindsMinimum,
  redMeatCap,
  vegKindsMinimum,
  type DraftContext,
  type DraftRule,
} from "../../../../src/info/meals/planner/checks";
import { MAX_PLAN_DAYS, parseDraft, type PlanDraft } from "../../../../src/info/meals/planner/draft";
import { goodDraft, PROFILE, START_WEEKDAY, targetsFor } from "./fixture";

const ctx = (over: Partial<DraftContext> = {}): DraftContext => ({
  profile: PROFILE,
  targets: targetsFor(),
  startWeekday: START_WEEKDAY,
  ...over,
});

function check(edit: (d: PlanDraft) => void, over: Partial<DraftContext> = {}) {
  const draft = goodDraft();
  edit(draft);
  return checkDraft(draft, ctx(over));
}

const rules = (r: { problems: { rule: DraftRule }[] }) => r.problems.map((p) => p.rule);

describe("the good draft", () => {
  test("passes every check and solves", () => {
    const r = checkDraft(goodDraft(), ctx());
    expect(r.problems.map((p) => p.message)).toEqual([]);
    expect(r.plan?.days).toHaveLength(3);
    expect(r.notes).toEqual([]);
  });

  test("survives the tool's argument parser unchanged", () => {
    expect(parseDraft(JSON.parse(JSON.stringify(goodDraft())))).toEqual(goodDraft());
  });

  test("does not change the draft it was given", () => {
    const draft = goodDraft();
    checkDraft(draft, ctx());
    expect(draft).toEqual(goodDraft());
  });
});

describe("span rules scaled to 1 to 3 days", () => {
  test("red meat: 1 meal for 1 to 2 days, 2 for 3", () => {
    expect([1, 2, 3].map(redMeatCap)).toEqual([1, 1, 2]);
  });
  test("fish once in 3 days, not required in fewer", () => {
    expect([1, 2, 3].map(fishMinimum)).toEqual([0, 0, 1]);
  });
  test("two protein kinds; vegetable kinds days plus 2", () => {
    expect([1, 2, 3].map(proteinKindsMinimum)).toEqual([2, 2, 2]);
    expect([1, 2, 3].map(vegKindsMinimum)).toEqual([3, 4, 5]);
  });
});

describe("structure", () => {
  test("more than three days goes back", () => {
    const r = check((d) => d.days.push(structuredClone(d.days[2])));
    expect(rules(r)).toEqual(["days"]);
    expect(r.problems[0].message).toContain(`1 to ${MAX_PLAN_DAYS}`);
    expect(r.plan).toBeNull();
  });

  test("an unknown dish and a dish of the wrong role", () => {
    const r = check((d) => {
      d.days[0].breakfast = "no_such_dish";
      d.days[1].dinner.main = { dish: "milk_toast_boiled_egg" };
    });
    expect(rules(r)).toEqual(["dish", "dish_role"]);
    expect(r.problems[0].message).toBe('Day 1 breakfast: there is no dish "no_such_dish" in the library.');
  });

  test("a fresh main's staple must be one of its own", () => {
    const r = check((d) => {
      d.days[0].lunch.main = { dish: "kung_pao_chicken", staple: "pasta" };
    });
    expect(rules(r)).toEqual(["staple"]);
  });

  test("a batch dish eaten as a fresh main, and a fresh dish in a pot", () => {
    const r = check((d) => {
      d.days[2].lunch.main = { dish: "beef_ragu" };
      d.batches.push({ id: "cod", dish: "lemon_seared_cod", session: "s1", meals: [] });
    });
    expect(rules(r)).toContain("pot");
    expect(r.problems.filter((p) => p.rule === "pot")).toHaveLength(2);
  });

  test("a pot of four meals, and a way that does not exist", () => {
    const r = check((d) => {
      d.days[0].lunch.main = { batch: "chili", way: 2 };
      d.days[2].lunch.main = { batch: "chili", way: 4 };
      d.batches[0].meals.push({ day: 1, slot: "lunch" }, { day: 3, slot: "lunch" });
    });
    expect(rules(r)).toContain("pot_meals");
    expect(rules(r)).toContain("way");
    expect(r.problems.find((p) => p.rule === "pot_meals")?.message).toContain("feeds 4 meals; a pot feeds 1 to 3");
  });

  test("a pot and its meals must point at each other", () => {
    const r = check((d) => {
      d.batches[0].meals.push({ day: 3, slot: "dinner" });
    });
    expect(rules(r)).toContain("pot_link");
    expect(r.problems.find((p) => p.rule === "pot_link")?.message).toBe("Pot chili lists Day 3 dinner, but that meal does not eat from it.");
  });

  test("the same dish at lunch and dinner of one day", () => {
    const r = check((d) => {
      d.days[1].dinner.main = { dish: "kung_pao_chicken", staple: "brown_rice" };
      d.days[1].lunch.main = { dish: "kung_pao_chicken", staple: "brown_rice" };
      d.batches[0].meals = [{ day: 1, slot: "dinner" }];
    });
    expect(rules(r)).toContain("same_day_dish");
  });

  test("one pot per dish", () => {
    const r = check((d) => {
      d.days[2].lunch.main = { batch: "chili2", way: 2 };
      d.batches.push({ id: "chili2", dish: "chicken_bean_chili", session: "s1", meals: [{ day: 3, slot: "lunch" }] });
    });
    expect(rules(r)).toContain("one_pot_per_dish");
  });

  test("a pot's meals use different ways", () => {
    const r = check((d) => {
      d.days[1].lunch.main = { batch: "chili", way: 1 };
    });
    expect(rules(r)).toEqual(["ways_vary"]);
    expect(r.problems[0].message).toContain("use 2 different ones");
  });

  test("at most one prep session", () => {
    const r = check((d) => {
      d.sessions.push({ id: "s2", day: 2, part: "morning" });
    });
    expect(rules(r)).toEqual(["sessions"]);
  });

  test("the fridge window: the cooking day and two more", () => {
    expect(FRIDGE_DAYS_AFTER_COOK).toBe(2);
    const late = check((d) => {
      d.sessions[0] = { id: "s1", day: 1, part: "morning" };
      d.days[1].lunch.main = { dish: "green_pepper_pork_strips", staple: "multigrain_rice" };
      d.days[2].lunch.main = { batch: "chili", way: 3 };
      d.batches[0].meals = [{ day: 1, slot: "dinner" }, { day: 3, slot: "lunch" }];
    });
    expect(rules(late)).toEqual([]);
    const before = check((d) => {
      d.sessions[0] = { id: "s1", day: 1, part: "evening" };
    });
    expect(rules(before)).toEqual(["fridge"]);
    expect(before.problems[0].message).toBe("Pot chili: Day 1 dinner comes before its prep session (Day 1 evening).");
  });

  test("the session must sit at a time they can cook, when the profile says", () => {
    const r = check(() => {}, { profile: { ...PROFILE, cookSlots: [{ weekday: 7, part: "afternoon" }] } });
    expect(rules(r)).toEqual(["cook_slot"]);
    const ok = check(() => {}, { profile: { ...PROFILE, cookSlots: [{ weekday: 1, part: "afternoon" }] } });
    expect(rules(ok)).toEqual([]);
  });

  test("a disliked food rules a dish out", () => {
    const r = check(() => {}, { profile: { ...PROFILE, dislikes: ["pork"] } });
    expect(rules(r)).toEqual(["dish_blocked"]);
    expect(r.problems[0].message).toContain("which they dislike");
  });

  test("fruit must be a fruit", () => {
    const r = check((d) => {
      d.days[0].fruit = ["chicken_breast"];
    });
    expect(rules(r)).toContain("fruit_food");
  });
});

describe("the solved plan", () => {
  test("red meat over the cap", () => {
    const r = check((d) => {
      d.days[0].lunch.main = { dish: "green_pepper_pork_strips", staple: "multigrain_rice" };
      d.days[1].dinner.main = { dish: "pork_pepper_medallions", staple: "quinoa" };
    });
    expect(rules(r)).toContain("red_meat");
    expect(r.problems.find((p) => p.rule === "red_meat")?.message).toContain("a 3-day plan has at most 2");
  });

  test("no legumes in the plan", () => {
    const r = check((d) => {
      d.days[0].breakfast = "milk_toast_boiled_egg";
      d.days[0].dinner.main = { batch: "chili", way: 1 };
      d.batches[0].dish = "paprika_braised_chicken_thighs";
    });
    expect(rules(r)).toContain("legumes");
  });

  test("whole grains under half of the staples", () => {
    const r = check((d) => {
      d.days[0].lunch.main = { dish: "kung_pao_chicken", staple: "white_rice" };
      d.days[1].dinner.main = { dish: "salmon_broccoli_skillet", staple: "steamed_baby_potatoes" };
      d.days[2].lunch.main = { dish: "green_pepper_pork_strips", staple: "white_rice" };
      d.days[2].dinner.main = { dish: "lemon_seared_cod", staple: "steamed_baby_potatoes" };
    });
    expect(rules(r)).toContain("whole_grain");
  });

  test("fruit: about two portions a day", () => {
    const r = check((d) => {
      d.days[1].fruit = [];
    });
    expect(rules(r)).toEqual(["fruit"]);
    expect(r.problems[0].message).toContain("Day 2 has 0 fruit portion(s)");
  });

  test("protein from one kind only", () => {
    const r = check((d) => {
      d.days[0].breakfast = "chicken_wrap_milk";
    });
    expect(rules(r)).not.toContain("protein_variety");
  });

  test("no fish in three days, unless they eat none", () => {
    const edit = (d: PlanDraft) => {
      d.days[1].dinner.main = { dish: "kung_pao_chicken", staple: "brown_rice" };
      d.days[2].dinner.main = { dish: "lemon_mushroom_chicken", staple: "steamed_baby_potatoes" };
    };
    expect(rules(check(edit))).toContain("fish");
    expect(rules(check(edit, { profile: { ...PROFILE, dislikes: ["seafood"] } }))).not.toContain("fish");
  });

  test("a pack nobody finishes goes back with the amount and the day it spoils", () => {
    const r = check((d) => {
      d.days[2].dinner.main = { dish: "tuna_cucumber_bowl", staple: "whole_wheat_pita" };
    });
    const left = r.problems.filter((p) => p.rule === "leftover");
    expect(left.map((p) => p.food).sort()).toEqual(["cherry_tomato", "romaine"]);
    expect(left.find((p) => p.food === "romaine")?.message).toMatch(/^罗马生菜 \(romaine\): buying 1 head of 300 g leaves \d+ g that no meal uses; opened on Day 3, it spoils on Day 8\./);
  });
});
