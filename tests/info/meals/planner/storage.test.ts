import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getLocale, setLocale, type Locale } from "../../../../src/i18n";
import { CHILL_AFTER_OPENING, ROOM_TEMPERATURE } from "../../../../src/info/meals/nutrition/food-columns";
import { foodById } from "../../../../src/info/meals/nutrition/foods";
import type { Profile } from "../../../../src/info/meals/nutrition/targets";
import { checkDraft } from "../../../../src/info/meals/planner/checks";
import type { PlanDraft } from "../../../../src/info/meals/planner/draft";
import { planLibrary } from "../../../../src/info/meals/planner/library";
import { keepText } from "../../../../src/info/meals/planner/packs";
import { storageText, type StoragePlan, type StoreRow } from "../../../../src/info/meals/planner/storage";
import { goodDraft, PROFILE, START_WEEKDAY, targetsFor } from "./fixture";

function run(draft: PlanDraft = goodDraft(), profile: Profile = PROFILE, people = 1) {
  const r = checkDraft(draft, { profile, targets: targetsFor(profile, draft.days.length), startWeekday: START_WEEKDAY, people });
  if (!r.storage) throw new Error(`not solved: ${r.problems.map((p) => p.message).join(" | ")}`);
  return { ...r, storage: r.storage as StoragePlan };
}

const rows = <K extends StoreRow["kind"]>(list: StoreRow[], kind: K) => list.filter((r): r is Extract<StoreRow, { kind: K }> => r.kind === kind);

describe("the fixture plan, boxed", () => {
  const { storage, shopping, problems } = run();

  test("passes the checks and carries a storage plan", () => {
    expect(problems).toEqual([]);
    expect(storage).not.toBeNull();
  });

  test("boxes the pot meals not eaten at the prep meal", () => {
    // The chili pot is cooked Day 1 afternoon and eaten Day 1 dinner and Day 2 lunch.
    expect(storage.containers).toContainEqual({ kind: "box", count: 1, potMeals: 2, eatenAtPrep: 1 });
    expect(storage.boxes).toEqual([
      {
        batch: "chili",
        dish: "chicken_bean_chili",
        meal: { day: 2, slot: "lunch" },
        eatBy: { day: 2, slot: "lunch" },
        count: 1,
        rice: null,
        staple: "microwave_potato",
        addOns: ["frozen_broccoli"],
        sides: [],
      },
    ]);
    expect(rows(storage.fridge, "pot")).toEqual([
      { kind: "pot", batch: "chili", dish: "chicken_bean_chili", portions: 1, boxed: true, eatBy: { day: 2, slot: "lunch" } },
    ]);
  });

  test("raw meat waits in the fridge when it keeps until its cooking day, else is frozen the day it is bought", () => {
    expect(rows(storage.fridge, "rawForMeal")).toEqual([
      { kind: "rawForMeal", food: "chicken_breast", meals: [{ day: 1, slot: "lunch" }] },
      { kind: "rawForMeal", food: "chicken_thigh", meals: [{ day: 1, slot: "prep" }] },
      { kind: "rawForMeal", food: "salmon", meals: [{ day: 2, slot: "dinner" }] },
    ]);
    expect(rows(storage.freezer, "frozenForMeal")).toContainEqual({
      kind: "frozenForMeal", food: "lean_pork_leg", meals: [{ day: 3, slot: "lunch" }], boughtFrozen: false,
    });
    const line = (id: string) => shopping.find((l) => l.food === id);
    expect(line("chicken_thigh")?.freeze).toBe(false);
    expect(line("salmon")?.freeze).toBe(false);
    expect(line("lean_pork_leg")?.freeze).toBe(true);
    expect(line("cod")?.frozen).toBe(true);
    expect(line("frozen_broccoli")?.frozen).toBe(true);
  });

  test("what a raw pack leaves over goes in the freezer, one bag each", () => {
    const left = rows(storage.freezer, "rawLeftover");
    expect(left.map((r) => r.food)).toEqual(["chicken_breast", "chicken_thigh", "salmon", "lean_pork_leg"]);
    // 500 g of thighs, about 213 g into the pot.
    expect(left.find((r) => r.food === "chicken_thigh")?.grams).toBe(287);
    // Four leftovers and the pork portion frozen for Day 3.
    expect(storage.containers).toContainEqual({ kind: "freezerBag", count: 5, foods: ["chicken_breast", "chicken_thigh", "salmon", "lean_pork_leg"] });
  });

  test("food bought frozen stays frozen; the Day 3 cod dinner is moved to the fridge the evening of Day 2", () => {
    expect(rows(storage.freezer, "frozenForMeal")).toContainEqual({ kind: "frozenForMeal", food: "cod", meals: [{ day: 3, slot: "dinner" }], boughtFrozen: true });
    expect(rows(storage.freezer, "frozenOther")[0]?.foods).toEqual(["frozen_blueberries", "frozen_spinach", "frozen_broccoli", "frozen_peas"]);
    expect(storage.nights).toEqual([
      {
        day: 2,
        items: [
          { kind: "thaw", food: "lean_pork_leg", meal: { day: 3, slot: "lunch" }, fromFrozen: false },
          { kind: "thaw", food: "cod", meal: { day: 3, slot: "dinner" }, fromFrozen: true },
        ],
      },
    ]);
  });

  test("opened packs carry their use-by day; jars, produce and dry goods are placed", () => {
    expect(rows(storage.fridge, "opened")).toEqual([
      { kind: "opened", food: "celery", useBy: 8, how: "produce" },
      { kind: "opened", food: "plain_yogurt", useBy: 8, how: "lid" },
      { kind: "opened", food: "low_fat_milk", useBy: 9, how: "lid" },
    ]);
    expect(rows(storage.cupboard, "opened")).toEqual([
      { kind: "opened", food: "wholegrain_toast", useBy: 8, how: "bread" },
      { kind: "opened", food: "whole_wheat_toast", useBy: 9, how: "bread" },
    ]);
    expect(rows(storage.fridge, "jars")[0]?.foods).toEqual(["chili_sauce", "garlic_paste", "oyster_sauce"]);
    const room = rows(storage.cupboard, "room")[0]?.foods ?? [];
    expect(room).toContain("onion");
    expect(room).toContain("lemon");
    const pantry = rows(storage.cupboard, "pantry")[0]?.foods ?? [];
    expect(pantry).toContain("canned_kidney_beans");
    expect(pantry).toContain("reduced_salt_soy_sauce");
    expect(pantry).not.toContain("oyster_sauce");
  });

  test("every shopping line is placed exactly once, raw packs aside", () => {
    const placed = [...storage.fridge, ...storage.freezer, ...storage.cupboard].flatMap((r) =>
      "foods" in r ? r.foods : "food" in r && r.kind !== "rawLeftover" ? [r.food] : [],
    );
    for (const line of shopping) expect(placed).toContain(line.food);
  });
});

