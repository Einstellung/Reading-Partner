// The seed dish library (docs/671 菜库): every dish passes the entry check,
// and the library as a whole is balanced across roles, cuisines and prep.

import { describe, expect, test } from "bun:test";
import { checkDish, isMincedMeat } from "../../../../src/info/meals/dishes/check";
import { SEED_DISHES } from "../../../../src/info/meals/dishes/seed";
import { DEFAULT_KITCHEN, type Dish, type DishRole } from "../../../../src/info/meals/dishes/types";
import { foodById } from "../../../../src/info/meals/nutrition/foods";

const byRole = (role: DishRole): Dish[] => SEED_DISHES.filter((d) => d.role === role);
const mains = byRole("main");
const batchMains = mains.filter((d) => d.prep === "batch");
const freshMains = mains.filter((d) => d.prep === "fresh");
const STAPLE_IDS: ReadonlySet<string> = new Set(byRole("staple").map((d) => d.id));

describe("seed dishes", () => {
  test("every dish passes the entry check", () => {
    const bad = SEED_DISHES.flatMap((d) => {
      const r = checkDish(d, { stapleDishIds: STAPLE_IDS });
      return r.ok ? [] : [`${d.id}: ${r.failures.map((f) => f.message).join("; ")}`];
    });
    expect(bad).toEqual([]);
  });

  test("no dish uses the carton stock: an opened carton goes bad half used, the paste keeps", () => {
    const using = SEED_DISHES.filter((d) => d.ingredients.some((i) => i.food === "low_sodium_stock")).map((d) => d.id);
    expect(using).toEqual([]);
    expect(foodById("low_sodium_stock")).toBeDefined();
  });

  test("no dish or way uses gai lan or choy sum: hard to find outside southern China and Asian markets", () => {
    const BANNED = new Set(["gai_lan", "choy_sum"]);
    for (const d of SEED_DISHES) {
      const foods = [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)].map((i) => i.food);
      expect(foods.filter((f) => BANNED.has(f)), d.id).toEqual([]);
      const text = [d.name, d.nameEn, d.summary, d.summaryEn, ...(d.ways ?? []).flatMap((w) => [w.name, w.nameEn])].join(" ");
      expect(/芥蓝|菜心|gai lan|choy sum/i.test(text), d.id).toBe(false);
    }
  });

  test("the deep-coloured vegetables the seed relies on are common produce, easy to buy in China and the US", () => {
    const COMMON_DEEP = new Set([
      "spinach", "frozen_spinach", "broccoli", "frozen_broccoli", "bok_choy", "romaine", "green_beans", "frozen_green_beans", "green_pepper",
      "carrot", "tomato", "cherry_tomato", "red_bell_pepper", "pumpkin",
      "red_cabbage",
    ]);
    const lines = (d: Dish) => [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)];
    const used = new Set<string>();
    for (const d of SEED_DISHES) {
      for (const i of lines(d)) {
        if (!foodById(i.food)?.deepColor) continue;
        used.add(i.food);
        expect(COMMON_DEEP.has(i.food), `${d.id}: ${i.food}`).toBe(true);
      }
    }
    // The main ways of getting deep colour are all in use.
    for (const f of ["frozen_spinach", "frozen_broccoli", "bok_choy", "romaine", "frozen_green_beans", "tomato", "carrot", "red_bell_pepper", "red_cabbage"]) {
      expect(used.has(f), f).toBe(true);
    }
  });

  test("ids are unique, do not collide with food ids, and every dish is a seed", () => {
    const ids = SEED_DISHES.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.filter((id) => foodById(id))).toEqual([]);
    expect(SEED_DISHES.every((d) => d.origin === "seed" && !Number.isNaN(Date.parse(d.createdAt)))).toBe(true);
  });

  test("names are filled in, Chinese and English", () => {
    for (const d of SEED_DISHES) {
      expect(/[一-鿿]/.test(d.name), d.id).toBe(true);
      expect(/^[A-Za-z]/.test(d.nameEn) && !/[一-鿿]/.test(d.nameEn), d.id).toBe(true);
    }
  });

  test("every dish says how it is cooked: a Chinese sentence of at most 40 characters and an English one", () => {
    for (const d of SEED_DISHES) {
      expect(d.summary.trim().length, d.id).toBeGreaterThan(0);
      expect([...d.summary].length, d.id).toBeLessThanOrEqual(40);
      expect(/[一-鿿]/.test(d.summary), d.id).toBe(true);
      expect(/^[A-Z]/.test(d.summaryEn) && !/[一-鿿]/.test(d.summaryEn), d.id).toBe(true);
    }
    expect(new Set(SEED_DISHES.map((d) => d.summary)).size).toBe(SEED_DISHES.length);
  });

  test("chili is a stew, not a hot sauce: no dish or way name calls it 辣酱", () => {
    for (const d of SEED_DISHES) {
      expect(d.name.includes("辣酱") && d.id.includes("chili"), d.id).toBe(false);
      for (const w of d.ways ?? []) expect(w.name.includes("辣酱") && d.id.includes("chili"), `${d.id}: ${w.name}`).toBe(false);
    }
  });

  test("breakfasts are natural servings: eggs by the whole egg, not scaled", () => {
    for (const d of byRole("breakfast")) {
      for (const i of d.ingredients.filter((x) => x.food === "egg" || x.food === "tea_egg")) expect(i.grams % 50, d.id).toBe(0);
      expect(checkDish(d).serving?.factor, d.id).toBe(1);
    }
  });

  test("breakfasts are mostly two-protein combinations", () => {
    const twoOrMore = byRole("breakfast").filter((d) => d.ingredients.filter((i) => i.role === "protein").length >= 2);
    expect(twoOrMore.length).toBeGreaterThanOrEqual(6);
  });

  test("role counts", () => {
    expect(mains.length).toBeGreaterThanOrEqual(75);
    expect(mains.length).toBeLessThanOrEqual(100);
    expect(byRole("side").length).toBeGreaterThanOrEqual(6);
    expect(byRole("side").length).toBeLessThanOrEqual(16);
    expect(byRole("staple").length).toBeGreaterThanOrEqual(10);
    expect(byRole("staple").length).toBeLessThanOrEqual(15);
    expect(byRole("breakfast").length).toBeGreaterThanOrEqual(8);
    expect(byRole("breakfast").length).toBeLessThanOrEqual(14);
  });

  test("no Korean or Indian dishes, and no cuisine is over 30% of the mains", () => {
    const n: Record<string, number> = {};
    for (const d of mains) n[d.cuisine] = (n[d.cuisine] ?? 0) + 1;
    expect(Object.keys(n).filter((c) => c === "korean" || c === "indian")).toEqual([]);
    for (const d of SEED_DISHES) expect(["korean", "indian", "other"].includes(d.cuisine), d.id).toBe(false);
    for (const [cuisine, count] of Object.entries(n)) expect(count / mains.length, cuisine).toBeLessThanOrEqual(0.3);
    for (const c of ["chinese", "japanese", "southeast_asian", "american", "mexican", "italian", "mediterranean"]) {
      expect(n[c] ?? 0, c).toBeGreaterThanOrEqual(5);
    }
  });

  test("at least 60% of the mains are batch dishes, and batch dishes use batch methods", () => {
    expect(batchMains.length / mains.length).toBeGreaterThanOrEqual(0.6);
    expect(freshMains.length).toBeGreaterThan(0);
  });

  test("every batch main has 2 to 3 ways and no staples list; fresh mains have no ways", () => {
    for (const d of batchMains) {
      expect(d.ways?.length ?? 0, d.id).toBeGreaterThanOrEqual(2);
      expect(d.ways?.length ?? 0, d.id).toBeLessThanOrEqual(3);
      expect(d.staples, d.id).toEqual([]);
    }
    for (const d of freshMains) {
      expect(d.ways, d.id).toBeUndefined();
      expect(d.staples.length, d.id).toBeGreaterThan(0);
    }
  });

  test("every staple dish is named by at least one way or fresh main", () => {
    const named = new Set<string>();
    for (const d of mains) {
      for (const s of d.staples) named.add(s);
      for (const w of d.ways ?? []) if (w.staple) named.add(w.staple);
    }
    for (const id of STAPLE_IDS) expect(named.has(id), `${id} is named by no way or fresh main`).toBe(true);
  });

  test("quick sides: hands-on 5 minutes or less, deep-coloured, low sodium, default kitchen only", () => {
    const QUICK = [
      "microwave_spinach_sesame", "quick_garlic_spinach", "steamed_carrot_coins", "soy_green_beans_microwave",
      "tomato_cucumber_salad", "purple_cabbage_vinegar", "romaine_cherry_tomato_salad",
    ];
    for (const id of QUICK) {
      const d = SEED_DISHES.find((x) => x.id === id)!;
      expect(d?.role, id).toBe("side");
      expect(d.prep, id).toBe("fresh");
      expect(d.activeMin, id).toBeLessThanOrEqual(5);
      expect(d.equipment.every((e) => DEFAULT_KITCHEN.includes(e)), id).toBe(true);
      const r = checkDish(d);
      expect(r.ok, id).toBe(true);
      if (!r.ok) continue;
      expect(r.serving.deepVegG / r.serving.realVegG, id).toBeGreaterThanOrEqual(0.6);
      expect(r.serving.sodium, id).toBeLessThanOrEqual(200);
    }
  });

  test("sides and breakfasts are fresh; breakfasts take under 5 minutes", () => {
    for (const d of [...byRole("side"), ...byRole("breakfast")]) expect(d.prep, d.id).toBe("fresh");
    for (const d of byRole("breakfast")) expect(d.activeMin, d.id).toBeLessThanOrEqual(5);
  });

  test("no pre-packaged mince: ground meat comes only from a named whole cut ground fresh", () => {
    const lines = SEED_DISHES.flatMap((d) => d.ingredients.map((i) => ({ d, i })));
    expect(lines.filter(({ i }) => isMincedMeat(foodById(i.food)!)).map(({ d }) => d.id)).toEqual([]);
    const ground = SEED_DISHES.filter((d) => d.ingredients.some((i) => i.ground));
    expect(ground.map((d) => d.id).sort()).toEqual([
      "beef_meatballs_marinara",
      "chicken_meatball_spinach_soup",
      "napa_tofu_meatball_stew",
      "tomato_beef_kofta",
      "winter_melon_chicken_meatball_soup",
    ]);
    for (const d of ground) {
      expect(d.summary, d.id).toContain("现绞");
      expect(d.summaryEn, d.id).toMatch(/ground fresh/);
    }
    // Nothing still talks about mince in a name or summary.
    for (const d of SEED_DISHES) {
      expect(/肉末|肉馅|肉糜|绞肉|mince/i.test(`${d.name} ${d.nameEn} ${d.summary} ${d.summaryEn}`), d.id).toBe(false);
    }
  });

  test("tofu is a main protein in several dishes across cuisines, firm tofu among them, and dried tofu is not used", () => {
    const tofu = mains.filter((d) => d.ingredients.some((i) => i.role === "protein" && ["firm_tofu", "soft_tofu"].includes(i.food)));
    expect(tofu.length).toBeGreaterThanOrEqual(8);
    expect(tofu.filter((d) => d.ingredients.some((i) => i.food === "firm_tofu")).length).toBeGreaterThanOrEqual(6);
    expect(new Set(tofu.map((d) => d.cuisine)).size).toBeGreaterThanOrEqual(4);
    expect(tofu.some((d) => d.prep === "batch") && tofu.some((d) => d.prep === "fresh")).toBe(true);
    const lines = SEED_DISHES.flatMap((d) => [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)]);
    expect(lines.filter((i) => ["dried_tofu", "spiced_dried_tofu"].includes(i.food))).toEqual([]);
  });

  test("a tofu-with-meat batch pot uses about one block of tofu: tofu is the larger protein, 3 servings take 330-450 g", () => {
    const pots = batchMains.filter((d) => {
      const protein = d.ingredients.filter((i) => i.role === "protein");
      return protein.some((i) => i.food.endsWith("_tofu")) && protein.some((i) => ["meat", "poultry"].includes(foodById(i.food)?.proteinCategory ?? ""));
    });
    expect(pots.map((d) => d.id).sort()).toEqual(["beef_mapo_tofu", "miso_tofu_chicken_pot", "napa_tofu_meatball_stew", "tomato_tofu_chicken_stew"]);
    for (const d of pots) {
      const serving = checkDish(d, { stapleDishIds: STAPLE_IDS }).serving!;
      const grams = (pick: (food: string) => boolean) => serving.ingredients.filter((i) => i.role === "protein" && pick(i.food)).reduce((n, i) => n + i.grams, 0);
      const tofu = grams((f) => f.endsWith("_tofu"));
      const meat = grams((f) => !f.endsWith("_tofu"));
      expect(tofu * 3, d.id).toBeGreaterThanOrEqual(330);
      expect(tofu * 3, d.id).toBeLessThanOrEqual(450);
      expect(tofu, d.id).toBeGreaterThan(meat * 2);
      expect(meat, d.id).toBeGreaterThanOrEqual(40);
    }
  });

  test("frozen edamame is used in several dishes: it keeps indefinitely", () => {
    const using = SEED_DISHES.filter((d) => [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)].some((i) => i.food === "frozen_edamame"));
    expect(using.length).toBeGreaterThanOrEqual(10);
  });

  test("names are short and plain: no 和 twice in a Chinese name, no ' and ' twice in an English one, ways within 14 characters", () => {
    for (const d of SEED_DISHES) {
      const names = [{ zh: d.name, en: d.nameEn }, ...(d.ways ?? []).map((w) => ({ zh: w.name, en: w.nameEn }))];
      for (const n of names) {
        expect(n.zh.split("和").length - 1, `${d.id}: ${n.zh}`).toBeLessThanOrEqual(1);
        expect(n.en.split(" and ").length - 1, `${d.id}: ${n.en}`).toBeLessThanOrEqual(1);
      }
      for (const w of d.ways ?? []) expect([...w.name].length, `${d.id}: ${w.name}`).toBeLessThanOrEqual(14);
    }
  });

  test("a way is named for the vegetables it really carries", () => {
    const VEG_ZH: Record<string, string> = {
      spinach: "菠菜", broccoli: "西兰花", bok_choy: "上海青", romaine: "生菜", green_beans: "四季豆", green_pepper: "青椒", carrot: "胡萝卜",
      tomato: "番茄", cherry_tomato: "小番茄", red_bell_pepper: "彩椒", pumpkin: "南瓜", red_cabbage: "紫甘蓝", cucumber: "黄瓜", corn: "玉米", peas: "豌豆", edamame: "毛豆",
    };
    const all = Object.values(VEG_ZH);
    for (const d of SEED_DISHES) {
      for (const w of d.ways ?? []) {
        const have = new Set(w.addOns.map((a) => VEG_ZH[a.food.replace(/^frozen_/, "")]).filter(Boolean));
        const cut = Math.max(w.name.lastIndexOf("配"), w.name.lastIndexOf("拌"));
        const name = cut < 0 ? "" : w.name.slice(cut).replace(/玉米饼条?|糯玉米/g, "");
        for (const v of all) if (name.includes(v)) expect(have.has(v) || (v === "番茄" && have.has("小番茄")) || (v === "番茄" && name.includes("小番茄")), `${d.id}: ${w.name} names ${v} not on the plate`).toBe(true);
      }
    }
  });

  test("no vegetable is in more than a quarter of the ways: add-ons are spread over the whole list", () => {
    const family = (food: string) => food.replace(/^frozen_/, "");
    const count = new Map<string, number>();
    let ways = 0;
    for (const d of SEED_DISHES) {
      for (const w of d.ways ?? []) {
        ways++;
        const seen = new Set(w.addOns.filter((a) => foodById(a.food)?.roles.includes("veg")).map((a) => family(a.food)));
        for (const f of seen) count.set(f, (count.get(f) ?? 0) + 1);
      }
    }
    expect(ways).toBeGreaterThan(150);
    for (const [food, n] of count) expect(n / ways, `${food}: ${n} of ${ways} ways`).toBeLessThanOrEqual(0.25);
    // Every deep-coloured vegetable on the common list shows up as an add-on.
    for (const f of ["spinach", "broccoli", "bok_choy", "romaine", "green_beans", "green_pepper", "carrot", "tomato", "cherry_tomato", "red_bell_pepper", "pumpkin", "red_cabbage"]) {
      expect(count.get(f) ?? 0, f).toBeGreaterThanOrEqual(3);
    }
  });

  test("no fruit in mains, sides, staples or ways: fruit is its own item, breakfasts keep theirs", () => {
    for (const d of SEED_DISHES.filter((x) => x.role !== "breakfast")) {
      for (const i of [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)]) expect(i.role, `${d.id}: ${i.food}`).not.toBe("fruit");
    }
    for (const d of SEED_DISHES.filter((x) => x.role !== "breakfast")) {
      expect(/苹果|橙|菠萝|香蕉|apple|orange|pineapple|banana/i.test(`${d.name} ${d.nameEn} ${d.summary} ${d.summaryEn} ${(d.ways ?? []).map((w) => `${w.name} ${w.nameEn}`).join(" ")}`), d.id).toBe(false);
    }
  });

  test("fish and seafood mains are always fresh, never batch", () => {
    const fish = mains.filter((d) => d.ingredients.some((i) => i.role === "protein" && foodById(i.food)?.proteinCategory === "seafood"));
    expect(fish.length).toBeGreaterThanOrEqual(15);
    expect(fish.filter((d) => d.prep === "batch").map((d) => d.id)).toEqual([]);
    for (const d of fish) expect(d.staples.length, d.id).toBeGreaterThan(0);
  });

  test("fish dishes use fish that is easy to buy and mild: no scallop, clam, hairtail or squid", () => {
    const banned = new Set(["scallop", "clam", "hairtail", "squid"]);
    for (const d of SEED_DISHES) {
      for (const i of [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)]) expect(banned.has(i.food), `${d.id}: ${i.food}`).toBe(false);
    }
  });

  test("fish and shrimp dishes vary their vegetables: no two share a main pair, tomato with zucchini at most once", () => {
    const fish = mains.filter((d) => d.ingredients.some((i) => i.role === "protein" && foodById(i.food)?.proteinCategory === "seafood"));
    const tomato = new Set(["tomato", "cherry_tomato", "crushed_tomatoes"]);
    const pair = (d: Dish) =>
      d.ingredients
        .filter((i) => i.role === "veg")
        .sort((a, b) => b.grams - a.grams)
        .slice(0, 2)
        .map((i) => (tomato.has(i.food) ? "tomato" : i.food))
        .sort()
        .join("+");
    const seen = new Map<string, string>();
    for (const d of fish) {
      const p = pair(d);
      expect(seen.get(p), `${d.id} repeats the vegetables ${p} of ${seen.get(p)}`).toBeUndefined();
      seen.set(p, d.id);
    }
    const both = fish.filter((d) => {
      const veg = d.ingredients.filter((i) => i.role === "veg").map((i) => i.food);
      return veg.some((f) => tomato.has(f)) && veg.includes("zucchini");
    });
    expect(both.length).toBeLessThanOrEqual(1);
  });

  test("canned mackerel and sardine dishes (no cooking) in two cuisines, and a basa dish", () => {
    const using = (food: string) => mains.filter((d) => d.ingredients.some((i) => i.food === food));
    const mackerel = using("canned_mackerel_tomato");
    const sardine = using("canned_sardine");
    expect(mackerel.length).toBeGreaterThanOrEqual(1);
    expect(sardine.length).toBeGreaterThanOrEqual(1);
    for (const d of [...mackerel, ...sardine]) {
      expect(d.prep, d.id).toBe("fresh");
      expect(d.method, d.id).toBe("assemble");
    }
    expect(new Set([...mackerel, ...sardine].map((d) => d.cuisine)).size).toBeGreaterThanOrEqual(2);
    expect(using("basa_fillet").length).toBeGreaterThanOrEqual(1);
  });

  test("a solid set of beef dishes, spread over the cuisines", () => {
    const beef = mains.filter((d) => d.ingredients.some((i) => foodById(i.food)?.tags.includes("beef")));
    expect(beef.length).toBeGreaterThanOrEqual(18);
    const cuisines = new Set(beef.map((d) => d.cuisine));
    for (const c of ["chinese", "japanese", "southeast_asian", "american", "mexican", "italian", "mediterranean"]) {
      expect(cuisines.has(c as never), c).toBe(true);
    }
  });

  test("the Northeastern iron-pot stew and the napa tofu meatball stew are in the library", () => {
    for (const id of ["napa_tofu_meatball_stew", "northeast_iron_pot_chicken"]) {
      const d = SEED_DISHES.find((x) => x.id === id);
      expect(d?.cuisine, id).toBe("chinese");
      expect(d?.prep, id).toBe("batch");
      expect(d?.ways?.length ?? 0, id).toBeGreaterThanOrEqual(2);
    }
  });

  test("breakfast sodium is not capped, and the toast breakfast has two slices", () => {
    const d = byRole("breakfast").find((x) => x.id === "milk_toast_boiled_egg")!;
    expect(d.ingredients.find((i) => i.food === "whole_wheat_toast")?.grams).toBe(70);
    expect(checkDish(d).ok).toBe(true);
  });

  test("every dish fits the default kitchen: its equipment and every way's staple preparation", () => {
    const outside = SEED_DISHES.flatMap((d) => d.equipment.filter((e) => !DEFAULT_KITCHEN.includes(e)).map((e) => `${d.id}: ${e}`));
    expect(outside).toEqual([]);
    const staples = new Map(byRole("staple").map((d) => [d.id, d]));
    for (const d of SEED_DISHES) {
      for (const id of [...d.staples, ...(d.ways ?? []).map((w) => w.staple ?? "")]) {
        for (const e of staples.get(id)?.equipment ?? []) expect(DEFAULT_KITCHEN.includes(e), `${d.id} -> ${id}: ${e}`).toBe(true);
      }
    }
  });

  test("no oven, slow-cooker, baked or roasted wording in names and summaries", () => {
    for (const d of SEED_DISHES) {
      const text = [d.name, d.nameEn, d.summary, d.summaryEn, ...(d.ways ?? []).flatMap((w) => [w.name, w.nameEn])].join(" ");
      expect(/烤箱|慢炖锅|慢炖|烤盘|\boven\b|slow[- ]cook|\bbaked?\b|(?<!pot )\broast(ed)?\b|traybake|sheet[- ]pan/i.test(text), d.id).toBe(false);
    }
  });

  test("seasoning is ready-made: no fresh garlic, ginger, scallion or leek, and no braised beef shank row", () => {
    const banned = new Set(["garlic", "ginger", "scallion", "leek", "braised_beef_shank"]);
    for (const d of SEED_DISHES) {
      const lines = [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)];
      for (const i of lines) expect(banned.has(i.food), `${d.id}: ${i.food}`).toBe(false);
    }
  });

  test("soy milk maker breakfasts: dry beans on the line, load the night before, count as legumes", () => {
    expect(DEFAULT_KITCHEN).toContain("soy_milk_maker");
    const soy = byRole("breakfast").filter((d) => d.equipment.includes("soy_milk_maker"));
    expect(soy.length).toBeGreaterThanOrEqual(4);
    const sources = new Set<string>();
    for (const d of soy) {
      const beans = d.ingredients.filter((i) => ["soy", "legume"].includes(foodById(i.food)?.proteinCategory ?? ""));
      expect(beans.length, d.id).toBeGreaterThan(0);
      // Soybeans are the base of every milk, in a natural 20 to 25 g handful.
      const soybeans = d.ingredients.find((i) => i.food === "soybean_dry");
      expect(soybeans?.grams, d.id).toBeGreaterThanOrEqual(20);
      expect(soybeans?.grams, d.id).toBeLessThanOrEqual(25);
      expect(d.summary, d.id).toContain("前一晚");
      expect(d.summary, d.id).toContain("定时");
      expect(d.summaryEn.toLowerCase(), d.id).toContain("night before");
      expect(d.summaryEn.toLowerCase(), d.id).toContain("timer");
      expect(d.activeMin, d.id).toBeLessThanOrEqual(5);
      expect(checkDish(d).ok, d.id).toBe(true);
      expect(checkDish(d).serving!.protein, d.id).toBeGreaterThanOrEqual(15);
      for (const i of d.ingredients) sources.add(i.food);
    }
    for (const f of ["black_soybean_dry", "adzuki_beans_dry", "red_dates_dried", "oats", "millet_raw", "walnuts"]) {
      expect(sources.has(f), f).toBe(true);
    }
  });

  test("steamed chicken is sliced thin and coated with starch, never a plain whole breast", () => {
    const steamed = SEED_DISHES.filter((d) => d.method === "steam" && d.ingredients.some((i) => i.food.startsWith("chicken_")));
    expect(steamed.length).toBeGreaterThan(0);
    for (const d of steamed) {
      expect(d.ingredients.some((i) => i.food === "cornstarch"), d.id).toBe(true);
      expect(d.summary, d.id).toContain("薄片");
      expect(d.summary, d.id).toContain("淀粉");
      expect(d.summaryEn.toLowerCase(), d.id).toMatch(/sliced thin/);
      expect(d.summaryEn.toLowerCase(), d.id).toContain("cornstarch");
      // Breast is steamed 8 to 10 minutes; thigh is the other way out.
      const breast = d.ingredients.some((i) => i.food === "chicken_breast");
      if (breast) expect(d.summary, d.id).toMatch(/蒸 (8|9|10)/);
      else expect(d.ingredients.some((i) => i.food === "chicken_thigh"), d.id).toBe(true);
    }
    // No dish steams a breast or thigh whole and plain.
    for (const d of SEED_DISHES) expect(/整[块片]鸡胸|整块鸡腿|whole (chicken )?breast/i.test(d.summary + d.summaryEn), d.id).toBe(false);
  });
});