describe("the plan's rice: one rice-cooker batch at the prep session", () => {
  /** The solved grams of the plan's rice at these meals. */
  const riceGrams = (plan: NonNullable<ReturnType<typeof run>["plan"]>, meals: { day: number; slot: "lunch" | "dinner" }[], staple = "brown_rice") =>
    meals.reduce((sum, m) => sum + plan.days[m.day - 1].meals[m.slot].lines.filter((l) => l.source === "staple" && l.dish === staple).reduce((a, l) => a + l.grams, 0), 0);

  test("the fixture: cooked with the pot for every rice meal after the session; Day 1 lunch, before it, cooks its own", () => {
    const { storage, plan } = run();
    const meals = [{ day: 1, slot: "dinner" as const }, { day: 2, slot: "dinner" as const }];
    expect(storage.rice).toEqual({
      staple: "brown_rice",
      food: "brown_rice_cooked",
      grams: Math.round(riceGrams(plan!, meals)),
      cookedAt: { day: 1, slot: "prep" },
      meals,
      portions: 2,
      eatenNow: { day: 1, slot: "dinner" },
    });
    // The Day 2 salmon dinner is cooked fresh; its rice waits in one container.
    expect(storage.containers).toContainEqual({ kind: "riceContainer", count: 1, staple: "brown_rice", meals: [{ day: 2, slot: "dinner" }] });
    expect(rows(storage.fridge, "rice")).toEqual([{ kind: "rice", staple: "brown_rice", inBoxes: 0, inContainer: 1, eatBy: { day: 2, slot: "dinner" } }]);
    expect(storage.nights.flatMap((n) => n.items).map((i) => i.kind)).not.toContain("riceCooker");
  });

  test("a pot meal with the plan's rice carries it in its box", () => {
    const draft = goodDraft();
    draft.days[0].dinner.main = { batch: "chili", way: 3 };
    draft.days[1].lunch.main = { batch: "chili", way: 1 };
    const { storage, problems } = run(draft);
    expect(problems).toEqual([]);
    expect(storage.boxes[0]).toMatchObject({ meal: { day: 2, slot: "lunch" }, rice: "brown_rice", staple: null, addOns: ["frozen_spinach"] });
    expect(storage.rice?.eatenNow).toBeNull();
    expect(rows(storage.fridge, "rice")).toEqual([{ kind: "rice", staple: "brown_rice", inBoxes: 1, inContainer: 1, eatBy: { day: 2, slot: "dinner" } }]);
    expect(storage.containers).toContainEqual({ kind: "riceContainer", count: 1, staple: "brown_rice", meals: [{ day: 2, slot: "dinner" }] });
  });

  test("no boxes: all the kept rice goes into one lidded container", () => {
    const draft = goodDraft();
    draft.days[0].dinner.main = { batch: "chili", way: 3 };
    draft.days[1].lunch.main = { batch: "chili", way: 1 };
    const { storage } = run(draft, { ...PROFILE, boxes: false });
    expect(storage.boxes).toEqual([]);
    expect(storage.containers).toContainEqual({ kind: "riceContainer", count: 1, staple: "brown_rice", meals: [{ day: 2, slot: "lunch" }, { day: 2, slot: "dinner" }] });
    expect(rows(storage.fridge, "rice")[0]).toMatchObject({ inBoxes: 0, inContainer: 2 });
  });

  test("a fresh-cooked rice dinner on Day 3 is in the batch; two people double it", () => {
    const draft = goodDraft();
    draft.days[1].dinner = { main: { dish: "lemon_seared_cod", staple: "quinoa" }, sides: [] };
    draft.days[2].dinner = { main: { dish: "salmon_broccoli_skillet", staple: "brown_rice" }, sides: [] };
    draft.days[1].breakfast = "soy_milk_maker_plain";
    const one = run(draft);
    expect(one.storage.rice?.meals).toEqual([{ day: 1, slot: "dinner" }, { day: 3, slot: "dinner" }]);
    expect(one.storage.rice?.grams).toBe(Math.round(riceGrams(one.plan!, [{ day: 1, slot: "dinner" }, { day: 3, slot: "dinner" }])));
    expect(rows(one.storage.fridge, "rice")[0]?.eatBy).toEqual({ day: 3, slot: "dinner" });
    const two = run(draft, PROFILE, 2);
    expect(two.storage.rice?.portions).toBe(4);
    expect(two.storage.rice?.grams).toBe(Math.round(riceGrams(two.plan!, [{ day: 1, slot: "dinner" }, { day: 3, slot: "dinner" }]) * 2));
    expect(rows(two.storage.fridge, "rice")[0]).toMatchObject({ inBoxes: 0, inContainer: 2 });
  });

  test("no prep session: the batch is cooked at the first rice meal", () => {
    const draft = goodDraft();
    draft.days[0].dinner.main = { dish: "salmon_broccoli_skillet", staple: "brown_rice" };
    draft.days[1].lunch.main = { dish: "green_pepper_pork_strips", staple: "steamed_sweet_potato" };
    draft.batches = [];
    draft.sessions = [];
    const { storage } = run(draft);
    expect(storage.rice).toMatchObject({
      cookedAt: { day: 1, slot: "lunch" },
      meals: [{ day: 1, slot: "lunch" }, { day: 1, slot: "dinner" }, { day: 2, slot: "dinner" }],
      eatenNow: { day: 1, slot: "lunch" },
    });
    expect(storage.containers).toContainEqual({ kind: "riceContainer", count: 1, staple: "brown_rice", meals: [{ day: 1, slot: "dinner" }, { day: 2, slot: "dinner" }] });
  });
});

describe("variants", () => {
  test("no boxes: one lidded container per pot with something left", () => {
    const { storage } = run(goodDraft(), { ...PROFILE, boxes: false });
    expect(storage.boxes).toEqual([]);
    expect(storage.containers.find((c) => c.kind === "box")).toBeUndefined();
    expect(storage.containers).toContainEqual({ kind: "potContainer", count: 1, batches: ["chili"] });
    expect(rows(storage.fridge, "pot")[0]).toMatchObject({ boxed: false, portions: 1, eatBy: { day: 2, slot: "lunch" } });
  });

  test("two people: two boxes for each boxed meal", () => {
    const { storage } = run(goodDraft(), PROFILE, 2);
    expect(storage.containers).toContainEqual({ kind: "box", count: 2, potMeals: 2, eatenAtPrep: 1 });
    expect(storage.boxes[0]?.count).toBe(2);
  });

  test("a fresh fish dinner on Day 3 is frozen the day it is bought and thawed the night before", () => {
    const draft = goodDraft();
    draft.days[1].dinner = { main: { dish: "lemon_seared_cod", staple: "quinoa" }, sides: [] };
    draft.days[2].dinner = { main: { dish: "salmon_broccoli_skillet", staple: "brown_rice" }, sides: [] };
    draft.days[1].breakfast = "soy_milk_maker_plain";
    const { storage, shopping } = run(draft);
    expect(shopping.find((l) => l.food === "salmon")?.freeze).toBe(true);
    expect(rows(storage.freezer, "frozenForMeal")).toContainEqual({ kind: "frozenForMeal", food: "salmon", meals: [{ day: 3, slot: "dinner" }], boughtFrozen: false });
    expect(rows(storage.fridge, "rawForMeal").map((r) => r.food)).not.toContain("salmon");
    const night1 = storage.nights.find((n) => n.day === 1)?.items ?? [];
    const night2 = storage.nights.find((n) => n.day === 2)?.items ?? [];
    expect(night1).toContainEqual({ kind: "soyMilk", meal: { day: 2, slot: "breakfast" }, dish: "soy_milk_maker_plain", foods: ["soybean_dry"] });
    expect(night1).toContainEqual({ kind: "thaw", food: "cod", meal: { day: 2, slot: "dinner" }, fromFrozen: true });
    expect(night2).toContainEqual({ kind: "thaw", food: "salmon", meal: { day: 3, slot: "dinner" }, fromFrozen: true });
  });

  test("a one-day plan: the pot is eaten at the prep meal, nothing is boxed and there is no night before", () => {
    const base = goodDraft();
    const draft: PlanDraft = {
      days: [base.days[0]],
      batches: [{ id: "chili", dish: "chicken_bean_chili", session: "s1", meals: [{ day: 1, slot: "dinner" }] }],
      sessions: [{ id: "s1", day: 1, part: "afternoon" }],
    };
    const { storage } = run(draft);
    expect(storage.boxes).toEqual([]);
    expect(storage.containers.map((c) => c.kind)).toEqual(["freezerBag"]);
    expect(rows(storage.fridge, "pot")).toEqual([]);
    // Day 1 lunch cooks its own rice; the batch feeds only the prep meal, eaten as it is cooked.
    expect(storage.rice).toMatchObject({ meals: [{ day: 1, slot: "dinner" }], eatenNow: { day: 1, slot: "dinner" } });
    expect(rows(storage.fridge, "rice")).toEqual([]);
    expect(storage.nights).toEqual([]);
    expect(rows(storage.freezer, "rawLeftover").map((r) => r.food)).toEqual(["chicken_breast", "chicken_thigh"]);
  });
});