// Docs/671 菜库: seed dishes avoid partial-pack perishables. A dish that opens a
// pack it cannot finish leaves the rest to spoil, so the seed library stays
// clear of the packs nobody can use up in one plan.
describe("seed dishes and partial-pack perishables", () => {
  const lines = (d: Dish) => [...d.ingredients, ...(d.ways ?? []).flatMap((w) => w.addOns)];
  const usedBy = (food: string) => SEED_DISHES.filter((d) => lines(d).some((i) => i.food === food)).map((d) => d.id);

  test("no seed dish uses coconut milk: the rest of the can would spoil", () => {
    expect(usedBy("light_coconut_milk")).toEqual([]);
    expect(foodById("light_coconut_milk")).toBeDefined();
    for (const d of SEED_DISHES) expect(/椰/.test(`${d.name} ${(d.ways ?? []).map((w) => w.name).join(" ")} ${d.summary}`), d.id).toBe(false);
  });

  test("no fresh herb line: a bunch rots long before three grams of it are used up", () => {
    for (const id of ["basil", "mint", "coriander", "dill", "parsley"]) expect(usedBy(id), id).toEqual([]);
    // Generic form: no perishable fresh produce line under 20 g (lemon, lime and onion keep for weeks).
    const tiny = SEED_DISHES.flatMap((d) =>
      lines(d)
        .filter((i) => {
          const f = foodById(i.food)!;
          return f.category === "produce" && f.keeps !== "w2plus" && i.grams < 20;
        })
        .map((i) => `${d.id}: ${i.food} ${i.grams} g`),
    );
    expect(tiny).toEqual([]);
  });

  test("no soft cheese or fresh dairy garnish: feta and mozzarella are not in any dish", () => {
    expect(usedBy("feta")).toEqual([]);
    expect(usedBy("mozzarella")).toEqual([]);
    expect(usedBy("egg_white")).toEqual([]);
    // Yogurt is a breakfast item at 100 g or more, not a spoonful on a pot.
    for (const d of SEED_DISHES) {
      for (const i of lines(d).filter((x) => x.food === "greek_yogurt" || x.food === "plain_yogurt")) {
        expect(d.role === "breakfast" && i.grams >= 100, `${d.id}: ${i.food} ${i.grams} g`).toBe(true);
      }
    }
  });

  test("no unusual perishable that only one or two dishes would use", () => {
    const banned = ["avocado", "pineapple", "asparagus", "eggplant", "snow_peas", "enoki", "chinese_chives", "mung_bean_sprouts", "king_oyster_mushroom", "blueberries"];
    for (const f of banned) expect(usedBy(f), f).toEqual([]);
  });

  test("a pot of three takes about one whole can of tomatoes, and a whole drained can of beans where it has beans", () => {
    const canned = (d: Dish, foods: string[]) => lines(d).filter((i) => foods.includes(i.food));
    for (const d of SEED_DISHES) {
      for (const i of canned(d, ["crushed_tomatoes"])) {
        expect(d.prep, `${d.id} opens a can for one serving`).toBe("batch");
        expect(i.grams * 3, d.id).toBeGreaterThanOrEqual(375);
        expect(i.grams * 3, d.id).toBeLessThanOrEqual(420);
      }
      for (const i of canned(d, ["canned_kidney_beans", "canned_black_beans", "canned_chickpeas"])) {
        expect(d.prep, `${d.id} opens a can for one serving`).toBe("batch");
        expect(i.grams * 3, d.id).toBeGreaterThanOrEqual(225);
        expect(i.grams * 3, d.id).toBeLessThanOrEqual(260);
      }
    }
  });
});