describe("text", () => {
  let saved: Locale;
  beforeEach(() => {
    saved = getLocale();
  });
  afterEach(() => setLocale(saved));

  test("zh-CN", () => {
    setLocale("zh-CN");
    const { storage } = run();
    const tx = storageText(storage, planLibrary(PROFILE));
    expect(tx.containers[0]).toEqual({ name: "食盒", detail: "约 750 ml、带盖、能进微波炉，玻璃的最好 · 锅里共 2 份，备餐那顿吃 1 份，其余 1 份装盒", count: "1 个" });
    expect(tx.containers[1]).toEqual({ name: "装饭的有盖容器", detail: "装糙米饭，给：第 2 天晚餐", count: "1 个" });
    expect(tx.containers[2]?.count).toBe("5 个");
    expect(tx.rice).toEqual({ name: "糙米饭 · 电饭锅一锅 2 份", detail: "第 1 天备餐时用电饭锅一次煮好，分给：第 1 天晚餐、第 2 天晚餐" });
    expect(tx.boxes[0]).toEqual({
      meal: "第 2 天午餐",
      what: "盒里只有：鸡腿丁红芸豆炖菜（chili） 1 份",
      with: "吃时现配：微波土豆、冷冻西兰花",
      keep: "冷藏 · 第 2 天午餐前吃完",
    });
    const fridge = tx.places.find((p) => p.place === "fridge");
    expect(fridge?.label).toBe("冷藏");
    expect(fridge?.rows).toContainEqual({ name: "去皮鸡腿肉（生）", detail: "原包装放冷藏最下层。", until: "第 1 天备餐时用" });
    expect(fridge?.rows[1]).toEqual({ name: "糙米饭 · 1 份", detail: "装进有盖容器。摊开晾凉，1 小时内放进冷藏；每次取一份，热到冒热气。", until: "第 2 天晚餐前吃完" });
    const freezer = tx.places.find((p) => p.place === "freezer");
    expect(freezer?.rows).toContainEqual({ name: "去皮鸡腿肉（生）· 剩约 290 g", detail: "平铺装进冷冻袋，压出空气，袋上写日期。", until: "4 周内用" });
    // Rice and quinoa are kept dry, by their dry names.
    const cupboard = tx.places.find((p) => p.place === "cupboard")?.rows.map((r) => r.name).join("、") ?? "";
    expect(cupboard).toContain("糙米");
    expect(cupboard).not.toContain("糙米饭");
    expect(cupboard).toContain("藜麦");
    expect(tx.nights).toEqual([
      {
        title: "第 2 天晚上",
        lines: [
          "猪后腿瘦肉那份从冷冻拿到冷藏解冻（第 3 天午餐）",
          "鳕鱼从冷冻拿到冷藏解冻（第 3 天晚餐）；来不及就冻着下锅",
        ],
      },
    ]);
  });

  test("zh-CN: a pot meal's rice is in its box", () => {
    setLocale("zh-CN");
    const draft = goodDraft();
    draft.days[0].dinner.main = { batch: "chili", way: 3 };
    draft.days[1].lunch.main = { batch: "chili", way: 1 };
    const tx = storageText(run(draft).storage, planLibrary(PROFILE));
    expect(tx.boxes[0]).toEqual({ meal: "第 2 天午餐", what: "盒里有：鸡腿丁红芸豆炖菜（chili） 1 份 + 糙米饭", with: "吃时现配：冷冻菠菜", keep: "冷藏 · 第 2 天午餐前吃完" });
    expect(tx.places.find((p) => p.place === "fridge")?.rows[1]).toEqual({
      name: "糙米饭 · 2 份",
      detail: "1 份随锅分进食盒，其余 1 份装进有盖容器。摊开晾凉，1 小时内放进冷藏；吃前热到冒热气。",
      until: "第 2 天晚餐前吃完",
    });
  });

  test("en", () => {
    setLocale("en");
    const { storage } = run(goodDraft(), { ...PROFILE, boxes: false });
    const tx = storageText(storage, planLibrary(PROFILE));
    expect(tx.containers[0]).toEqual({ name: "Large lidded containers", detail: "one per pot, for what is left in it", count: "1" });
    expect(tx.places[0]?.rows[0]).toEqual({ name: "Chicken and kidney bean chili · 1 portion left", detail: expect.any(String), until: "Eat by Day 2 Lunch" });
  });

  test("shopping keep text", () => {
    setLocale("zh-CN");
    const { shopping } = run();
    const line = (id: string) => shopping.find((l) => l.food === id) as (typeof shopping)[number];
    expect(keepText(line("cod"))).toBe("买回直接冷冻");
    expect(keepText(line("lean_pork_leg"))).toBe("买回当天分装冷冻");
    expect(keepText(line("chicken_thigh"))).toBe("");
  });
});

test("the storage food sets name real foods", () => {
  for (const id of [...CHILL_AFTER_OPENING, ...ROOM_TEMPERATURE]) expect(foodById(id)?.id).toBe(id);
});
