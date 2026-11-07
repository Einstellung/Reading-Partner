// The seed dish library (docs/671 菜库): home dishes drafted from the food
// table, every one passing the entry check (checkDish), reviewed by the owner
// in a list page and guarded by tests/info/meals/dishes/seed.test.ts. Only
// ingredients and attributes are stored, never recipe text. Chinese dishes
// follow the ingredient lists of HowToCook (Unlicense) and YunYouJun/cook
// (MIT); the other cuisines are common home cooking.
//
// Templates are written at roughly one person's amount; the reference serving
// (serving.ts) rescales them, so only the proportions matter. Seasoning is
// ready-made pastes, powders and sauces: no fresh garlic, ginger, scallion or
// chili. A batch main is a protein-centred pot (hands-off method) with 2 to 3
// ways to eat it, each naming a staple and the fresh add-ons put on the plate
// at the meal; vegetables are cooked fresh, not in the pot, except the ones
// that belong in the dish. Fresh mains name the staples they go with.
//
// Seed dishes avoid partial-pack perishables (docs/671 整包与开封): no fresh
// herbs, coconut milk, feta, mozzarella, avocado or other fresh produce that
// only one or two dishes use; a batch pot takes about one whole can of
// tomatoes or beans; small fresh garnishes stay only when many dishes share
// them (cherry tomato, cucumber, spinach, lettuce).
//
// No pre-packaged mince: its cuts and fat are unknown and it spoils in a day
// or two. Meatballs, kofta and loaves use a named lean cut ground fresh (the
// `gr` lines, ground: true), cooked the same day; every other dish uses whole
// cuts as cubes, slices or dice.

import type { MethodId } from "./methods";
import type { Cuisine, Dish, DishFinish, DishIngredient, DishRole, DishRoute, DishWay, Equipment, IngredientRole } from "./types";

const CREATED_AT = "2026-10-25T00:00:00.000Z";

const line =
  (role: IngredientRole) =>
  (food: string, grams: number): DishIngredient => ({ food, grams, role });
const pr = line("protein");
const ve = line("veg");
const st = line("staple");
const oi = line("oil");
// An oil line that only greases the pan: it takes the household's oil (house-oil.ts).
const co = (food: string, grams: number): DishIngredient => ({ food, grams, role: "oil", cookingOil: true });
const se = line("seasoning");
const fr = line("fruit");
const tp = line("topping");
/** A protein line of a whole cut that is ground fresh (at the counter or at home) and cooked that day. */
const gr = (food: string, grams: number): DishIngredient => ({ food, grams, role: "protein", ground: true });

/** [hands-on, total] minutes. */
type Minutes = [number, number];

interface Spec {
  id: string;
  zh: string;
  en: string;
  /** How it is cooked, one Chinese sentence, and the English of it. */
  sum: string;
  sumEn: string;
  /** What it tastes like and is like to eat, one plain sentence, and the English of it. */
  taste: string;
  tasteEn: string;
  role?: DishRole;
  c: Cuisine;
  m: MethodId;
  eq?: Equipment[];
  t: Minutes;
  i: DishIngredient[];
  /** Fresh mains only. */
  staples?: string[];
  /** Batch mains only: 2 to 3 ways to eat the pot. */
  ways?: DishWay[];
  /** Other equipment that makes the same dish, in the order the planner tries them. */
  routes?: DishRoute[];
}

const dish = (s: Spec): Dish => ({
  id: s.id,
  name: s.zh,
  nameEn: s.en,
  summary: s.sum,
  summaryEn: s.sumEn,
  taste: s.taste,
  tasteEn: s.tasteEn,
  role: s.role ?? "main",
  cuisine: s.c,
  method: s.m,
  equipment: s.eq ?? ["stove"],
  activeMin: s.t[0],
  totalMin: s.t[1],
  prep: s.ways ? "batch" : "fresh",
  staples: s.staples ?? [],
  ingredients: s.i,
  ...(s.ways ? { ways: s.ways } : {}),
  ...(s.routes ? { routes: s.routes } : {}),
  origin: "seed",
  createdAt: CREATED_AT,
});

/** A staple is cooked ahead, so it is a batch dish with no ways. */
const batchStaple = (s: Spec): Dish => ({ ...dish({ ...s, role: "staple" }), prep: "batch" });

/** Another way to cook a dish: its equipment, [hands-on, total] minutes and how, in Chinese and English. */
const route = (equipment: Equipment[], t: Minutes, summary: string, summaryEn: string): DishRoute => ({
  equipment,
  activeMin: t[0],
  totalMin: t[1],
  summary,
  summaryEn,
});

const way = (name: string, nameEn: string, staple: string | null, addOns: DishIngredient[], activeMin = 3): DishWay => ({
  name,
  nameEn,
  staple,
  addOns,
  activeMin,
});

// Staple dish ids the ways and fresh mains name.
const RICE = "white_rice";
const BROWN = "brown_rice";
const GRAINS = "multigrain_rice";
const MILLET = "millet_rice";
const QUINOA = "quinoa";
const PASTA = "pasta";
const WW_PASTA = "whole_wheat_pasta";
const SOBA = "soba_noodles";
const VERMICELLI = "rice_vermicelli";
const SWEET_POTATO = "steamed_sweet_potato";
const MICROWAVE_POTATO = "microwave_potato";
const BABY_POTATOES = "steamed_baby_potatoes";
const CORN = "steamed_waxy_corn";

const STAPLES: Dish[] = [
  batchStaple({ id: RICE, zh: "米饭", en: "Steamed white rice", sum: "白米淘洗后加水，用电饭锅煮熟", sumEn: "White rice rinsed and cooked with water in a rice cooker.", taste: "味道清淡，软糯微甜，没有咸味。", tasteEn: "Plain and mild, soft and slightly sweet, with no salt.", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 40], i: [st("rice_cooked", 110)],
    routes: [
      route(["pressure_cooker"], [3, 30], "白米淘洗后加等量水，压力锅高压 4 分钟，自然泄压 10 分钟", "White rice rinsed, with an equal volume of water, 4 minutes at high pressure, then 10 minutes natural release."),
      route(["stove"], [5, 30], "白米淘洗后加水煮开，盖盖小火煮 15 分钟，关火焖 10 分钟", "White rice rinsed and brought to a boil, covered on low 15 minutes, then 10 minutes covered off the heat."),
    ] }),
  batchStaple({ id: BROWN, zh: "糙米饭", en: "Brown rice", sum: "糙米淘洗后加水，用电饭锅煮熟", sumEn: "Brown rice rinsed and cooked with water in a rice cooker.", taste: "比白米饭更有嚼劲，带麸皮的谷物香，没有咸味。", tasteEn: "Chewier than white rice, with a bran-like grain flavour and no salt.", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 60], i: [st("brown_rice_cooked", 163)],
    routes: [
      route(["pressure_cooker"], [3, 45], "糙米淘洗后加水，压力锅高压 22 分钟，自然泄压 10 分钟", "Brown rice rinsed, with water, 22 minutes at high pressure, then 10 minutes natural release."),
      route(["stove"], [5, 60], "糙米淘洗后加水煮开，盖盖小火煮 40 分钟，关火焖 10 分钟", "Brown rice rinsed and brought to a boil, covered on low 40 minutes, then 10 minutes covered off the heat."),
    ] }),
  batchStaple({ id: GRAINS, zh: "五谷杂粮饭", en: "Multigrain rice", sum: "杂粮米淘洗后加水，用电饭锅煮熟", sumEn: "Mixed grains rinsed and cooked with water in a rice cooker.", taste: "杂粮颗粒有嚼劲，比白米饭粗糙，带谷物香，没有咸味。", tasteEn: "Chewy mixed grains, coarser than white rice, with a grainy flavour and no salt.", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 50], i: [st("multigrain_rice_raw", 57)],
    routes: [
      route(["pressure_cooker"], [3, 45], "杂粮米淘洗后加水，压力锅高压 20 分钟，自然泄压 10 分钟", "Mixed grains rinsed, with water, 20 minutes at high pressure, then 10 minutes natural release."),
      route(["stove"], [5, 55], "杂粮米淘洗后加水煮开，盖盖小火煮 35 分钟，关火焖 10 分钟", "Mixed grains rinsed and brought to a boil, covered on low 35 minutes, then 10 minutes covered off the heat."),
    ] }),
  batchStaple({ id: MILLET, zh: "小米饭", en: "Millet rice", sum: "小米淘洗后加水，用电饭锅煮熟", sumEn: "Millet rinsed and cooked with water in a rice cooker.", taste: "小米颗粒细，软糯，带淡淡的谷物甜香，没有咸味。", tasteEn: "Fine, soft grains with a faint sweet, grainy aroma and no salt.", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 35], i: [st("millet_raw", 55)],
    routes: [
      route(["pressure_cooker"], [3, 30], "小米淘洗后加水，压力锅高压 10 分钟，自然泄压 10 分钟", "Millet rinsed, with water, 10 minutes at high pressure, then 10 minutes natural release."),
      route(["stove"], [5, 30], "小米淘洗后加水煮开，盖盖小火煮 20 分钟，关火焖 5 分钟", "Millet rinsed and brought to a boil, covered on low 20 minutes, then 5 minutes covered off the heat."),
    ] }),
  batchStaple({ id: QUINOA, zh: "藜麦饭", en: "Cooked quinoa", sum: "藜麦冲洗后加水煮 15 分钟，吸干水分", sumEn: "Quinoa rinsed and simmered in water for 15 minutes until the water is absorbed.", taste: "颗粒小，有嚼劲，带一点坚果香和泥土味，没有咸味。", tasteEn: "Small, chewy grains with a slight nutty, earthy flavour and no salt.", c: "mediterranean", m: "grain", t: [5, 20], i: [st("quinoa_cooked", 167)] }),
  batchStaple({ id: PASTA, zh: "水煮意面", en: "Boiled pasta", sum: "意面下入沸盐水煮 10 分钟，捞出沥干", sumEn: "Pasta boiled in salted water for 10 minutes and drained.", taste: "味道清淡，煮到有嚼劲，盐水煮过略带咸味。", tasteEn: "Plain, cooked to a chewy bite and lightly salted from the cooking water.", c: "italian", m: "grain", t: [5, 15], i: [st("pasta_dry", 54)] }),
  batchStaple({ id: WW_PASTA, zh: "水煮全麦意面", en: "Boiled whole-wheat pasta", sum: "全麦意面下入沸盐水煮 10 分钟，捞出沥干", sumEn: "Whole-wheat pasta boiled in salted water for 10 minutes and drained.", taste: "麦香比白意面重，更粗糙更有嚼劲，盐水煮过略带咸味。", tasteEn: "A stronger wheat flavour than white pasta, coarser and chewier, lightly salted from the cooking water.", c: "italian", m: "grain", t: [5, 15], i: [st("whole_wheat_pasta_dry", 57)] }),
  batchStaple({ id: SOBA, zh: "水煮荞麦面", en: "Boiled soba noodles", sum: "荞麦面下入沸水煮熟，过凉水沥干", sumEn: "Soba boiled until tender, rinsed cold and drained.", taste: "有荞麦的谷物香，口感软而易断，过凉水后清爽。", tasteEn: "Nutty buckwheat flavour with a soft, easily broken bite, cool and fresh after the cold rinse.", c: "japanese", m: "grain", t: [5, 10], i: [st("soba_fresh", 135)] }),
  batchStaple({ id: VERMICELLI, zh: "泡发米粉", en: "Rice vermicelli", sum: "干米粉用开水泡软，沥干", sumEn: "Dried rice vermicelli soaked in boiling water until soft, then drained.", taste: "味道清淡，细而软滑，没有咸味。", tasteEn: "Plain, thin and soft-smooth, with no salt.", c: "southeast_asian", m: "grain", eq: ["kettle"], t: [5, 12], i: [st("rice_noodles_dry", 57)],
    routes: [route(["stove"], [5, 15], "锅里烧开水后关火，放干米粉泡软，沥干", "Water boiled in a pot and taken off the heat, the dried vermicelli soaked in it until soft, then drained.")] }),
  batchStaple({ id: SWEET_POTATO, zh: "蒸红薯", en: "Steamed sweet potato", sum: "红薯洗净连皮上锅蒸 25 分钟", sumEn: "Sweet potato washed and steamed with the skin on for 25 minutes.", taste: "自带甜味，软糯，皮薄，没有调味。", tasteEn: "Naturally sweet and soft with a thin skin, unseasoned.", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 30], i: [st("sweet_potato", 174)],
    routes: [route(["microwave"], [3, 12], "红薯洗净扎几个孔，微波 8 分钟至软", "Sweet potato washed and pricked, microwaved about 8 minutes until soft.")] }),
  batchStaple({ id: MICROWAVE_POTATO, zh: "微波土豆", en: "Microwaved potato", sum: "土豆洗净扎孔，微波 8 分钟至软", sumEn: "Potato washed and pricked, microwaved about 8 minutes until soft.", taste: "淡淡的土豆香，粉糯，没有调味。", tasteEn: "A mild potato flavour, floury and soft, unseasoned.", c: "american", m: "steam", eq: ["microwave"], t: [3, 12], i: [st("potato", 270)] }),
  batchStaple({
    id: BABY_POTATOES, zh: "蒸小土豆", en: "Steamed baby potatoes", sum: "小土豆上锅蒸 20 分钟，拌橄榄油、烟熏红椒粉和盐", sumEn: "Baby potatoes steamed 20 minutes, tossed with olive oil, smoked paprika and salt.", taste: "带皮软糯，橄榄油和烟熏红椒粉带淡淡烟熏味，微咸。", tasteEn: "Soft, with the skin on, coated in olive oil, lightly salted, with a faint smoky paprika note.", c: "american", m: "steam", eq: ["steamer"], t: [5, 25],
    i: [st("baby_potato", 340), oi("olive_oil", 3), se("smoked_paprika", 1), se("salt", 0.3)],
    routes: [route(["stove"], [5, 25], "小土豆冷水下锅煮开再煮 15 分钟，沥干，拌橄榄油、红椒粉和盐", "Baby potatoes brought to a boil from cold and simmered 15 minutes, drained, tossed with olive oil, smoked paprika and salt.")],
  }),
  batchStaple({ id: CORN, zh: "蒸糯玉米", en: "Steamed waxy corn", sum: "糯玉米带叶上锅蒸 20 分钟", sumEn: "Waxy corn cobs steamed for 20 minutes.", taste: "软糯微甜，有嚼劲，没有调味。", tasteEn: "Soft, chewy and slightly sweet, unseasoned.", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 25], i: [st("waxy_corn_cob", 121)],
    routes: [route(["stove"], [3, 20], "糯玉米放进开水锅里煮 15 分钟", "Waxy corn cobs boiled in a pot of water for 15 minutes.")] }),
];

const SIDES: Dish[] = [
  dish({ id: "steamed_broccoli_lemon", zh: "柠檬清蒸西兰花", en: "Steamed broccoli with lemon", sum: "冷冻西兰花上锅蒸 5 分钟，淋柠檬汁和橄榄油", sumEn: "Frozen broccoli steamed 5 minutes, dressed with lemon and olive oil.", taste: "清淡，柠檬的酸和橄榄油香，西兰花蒸软。", tasteEn: "Light, with lemon tang and olive oil; steamed soft broccoli.", role: "side", c: "mediterranean", m: "steam", eq: ["steamer"], t: [3, 8], i: [ve("frozen_broccoli", 150), se("lemon", 6), oi("olive_oil", 3), se("salt", 0.3)] }),
  dish({ id: "garlic_bok_choy", zh: "蒜蓉炒上海青", en: "Stir-fried bok choy with garlic paste", sum: "上海青大火快炒，加蒜蓉酱和盐调味", sumEn: "Bok choy stir-fried hot with garlic paste and salt.", taste: "蒜香，微咸，上海青大火炒得脆嫩多汁。", tasteEn: "Garlicky and lightly salted; bok choy stir-fried hot, crisp and juicy.", role: "side", c: "chinese", m: "stir_fry", t: [5, 7], i: [ve("bok_choy", 160), se("garlic_paste", 2), co("canola_oil", 3), se("salt", 0.3)] }),
  dish({ id: "oyster_broccoli", zh: "蚝油西兰花", en: "Blanched broccoli with oyster sauce", sum: "冷冻西兰花焯水沥干，淋蚝油和香油", sumEn: "Frozen broccoli blanched and drained, dressed with oyster sauce and sesame oil.", taste: "蚝油的咸鲜微甜，香油提香，西兰花焯过后软中带脆。", tasteEn: "Savoury, slightly sweet oyster sauce with sesame oil; blanched broccoli, tender with a little bite.", role: "side", c: "chinese", m: "greens", t: [5, 8], i: [ve("frozen_broccoli", 150), se("oyster_sauce", 2), oi("sesame_oil", 1.5)] }),
  dish({ id: "goma_ae_spinach", zh: "芝麻酱拌菠菜", en: "Spinach with sesame dressing", sum: "冷冻菠菜解冻挤干，拌芝麻酱和酱油", sumEn: "Frozen spinach thawed and squeezed dry, mixed with sesame paste and soy sauce.", taste: "芝麻酱浓香，酱油带淡淡咸味，菠菜软。", tasteEn: "Rich sesame paste with a light soy saltiness; soft spinach.", role: "side", c: "japanese", m: "greens", t: [5, 8], i: [ve("frozen_spinach", 150), oi("sesame_paste", 6), se("light_soy_sauce", 1.5)] }),
  dish({ id: "greek_cucumber_tomato_salad", zh: "希腊风黄瓜番茄沙拉", en: "Greek-style cucumber and tomato salad", sum: "黄瓜、番茄、红洋葱切块，撒牛至，淋橄榄油和柠檬汁", sumEn: "Cucumber, tomato and red onion cut up, sprinkled with oregano and dressed with oil and lemon.", taste: "酸爽，柠檬汁和橄榄油拌着，牛至带草香，黄瓜番茄脆而多汁，红洋葱微辛。", tasteEn: "Fresh and tart with lemon and olive oil, herby oregano, crisp juicy cucumber and tomato, and a little sharp red onion.", role: "side", c: "mediterranean", m: "salad", eq: [], t: [6, 6], i: [ve("cucumber", 75), ve("tomato", 65), ve("red_onion", 10), oi("olive_oil", 3), se("dried_oregano", 0.5), se("lemon", 5)] }),
  dish({ id: "steamed_pumpkin_soy", zh: "酱油蒸南瓜块", en: "Steamed pumpkin with soy sauce", sum: "南瓜切块上锅蒸 10 分钟，拌酱油和香油", sumEn: "Pumpkin cubes steamed 10 minutes, tossed with soy sauce and sesame oil.", taste: "南瓜蒸软后自带甜味，粉糯，酱油淡咸，香油带香。", tasteEn: "Steamed pumpkin is naturally sweet and soft; light soy saltiness and a little sesame oil.", role: "side", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 13], i: [ve("pumpkin", 160), se("reduced_salt_soy_sauce", 2), oi("sesame_oil", 1.5)] }),
  dish({ id: "fresh_salsa_salad", zh: "青柠番茄碎（salsa）", en: "Fresh tomato salsa with lime", sum: "番茄、洋葱、黄瓜切小丁，拌青柠汁和盐", sumEn: "Tomato, onion and cucumber diced and mixed with lime juice and salt.", taste: "青柠的酸，番茄洋葱黄瓜切成小丁，生吃，清爽多汁，咸味淡。", tasteEn: "Lime tang with diced tomato, onion and cucumber, raw, fresh and juicy; lightly salted.", role: "side", c: "mexican", m: "salad", eq: [], t: [6, 6], i: [ve("tomato", 110), ve("red_onion", 20), ve("cucumber", 30), se("lime", 8), se("salt", 0.3)] }),
  dish({ id: "sauteed_zucchini_lemon", zh: "柠檬炒西葫芦", en: "Sauteed zucchini with lemon", sum: "西葫芦切片用油炒软，加柠檬汁和意式香草", sumEn: "Zucchini slices sauteed soft in a little oil, finished with lemon and Italian herbs.", taste: "西葫芦炒软后清甜，柠檬汁带酸，意式香草味。", tasteEn: "Sauteed zucchini is soft and mildly sweet, with lemon tang and Italian herbs.", role: "side", c: "italian", m: "stir_fry", t: [6, 8], i: [ve("zucchini", 150), co("olive_oil", 4), se("italian_seasoning", 1), se("lemon", 4), se("salt", 0.3)] }),
  dish({ id: "lemon_green_beans_almond", zh: "杏仁柠檬四季豆", en: "Microwaved green beans with almonds", sum: "冷冻四季豆微波加热 3 分钟，拌柠檬汁和盐，撒杏仁", sumEn: "Frozen green beans microwaved 3 minutes, tossed with lemon and salt, topped with almonds.", taste: "柠檬的酸，微咸，四季豆微波后偏软，杏仁脆。", tasteEn: "Lemon tang and a little salt; microwaved green beans are fairly soft, with crunchy almonds.", role: "side", c: "american", m: "microwave", eq: ["microwave"], t: [4, 7], i: [ve("frozen_green_beans", 150), tp("almonds", 6), se("lemon", 5), se("salt", 0.3)] }),

  // Quick sides (hands-on 5 minutes or less, default kitchen, low sodium): the
  // planner adds one to any meal that is short of deep-coloured vegetables
  // (docs/671 多样性).
  dish({ id: "microwave_spinach_sesame", zh: "微波菠菜拌芝麻", en: "Microwaved spinach with sesame", sum: "冷冻菠菜微波加热 4 分钟，挤干水，拌酱油、香油和芝麻", sumEn: "Frozen spinach microwaved 4 minutes and squeezed dry, mixed with soy sauce, sesame oil and sesame seeds.", taste: "酱油、香油和芝麻的香，菠菜软，咸味淡。", tasteEn: "Soy sauce, sesame oil and sesame seeds; soft spinach, lightly salted.", role: "side", c: "japanese", m: "microwave", eq: ["microwave"], t: [4, 8], i: [ve("frozen_spinach", 150), oi("sesame_seeds", 4), oi("sesame_oil", 1), se("reduced_salt_soy_sauce", 2)] }),
  dish({ id: "quick_garlic_spinach", zh: "蒜蓉快炒菠菜", en: "Quick stir-fried spinach with garlic paste", sum: "菠菜大火快炒 2 分钟，加蒜蓉酱和盐调味", sumEn: "Spinach stir-fried hot for 2 minutes with garlic paste and salt.", taste: "蒜香，微咸，菠菜快炒后软嫩出水。", tasteEn: "Garlicky and lightly salted; quick-fried spinach is soft and a little watery.", role: "side", c: "chinese", m: "stir_fry", t: [4, 6], i: [ve("spinach", 160), se("garlic_paste", 2), co("canola_oil", 3), se("salt", 0.3)] }),
  dish({ id: "steamed_carrot_coins", zh: "清蒸胡萝卜片", en: "Steamed carrot coins", sum: "胡萝卜切厚片上锅蒸 10 分钟，拌橄榄油、少许盐和黑胡椒", sumEn: "Carrot cut into thick coins and steamed 10 minutes, tossed with olive oil, a pinch of salt and black pepper.", taste: "胡萝卜自带的甜，橄榄油和黑胡椒提味，蒸软。", tasteEn: "The natural sweetness of carrot with olive oil and black pepper; steamed soft.", role: "side", c: "american", m: "steam", eq: ["steamer"], t: [3, 13], i: [ve("carrot", 150), oi("olive_oil", 3), se("salt", 0.1), se("ground_black_pepper", 0.3)],
    routes: [route(["microwave"], [3, 8], "胡萝卜切厚片加一勺水，盖上微波 5 分钟，拌橄榄油、盐和黑胡椒", "Carrot coins with a spoon of water, covered and microwaved 5 minutes, tossed with olive oil, salt and black pepper.")] }),
  dish({ id: "soy_green_beans_microwave", zh: "酱油四季豆", en: "Microwaved green beans with soy sauce", sum: "冷冻四季豆微波加热 4 分钟，拌酱油和香油", sumEn: "Frozen green beans microwaved 4 minutes, tossed with soy sauce and sesame oil.", taste: "酱油的咸香，香油提香，四季豆微波后偏软。", tasteEn: "Salty soy and sesame oil; microwaved green beans are fairly soft.", role: "side", c: "chinese", m: "microwave", eq: ["microwave"], t: [3, 7], i: [ve("frozen_green_beans", 150), se("reduced_salt_soy_sauce", 3), oi("sesame_oil", 1.5)] }),
  dish({ id: "tomato_cucumber_salad", zh: "番茄黄瓜沙拉", en: "Tomato and cucumber salad", sum: "番茄和黄瓜切块，拌橄榄油、米醋和盐，不用开火", sumEn: "Tomato and cucumber cut up and tossed with olive oil, rice vinegar and salt; no cooking.", taste: "微酸清爽，米醋和橄榄油拌着，番茄黄瓜多汁。", tasteEn: "Fresh and lightly sour with rice vinegar and olive oil; juicy tomato and cucumber.", role: "side", c: "mediterranean", m: "salad", eq: [], t: [4, 4], i: [ve("tomato", 100), ve("cucumber", 50), oi("olive_oil", 3), se("rice_vinegar", 6), se("salt", 0.3)] }),
  dish({ id: "purple_cabbage_vinegar", zh: "醋拌紫甘蓝丝", en: "Shredded purple cabbage with vinegar", sum: "紫甘蓝和胡萝卜切丝，拌米醋、橄榄油和盐，不用开火", sumEn: "Purple cabbage and carrot shredded and tossed with rice vinegar, olive oil and salt; no cooking.", taste: "偏酸，紫甘蓝脆，胡萝卜丝带点甜，米醋和橄榄油拌着。", tasteEn: "Fairly sour with crunchy red cabbage and a little sweet carrot, dressed in rice vinegar and olive oil.", role: "side", c: "american", m: "salad", eq: [], t: [5, 5], i: [ve("red_cabbage", 130), ve("carrot", 25), oi("olive_oil", 3), se("rice_vinegar", 8), se("salt", 0.3)] }),
  dish({ id: "romaine_cherry_tomato_salad", zh: "生菜小番茄沙拉", en: "Romaine and cherry tomato salad", sum: "罗马生菜撕块，加对半切的小番茄，拌橄榄油和柠檬汁，不用开火", sumEn: "Romaine torn up with halved cherry tomatoes, tossed with olive oil and lemon juice; no cooking.", taste: "柠檬汁带酸，罗马生菜脆，小番茄多汁，橄榄油拌着。", tasteEn: "Lemon tang, crisp romaine and juicy cherry tomatoes dressed with olive oil.", role: "side", c: "mediterranean", m: "salad", eq: [], t: [4, 4], i: [ve("romaine", 100), ve("cherry_tomato", 60), oi("olive_oil", 3), se("lemon", 6), se("salt", 0.3)] }),
];

const BREAKFASTS: Dish[] = [
  dish({
    id: "milk_toast_boiled_egg", zh: "牛奶全麦吐司水煮蛋", en: "Milk, whole-wheat toast and a boiled egg",
    sum: "鸡蛋煮 8 分钟，两片吐司在平底锅煎热，牛奶倒杯即可", sumEn: "Boil the egg 8 minutes, pan-toast two slices of bread, pour the milk.", taste: "清淡，全麦吐司煎热后微脆，水煮蛋味淡，配一杯牛奶。", tasteEn: "Plain: whole-wheat toast pan-warmed and slightly crisp, a boiled egg and a glass of milk.",
    role: "breakfast", c: "american", m: "simmer", eq: ["stove"], t: [4, 12],
    i: [pr("low_fat_milk", 250), pr("egg", 100), st("whole_wheat_toast", 70)],
  }),
  dish({
    id: "soy_milk_bun_tea_egg", zh: "豆浆馒头茶叶蛋", en: "Soy milk, steamed bun and tea egg",
    sum: "馒头上锅蒸热，配现成的茶叶蛋、豆浆和橘子", sumEn: "Steam the bun until hot; serve with a ready tea egg, soy milk and a mandarin.", taste: "馒头松软微甜，茶叶蛋咸香带茶味，豆浆有豆香，橘子酸甜。", tasteEn: "Soft, faintly sweet bun, a salty tea egg with a tea aroma, soy milk with a beany taste and a sweet-tart mandarin.",
    role: "breakfast", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 8],
    i: [pr("soy_milk_unsweetened", 250), pr("tea_egg", 50), st("steamed_bun", 50), fr("mandarin", 100)],
  }),
  dish({
    id: "yogurt_blueberry_toast_egg", zh: "酸奶蓝莓吐司水煮蛋", en: "Yogurt with blueberries, toast and a boiled egg",
    sum: "鸡蛋煮 8 分钟，吐司在平底锅煎热，酸奶拌蓝莓", sumEn: "Boil the egg 8 minutes, pan-toast the bread, stir blueberries into the yogurt.", taste: "酸奶微酸，蓝莓酸甜，吐司煎热，水煮蛋味淡。", tasteEn: "Mildly sour yogurt with sweet-tart blueberries, warm toast and a plain boiled egg.",
    role: "breakfast", c: "american", m: "simmer", eq: ["stove"], t: [4, 12],
    i: [pr("plain_yogurt", 150), pr("egg", 50), st("wholegrain_toast", 35), fr("frozen_blueberries", 60)],
  }),
  dish({
    id: "milk_oats_banana", zh: "牛奶燕麦片香蕉水煮蛋", en: "Milk, oat cereal, banana and a boiled egg",
    sum: "鸡蛋煮 8 分钟，燕麦片倒进牛奶泡软，切香蕉片放上面", sumEn: "Boil the egg 8 minutes, soak the oats in milk and top with sliced banana.", taste: "燕麦泡软后软糯，香蕉带甜，水煮蛋味淡，整体清淡。", tasteEn: "Oats softened in milk, sweet banana and a plain boiled egg; a light breakfast.",
    role: "breakfast", c: "american", m: "assemble", eq: [], t: [3, 3],
    i: [pr("low_fat_milk", 250), pr("egg", 50), st("oats", 30), fr("banana", 80)],
  }),
  dish({
    id: "microwave_egg_cheese_tortilla", zh: "鸡蛋奶酪玉米饼卷", en: "Scrambled egg and cheese tortilla",
    sum: "鸡蛋打散微波 1 分半炒熟，和奶酪片、番茄一起卷进玉米饼", sumEn: "Microwave the beaten egg 90 seconds, then roll it with cheese and tomato in corn tortillas.", taste: "鸡蛋软嫩咸香，奶酪片带奶香，番茄微酸，玉米饼包着吃。", tasteEn: "Soft salty scrambled egg, creamy cheese and slightly tart tomato in a corn tortilla.",
    role: "breakfast", c: "mexican", m: "microwave", eq: ["microwave"], t: [4, 5],
    i: [pr("egg", 100), pr("cheese_slice", 10), st("corn_tortilla", 60), ve("tomato", 50)],
  }),
  dish({
    id: "yogurt_oats_blueberry_walnut", zh: "希腊酸奶燕麦蓝莓核桃", en: "Greek yogurt, oats, blueberries and walnuts",
    sum: "燕麦片拌进希腊酸奶，放上蓝莓和核桃碎，不用开火", sumEn: "Stir oats into Greek yogurt and top with blueberries and chopped walnuts; no cooking.", taste: "希腊酸奶浓稠微酸，燕麦软，蓝莓酸甜，核桃脆，没有加糖。", tasteEn: "Thick, mildly sour Greek yogurt with soft oats, sweet-tart blueberries and crunchy walnuts; no added sugar.",
    role: "breakfast", c: "american", m: "assemble", eq: [], t: [3, 3],
    i: [pr("greek_yogurt", 200), st("oats", 30), fr("frozen_blueberries", 60), tp("walnuts", 8)],
  }),
  dish({
    id: "pita_egg_yogurt_tomato", zh: "口袋饼水煮蛋酸奶小番茄", en: "Pita with a boiled egg, Greek yogurt and cherry tomatoes",
    sum: "鸡蛋煮 8 分钟，口袋饼切开，配希腊酸奶和小番茄", sumEn: "Boil the egg 8 minutes; serve with sliced pita, Greek yogurt and cherry tomatoes.", taste: "希腊酸奶微酸，口袋饼软，水煮蛋味淡，小番茄多汁，橄榄油提香。", tasteEn: "Mildly sour Greek yogurt, soft pita, a plain boiled egg, juicy cherry tomatoes and a little olive oil.",
    role: "breakfast", c: "mediterranean", m: "simmer", t: [4, 12],
    i: [pr("egg", 50), pr("greek_yogurt", 100), st("whole_wheat_pita", 40), ve("cherry_tomato", 60), oi("olive_oil", 3)],
  }),
  dish({
    id: "miso_egg_soup_rice_ball_egg", zh: "味噌蛋花汤饭团水煮蛋", en: "Miso egg-drop soup, rice ball and a boiled egg",
    sum: "热水化开味噌煮开，淋入蛋液成蛋花，米饭捏成饭团裹海苔，再配水煮蛋", sumEn: "Dissolve miso in hot water, drop in beaten egg for egg-drop soup; shape rice into a ball wrapped in nori; serve with a boiled egg.", taste: "味噌汤咸鲜，蛋花软，饭团裹海苔咸香，水煮蛋味淡。", tasteEn: "Salty-savoury miso soup with soft egg ribbons, a nori-wrapped rice ball and a plain boiled egg.",
    role: "breakfast", c: "japanese", m: "simmer", t: [5, 12],
    i: [pr("egg", 50), pr("egg", 50), se("miso", 6), st("rice_cooked", 100), ve("nori", 1)],
  }),
  dish({
    id: "chicken_wrap_milk", zh: "鸡胸肉口袋饼配牛奶", en: "Chicken pita with milk",
    sum: "即食鸡胸肉撕丝，和黄瓜一起塞进口袋饼，配一杯牛奶", sumEn: "Shred ready-cooked chicken, stuff it into a pita with cucumber, serve with a glass of milk.", taste: "鸡肉丝偏咸鲜，黄瓜脆，口袋饼软，配一杯牛奶。", tasteEn: "Savoury shredded chicken with crisp cucumber in soft pita, with a glass of milk.",
    role: "breakfast", c: "american", m: "assemble", eq: [], t: [4, 4],
    i: [pr("ready_chicken_breast", 60), pr("low_fat_milk", 250), st("whole_wheat_pita", 40), ve("cucumber", 40)],
  }),
  dish({
    id: "sweet_potato_egg_soy_milk", zh: "蒸红薯水煮蛋豆浆", en: "Steamed sweet potato, boiled egg and soy milk",
    sum: "红薯和鸡蛋放进同一个蒸锅蒸 15 分钟，配一杯豆浆", sumEn: "Steam the sweet potato and egg together for 15 minutes; serve with soy milk.", taste: "红薯蒸软自带甜，鸡蛋味淡，豆浆有豆香，整体清淡。", tasteEn: "Naturally sweet steamed sweet potato, a plain egg and soy milk with a beany taste; a light breakfast.",
    role: "breakfast", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 18],
    i: [pr("soy_milk_unsweetened", 250), pr("egg", 50), st("sweet_potato", 150)],
  }),
  // Soy milk maker breakfasts: the dry beans and the water go in the night
  // before with the timer set, so the milk is ready when the user wakes. The
  // line grams are the dry beans, oats and nuts that go into the maker, the
  // water is not a line (it has no nutrition), and the whole-bean milk is
  // drunk unstrained, so the nutrition is the dry ingredients' own. These
  // count as legumes in the plan (docs/671 多样性).
  dish({
    id: "soy_milk_maker_plain", zh: "自磨黄豆浆茶叶蛋馒头", en: "Home-made soy milk, tea egg and steamed bun",
    sum: "前一晚黄豆加水入豆浆机，设好定时；早上馒头微波热 1 分钟，配茶叶蛋", sumEn: "Load the soybeans and water into the soy milk maker the night before and set the timer; in the morning microwave the bun 1 minute and serve with a tea egg.", taste: "自磨黄豆浆豆香浓，偏稠，茶叶蛋咸香，馒头松软，橘子酸甜。", tasteEn: "Home-made soy milk with a strong bean flavour and a thick body, a salty tea egg, a soft bun and a sweet-tart mandarin.",
    role: "breakfast", c: "chinese", m: "assemble", eq: ["soy_milk_maker", "microwave"], t: [4, 35],
    i: [pr("soybean_dry", 25), pr("tea_egg", 50), st("steamed_bun", 100), fr("mandarin", 100)],
  }),
  dish({
    id: "soy_milk_maker_five_grain", zh: "五谷豆浆水煮蛋半个馒头", en: "Five-grain soy milk, two boiled eggs and half a steamed bun",
    sum: "前一晚黄豆燕麦小米红豆加水入豆浆机定时；早上煮 2 个蛋，配半个馒头", sumEn: "Load the soybeans, oats, millet and adzuki beans with water into the soy milk maker the night before and set the timer; in the morning boil two eggs 8 minutes and serve with half a bun.", taste: "五谷豆浆带谷物和豆香，偏稠，水煮蛋味淡，馒头松软，苹果酸甜。", tasteEn: "Grain-and-bean soy milk, rather thick, with plain boiled eggs, a soft half bun and a sweet-tart apple.",
    role: "breakfast", c: "chinese", m: "simmer", eq: ["soy_milk_maker", "stove"], t: [5, 40],
    i: [pr("soybean_dry", 20), st("adzuki_beans_dry", 8), st("oats", 15), st("millet_raw", 10), pr("egg", 100), st("steamed_bun", 50), fr("apple", 100)],
  }),
  dish({
    id: "soy_milk_maker_black_bean_walnut", zh: "黑豆核桃豆浆水煮蛋吐司", en: "Black bean walnut soy milk, boiled egg and toast",
    sum: "前一晚黄豆、黑豆、核桃加水入豆浆机，设好定时；早上煮蛋，配吐司", sumEn: "Load the soybeans, black soybeans and walnuts with water into the soy milk maker the night before and set the timer; in the morning boil the egg 8 minutes and serve with toast.", taste: "黑豆核桃豆浆有豆香和核桃的油香，偏稠，水煮蛋味淡，配吐司。", tasteEn: "Soy milk with a beany taste and walnut richness, rather thick, with a plain boiled egg and toast.",
    role: "breakfast", c: "chinese", m: "simmer", eq: ["soy_milk_maker", "stove"], t: [5, 40],
    i: [pr("soybean_dry", 20), pr("black_soybean_dry", 10), tp("walnuts", 8), pr("egg", 50), st("whole_wheat_toast", 70)],
  }),
  dish({
    id: "soy_milk_maker_red_date", zh: "红枣豆浆茶叶蛋全麦吐司", en: "Red date soy milk, tea egg and whole-wheat toast",
    sum: "前一晚黄豆、红枣加水入豆浆机，设好定时；早上倒出，配茶叶蛋和全麦吐司", sumEn: "Load the soybeans, dried red dates and water into the soy milk maker the night before and set the timer; in the morning pour it out and serve with a tea egg and whole-wheat toast.", taste: "红枣豆浆带红枣的甜香，茶叶蛋咸香，配全麦吐司。", tasteEn: "Soy milk with the sweet aroma of red dates, a salty tea egg and whole-wheat toast.",
    role: "breakfast", c: "chinese", m: "assemble", eq: ["soy_milk_maker"], t: [3, 35],
    i: [pr("soybean_dry", 25), fr("red_dates_dried", 10), pr("tea_egg", 50), st("whole_wheat_toast", 70)],
  }),
];

const AMERICAN: Dish[] = [
  dish({
    id: "chicken_bean_chili", zh: "鸡腿丁红芸豆炖菜（chili）", en: "Chicken and kidney bean chili", sum: "鸡腿肉丁、红芸豆、番茄、彩椒加辣椒粉和孜然炖 40 分钟", sumEn: "Diced chicken thigh, kidney beans, tomato and pepper simmered 40 minutes with chili powder and cumin.", taste: "咸香微辣，辣椒粉和孜然味明显，番茄带一点酸，红芸豆软糯，汤汁偏稠。", tasteEn: "Savoury and mildly spicy, with clear chili powder and cumin, a little tomato tang, soft kidney beans and a thick sauce.", c: "american", m: "stew", t: [15, 60],
    i: [pr("chicken_thigh", 125), st("canned_kidney_beans", 80), ve("crushed_tomatoes", 130), ve("onion", 40), ve("red_bell_pepper", 30), se("chili_powder_blend", 3), se("ground_cumin", 1)],
    ways: [
      way("鸡丁豆子炖菜盖糙米饭配菠菜", "Chicken chili over brown rice with spinach", BROWN, [ve("frozen_spinach", 140)]),
      way("鸡丁豆子炖菜卷玉米饼配生菜", "Chicken chili in corn tortillas with lettuce", "corn_tortilla", [ve("romaine", 90), ve("cherry_tomato", 80), tp("lime", 8)]),
      way("鸡丁豆子炖菜配土豆和西兰花", "Chicken chili on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "beef_black_bean_chili", zh: "牛肉黑豆炖菜（chili）", en: "Beef chunk and black bean chili", sum: "牛腱块加黑豆、番茄、彩椒和烟熏红椒粉，小火炖 90 分钟", sumEn: "Beef shank chunks simmered 90 minutes with black beans, tomato, pepper and smoked paprika.", taste: "咸香带烟熏味，辣椒粉和孜然让它微辣，牛腱炖到软烂，黑豆绵软，汤汁偏稠。", tasteEn: "Savoury and smoky, mildly spicy from chili powder and cumin; the shank is braised tender, the black beans are soft and the sauce is thick.", c: "american", m: "stew", t: [15, 120],
    i: [pr("beef_shank_raw", 135), st("canned_black_beans", 80), ve("crushed_tomatoes", 130), ve("onion", 40), ve("red_bell_pepper", 40), se("smoked_paprika", 2), se("ground_cumin", 1), se("chili_powder_blend", 2)],
    ways: [
      way("牛肉黑豆炖菜配蒸红薯和四季豆", "Beef chili on sweet potato with green beans", SWEET_POTATO, [ve("frozen_green_beans", 130), tp("lime", 8)]),
      way("牛肉黑豆炖菜盖糙米饭配生菜", "Beef chili over brown rice with lettuce", BROWN, [ve("romaine", 110), ve("red_bell_pepper", 50)]),
      way("牛肉黑豆炖菜卷全麦饼配紫甘蓝", "Beef chili in a whole-wheat wrap with red cabbage", "whole_wheat_tortilla", [ve("red_cabbage", 110), ve("tomato", 50)]),
    ],
  }),
  dish({
    id: "pressure_cooker_pulled_pork", zh: "压力锅手撕猪肉", en: "Pressure-cooker pulled pork", sum: "猪腿肉加洋葱和烧烤酱，压力锅压 45 分钟后撕散", sumEn: "Pork leg with onion and barbecue sauce, pressure-cooked 45 minutes, then shredded.", taste: "烧烤酱的甜咸带烟熏味，米醋压住一点腻，猪肉撕成丝，软嫩多汁。", tasteEn: "Sweet-salty barbecue with a smoky edge and a little vinegar tang; the pork is shredded, soft and moist.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 70],
    i: [pr("lean_pork_leg", 120), ve("onion", 50), se("bbq_sauce", 12), se("smoked_paprika", 1.5), se("rice_vinegar", 6), se("stock_paste", 1.25)],
    ways: [
      way("手撕猪肉夹口袋饼配胡萝卜生菜", "Pulled pork in pita with carrot and lettuce", "whole_wheat_pita", [ve("carrot", 70), ve("romaine", 100)]),
      way("手撕猪肉配土豆和西兰花", "Pulled pork on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 160)]),
      way("手撕猪肉盖糙米饭配四季豆", "Pulled pork over brown rice with green beans", BROWN, [ve("frozen_green_beans", 160)]),
    ],
  }),
  dish({
    id: "bbq_pulled_chicken", zh: "烧烤味手撕鸡", en: "BBQ pulled chicken", sum: "鸡胸肉加洋葱、烧烤酱和高汤，压力锅压 15 分钟后撕成丝", sumEn: "Chicken breast with onion, barbecue sauce and stock, pressure-cooked 15 minutes, then shredded.", taste: "烧烤酱的甜咸带烟熏味，蒜粉提香，鸡胸撕成丝，比猪肉清淡，汤汁不多。", tasteEn: "Sweet-salty barbecue with a smoky edge and a hint of garlic; the breast is shredded, leaner than pork, with little sauce.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 35],
    i: [pr("chicken_breast", 108), ve("onion", 50), se("bbq_sauce", 12), se("garlic_powder", 1), se("smoked_paprika", 1.5), se("stock_paste", 1.5)],
    ways: [
      way("烧烤手撕鸡夹口袋饼配生菜番茄", "BBQ chicken in pita with lettuce and tomato", "whole_wheat_pita", [ve("romaine", 90), ve("tomato", 80)]),
      way("烧烤手撕鸡配蒸红薯和四季豆", "BBQ chicken on sweet potato with green beans", SWEET_POTATO, [ve("frozen_green_beans", 160)]),
      way("烧烤手撕鸡盖杂粮饭配玉米", "BBQ chicken over multigrain rice with corn", GRAINS, [ve("frozen_corn", 60), ve("red_cabbage", 100)]),
    ],
  }),
  dish({
    id: "paprika_braised_chicken_thighs", zh: "红椒粉焖鸡腿肉", en: "Paprika braised chicken thighs", sum: "鸡腿肉、胡萝卜、洋葱抹红椒粉，平底锅加盖焖 30 分钟", sumEn: "Chicken thighs, carrot and onion rubbed with paprika and braised under a lid in one pan for 30 minutes.", taste: "红椒粉的烟熏微甜，洋葱和胡萝卜的甜味融进汤汁，鸡腿肉软嫩，调味温和不辣。", tasteEn: "Smoky-sweet paprika with the sweetness of onion and carrot in the juices; soft thigh meat, gently seasoned and not spicy.", c: "american", m: "braise", eq: ["stove"], t: [10, 40],
    i: [pr("chicken_thigh", 125), ve("carrot", 70), ve("onion", 50), se("smoked_paprika", 2), se("poultry_seasoning", 1.5), se("garlic_powder", 1), se("salt", 0.4), co("olive_oil", 3), se("stock_paste", 1.25)],
    ways: [
      way("红椒焖鸡腿配小土豆和生菜", "Paprika chicken with baby potatoes and lettuce", BABY_POTATOES, [ve("romaine", 80), ve("cucumber", 50)]),
      way("红椒焖鸡腿夹口袋饼配番茄黄瓜", "Paprika chicken in pita with tomato and cucumber", "whole_wheat_pita", [ve("tomato", 80), ve("cucumber", 50)]),
      way("红椒焖鸡腿配藜麦和菠菜", "Paprika chicken over quinoa with spinach", QUINOA, [ve("frozen_spinach", 110)]),
    ],
  }),
  dish({
    id: "chicken_vegetable_soup", zh: "鸡肉蔬菜汤", en: "Chicken and vegetable soup", sum: "鸡胸肉、胡萝卜、芹菜、洋葱加高汤小火煮 30 分钟", sumEn: "Chicken breast, carrot, celery and onion simmered in stock for 30 minutes.", taste: "清淡的鸡汤味，胡萝卜和芹菜带一点甜和清香，鸡胸肉软，汤清不油。", tasteEn: "A light chicken broth with the mild sweetness of carrot and the fresh note of celery; tender breast and a clear, not oily soup.", c: "american", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 108), ve("carrot", 60), ve("celery", 50), ve("onion", 40), se("stock_paste", 5), se("poultry_seasoning", 1)],
    ways: [
      way("鸡肉蔬菜汤配全麦吐司和生菜", "Chicken soup with whole-wheat toast and lettuce", "whole_wheat_toast", [ve("romaine", 110)]),
      way("鸡肉蔬菜汤加全麦意面配菠菜", "Chicken soup with whole-wheat pasta and spinach", WW_PASTA, [ve("frozen_spinach", 110)]),
      way("鸡肉蔬菜汤泡饭配四季豆", "Chicken soup over rice with green beans", RICE, [ve("frozen_green_beans", 100)]),
    ],
  }),
  dish({
    id: "beef_pot_roast", zh: "蔬菜炖牛腱", en: "Pot roast beef with vegetables", sum: "牛腱切块和胡萝卜、洋葱、番茄一起压力锅炖 45 分钟", sumEn: "Beef shank cubes with carrot, onion and tomato, pressure-cooked 45 minutes.", taste: "咸鲜带番茄的微酸，黑胡椒味轻，牛腱炖软，胡萝卜和洋葱出甜，汤汁多。", tasteEn: "Savoury with a mild tomato tang and light black pepper; soft shank, sweet carrot and onion, and plenty of juices.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 75],
    i: [pr("beef_shank_raw", 105), ve("carrot", 70), ve("onion", 50), ve("crushed_tomatoes", 130), se("stock_paste", 1.5), se("garlic_powder", 1), se("ground_black_pepper", 0.5), se("salt", 0.4)],
    ways: [
      way("蔬菜炖牛腱配小土豆和四季豆", "Pot roast with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 130)]),
      way("蔬菜炖牛腱拌全麦意面配生菜", "Pot roast with whole-wheat pasta and lettuce", WW_PASTA, [ve("romaine", 80), ve("cherry_tomato", 70)]),
      way("蔬菜炖牛腱配蒸红薯和西兰花", "Pot roast on sweet potato with broccoli", SWEET_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "beef_mushroom_paprika_stew", zh: "红椒粉蘑菇炖牛肉", en: "Beef and mushroom paprika stew", sum: "牛腱块、蘑菇、洋葱加高汤和红椒粉，压力锅压 40 分钟", sumEn: "Beef shank cubes, mushroom and onion with stock and paprika, pressure-cooked 40 minutes.", taste: "红椒粉的烟熏微甜，蘑菇出鲜，牛腱软烂，汤汁咸鲜不辣。", tasteEn: "Smoky-sweet paprika with the savoury depth of mushroom; falling-apart shank in a salty, savoury, not spicy sauce.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 120), ve("button_mushroom", 100), ve("onion", 40), se("stock_paste", 2.5), se("smoked_paprika", 1.5), se("garlic_powder", 1), se("salt", 0.3)],
    ways: [
      way("蘑菇炖牛肉拌全麦意面配彩椒", "Paprika beef with whole-wheat pasta and red pepper", WW_PASTA, [ve("red_bell_pepper", 100)]),
      way("蘑菇炖牛肉盖糙米饭配四季豆", "Paprika beef over brown rice with green beans", BROWN, [ve("frozen_green_beans", 130)]),
      way("蘑菇炖牛肉配土豆和西兰花", "Paprika beef on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "pressure_cooker_pepper_steak", zh: "彩椒炖牛肉（pepper steak）", en: "Pressure-cooker pepper steak", sum: "牛腱块、彩椒、洋葱、番茄碎加酱油，压力锅压 40 分钟", sumEn: "Beef shank cubes with peppers, onion, crushed tomato and soy sauce, pressure-cooked 40 minutes.", taste: "酱油的咸鲜加番茄的微酸，彩椒带甜和一点青味，牛腱软烂，黑胡椒味轻。", tasteEn: "Soy-sauce saltiness with a mild tomato tang, sweet bell pepper with a slightly green edge, soft shank and light black pepper.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), ve("green_pepper", 60), ve("red_bell_pepper", 50), ve("onion", 50), ve("crushed_tomatoes", 130), se("reduced_salt_soy_sauce", 4), se("garlic_powder", 1), se("ground_black_pepper", 0.5)],
    ways: [
      way("彩椒炖牛肉盖糙米饭配西兰花", "Pepper steak over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("彩椒炖牛肉配土豆和四季豆", "Pepper steak on a microwaved potato with green beans", MICROWAVE_POTATO, [ve("frozen_green_beans", 130)]),
      way("彩椒炖牛肉卷全麦饼配生菜", "Pepper steak in a whole-wheat wrap with lettuce", "whole_wheat_tortilla", [ve("romaine", 90), ve("carrot", 60)]),
    ],
  }),
  dish({
    id: "steak_spinach_salad", zh: "牛排菠菜沙拉", en: "Seared steak and spinach salad", sum: "西冷牛排煎到喜欢的熟度，切片放在菠菜和小番茄上", sumEn: "Sirloin steak pan-seared to taste, sliced over spinach and cherry tomatoes.", taste: "牛排外面煎出焦香、里面偏嫩，黑胡椒咸香，菠菜和小番茄清爽，米醋带一点酸。", tasteEn: "Seared steak with a browned crust and tender middle, peppery and salty, on fresh spinach and cherry tomatoes with a light vinegar tang.", c: "american", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, MICROWAVE_POTATO, "whole_wheat_toast"],
    i: [pr("sirloin_steak", 120), ve("spinach", 105), ve("cherry_tomato", 75), ve("red_onion", 20), oi("olive_oil", 4), se("rice_vinegar", 6), se("ground_black_pepper", 0.5), se("salt", 0.4)],
  }),
  dish({
    id: "tuna_cucumber_bowl", zh: "金枪鱼黄瓜沙拉碗", en: "Tuna and cucumber salad bowl", sum: "水浸金枪鱼拌橄榄油和柠檬汁，配黄瓜、生菜和小番茄，不用开火", sumEn: "Canned tuna mixed with olive oil and lemon juice, served on cucumber, lettuce and cherry tomato; no cooking.", taste: "清爽微酸，柠檬汁和橄榄油拌的金枪鱼味道偏淡，黄瓜和生菜脆。", tasteEn: "Fresh and lightly tart; tuna dressed with lemon and olive oil tastes mild, with crisp cucumber and romaine.", c: "american", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast", MICROWAVE_POTATO],
    i: [pr("canned_tuna_water", 125), oi("olive_oil", 4), ve("cucumber", 50), ve("cherry_tomato", 70), ve("romaine", 90), se("lemon", 8), se("salt", 0.2)],
  }),
  dish({
    id: "chicken_cobb_salad", zh: "鸡肉鸡蛋沙拉（Cobb）", en: "Chicken Cobb-style salad", sum: "即食鸡胸肉和水煮蛋切块，铺在生菜和番茄上，淋油醋汁", sumEn: "Ready-cooked chicken and boiled egg over lettuce and tomato with a vinaigrette.", taste: "味道清淡，油醋汁微酸，即食鸡胸肉紧实，鸡蛋软，生菜和番茄脆爽。", tasteEn: "Light, with a slightly tart vinaigrette; firm ready-cooked chicken, soft egg, crisp romaine and tomato.", c: "american", m: "assemble", eq: [], t: [10, 10],
    staples: ["whole_wheat_pita", QUINOA],
    i: [pr("ready_chicken_breast", 85), pr("egg", 65), ve("romaine", 120), ve("tomato", 85), oi("olive_oil", 4), se("rice_vinegar", 6)],
  }),
  dish({
    id: "salmon_broccoli_skillet", zh: "香煎三文鱼配西兰花", en: "Pan-seared salmon with broccoli", sum: "三文鱼皮朝下煎熟，冷冻西兰花同锅煎软，挤上柠檬汁", sumEn: "Salmon seared skin-side down, frozen broccoli cooked in the same pan, finished with lemon.", taste: "三文鱼皮脆肉嫩、油脂香，柠檬汁和柠檬胡椒带酸和胡椒味，西兰花煎软有一点焦香。", tasteEn: "Salmon with crisp skin and rich, tender flesh; lemon juice and lemon pepper add tang and pepper, and the broccoli is pan-softened with a little browning.", c: "american", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, QUINOA, BROWN],
    i: [pr("salmon", 120), ve("frozen_broccoli", 185), co("olive_oil", 3), se("lemon", 8), se("lemon_pepper_seasoning", 1), se("salt", 0.2)],
  }),
  dish({
    id: "cajun_shrimp_zucchini", zh: "卡津香料炒虾仁西葫芦", en: "Cajun shrimp with zucchini", sum: "虾仁用卡津香料拌匀，和西葫芦、彩椒大火快炒", sumEn: "Shrimp tossed in Cajun spice and stir-fried quickly with zucchini and pepper.", taste: "卡津香料的咸香微辣，带烟熏和香草味，虾仁弹牙，西葫芦和彩椒大火炒到断生，脆中带软。", tasteEn: "Salty and mildly spicy from Cajun seasoning, with smoky and herby notes; springy shrimp and zucchini and pepper stir-fried just tender.", c: "american", m: "stir_fry", t: [12, 15],
    staples: [BROWN, GRAINS, PASTA],
    i: [pr("white_shrimp", 115), ve("zucchini", 80), ve("red_bell_pepper", 110), se("cajun_seasoning", 1.5), co("olive_oil", 4)],
  }),
];

const MEDITERRANEAN: Dish[] = [
  dish({
    id: "lemon_herb_braised_chicken", zh: "柠檬香草焖鸡胸", en: "Lemon-herb braised chicken breast", sum: "鸡胸肉和西葫芦、红洋葱加柠檬汁、牛至和少许高汤，加盖焖 15 分钟", sumEn: "Chicken breast with zucchini and red onion, lemon, oregano and a little stock, braised under a lid 15 minutes.", taste: "柠檬的酸香加牛至的草本味，调味清淡，鸡胸肉嫩，西葫芦出水带清甜。", tasteEn: "Lemony and herby with oregano, lightly seasoned; tender breast and watery, mildly sweet zucchini.", c: "mediterranean", m: "braise", eq: ["stove"], t: [10, 30],
    i: [pr("chicken_breast", 108), ve("zucchini", 80), ve("red_onion", 40), se("lemon", 10), se("dried_oregano", 1), se("salt", 0.4), co("olive_oil", 4), se("stock_paste", 1.25)],
    ways: [
      way("柠檬焖鸡胸配藜麦和菠菜番茄", "Lemon chicken over quinoa with spinach and tomato", QUINOA, [ve("frozen_spinach", 90), ve("tomato", 80)]),
      way("柠檬焖鸡胸夹口袋饼配生菜番茄", "Lemon chicken in pita with lettuce and tomato", "whole_wheat_pita", [ve("romaine", 80), ve("tomato", 80)]),
      way("柠檬焖鸡胸配小土豆和四季豆", "Lemon chicken with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 130)]),
    ],
  }),
  dish({
    id: "greek_lemon_chicken_soup", zh: "希腊柠檬鸡汤", en: "Greek-style lemon chicken soup", sum: "鸡胸肉、胡萝卜、芹菜加高汤煮软，起锅前挤柠檬汁加干莳萝", sumEn: "Chicken breast, carrot and celery simmered in stock, finished with lemon juice and dried dill.", taste: "清鸡汤里有明显的柠檬酸和莳萝草香，胡萝卜和芹菜清甜，整体清淡。", tasteEn: "A light chicken broth with clear lemon sourness and dill, mildly sweet carrot and celery.", c: "mediterranean", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 100), ve("carrot", 50), ve("celery", 40), se("stock_paste", 5), se("lemon", 20), se("dried_dill", 0.5)],
    ways: [
      way("柠檬鸡汤配口袋饼和黄瓜", "Lemon chicken soup with pita and cucumber", "whole_wheat_pita", [ve("cucumber", 60), ve("tomato", 80)]),
      way("柠檬鸡汤泡饭配南瓜", "Lemon chicken soup over rice with pumpkin", RICE, [ve("pumpkin", 120)]),
      way("柠檬鸡汤加全麦意面配小番茄", "Lemon chicken soup with whole-wheat pasta and cherry tomatoes", WW_PASTA, [ve("cherry_tomato", 70), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "chicken_chickpea_stew", zh: "鸡肉鹰嘴豆炖菜", en: "Chicken and chickpea stew", sum: "鸡胸肉块、鹰嘴豆、番茄、胡萝卜加孜然和辣椒酱炖 30 分钟", sumEn: "Chicken cubes, chickpeas, tomato and carrot simmered 30 minutes with cumin and harissa.", taste: "孜然和肉桂的暖香，哈里萨辣酱带一点辣，番茄微酸，鹰嘴豆粉糯，汤汁偏稠。", tasteEn: "Warm cumin and cinnamon with a little heat from harissa and a mild tomato tang; floury chickpeas in a thick sauce.", c: "mediterranean", m: "stew", t: [15, 45],
    i: [pr("chicken_breast", 115), st("canned_chickpeas", 80), ve("crushed_tomatoes", 130), ve("onion", 40), ve("carrot", 40), se("ground_cumin", 1), se("ground_cinnamon", 0.5), se("harissa", 5)],
    ways: [
      way("鹰嘴豆炖鸡配藜麦和黄瓜菠菜", "Chickpea stew over quinoa with cucumber and spinach", QUINOA, [ve("cucumber", 60), ve("frozen_spinach", 80)]),
      way("鹰嘴豆炖鸡夹口袋饼配生菜番茄", "Chickpea stew in pita with lettuce and tomato", "whole_wheat_pita", [ve("romaine", 80), ve("tomato", 80)]),
      way("鹰嘴豆炖鸡盖糙米饭配西兰花", "Chickpea stew over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "tomato_beef_kofta", zh: "番茄汁炖牛肉丸（kofta）", en: "Beef kofta simmered in tomato sauce", sum: "牛后腿肉现绞，拌孜然、红椒粉和洋葱碎捏丸，放进番茄汁煮 20 分钟", sumEn: "Lean beef round ground fresh, mixed with cumin, paprika and onion, rolled into balls and simmered 20 minutes in tomato sauce.", taste: "孜然和红椒粉的烟熏香，肉丸紧实微弹，番茄汁微酸，不辣。", tasteEn: "Cumin and smoked paprika, with firm, slightly springy meatballs in a mildly tangy tomato sauce; not spicy.", c: "mediterranean", m: "stew", eq: ["stove"], t: [15, 40],
    i: [gr("lean_beef", 110), ve("red_onion", 30), se("ground_cumin", 1.5), se("smoked_paprika", 1.5), se("garlic_powder", 1), se("salt", 0.4), ve("crushed_tomatoes", 130)],
    ways: [
      way("牛肉丸夹口袋饼配黄瓜番茄", "Kofta in pita with cucumber and tomato", "whole_wheat_pita", [ve("cucumber", 70), ve("tomato", 80)]),
      way("牛肉丸配藜麦和小番茄彩椒", "Kofta over quinoa with cherry tomatoes and red pepper", QUINOA, [ve("cherry_tomato", 100), ve("red_bell_pepper", 60)]),
      way("牛肉丸盖米饭配紫甘蓝", "Kofta over rice with red cabbage", RICE, [ve("red_cabbage", 150), tp("lime", 8)]),
    ],
  }),
  dish({
    id: "lemon_dill_steamed_salmon", zh: "柠檬莳萝蒸三文鱼", en: "Lemon-dill steamed salmon", sum: "三文鱼和四季豆、红彩椒淋柠檬汁、撒干莳萝，上锅蒸 10 分钟", sumEn: "Salmon with green beans and red pepper, lemon and dried dill, steamed 10 minutes.", taste: "清蒸的清淡口味，柠檬的酸和莳萝的草香，三文鱼油润，四季豆和彩椒脆甜。", tasteEn: "Light steamed flavour with lemon tang and dill; rich, moist salmon with crisp-sweet green beans and bell pepper.", c: "mediterranean", m: "steam", eq: ["steamer"], t: [10, 20],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("salmon", 120), ve("green_beans", 110), ve("red_bell_pepper", 70), se("lemon", 10), se("dried_dill", 0.5), oi("olive_oil", 2), se("salt", 0.3)],
  }),
  dish({
    id: "tomato_braised_cod", zh: "番茄炖鳕鱼", en: "Tomato-braised cod", sum: "番茄、洋葱和西葫芦煮成酱，铺上鳕鱼加盖煮 10 分钟", sumEn: "Tomato, onion and zucchini cooked into a sauce, cod laid on top and cooked under a lid 10 minutes.", taste: "番茄酸甜，牛至带草香，鳕鱼肉细嫩易散，酱汁清爽。", tasteEn: "Sweet-tart tomato with oregano; delicate cod that flakes easily in a light sauce.", c: "mediterranean", m: "stew", eq: ["stove"], t: [10, 25],
    staples: [PASTA, BROWN, "whole_wheat_pita"],
    i: [pr("cod", 140), ve("tomato", 150), ve("onion", 40), ve("zucchini", 50), se("dried_oregano", 1), co("olive_oil", 4), se("salt", 0.3)],
  }),
  dish({
    id: "lentil_tomato_stew", zh: "番茄扁豆炖菜", en: "Lentil and tomato stew", sum: "扁豆、番茄、胡萝卜、芹菜加高汤和孜然煮 30 分钟，挤柠檬汁", sumEn: "Lentils, tomato, carrot and celery simmered 30 minutes in stock with cumin, finished with lemon.", taste: "番茄微酸，孜然和牛至的香，扁豆绵软，起锅前挤柠檬提酸，汤汁偏稠。", tasteEn: "Mildly tart tomato with cumin and oregano; soft lentils, a squeeze of lemon at the end and a thick sauce.", c: "mediterranean", m: "stew", t: [12, 45],
    i: [st("lentils_dry", 75), ve("crushed_tomatoes", 130), ve("carrot", 50), ve("onion", 40), ve("celery", 30), se("stock_paste", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("lemon", 8)],
    ways: [
      way("番茄扁豆炖菜夹口袋饼配黄瓜", "Lentil stew in pita with cucumber", "whole_wheat_pita", [ve("cucumber", 60), ve("tomato", 80)]),
      way("番茄扁豆炖菜盖糙米饭配菠菜", "Lentil stew over brown rice with spinach", BROWN, [ve("frozen_spinach", 110)]),
      way("番茄扁豆炖菜配土豆和小番茄", "Lentil stew on a microwaved potato with cherry tomatoes", MICROWAVE_POTATO, [ve("cherry_tomato", 70)]),
    ],
  }),
  dish({
    id: "harissa_braised_chicken", zh: "辣椒酱焖鸡腿（harissa）", en: "Harissa braised chicken thighs", sum: "鸡腿肉、彩椒、西葫芦和红洋葱拌北非辣椒酱，压力锅压 10 分钟", sumEn: "Chicken thighs, pepper, zucchini and red onion tossed in harissa, pressure-cooked 10 minutes.", taste: "哈里萨辣酱的辣和烟熏香，辣度中等，孜然提味，彩椒和西葫芦出汁带甜，鸡腿肉软嫩。", tasteEn: "Medium heat and smokiness from harissa with cumin; bell pepper and zucchini give sweet juices around soft thigh meat.", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 30],
    i: [pr("chicken_thigh", 125), ve("red_bell_pepper", 60), ve("zucchini", 50), ve("red_onion", 40), se("harissa", 8), se("ground_cumin", 1), co("olive_oil", 2), se("salt", 0.3), se("stock_paste", 1.5)],
    ways: [
      way("哈里萨焖鸡腿配藜麦和四季豆", "Harissa chicken over quinoa with green beans", QUINOA, [ve("frozen_green_beans", 100)]),
      way("哈里萨焖鸡腿夹口袋饼配生菜", "Harissa chicken in pita with lettuce", "whole_wheat_pita", [ve("romaine", 80), ve("tomato", 80)]),
      way("哈里萨焖鸡腿配小土豆和胡萝卜", "Harissa chicken with baby potatoes and carrot", BABY_POTATOES, [ve("carrot", 120)]),
    ],
  }),
  dish({
    id: "greek_beef_stifado", zh: "希腊洋葱番茄炖牛腱（stifado）", en: "Greek beef stifado", sum: "牛腱切块和大量洋葱、番茄、肉桂一起压力锅炖 45 分钟", sumEn: "Beef shank cubes with plenty of onion, tomato and cinnamon, pressure-cooked 45 minutes.", taste: "大量洋葱和番茄的酸甜，一点肉桂的暖香，牛腱炖软，汤汁偏稠偏甜。", tasteEn: "Sweet-tart onion and tomato with a touch of warm cinnamon; soft shank in a thick, rather sweet sauce.", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 75],
    i: [pr("beef_shank_raw", 105), ve("onion", 70), ve("crushed_tomatoes", 130), se("ground_cinnamon", 0.5), se("dried_oregano", 1), se("stock_paste", 1.25), se("salt", 0.4)],
    ways: [
      way("洋葱炖牛腱拌意面配生菜", "Stifado with pasta and lettuce", PASTA, [ve("romaine", 110), ve("cherry_tomato", 50)]),
      way("洋葱炖牛腱配小土豆和四季豆", "Stifado with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 160)]),
      way("洋葱炖牛腱盖糙米饭配西兰花", "Stifado over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 160)]),
    ],
  }),
  dish({
    id: "lubia_beef_green_beans", zh: "番茄四季豆炖牛肉（lubia）", en: "Lebanese beef and green bean stew (lubia)", sum: "牛腱块、四季豆、番茄碎加肉桂和孜然，压力锅炖 35 分钟", sumEn: "Beef shank cubes, green beans and crushed tomato with cinnamon and cumin, pressure-cooked 35 minutes.", taste: "番茄的微酸加肉桂和孜然的暖香，四季豆煮软，牛腱软烂，不辣。", tasteEn: "Mild tomato tang with warm cinnamon and cumin; well-cooked soft green beans and tender shank; not spicy.", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 60],
    i: [pr("beef_shank_raw", 105), ve("green_beans", 120), ve("crushed_tomatoes", 130), ve("onion", 40), se("ground_cinnamon", 0.5), se("ground_cumin", 1), se("garlic_paste", 2), co("olive_oil", 3), se("salt", 0.3)],
    ways: [
      way("四季豆炖牛肉盖米饭配黄瓜", "Lubia over rice with cucumber", RICE, [ve("cucumber", 70)]),
      way("四季豆炖牛肉配藜麦和小番茄", "Lubia over quinoa with cherry tomatoes", QUINOA, [ve("cherry_tomato", 70)]),
      way("四季豆炖牛肉夹口袋饼配生菜", "Lubia in pita with lettuce", "whole_wheat_pita", [ve("romaine", 80), ve("tomato", 80)]),
    ],
  }),
  dish({
    id: "shakshuka", zh: "鸡肉番茄红椒焖蛋（shakshuka）", en: "Shakshuka with chicken", sum: "番茄、彩椒、洋葱炒软煮成酱，拌入鸡肉丝，打入鸡蛋盖盖焖熟", sumEn: "Tomato, pepper and onion cooked into a sauce, shredded chicken stirred in, eggs set in it under a lid.", taste: "番茄红椒酱酸甜，带烟熏红椒香，鸡蛋焖熟后可蘸酱，鸡肉丝补一点咸鲜，不辣。", tasteEn: "A sweet-tart tomato and pepper sauce with smoked paprika, eggs set in it to dip, and shredded chicken for savouriness; not spicy.", c: "mediterranean", m: "pan_fry", t: [12, 20],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("egg", 100), pr("ready_chicken_breast", 85), ve("tomato", 170), ve("red_bell_pepper", 70), ve("onion", 30), se("smoked_paprika", 1.5), co("olive_oil", 2)],
  }),
  dish({
    id: "mediterranean_chicken_salad", zh: "地中海鸡肉沙拉", en: "Mediterranean chicken salad", sum: "即食鸡胸肉拌黄瓜、番茄和红洋葱，淋橄榄油、柠檬汁，撒牛至", sumEn: "Ready-cooked chicken tossed with cucumber, tomato and red onion, dressed with oil and lemon, sprinkled with oregano.", taste: "清爽微酸，柠檬汁和橄榄油拌的黄瓜番茄多汁，牛至带草香，鸡肉味淡。", tasteEn: "Fresh and lightly tart with lemon and olive oil, juicy cucumber and tomato, oregano, and mild chicken.", c: "mediterranean", m: "assemble", eq: [], t: [10, 10],
    staples: ["whole_wheat_pita", QUINOA, BABY_POTATOES],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 50), ve("tomato", 120), ve("red_onion", 20), oi("olive_oil", 4), se("dried_oregano", 1), se("lemon", 8)],
  }),
  dish({
    id: "tuna_edamame_salad", zh: "金枪鱼毛豆沙拉", en: "Tuna and edamame salad", sum: "水浸金枪鱼和解冻毛豆拌黄瓜、彩椒和生菜，淋橄榄油和柠檬汁", sumEn: "Canned tuna and thawed edamame tossed with cucumber, red pepper and lettuce, dressed with oil and lemon.", taste: "清爽微酸，金枪鱼咸鲜，毛豆有嚼劲，彩椒、黄瓜和生菜脆。", tasteEn: "Fresh and lightly tart; savoury tuna, chewy edamame, crisp bell pepper, cucumber and romaine.", c: "mediterranean", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("canned_tuna_water", 110), pr("frozen_edamame", 70), ve("cucumber", 50), ve("red_bell_pepper", 100), ve("romaine", 70), ve("red_onion", 20), oi("olive_oil", 3), se("lemon", 10)],
  }),
  dish({
    id: "sardine_edamame_salad", zh: "沙丁鱼毛豆沙拉", en: "Sardine and edamame salad", sum: "油浸沙丁鱼和解冻毛豆铺在菠菜、胡萝卜丝上，淋橄榄油和柠檬汁，不用开火", sumEn: "Canned sardines and thawed edamame over spinach and grated carrot, dressed with olive oil and lemon; no cooking.", taste: "油浸沙丁鱼的鱼味明显、偏咸，柠檬汁提酸，毛豆有嚼劲，菠菜和胡萝卜丝清脆。", tasteEn: "Oil-packed sardines taste distinctly fishy and salty, lifted by lemon; chewy edamame with fresh spinach and shredded carrot.", c: "mediterranean", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("canned_sardine", 90), pr("frozen_edamame", 80), ve("spinach", 160), ve("carrot", 70), ve("red_onion", 15), oi("olive_oil", 3), se("lemon", 10)],
  }),
  dish({
    id: "tomato_shrimp_skillet", zh: "番茄菠菜烩虾", en: "Tomato and spinach shrimp skillet", sum: "番茄煮成酱，下虾煮熟，拌入菠菜，撒牛至", sumEn: "Tomato cooked into a sauce, shrimp poached in it, spinach wilted in, sprinkled with oregano.", taste: "番茄酱汁酸甜，牛至带草香，虾弹牙，菠菜拌入后变软。", tasteEn: "Sweet-tart tomato sauce with oregano, springy shrimp and spinach wilted in.", c: "mediterranean", m: "stir_fry", t: [12, 18],
    staples: [PASTA, QUINOA, BROWN],
    i: [pr("white_shrimp", 110), ve("tomato", 150), ve("spinach", 80), se("dried_oregano", 1), co("olive_oil", 3)],
  }),
  dish({
    id: "lemon_seared_cod", zh: "柠檬香煎鳕鱼", en: "Lemon pan-seared cod with broccoli", sum: "鳕鱼煎至两面金黄，冷冻西兰花和豌豆同锅煎软，挤柠檬汁", sumEn: "Cod pan-seared golden on both sides, frozen broccoli and peas softened in the same pan, finished with lemon.", taste: "鳕鱼煎出金黄的边，肉细嫩，柠檬汁酸味清爽，西兰花和豌豆煎软，整体清淡。", tasteEn: "Cod with a golden crust and delicate flesh, a clean lemon tang, pan-softened broccoli and peas; a light dish.", c: "mediterranean", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("cod", 140), ve("frozen_broccoli", 175), ve("frozen_peas", 30), co("olive_oil", 4), se("lemon", 10), se("salt", 0.4)],
  }),
];

const ITALIAN: Dish[] = [
  dish({
    id: "beef_meatballs_marinara", zh: "意式番茄汁炖牛肉丸", en: "Beef meatballs simmered in marinara", sum: "牛后腿肉现绞，拌面包糠捏丸，放进番茄洋葱酱汁煮 20 分钟", sumEn: "Lean beef round ground fresh, mixed with breadcrumbs, rolled and simmered 20 minutes in a tomato and onion sauce.", taste: "番茄洋葱酱微酸，意式香草味，加了面包糠的肉丸偏软嫩。", tasteEn: "A mildly tangy tomato and onion sauce with Italian herbs; meatballs with breadcrumbs are soft and tender.", c: "italian", m: "stew", eq: ["stove"], t: [18, 40],
    i: [gr("lean_beef", 110), ve("crushed_tomatoes", 130), ve("onion", 30), se("breadcrumbs", 10), se("italian_seasoning", 1.5), se("dried_oregano", 1)],
    ways: [
      way("番茄牛肉丸拌意面配西兰花", "Meatballs with pasta and broccoli", PASTA, [ve("frozen_broccoli", 150)]),
      way("番茄牛肉丸配炒菠菜", "Meatballs over sauteed spinach", null, [ve("frozen_spinach", 150)], 5),
      way("牛肉丸配吐司和番茄生菜", "Meatballs on toast with tomato and lettuce", "white_toast", [ve("tomato", 90), ve("romaine", 80)]),
    ],
  }),
  dish({
    id: "chicken_cacciatore", zh: "意式番茄蘑菇炖鸡（cacciatore）", en: "Chicken cacciatore", sum: "鸡胸肉块、蘑菇、彩椒加番茄和牛至焖煮 30 分钟", sumEn: "Chicken cubes, mushroom and pepper braised 30 minutes in tomato with oregano.", taste: "番茄的酸甜，蘑菇的鲜，牛至和意式香草，鸡胸肉软，酱汁适合拌主食。", tasteEn: "Sweet-tart tomato, savoury mushroom, oregano and Italian herbs; tender breast in a sauce that suits pasta or toast.", c: "italian", m: "braise", t: [15, 45],
    i: [pr("chicken_breast", 108), ve("crushed_tomatoes", 130), ve("red_bell_pepper", 50), ve("button_mushroom", 50), ve("onion", 30), se("dried_oregano", 1), se("italian_seasoning", 1.5), co("olive_oil", 3), se("salt", 0.2)],
    ways: [
      way("蘑菇炖鸡拌全麦意面配生菜", "Cacciatore with whole-wheat pasta and lettuce", WW_PASTA, [ve("romaine", 80)]),
      way("蘑菇炖鸡配吐司和菠菜", "Cacciatore on toast with spinach", "white_toast", [ve("frozen_spinach", 100)]),
      way("蘑菇炖鸡配土豆和西兰花", "Cacciatore on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "beef_ragu", zh: "意式番茄炖牛肉块", en: "Italian tomato beef stew", sum: "牛腱块、番茄碎、洋葱、胡萝卜加意式香草，压力锅炖 35 分钟", sumEn: "Beef shank chunks with crushed tomato, onion and carrot and Italian herbs, pressure-cooked 35 minutes.", taste: "番茄酸甜，意式香草味，牛腱块软烂，胡萝卜和洋葱带甜，调味不重。", tasteEn: "Sweet-tart tomato with Italian herbs, tender chunks of shank and sweet carrot and onion; lightly seasoned.", c: "italian", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 60],
    i: [pr("beef_shank_raw", 105), ve("crushed_tomatoes", 130), ve("onion", 40), ve("carrot", 40), se("italian_seasoning", 1.5), se("dried_oregano", 1), se("salt", 0.2)],
    ways: [
      way("意式炖牛肉拌意面配四季豆", "Beef ragu with pasta and green beans", PASTA, [ve("frozen_green_beans", 130)]),
      way("意式炖牛肉拌全麦意面配小番茄", "Beef ragu with whole-wheat pasta and cherry tomatoes", WW_PASTA, [ve("cherry_tomato", 70), ve("romaine", 80)]),
      way("意式炖牛肉配土豆和西兰花", "Beef ragu on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "chicken_mushroom_ragu", zh: "意式鸡腿丁蘑菇番茄酱（ragu）", en: "Chicken thigh and mushroom ragu", sum: "鸡腿肉丁和蘑菇炒香，加番茄碎小火炖 30 分钟", sumEn: "Diced chicken thigh and mushroom sauteed, then simmered 30 minutes in crushed tomato.", taste: "番茄微酸，蘑菇出鲜，鸡腿丁嫩，意式香草味，酱汁稠，适合拌面。", tasteEn: "Mildly tart tomato with savoury mushrooms, tender chicken thigh and Italian herbs; a thick sauce that coats pasta.", c: "italian", m: "stew", t: [15, 45],
    i: [pr("chicken_thigh", 135), ve("button_mushroom", 100), ve("crushed_tomatoes", 130), ve("onion", 30), se("italian_seasoning", 1.5), co("olive_oil", 2), se("salt", 0.2)],
    ways: [
      way("鸡丁蘑菇酱拌全麦意面配菠菜", "Chicken ragu with whole-wheat pasta and spinach", WW_PASTA, [ve("frozen_spinach", 105)]),
      way("鸡丁蘑菇酱配藜麦和彩椒", "Chicken ragu over quinoa with red pepper", QUINOA, [ve("red_bell_pepper", 100)]),
      way("鸡丁蘑菇酱配吐司和生菜小番茄", "Chicken ragu on toast with lettuce and cherry tomatoes", "white_toast", [ve("romaine", 80), ve("cherry_tomato", 70)]),
    ],
  }),
  dish({
    id: "chicken_minestrone", zh: "意式鸡肉蔬菜汤（minestrone）", en: "Chicken and vegetable minestrone", sum: "鸡胸肉、番茄、胡萝卜、芹菜、西葫芦加高汤和意式香草煮 30 分钟", sumEn: "Chicken breast, tomato, carrot, celery and zucchini simmered 30 minutes in stock with Italian herbs.", taste: "清淡的番茄蔬菜汤，意式香草味，芹菜和西葫芦清甜，汤汁多。", tasteEn: "A light tomato and vegetable soup with Italian herbs, mildly sweet celery and zucchini, and plenty of broth.", c: "italian", m: "simmer", t: [15, 45],
    i: [pr("chicken_breast", 90), ve("crushed_tomatoes", 130), ve("carrot", 40), ve("celery", 30), ve("zucchini", 40), se("stock_paste", 2), se("italian_seasoning", 1.5)],
    ways: [
      way("意式鸡肉汤配全麦吐司和生菜", "Minestrone with whole-wheat toast and lettuce", "whole_wheat_toast", [ve("romaine", 80)]),
      way("意式鸡肉汤加全麦意面配四季豆", "Minestrone with whole-wheat pasta and green beans", WW_PASTA, [ve("frozen_green_beans", 110)]),
      way("意式鸡肉汤泡饭配菠菜", "Minestrone over rice with spinach", RICE, [ve("frozen_spinach", 90)]),
    ],
  }),
  dish({
    id: "chicken_pizzaiola", zh: "意式番茄焖鸡胸（pizzaiola）", en: "Chicken pizzaiola", sum: "鸡胸肉在番茄、洋葱、彩椒酱里加牛至，加盖焖 15 分钟", sumEn: "Chicken breast braised 15 minutes under a lid in tomato, onion and pepper sauce with oregano.", taste: "番茄加牛至，像比萨酱一样酸香，洋葱和彩椒带甜，鸡胸肉嫩，酱汁多。", tasteEn: "Tomato and oregano, tangy like pizza sauce, with sweet onion and pepper; tender breast and plenty of sauce.", c: "italian", m: "braise", eq: ["stove"], t: [12, 30],
    i: [pr("chicken_breast", 105), ve("crushed_tomatoes", 130), ve("onion", 30), ve("red_bell_pepper", 40), se("dried_oregano", 1.5), co("olive_oil", 3), se("salt", 0.2)],
    ways: [
      way("番茄焖鸡胸拌意面配生菜", "Pizzaiola with pasta and lettuce", PASTA, [ve("romaine", 150)]),
      way("番茄焖鸡胸配全麦吐司和菠菜", "Pizzaiola on whole-wheat toast with spinach", "whole_wheat_toast", [ve("frozen_spinach", 120)]),
      way("番茄焖鸡胸配小土豆和四季豆", "Pizzaiola with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 130)]),
    ],
  }),
  dish({
    id: "herb_braised_pork_tenderloin", zh: "香草焖猪里脊", en: "Herb-braised pork tenderloin", sum: "猪里脊和彩椒、西葫芦拌意式香草，加少许高汤加盖焖 20 分钟", sumEn: "Pork tenderloin with pepper and zucchini, Italian herbs and a little stock, braised under a lid 20 minutes.", taste: "意式香草和柠檬的清香，猪里脊瘦而嫩，彩椒和西葫芦出汁，汤汁少而淡。", tasteEn: "Italian herbs and lemon; lean, tender pork with pepper and zucchini juices, and a small light sauce.", c: "italian", m: "braise", eq: ["stove"], t: [10, 30],
    i: [pr("pork_tenderloin", 120), ve("red_bell_pepper", 60), ve("zucchini", 60), ve("red_onion", 30), se("italian_seasoning", 1.5), se("dried_oregano", 0.5), co("olive_oil", 3), se("salt", 0.3), se("lemon", 8), se("stock_paste", 1.25)],
    ways: [
      way("香草猪里脊配小土豆和四季豆", "Herb pork with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 130)]),
      way("香草猪里脊拌全麦意面配小番茄", "Herb pork with whole-wheat pasta and cherry tomatoes", WW_PASTA, [ve("cherry_tomato", 70), ve("romaine", 80)]),
      way("香草猪里脊配藜麦和南瓜", "Herb pork over quinoa with pumpkin", QUINOA, [ve("pumpkin", 100)]),
    ],
  }),
  dish({
    id: "italian_lentil_soup", zh: "意式扁豆汤", en: "Italian lentil soup", sum: "扁豆、番茄、胡萝卜、芹菜、洋葱加高汤煮 30 分钟", sumEn: "Lentils, tomato, carrot, celery and onion simmered in stock for 30 minutes.", taste: "番茄微酸，牛至带草香，扁豆绵软，蔬菜清甜，汤偏稠，味道朴实。", tasteEn: "Mildly tart tomato with oregano, soft lentils and sweet vegetables in a rather thick, plain soup.", c: "italian", m: "simmer", t: [12, 45],
    i: [st("lentils_dry", 90), ve("crushed_tomatoes", 130), ve("carrot", 50), ve("celery", 40), ve("onion", 40), se("stock_paste", 2.5), se("dried_oregano", 1)],
    ways: [
      way("意式扁豆汤配全麦吐司和生菜", "Lentil soup with whole-wheat toast and lettuce", "whole_wheat_toast", [ve("romaine", 80), ve("tomato", 80)]),
      way("意式扁豆汤加全麦意面配菠菜", "Lentil soup with whole-wheat pasta and spinach", WW_PASTA, [ve("frozen_spinach", 110)]),
      way("意式扁豆汤配藜麦和小番茄", "Lentil soup with quinoa and cherry tomatoes", QUINOA, [ve("cherry_tomato", 70), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "chicken_meatball_spinach_soup", zh: "鸡肉丸菠菜汤", en: "Chicken meatball and spinach soup", sum: "鸡腿肉现绞，拌面包糠捏成小丸，下入高汤煮熟，加菠菜", sumEn: "Chicken thigh ground fresh, mixed with breadcrumbs into small balls, poached in stock with spinach.", taste: "清淡的鸡汤味，意式香草，鸡肉丸软，菠菜和胡萝卜清甜，汤清。", tasteEn: "A light chicken broth with Italian herbs, soft chicken meatballs, spinach and sweet carrot; a clear soup.", c: "italian", m: "simmer", t: [18, 40],
    i: [gr("chicken_thigh", 100), se("breadcrumbs", 10), ve("frozen_spinach", 80), ve("carrot", 40), ve("onion", 30), se("stock_paste", 2), se("italian_seasoning", 1), se("salt", 0.3)],
    ways: [
      way("鸡肉丸汤加全麦意面配生菜", "Meatball soup with whole-wheat pasta and lettuce", WW_PASTA, [ve("romaine", 80)]),
      way("鸡肉丸汤配全麦吐司和小番茄", "Meatball soup with whole-wheat toast and cherry tomatoes", "whole_wheat_toast", [ve("cherry_tomato", 70)]),
      way("鸡肉丸汤泡饭配豌豆", "Meatball soup over rice with peas", RICE, [ve("frozen_peas", 60)]),
    ],
  }),
  dish({
    id: "shrimp_tomato_mushroom", zh: "番茄蘑菇炒虾仁", en: "Shrimp with cherry tomatoes and mushrooms", sum: "虾仁和小番茄、蘑菇快炒到番茄出汁，撒意式香草", sumEn: "Shrimp, cherry tomato and mushroom stir-fried until the tomato breaks down, sprinkled with Italian herbs.", taste: "小番茄炒出汁，酸甜，带蒜香和意式香草味，虾弹牙，蘑菇出鲜。", tasteEn: "Cherry tomatoes cooked down to sweet-tart juice, with garlic and Italian herbs, springy shrimp and savoury mushrooms.", c: "italian", m: "stir_fry", t: [12, 18],
    staples: [PASTA, WW_PASTA],
    i: [pr("white_shrimp", 115), ve("cherry_tomato", 110), ve("button_mushroom", 60), se("italian_seasoning", 1), co("olive_oil", 4), se("garlic_paste", 2), se("salt", 0.2)],
  }),
  dish({
    id: "lemon_mushroom_chicken", zh: "柠檬蘑菇煎鸡胸", en: "Lemon chicken with mushrooms and spinach", sum: "鸡胸肉煎熟，蘑菇和菠菜同锅炒软，加柠檬汁和少许高汤收汁", sumEn: "Chicken breast pan-fried, mushroom and spinach wilted in the pan, finished with lemon and a splash of stock.", taste: "柠檬的酸香，蘑菇的鲜，鸡胸肉煎熟，菠菜炒软，汤汁收得少，味道清淡。", tasteEn: "Lemony and savoury from mushroom; pan-cooked breast and wilted spinach in a small, light sauce.", c: "italian", m: "pan_fry", t: [12, 18],
    staples: [PASTA, BABY_POTATOES, MICROWAVE_POTATO],
    i: [pr("chicken_breast", 108), ve("button_mushroom", 70), ve("spinach", 130), se("lemon", 12), co("olive_oil", 4), se("salt", 0.4), se("stock_paste", 0.75)],
  }),
  dish({
    id: "italian_tomato_chicken_plate", zh: "意式番茄鸡肉拼盘", en: "Italian tomato chicken plate", sum: "即食鸡胸肉配番茄片和红洋葱，淋橄榄油和柠檬汁，撒意式香草", sumEn: "Ready-cooked chicken with sliced tomato and red onion, dressed with oil and lemon, sprinkled with Italian herbs.", taste: "番茄片多汁，红洋葱微辛，柠檬汁和意式香草带酸香，即食鸡胸肉味淡，凉着吃。", tasteEn: "Juicy tomato slices, a little sharp red onion, lemon and Italian herbs; mild ready-cooked chicken, eaten cold.", c: "italian", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_toast", QUINOA],
    i: [pr("ready_chicken_breast", 100), ve("tomato", 170), ve("red_onion", 15), se("italian_seasoning", 1), oi("olive_oil", 4), se("lemon", 6)],
  }),
  dish({
    id: "tuna_tomato_spaghetti_sauce", zh: "金枪鱼番茄意面酱", en: "Tuna and tomato sauce", sum: "彩椒和番茄煮成酱，拌入水浸金枪鱼，浇在意面上", sumEn: "Red pepper and tomato cooked into a sauce, canned tuna stirred in, served over pasta.", taste: "番茄彩椒酱酸甜，金枪鱼咸鲜，有蒜香和牛至味，酱偏稀，浇在意面上。", tasteEn: "A sweet-tart tomato and pepper sauce with savoury tuna, garlic and oregano; fairly loose, spooned over pasta.", c: "italian", m: "stir_fry", t: [10, 15],
    staples: [PASTA, WW_PASTA],
    i: [pr("canned_tuna_water", 100), ve("tomato", 150), ve("red_bell_pepper", 80), se("italian_seasoning", 1), co("olive_oil", 3), se("dried_oregano", 0.5), se("garlic_paste", 2)],
  }),
  dish({
    id: "pork_pepper_medallions", zh: "彩椒煎猪里脊", en: "Pork medallions with peppers and zucchini", sum: "猪里脊切厚片煎熟，彩椒和西葫芦同锅煎软，挤柠檬汁", sumEn: "Thick pork tenderloin slices pan-fried, pepper and zucchini softened in the same pan, finished with lemon.", taste: "猪里脊煎出焦香，彩椒和西葫芦煎软带甜，柠檬汁提酸，味道清淡。", tasteEn: "Browned lean pork with pan-softened sweet pepper and zucchini, a squeeze of lemon; lightly seasoned.", c: "italian", m: "pan_fry", t: [12, 18],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("pork_tenderloin", 118), ve("red_bell_pepper", 115), ve("zucchini", 60), co("olive_oil", 4), se("italian_seasoning", 1), se("salt", 0.3), se("lemon", 6)],
  }),
];

const CHINESE: Dish[] = [
  dish({
    id: "tomato_braised_beef_shank", zh: "番茄炖牛腱", en: "Tomato braised beef shank", sum: "牛腱切块和番茄、胡萝卜、洋葱一起压力锅炖 35 分钟", sumEn: "Beef shank cubes with tomato, carrot and onion, pressure-cooked 35 minutes.", taste: "番茄酸甜加酱油咸鲜，带姜蒜香，牛腱软烂，汤汁多，适合拌饭。", tasteEn: "Sweet-tart tomato with soy saltiness, ginger and garlic; tender shank and plenty of juices that soak into rice.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 60],
    i: [pr("beef_shank_raw", 105), ve("tomato", 220), ve("carrot", 50), ve("onion", 40), se("garlic_paste", 3), se("ginger_paste", 3), se("reduced_salt_soy_sauce", 5), co("canola_oil", 3)],
    ways: [
      way("番茄炖牛腱盖米饭配上海青", "Tomato beef over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("番茄炖牛腱拌面配西兰花", "Tomato beef with noodles and broccoli", "fresh_noodles", [ve("frozen_broccoli", 100)]),
      way("番茄炖牛腱配馒头和拍黄瓜", "Tomato beef with a steamed bun and smashed cucumber", "steamed_bun", [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "shiitake_braised_chicken", zh: "香菇黄焖鸡", en: "Shiitake braised chicken thighs", sum: "鸡腿肉块和香菇、青椒加蚝油、酱油焖 25 分钟", sumEn: "Chicken thigh cubes with shiitake and green pepper, braised 25 minutes in oyster and soy sauce.", taste: "蚝油和酱油的咸鲜，香菇味浓，鸡腿肉软嫩，彩椒带甜，有姜香，汤汁不多。", tasteEn: "Savoury oyster and soy sauce with strong shiitake flavour; soft thigh meat, sweet bell pepper and ginger, with little sauce.", c: "chinese", m: "stew", t: [15, 40],
    i: [pr("chicken_thigh", 120), ve("shiitake", 80), ve("red_bell_pepper", 70), se("oyster_sauce", 5), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), co("canola_oil", 3)],
    ways: [
      way("香菇黄焖鸡盖糙米饭配上海青", "Shiitake chicken over brown rice with bok choy", BROWN, [ve("bok_choy", 140)]),
      way("香菇黄焖鸡配糯玉米和四季豆", "Shiitake chicken with waxy corn and green beans", CORN, [ve("frozen_green_beans", 100)]),
      way("香菇黄焖鸡盖杂粮饭配西兰花", "Shiitake chicken over multigrain rice with broccoli", GRAINS, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "yam_wood_ear_chicken", zh: "山药木耳炖鸡", en: "Chicken stew with yam and wood ear", sum: "鸡腿肉块和山药、木耳、香菇加酱油和姜小火炖 30 分钟", sumEn: "Chicken thigh cubes with yam, wood ear and shiitake, simmered 30 minutes in soy sauce and ginger.", taste: "酱油和姜的清淡咸鲜，山药软糯，木耳滑脆，香菇出鲜。", tasteEn: "Lightly salty soy and ginger; soft, starchy yam, crunchy-slippery wood ear and savoury shiitake.", c: "chinese", m: "stew", t: [15, 45],
    i: [pr("chicken_thigh", 115), ve("chinese_yam", 70), ve("wood_ear", 35), ve("shiitake", 30), se("reduced_salt_soy_sauce", 4), se("ginger_paste", 3)],
    ways: [
      way("山药木耳炖鸡盖米饭配上海青", "Yam chicken stew over rice with bok choy", RICE, [ve("bok_choy", 140)]),
      way("山药木耳炖鸡盖小米饭配西兰花", "Yam chicken stew over millet rice with broccoli", MILLET, [ve("frozen_broccoli", 140)]),
      way("山药木耳炖鸡配馒头和菠菜", "Yam chicken stew with a steamed bun and spinach", "steamed_bun", [ve("frozen_spinach", 170)]),
    ],
  }),
  dish({
    id: "potato_soy_braised_chicken", zh: "土豆烧鸡", en: "Soy-braised chicken with potato", sum: "鸡腿肉、土豆、胡萝卜加酱油、蚝油和五香粉焖烧 25 分钟", sumEn: "Chicken thigh, potato and carrot braised 25 minutes in soy sauce, oyster sauce and five-spice.", taste: "酱油蚝油的咸甜，五香粉有淡淡的香料味，土豆吸饱汤汁软糯，鸡腿肉嫩。", tasteEn: "Salty-sweet soy and oyster sauce with a faint five-spice note; potato soaks up the sauce and goes soft, with tender thigh meat.", c: "chinese", m: "braise", t: [15, 40],
    i: [pr("chicken_thigh", 115), st("potato", 100), ve("onion", 40), ve("carrot", 50), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 2)],
    ways: [
      way("土豆烧鸡配上海青", "Potato chicken with bok choy", null, [ve("bok_choy", 140)]),
      way("土豆烧鸡盖米饭配西兰花", "Potato chicken over rice with broccoli", RICE, [ve("frozen_broccoli", 125)]),
    ],
  }),
  dish({
    id: "radish_beef_stew", zh: "白萝卜炖牛腱", en: "Beef shank and white radish stew", sum: "牛腱切块和白萝卜、胡萝卜一起压力锅炖 40 分钟", sumEn: "Beef shank cubes with white radish and carrot, pressure-cooked 40 minutes.", taste: "酱油和五香粉的咸香，白萝卜炖透后带甜、吸满汤汁，牛腱软烂，不辣。", tasteEn: "Savoury soy and five-spice; the radish turns sweet and soaks up the broth, with tender shank; not spicy.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 60],
    i: [pr("beef_shank_raw", 105), ve("white_radish", 150), ve("carrot", 60), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("five_spice_powder", 0.5), se("ginger_paste", 3)],
    ways: [
      way("萝卜炖牛腱盖米饭配西兰花", "Radish beef over rice with broccoli", RICE, [ve("frozen_broccoli", 140)]),
      way("萝卜炖牛腱拌面配上海青", "Radish beef with noodles and bok choy", "fresh_noodles", [ve("bok_choy", 140)]),
      way("萝卜炖牛腱配糯玉米和菠菜", "Radish beef with waxy corn and spinach", CORN, [ve("frozen_spinach", 125)]),
    ],
  }),
  dish({
    id: "napa_tofu_meatball_stew", zh: "白菜豆腐炖肉丸", en: "Napa cabbage, tofu and pork meatball stew", sum: "猪后腿瘦肉现绞拌姜捏丸，和白菜、豆腐、米粉炖 25 分钟", sumEn: "Lean pork leg ground fresh and mixed with ginger into balls, simmered 25 minutes with napa cabbage, tofu and a little rice noodle.", taste: "清淡咸鲜，姜香，白菜炖软出甜，豆腐吸汤，肉丸松软，香油提香。", tasteEn: "Lightly salty with ginger; napa cabbage turns soft and sweet, tofu soaks up the broth, the meatballs are tender and sesame oil adds aroma.", c: "chinese", m: "stew", t: [18, 45],
    i: [pr("firm_tofu", 145), gr("lean_pork_leg", 50), ve("napa_cabbage", 100), st("rice_noodles_dry", 12), se("reduced_salt_soy_sauce", 4), se("ginger_paste", 3), oi("sesame_oil", 2), se("salt", 0.3)],
    ways: [
      way("白菜豆腐肉丸盖米饭配上海青", "Tofu meatball stew over rice with bok choy", RICE, [ve("bok_choy", 140)]),
      way("白菜豆腐肉丸配馒头和菠菜", "Tofu meatball stew with a steamed bun and spinach", "steamed_bun", [ve("frozen_spinach", 135)]),
      way("白菜豆腐肉丸盖糙米饭配胡萝卜", "Tofu meatball stew over brown rice with carrot", BROWN, [ve("carrot", 110)]),
    ],
  }),
  dish({
    id: "northeast_iron_pot_chicken", zh: "东北铁锅炖鸡腿", en: "Northeastern iron-pot chicken with potato, corn and green beans", sum: "鸡腿肉块、土豆、玉米段、四季豆加酱油，铁锅小火炖 35 分钟", sumEn: "Chicken thigh pieces, potato, corn on the cob and green beans stewed 35 minutes in a heavy pot with soy sauce.", taste: "酱油蚝油的咸香，带点五香粉，土豆吸汤粉糯，玉米和四季豆带甜，鸡腿肉软，汤汁多。", tasteEn: "Savoury soy and oyster sauce with a little five-spice; floury potato, sweet corn and green beans, soft thigh meat and plenty of broth.", c: "chinese", m: "stew", t: [15, 50],
    i: [pr("chicken_thigh", 120), st("potato", 80), ve("sweet_corn_cob", 70), ve("green_beans", 90), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 3), se("stock_paste", 2.5)],
    ways: [
      way("铁锅炖鸡腿配馒头和上海青", "Iron-pot chicken with a steamed bun and bok choy", "steamed_bun", [ve("bok_choy", 125)]),
      way("铁锅炖鸡腿盖米饭配番茄", "Iron-pot chicken over rice with tomato", RICE, [ve("tomato", 140)]),
      way("铁锅炖鸡腿盖杂粮饭配西兰花", "Iron-pot chicken over multigrain rice with broccoli", GRAINS, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "potato_soy_braised_beef", zh: "土豆红烧牛腱", en: "Soy-braised beef shank with potato", sum: "牛腱块、土豆、胡萝卜加酱油、蚝油和五香粉，压力锅炖 40 分钟", sumEn: "Beef shank cubes, potato and carrot with soy sauce, oyster sauce and five-spice, pressure-cooked 40 minutes.", taste: "酱油蚝油的咸甜，五香粉有淡淡的香料味，土豆粉糯，牛腱炖软。", tasteEn: "Salty-sweet soy and oyster sauce with a faint five-spice note; floury potato and soft braised shank.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), st("potato", 100), ve("carrot", 50), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 3)],
    ways: [
      way("土豆烧牛腱配青椒", "Potato beef with green pepper", null, [ve("green_pepper", 150)]),
      way("土豆烧牛腱盖米饭配上海青", "Potato beef over rice with bok choy", RICE, [ve("bok_choy", 125)]),
      way("土豆烧牛腱配糯玉米和四季豆", "Potato beef with waxy corn and green beans", CORN, [ve("frozen_green_beans", 130)]),
    ],
  }),
  dish({
    id: "winter_melon_chicken_meatball_soup", zh: "冬瓜鸡肉丸汤", en: "Winter melon and chicken meatball soup", sum: "鸡腿肉现绞拌姜捏成丸，和冬瓜块、香菇在清汤里煮 20 分钟", sumEn: "Chicken thigh ground fresh and mixed with ginger into balls, simmered 20 minutes in a clear broth with winter melon and shiitake.", taste: "清淡的汤，姜香，冬瓜软嫩清甜，鸡肉丸嫩，香菇出鲜，香油带一点香味。", tasteEn: "A light soup with ginger, soft mildly sweet winter melon, tender chicken meatballs and savoury shiitake, with a little sesame oil.", c: "chinese", m: "simmer", t: [18, 40],
    i: [gr("chicken_thigh", 125), ve("winter_melon", 120), ve("shiitake", 30), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("sesame_oil", 2), se("stock_paste", 3.75)],
    ways: [
      way("冬瓜鸡肉丸汤泡饭配上海青", "Winter melon soup over rice with bok choy", RICE, [ve("bok_choy", 160)]),
      way("冬瓜鸡肉丸汤泡杂粮饭配菠菜", "Winter melon soup over multigrain rice with spinach", GRAINS, [ve("frozen_spinach", 160)]),
      way("冬瓜鸡肉丸汤下面条配番茄", "Winter melon soup with noodles and tomato", "fresh_noodles", [ve("tomato", 170)]),
    ],
  }),
  dish({
    id: "steamed_chicken_shiitake", zh: "香菇滑蒸鸡", en: "Silky steamed chicken with shiitake and wood ear", sum: "鸡腿肉切薄片，拌酱油、姜蓉和少许淀粉，与香菇、木耳铺盘蒸 10 分钟", sumEn: "Chicken thigh sliced thin and coated with soy sauce, ginger paste and a little cornstarch, steamed 10 minutes with shiitake and wood ear.", taste: "蒸出来的咸鲜，蚝油酱油加姜，鸡肉薄片滑嫩，香菇和木耳滑脆，汤汁少。", tasteEn: "Steamed savoury flavour from oyster sauce, soy and ginger; silky thin chicken slices, slippery shiitake and wood ear, little liquid.", c: "chinese", m: "steam", eq: ["steamer"], t: [12, 25],
    i: [pr("chicken_thigh", 120), ve("shiitake", 60), ve("wood_ear", 25), se("oyster_sauce", 4), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), se("cornstarch", 3), oi("sesame_oil", 2)],
    ways: [
      way("香菇蒸鸡盖糙米饭配西兰花", "Steamed chicken over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("香菇蒸鸡配蒸红薯和上海青", "Steamed chicken on sweet potato with bok choy", SWEET_POTATO, [ve("bok_choy", 140)]),
      way("香菇蒸鸡配馒头和四季豆", "Steamed chicken with a steamed bun and green beans", "steamed_bun", [ve("frozen_green_beans", 130)]),
    ],
  }),
  dish({
    id: "beef_mapo_tofu", zh: "牛肉丁麻婆豆腐", en: "Mapo tofu with diced beef and peppers", sum: "牛后腿肉切小丁炒散，加麻婆酱和豆瓣酱，下豆腐、青椒煮 8 分钟", sumEn: "Small diced beef round browned, simmered 8 minutes with mapo and chili bean sauce, tofu and green pepper.", taste: "麻辣咸香，花椒粉的麻和豆瓣酱的辣都明显，豆腐嫩，牛肉丁和青椒有嚼劲，酱汁稠，适合拌饭。", tasteEn: "Numbing, spicy and salty, with clear Sichuan pepper and doubanjiang heat; soft tofu, diced beef and peppers in a thick sauce for rice.", c: "chinese", m: "stew", t: [12, 20],
    i: [pr("firm_tofu", 150), pr("lean_beef", 55), ve("green_pepper", 100), se("mapo_sauce", 12), se("doubanjiang", 3), se("sichuan_pepper_powder", 1)],
    ways: [
      way("麻婆豆腐盖米饭配上海青", "Mapo tofu over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("麻婆豆腐盖糙米饭配西兰花", "Mapo tofu over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("麻婆豆腐盖杂粮饭配黄瓜", "Mapo tofu over multigrain rice with cucumber", GRAINS, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "five_spice_braised_chicken", zh: "五香卤鸡胸", en: "Five-spice braised chicken breast", sum: "鸡胸肉与胡萝卜、洋葱用酱油和五香粉小火卤 25 分钟", sumEn: "Chicken breast with carrot and onion, simmered 25 minutes in soy sauce and five-spice.", taste: "酱油和五香粉的咸香，姜味，鸡胸肉卤得紧实偏瘦，胡萝卜和洋葱带甜，不辣。", tasteEn: "Savoury soy and five-spice with ginger; the breast is firm and lean, carrot and onion add sweetness; not spicy.", c: "chinese", m: "braise", t: [10, 40],
    i: [pr("chicken_breast", 108), ve("carrot", 60), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("five_spice_powder", 1), se("ginger_paste", 3)],
    ways: [
      way("五香卤鸡胸盖米饭配青椒", "Five-spice chicken over rice with green pepper", RICE, [ve("green_pepper", 120)]),
      way("五香卤鸡胸拌面配上海青", "Five-spice chicken with noodles and bok choy", "fresh_noodles", [ve("bok_choy", 140)]),
      way("手撕五香鸡拌紫甘蓝", "Shredded five-spice chicken with red cabbage", null, [ve("red_cabbage", 100), tp("sesame_seeds", 3)], 5),
    ],
  }),
  dish({
    id: "tomato_tofu_egg_scramble", zh: "番茄豆腐滑蛋", en: "Tomato tofu and soft scrambled egg", sum: "番茄块炒出汁，下切块北豆腐焖 3 分钟，淋入蛋液炒至刚凝固", sumEn: "Tomato wedges cooked down, firm tofu simmered 3 minutes in the juice, then beaten egg stirred in until just set.", taste: "番茄酸甜，番茄酱再添一点甜，豆腐吸汤软嫩，鸡蛋滑，咸味淡。", tasteEn: "Sweet-tart tomato, a little more sweetness from ketchup, soft tofu that soaks up the juices and silky egg; lightly salted.", c: "chinese", m: "stir_fry", t: [10, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("egg", 100), pr("firm_tofu", 140), ve("tomato", 200), se("reduced_salt_soy_sauce", 3), se("ketchup", 5), se("salt", 0.4), co("canola_oil", 5)],
  }),
  dish({
    id: "tomato_shrimp_egg_stirfry", zh: "番茄虾仁炒蛋", en: "Tomato, shrimp and scrambled eggs", sum: "鸡蛋炒到刚凝固盛出，番茄炒出汁，下虾仁和鸡蛋拌匀", sumEn: "Eggs scrambled until just set and set aside, tomato cooked down, shrimp and eggs folded back in.", taste: "番茄酸甜带鲜，虾仁弹牙，鸡蛋嫩，酱油味淡咸。", tasteEn: "Sweet-tart, savoury tomato with springy shrimp and tender egg; lightly salty from soy sauce.", c: "chinese", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("egg", 52), pr("white_shrimp", 82), ve("tomato", 185), se("reduced_salt_soy_sauce", 3), co("canola_oil", 5)],
  }),
  dish({
    id: "kung_pao_chicken", zh: "宫保鸡丁", en: "Kung pao chicken", sum: "鸡丁与彩椒、胡萝卜、芹菜大火快炒，加醋、酱油和少许糖，撒花生", sumEn: "Chicken cubes stir-fried hot with pepper, carrot and celery, seasoned with vinegar, soy and a little sugar, topped with peanuts.", taste: "酸甜微辣，黑醋的酸、少许糖和辣酱，花生脆，鸡丁嫩，彩椒胡萝卜芹菜脆，酱汁收得干，不麻。", tasteEn: "Sweet, sour and mildly spicy from black vinegar, a little sugar and chili sauce; crunchy peanuts, tender chicken and crisp vegetables in a dry glaze, without numbing pepper.", c: "chinese", m: "stir_fry", t: [15, 20],
    staples: [RICE, BROWN, MILLET],
    i: [pr("chicken_breast", 105), tp("peanuts", 8), ve("red_bell_pepper", 80), ve("carrot", 70), ve("celery", 50), se("reduced_salt_soy_sauce", 4), se("black_vinegar", 4), se("white_sugar", 3), se("chili_sauce", 3), co("canola_oil", 4)],
  }),
  dish({
    id: "green_pepper_pork_strips", zh: "青椒肉丝", en: "Pork strips with peppers", sum: "猪腿肉切丝滑炒变色，加青椒、彩椒丝用蚝油和酱油炒熟", sumEn: "Pork strips stir-fried until pale, then cooked with pepper strips in oyster and soy sauce.", taste: "咸鲜带一点蚝油的甜，有蒜香，肉丝滑嫩，青椒和彩椒脆，不辣。", tasteEn: "Savoury with a little sweetness from oyster sauce and some garlic; silky pork strips and crisp peppers; not spicy.", c: "chinese", m: "stir_fry", t: [12, 15],
    staples: [RICE, GRAINS, SWEET_POTATO],
    i: [pr("lean_pork_leg", 115), ve("green_pepper", 50), ve("red_bell_pepper", 120), se("reduced_salt_soy_sauce", 3), se("oyster_sauce", 3), se("garlic_paste", 3), co("canola_oil", 5)],
  }),
  dish({
    id: "steamed_cod_shiitake", zh: "清蒸鳕鱼香菇", en: "Steamed cod with shiitake and bok choy", sum: "鳕鱼与香菇铺盘淋酱油，上锅蒸 10 分钟，配焯上海青", sumEn: "Cod and shiitake on a plate with soy sauce, steamed 10 minutes, served with blanched bok choy.", taste: "清淡咸鲜，酱油和姜的香，香油提味，鳕鱼细嫩，香菇滑，上海青脆。", tasteEn: "Light and savoury with soy and ginger and a touch of sesame oil; delicate cod, slippery shiitake and crisp bok choy.", c: "chinese", m: "steam", eq: ["steamer"], t: [10, 20],
    staples: [RICE, MILLET, CORN],
    i: [pr("cod", 135), ve("shiitake", 40), ve("bok_choy", 140), se("reduced_salt_soy_sauce", 5), se("ginger_paste", 3), oi("sesame_oil", 3)],
  }),
  dish({
    id: "sesame_chicken_cucumber_salad", zh: "麻酱鸡丝拌黄瓜", en: "Sesame chicken and cucumber salad", sum: "即食鸡胸肉撕丝，和黄瓜、紫甘蓝用芝麻酱、醋和酱油拌匀", sumEn: "Ready-cooked chicken shredded and tossed with cucumber and red cabbage in sesame paste, vinegar and soy.", taste: "凉拌，芝麻酱浓香，醋带酸、酱油带咸，黄瓜和紫甘蓝脆，鸡丝味淡。", tasteEn: "A cold salad with rich sesame paste, a sour edge from vinegar and saltiness from soy; crisp cucumber and cabbage, mild shredded chicken.", c: "chinese", m: "assemble", eq: [], t: [10, 10],
    staples: [RICE, "steamed_bun", SWEET_POTATO],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 80), ve("red_cabbage", 120), oi("sesame_paste", 8), se("reduced_salt_soy_sauce", 3), se("black_vinegar", 4)],
  }),
  dish({
    id: "tomato_tofu_chicken_stew", zh: "番茄豆腐炖鸡腿", en: "Tomato tofu and chicken thigh stew", sum: "鸡腿肉块与番茄、北豆腐加酱油炖 20 分钟，豆腐吸饱汤汁", sumEn: "Chicken thigh cubes stewed 20 minutes with tomato, firm tofu and soy sauce until the tofu takes up the broth.", taste: "番茄酸甜，豆腐吸饱汤汁，鸡腿肉嫩，有姜香，咸味淡，汤汁多。", tasteEn: "Sweet-tart tomato, tofu that soaks up the broth, tender thigh meat and ginger; lightly salted with plenty of broth.", c: "chinese", m: "stew", t: [10, 35],
    i: [pr("firm_tofu", 145), pr("chicken_thigh", 55), ve("tomato", 170), ve("onion", 25), se("reduced_salt_soy_sauce", 4), se("ketchup", 8), se("ginger_paste", 2), oi("sesame_oil", 2), se("salt", 0.3)],
    ways: [
      way("豆腐炖鸡腿盖米饭配上海青", "Tofu chicken stew over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("豆腐炖鸡腿盖小米饭配西兰花", "Tofu chicken stew over millet rice with broccoli", MILLET, [ve("frozen_broccoli", 100)]),
      way("豆腐炖鸡腿拌面配菠菜", "Tofu chicken stew with noodles and spinach", "fresh_noodles", [ve("frozen_spinach", 100)]),
    ],
  }),
  dish({
    id: "homestyle_tofu_pork_slices", zh: "家常豆腐炒肉片", en: "Home-style tofu with pork slices", sum: "猪大排切片滑炒，下煎黄的北豆腐块，加青椒、胡萝卜、木耳和豆瓣酱炒熟", sumEn: "Pork loin slices stir-fried until pale, then pan-browned firm tofu, green pepper, carrot and wood ear with chili bean sauce.", taste: "豆瓣酱的咸辣香，豆腐煎黄外韧内嫩，肉片滑，青椒、胡萝卜和木耳口感脆滑，微辣。", tasteEn: "Salty, mildly spicy doubanjiang; pan-browned tofu with a firm skin and soft middle, silky pork, and crisp green pepper, carrot and wood ear.", c: "chinese", m: "stir_fry", t: [14, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("firm_tofu", 170), pr("pork_loin", 45), ve("green_pepper", 100), ve("carrot", 45), ve("wood_ear", 25), se("doubanjiang", 3), se("reduced_salt_soy_sauce", 4), se("garlic_paste", 2), co("canola_oil", 4)],
  }),
];

const MEXICAN: Dish[] = [
  dish({
    id: "salsa_shredded_chicken", zh: "墨西哥番茄手撕鸡", en: "Pressure-cooker salsa chicken", sum: "鸡胸肉、番茄碎、洋葱、青椒加墨西哥香料，压力锅压 12 分钟后撕散", sumEn: "Chicken breast with crushed tomato, onion, pepper and taco spice, pressure-cooked 12 minutes, then shredded.", taste: "番茄微酸，墨西哥香料带咸香和微辣，青柠提酸，鸡胸撕成丝，酱汁多，适合包饼或拌饭。", tasteEn: "Mildly tart tomato with salty, slightly spicy taco seasoning and a lime lift; shredded breast in plenty of sauce for tortillas or rice.", c: "mexican", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 30],
    i: [pr("chicken_breast", 110), ve("crushed_tomatoes", 130), ve("onion", 40), ve("green_pepper", 40), se("taco_seasoning", 2.5), se("lime", 8)],
    ways: [
      way("番茄手撕鸡卷玉米饼配紫甘蓝", "Salsa chicken in corn tortillas with red cabbage", "corn_tortilla", [ve("red_cabbage", 100), ve("tomato", 70), tp("lime", 8)]),
      way("番茄手撕鸡盖糙米饭配彩椒玉米", "Salsa chicken over brown rice with red pepper and corn", BROWN, [ve("red_bell_pepper", 100), ve("frozen_corn", 60)]),
      way("番茄手撕鸡配土豆和生菜番茄", "Salsa chicken on a microwaved potato with lettuce and tomato", MICROWAVE_POTATO, [ve("romaine", 80), ve("tomato", 80)]),
    ],
  }),
  dish({
    id: "orange_carnitas_pork", zh: "青柠孜然手撕猪肉（carnitas）", en: "Pressure-cooker cumin-lime carnitas-style pork", sum: "猪腿肉加洋葱、青柠汁、孜然和牛至，压力锅压 45 分钟后撕散", sumEn: "Pork leg with onion, lime juice, cumin and oregano, pressure-cooked 45 minutes, then shredded.", taste: "孜然的暖香、青柠的酸和牛至的草香，猪肉撕成丝，软嫩偏干，不辣。", tasteEn: "Warm cumin, lime sourness and oregano; shredded pork that is soft and fairly dry, not spicy.", c: "mexican", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 70],
    i: [pr("lean_pork_leg", 120), ve("onion", 50), se("ground_cumin", 1.5), se("dried_oregano", 1), se("lime", 15), se("salt", 0.4), se("stock_paste", 1.25)],
    ways: [
      way("孜然手撕猪肉卷玉米饼配紫甘蓝", "Carnitas in corn tortillas with red cabbage", "corn_tortilla", [ve("red_cabbage", 100), ve("green_pepper", 60), tp("lime", 8)]),
      way("孜然手撕猪肉盖糙米饭配番茄", "Carnitas over brown rice with tomato", BROWN, [ve("tomato", 100), ve("frozen_corn", 60)]),
      way("孜然手撕猪肉生菜包", "Carnitas lettuce wraps", null, [ve("romaine", 100), ve("cherry_tomato", 70)], 5),
    ],
  }),
  dish({
    id: "beef_barbacoa", zh: "香料炖牛腱（barbacoa）", en: "Beef barbacoa", sum: "牛腱块与洋葱、番茄、辣椒粉和孜然一起压力锅炖 50 分钟后撕散", sumEn: "Beef shank cubes with onion, tomato, chili powder and cumin, pressure-cooked 50 minutes, then shredded.", taste: "辣椒粉和孜然的咸香微辣，番茄微酸，青柠提酸，牛腱炖到撕散，汤汁多。", tasteEn: "Savoury and mildly spicy from chili powder and cumin, with a gentle tomato tang and lime; shank braised until it shreds, in plenty of juices.", c: "mexican", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 75],
    i: [pr("beef_shank_raw", 105), ve("onion", 50), ve("crushed_tomatoes", 130), se("chili_powder_blend", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("lime", 8), se("salt", 0.3)],
    ways: [
      way("香料炖牛腱卷玉米饼配紫甘蓝", "Barbacoa in corn tortillas with red cabbage", "corn_tortilla", [ve("red_cabbage", 100), ve("cherry_tomato", 70)]),
      way("香料炖牛腱配蒸红薯和四季豆", "Barbacoa on sweet potato with green beans", SWEET_POTATO, [ve("frozen_green_beans", 150)]),
      way("香料炖牛腱盖糙米饭配玉米生菜", "Barbacoa over brown rice with corn and lettuce", BROWN, [ve("frozen_corn", 60), ve("romaine", 100)]),
    ],
  }),
  dish({
    id: "carne_guisada", zh: "番茄土豆炖牛肉（carne guisada）", en: "Carne guisada beef and potato stew", sum: "牛腱块、土豆、番茄碎、青椒加辣椒粉和孜然，小火炖 100 分钟", sumEn: "Beef shank cubes, potato, crushed tomato and pepper with chili powder and cumin, simmered 100 minutes.", taste: "辣椒粉和孜然的咸香微辣，牛腱炖约 100 分钟很软烂，土豆粉糯吸汤，番茄酱汁偏稠。", tasteEn: "Savoury and mildly spicy from chili powder and cumin; shank braised about 100 minutes until very tender, floury potato and a thick tomato sauce.", c: "mexican", m: "stew", t: [15, 120],
    i: [pr("beef_shank_raw", 105), st("potato", 70), ve("crushed_tomatoes", 130), ve("onion", 40), ve("green_pepper", 40), se("chili_powder_blend", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("salt", 0.3)],
    ways: [
      way("番茄炖牛肉卷玉米饼配青椒", "Carne guisada in corn tortillas with green pepper", "corn_tortilla", [ve("green_pepper", 120), tp("lime", 8)]),
      way("番茄炖牛肉盖糙米饭配菠菜", "Carne guisada over brown rice with spinach", BROWN, [ve("frozen_spinach", 150)]),
      way("番茄炖牛肉盖杂粮饭配玉米", "Carne guisada over multigrain rice with corn", GRAINS, [ve("frozen_corn", 60), ve("frozen_broccoli", 130)]),
    ],
  }),
  dish({
    id: "chicken_taco_filling", zh: "墨西哥香料手撕鸡腿肉", en: "Taco-spiced shredded chicken thigh", sum: "鸡腿肉块加番茄碎、洋葱、彩椒和墨西哥香料煮 25 分钟，撕散", sumEn: "Chicken thigh pieces cooked 25 minutes with crushed tomato, onion, pepper and taco spice, then shredded.", taste: "塔可调味料的咸香微辣，番茄微酸，鸡腿肉撕散后嫩，汤汁多。", tasteEn: "Salty, mildly spicy taco seasoning with a gentle tomato tang; shredded thigh meat is tender and juicy.", c: "mexican", m: "stew", t: [12, 40],
    i: [pr("chicken_thigh", 125), ve("crushed_tomatoes", 130), ve("onion", 40), ve("red_bell_pepper", 40), se("taco_seasoning", 3)],
    ways: [
      way("塔可鸡腿肉卷玉米饼配生菜番茄", "Taco chicken in corn tortillas with lettuce and tomato", "corn_tortilla", [ve("romaine", 80), ve("tomato", 80)]),
      way("塔可鸡腿肉盖糙米饭配玉米", "Taco chicken over brown rice with corn", BROWN, [ve("frozen_corn", 50), ve("frozen_green_beans", 110)]),
      way("塔可鸡腿肉配土豆和彩椒", "Taco chicken on a microwaved potato with red pepper", MICROWAVE_POTATO, [ve("red_bell_pepper", 120)]),
    ],
  }),
  dish({
    id: "chicken_tortilla_soup", zh: "墨西哥鸡肉玉米汤", en: "Chicken tortilla soup", sum: "鸡胸肉、玉米粒、番茄、洋葱加高汤和香料煮 25 分钟，挤青柠", sumEn: "Chicken breast, corn, tomato and onion simmered 25 minutes in stock with spice, finished with lime.", taste: "番茄清汤打底，墨西哥香料微辣，青柠带酸，玉米粒带甜，鸡肉软。", tasteEn: "A light tomato broth with mildly spicy Mexican seasoning, lime sourness, sweet corn and soft chicken.", c: "mexican", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 95), st("frozen_corn", 40), ve("crushed_tomatoes", 130), ve("onion", 30), ve("green_pepper", 30), se("stock_paste", 2), se("taco_seasoning", 2), se("lime", 8)],
    ways: [
      way("墨西哥鸡汤配玉米饼条和生菜", "Tortilla soup with tortilla strips and lettuce", "corn_tortilla", [ve("romaine", 140)]),
      way("墨西哥鸡汤泡饭配小番茄紫甘蓝", "Tortilla soup over rice with cherry tomatoes and red cabbage", RICE, [ve("cherry_tomato", 100), ve("red_cabbage", 50)]),
    ],
  }),
  dish({
    id: "shrimp_fajita_skillet", zh: "墨西哥彩椒炒虾仁（fajita）", en: "Shrimp fajita skillet", sum: "虾仁与彩椒、青椒、洋葱用烤肉香料大火快炒，挤青柠", sumEn: "Shrimp stir-fried hot with peppers and onion in fajita spice, finished with lime.", taste: "烤肉香料的咸香微辣带烟熏，彩椒洋葱炒软带甜，虾弹牙，青柠提酸。", tasteEn: "Salty, mildly spicy and smoky fajita seasoning; sweet, soft peppers and onion, springy shrimp and a lime lift.", c: "mexican", m: "stir_fry", t: [12, 18],
    staples: ["corn_tortilla", "whole_wheat_tortilla", BROWN],
    i: [pr("white_shrimp", 115), ve("red_bell_pepper", 140), ve("green_pepper", 30), ve("onion", 40), se("fajita_seasoning", 2.5), se("lime", 8), co("canola_oil", 4)],
  }),
  dish({
    id: "fish_tacos_cabbage", zh: "墨西哥鱼肉玉米饼卷", en: "Fish tacos with red cabbage", sum: "罗非鱼片抹香料煎熟撕块，配紫甘蓝丝和番茄卷进玉米饼", sumEn: "Tilapia rubbed with spice and pan-fried, flaked and rolled in a tortilla with red cabbage and tomato.", taste: "罗非鱼抹香料煎熟，味淡肉嫩，紫甘蓝脆，番茄和青柠清爽，用玉米饼卷着吃。", tasteEn: "Lightly spiced, mild and tender tilapia with crisp red cabbage, tomato and lime, rolled in corn tortillas.", c: "mexican", m: "pan_fry", t: [12, 15],
    staples: ["corn_tortilla", BROWN],
    i: [pr("frozen_tilapia_fillet", 135), ve("red_cabbage", 110), ve("tomato", 80), se("lime", 10), se("taco_seasoning", 1.5), co("canola_oil", 3)],
  }),
  dish({
    id: "chicken_burrito_bowl", zh: "鸡肉玉米饭碗", en: "Chicken and corn burrito bowl", sum: "即食鸡胸肉、毛豆、玉米粒、番茄、生菜摆在饭上，挤青柠汁", sumEn: "Ready-cooked chicken, edamame, corn, tomato and lettuce over rice, finished with lime.", taste: "清爽，青柠带酸，香料味淡，即食鸡肉紧实，毛豆和玉米粒有嚼劲，生菜番茄脆。", tasteEn: "Fresh and lime-tart with mild spice; firm ready-cooked chicken, chewy edamame and corn, crisp romaine and tomato.", c: "mexican", m: "assemble", eq: [], t: [8, 8],
    staples: [BROWN, RICE, "whole_wheat_tortilla"],
    i: [pr("ready_chicken_breast", 85), ve("frozen_edamame", 45), ve("frozen_corn", 50), ve("tomato", 60), ve("romaine", 60), ve("red_onion", 15), se("lime", 8), se("taco_seasoning", 1)],
  }),
  dish({
    id: "mexican_tofu_black_bean_bowl", zh: "墨西哥香料豆腐黑豆碗", en: "Mexican-spiced tofu and black bean bowl", sum: "北豆腐捏碎与黑豆、毛豆、彩椒加塔可调味粉焖煮 15 分钟", sumEn: "Crumbled firm tofu, black beans, edamame and peppers simmered 15 minutes with taco seasoning and lime.", taste: "塔可调味料的咸香微辣，青柠带酸，豆腐碎吸足味道，黑豆绵软，毛豆有嚼劲。", tasteEn: "Salty, mildly spicy taco seasoning with lime; crumbled tofu that takes up the flavour, soft black beans and chewy edamame.", c: "mexican", m: "stew", t: [10, 25],
    i: [pr("firm_tofu", 130), pr("canned_black_beans", 85), pr("frozen_edamame", 52), ve("red_bell_pepper", 50), ve("green_pepper", 40), ve("onion", 20), se("taco_seasoning", 4), se("lime", 8)],
    ways: [
      way("豆腐黑豆碗盖糙米饭配生菜", "Tofu bean bowl over brown rice with lettuce", BROWN, [ve("romaine", 100)]),
      way("豆腐黑豆碗卷玉米饼配紫甘蓝", "Tofu bean bowl in corn tortillas with red cabbage", "corn_tortilla", [ve("red_cabbage", 80), tp("lime", 8)]),
      way("豆腐黑豆碗配土豆和菠菜", "Tofu bean bowl on a microwaved potato with spinach", MICROWAVE_POTATO, [ve("frozen_spinach", 100)]),
    ],
  }),
];

const JAPANESE: Dish[] = [
  dish({
    id: "teriyaki_braised_chicken", zh: "照烧焖鸡胸", en: "Teriyaki braised chicken", sum: "鸡胸肉和洋葱加照烧酱，平底锅加盖焖 15 分钟，撒芝麻", sumEn: "Chicken breast and onion in teriyaki sauce, braised under a lid in a pan 15 minutes, sprinkled with sesame.", taste: "照烧酱的甜咸，洋葱出甜，芝麻带香，鸡胸肉嫩，酱汁稠亮。", tasteEn: "Sweet-salty teriyaki with sweet onion and sesame; tender breast in a thick glossy sauce.", c: "japanese", m: "braise", eq: ["stove"], t: [10, 25],
    i: [pr("chicken_breast", 108), ve("onion", 40), se("teriyaki_sauce", 12), tp("sesame_seeds", 2)],
    ways: [
      way("照烧鸡胸盖米饭配西兰花", "Teriyaki chicken over rice with broccoli", RICE, [ve("frozen_broccoli", 160)]),
      way("照烧鸡胸拌荞麦面配上海青", "Teriyaki chicken with soba and bok choy", SOBA, [ve("bok_choy", 160)]),
      way("照烧鸡胸盖糙米饭配南瓜毛豆", "Teriyaki chicken over brown rice with pumpkin and edamame", BROWN, [ve("pumpkin", 100), ve("frozen_edamame", 60)]),
    ],
  }),
  dish({
    id: "nikujaga", zh: "土豆炖牛肉（肉じゃが）", en: "Nikujaga beef and potato simmer", sum: "牛肉片、土豆、洋葱、胡萝卜用酱油、味醂和高汤煮 25 分钟", sumEn: "Beef slices, potato, onion and carrot simmered 25 minutes in soy sauce, mirin and stock.", taste: "酱油和味醂的甜咸，味道淡口，土豆吸汤软糯，牛肉嫩，洋葱胡萝卜带甜，汤汁多。", tasteEn: "Gently sweet-salty from soy sauce and mirin; potato soaks up the broth, tender beef, sweet onion and carrot, plenty of liquid.", c: "japanese", m: "simmer", t: [15, 40],
    i: [pr("lean_beef", 110), st("potato", 100), ve("onion", 50), ve("carrot", 40), se("reduced_salt_soy_sauce", 4), se("mirin", 5), se("stock_paste", 2.5)],
    ways: [
      way("土豆炖牛肉盖米饭配四季豆", "Nikujaga over rice with green beans", RICE, [ve("frozen_green_beans", 130)]),
      way("土豆炖牛肉配上海青", "Nikujaga with bok choy", null, [ve("bok_choy", 140)]),
      way("土豆炖牛肉盖糙米饭配毛豆", "Nikujaga over brown rice with edamame", BROWN, [ve("frozen_edamame", 35), ve("bok_choy", 120)]),
    ],
  }),
  dish({
    id: "gyudon_beef", zh: "牛丼（牛肉洋葱）", en: "Gyudon beef and onion simmer", sum: "牛肉片和洋葱用酱油、味醂和高汤小火煮 15 分钟", sumEn: "Beef slices and onion simmered 15 minutes in soy sauce, mirin and stock.", taste: "酱油和味醂的甜咸，有姜香，洋葱煮软出甜，牛肉片薄嫩，汤汁适合拌饭。", tasteEn: "Sweet-salty soy and mirin with ginger; onion cooked soft and sweet, thin tender beef, and a broth for spooning over rice.", c: "japanese", m: "simmer", t: [10, 25],
    i: [pr("beef_hotpot_slices", 110), ve("onion", 80), se("reduced_salt_soy_sauce", 4), se("mirin", 6), se("stock_paste", 2.5), se("ginger_paste", 2)],
    ways: [
      way("牛丼盖米饭配菠菜", "Gyudon over rice with spinach", RICE, [ve("frozen_spinach", 150)]),
      way("牛丼盖糙米饭配西兰花毛豆", "Gyudon over brown rice with broccoli and edamame", BROWN, [ve("frozen_broccoli", 120), ve("frozen_edamame", 35)]),
      way("牛丼拌荞麦面配胡萝卜", "Gyudon with soba and carrot", SOBA, [ve("carrot", 80), ve("bok_choy", 80)]),
    ],
  }),
  dish({
    id: "miso_pork_mushroom_stew", zh: "味噌猪肉蘑菇煲", en: "Miso pork and mushroom stew", sum: "猪腿肉片与白蘑菇、洋葱用味噌、味醂和高汤焖 20 分钟", sumEn: "Pork slices with mushroom and onion, braised 20 minutes in miso, mirin and stock.", taste: "味噌的咸鲜和发酵香，味醂带一点甜，蘑菇出鲜，猪肉软，汤汁清。", tasteEn: "Savoury, fermented miso with a touch of mirin sweetness and mushroom depth; soft pork in a clear broth.", c: "japanese", m: "braise", t: [12, 35],
    i: [pr("lean_pork_leg", 120), ve("button_mushroom", 90), ve("onion", 30), se("miso", 8), se("mirin", 3), se("ginger_paste", 2), se("stock_paste", 2)],
    ways: [
      way("味噌猪肉煲盖米饭配上海青", "Miso pork over rice with bok choy", RICE, [ve("bok_choy", 125)]),
      way("味噌猪肉煲盖糙米饭配西兰花", "Miso pork over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("味噌猪肉煲拌荞麦面配四季豆", "Miso pork with soba and green beans", SOBA, [ve("frozen_green_beans", 140)]),
    ],
  }),
  dish({
    id: "japanese_chicken_curry", zh: "日式咖喱鸡", en: "Japanese chicken curry", sum: "鸡胸肉块、土豆、胡萝卜、洋葱加高汤煮软，溶入咖喱块", sumEn: "Chicken cubes, potato, carrot and onion simmered in stock until soft, then thickened with curry roux.", taste: "咖喱块的香料味，偏咸甜，辣度看所用的咖喱块，土豆软粉，鸡胸偏淡，汤汁稠。", tasteEn: "Curry roux spice, salty-sweet, with heat depending on the roux; soft floury potato, mild breast and a thick sauce.", c: "japanese", m: "stew", t: [15, 40],
    i: [pr("chicken_breast", 100), st("potato", 60), ve("carrot", 50), ve("onion", 50), se("curry_roux", 8), se("stock_paste", 2)],
    ways: [
      way("咖喱鸡盖米饭配南瓜", "Curry chicken over rice with pumpkin", RICE, [ve("pumpkin", 110)]),
      way("咖喱鸡盖糙米饭配西兰花", "Curry chicken over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("咖喱鸡拌荞麦面配上海青", "Curry chicken with soba and bok choy", SOBA, [ve("bok_choy", 125)]),
    ],
  }),
  dish({
    id: "soy_mirin_chicken_dice", zh: "酱油味醂煮鸡腿丁", en: "Soy and mirin simmered chicken thigh", sum: "鸡腿肉丁加洋葱、酱油、味醂和姜，煮到收汁", sumEn: "Diced chicken thigh with onion, soy sauce, mirin and ginger, cooked down until the liquid is gone.", taste: "酱油和味醂的甜咸，有姜香，煮到收汁，鸡腿丁嫩，酱汁浓而少。", tasteEn: "Sweet-salty soy and mirin with ginger, cooked down to a glaze; tender thigh dice in a concentrated, small amount of sauce.", c: "japanese", m: "simmer", t: [12, 20],
    i: [pr("chicken_thigh", 140), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("mirin", 5), se("ginger_paste", 3)],
    ways: [
      way("酱油鸡腿丁盖米饭配西兰花", "Soy chicken over rice with broccoli", RICE, [ve("frozen_broccoli", 160)]),
      way("酱油鸡腿丁盖糙米饭配菠菜毛豆", "Soy chicken over brown rice with spinach and edamame", BROWN, [ve("frozen_spinach", 110), ve("frozen_edamame", 50)]),
      way("酱油鸡腿丁拌荞麦面配上海青", "Soy chicken with soba and bok choy", SOBA, [ve("bok_choy", 160), tp("sesame_seeds", 3)]),
    ],
  }),
  dish({
    id: "miso_salmon_spinach", zh: "味噌煎三文鱼配菠菜", en: "Miso salmon with spinach", sum: "三文鱼抹味噌和味醂腌 10 分钟后煎熟，菠菜同锅炒软", sumEn: "Salmon marinated 10 minutes in miso and mirin, pan-fried, with spinach wilted in the same pan.", taste: "味噌和味醂腌过，咸鲜微甜，煎出焦边，三文鱼油润，菠菜炒软。", tasteEn: "Marinated in miso and mirin, salty-savoury and slightly sweet, with browned edges; rich salmon and wilted spinach.", c: "japanese", m: "pan_fry", t: [12, 18],
    staples: [RICE, BROWN, SOBA],
    i: [pr("salmon", 120), se("miso", 8), se("mirin", 3), ve("spinach", 180), co("canola_oil", 2)],
  }),
  dish({
    id: "mackerel_cucumber_rice_bowl", zh: "茄汁鲭鱼黄瓜饭碗", en: "Tomato mackerel and cucumber rice bowl", sum: "罐头茄汁鲭鱼和黄瓜片、紫甘蓝丝摆在饭上，淋醋撒芝麻，不用开火", sumEn: "Canned mackerel in tomato sauce over rice with cucumber and red cabbage, rice vinegar and sesame; no cooking.", taste: "茄汁鲭鱼酸甜咸鲜，鱼味明显，醋提酸，黄瓜和紫甘蓝脆，芝麻带香，冷着吃。", tasteEn: "Tomato-packed mackerel is sweet-tart and salty with a distinct fish flavour, lifted by vinegar; crisp cucumber and cabbage, sesame, eaten cold.", c: "japanese", m: "assemble", eq: [], t: [6, 6],
    staples: [RICE, BROWN, MILLET],
    i: [pr("canned_mackerel_tomato", 130), ve("cucumber", 60), ve("red_cabbage", 110), se("rice_vinegar", 4), tp("sesame_seeds", 3)],
  }),
  dish({
    id: "cold_soba_chicken", zh: "凉荞麦面鸡丝", en: "Cold soba with chicken and cucumber", sum: "荞麦面煮熟过凉水，拌鸡丝、毛豆、黄瓜、胡萝卜、紫甘蓝丝和海苔，淋酱油醋汁", sumEn: "Soba boiled and rinsed cold, tossed with shredded chicken, edamame, cucumber, carrot, red cabbage and nori in a soy-vinegar dressing.", taste: "凉面，酱油醋汁咸酸清爽，荞麦有谷物香，鸡丝、毛豆、黄瓜脆爽，香油和海苔提香。", tasteEn: "Cold noodles in a salty-sour soy and vinegar dressing; nutty soba, shredded chicken, edamame and crisp vegetables, with sesame oil and nori.", c: "japanese", m: "assemble", eq: [], t: [10, 10],
    staples: [SOBA],
    i: [pr("ready_chicken_breast", 90), ve("frozen_edamame", 50), ve("cucumber", 60), ve("carrot", 60), ve("red_cabbage", 60), ve("nori", 1), tp("sesame_seeds", 3), se("reduced_salt_soy_sauce", 4), se("rice_vinegar", 4), oi("sesame_oil", 2)],
  }),
  dish({
    id: "teriyaki_tofu_chicken_dice", zh: "照烧豆腐鸡丁", en: "Teriyaki tofu and chicken dice", sum: "鸡腿丁与北豆腐块煎上色，加彩椒、胡萝卜和照烧汁收汁，撒芝麻", sumEn: "Chicken thigh dice and firm tofu browned, then red pepper, carrot and teriyaki sauce reduced to a glaze, sprinkled with sesame.", taste: "照烧汁的甜咸，豆腐煎出略韧的外皮，鸡丁嫩，彩椒带甜，撒芝麻。", tasteEn: "Sweet-salty teriyaki; tofu with a browned, slightly firm skin, tender chicken, sweet bell pepper and sesame.", c: "japanese", m: "pan_fry", t: [12, 15],
    staples: [RICE, BROWN, SOBA],
    i: [pr("firm_tofu", 170), pr("chicken_thigh", 45), ve("red_bell_pepper", 125), ve("carrot", 50), se("teriyaki_sauce", 12), tp("sesame_seeds", 2), co("canola_oil", 3)],
  }),
  dish({
    id: "miso_tofu_chicken_pot", zh: "日式豆腐味噌鸡肉锅", en: "Japanese miso tofu and chicken pot", sum: "鸡腿肉块与白萝卜、胡萝卜、香菇煮 15 分钟，下北豆腐，化入味噌", sumEn: "Chicken thigh cubes simmered 15 minutes with daikon, carrot and shiitake, then firm tofu, with miso stirred in.", taste: "味噌汤一样的咸鲜，有姜香，白萝卜煮软清甜，豆腐嫩，香菇出鲜，汤多。", tasteEn: "Savoury like miso soup, with ginger; soft sweet radish, tender tofu and shiitake in plenty of broth.", c: "japanese", m: "simmer", t: [10, 30],
    i: [pr("firm_tofu", 150), pr("chicken_thigh", 50), ve("white_radish", 70), ve("carrot", 40), ve("shiitake", 30), se("miso", 9), se("ginger_paste", 2), oi("sesame_oil", 2)],
    ways: [
      way("味噌豆腐鸡肉锅盖米饭配上海青", "Miso tofu pot over rice with bok choy", RICE, [ve("bok_choy", 110)]),
      way("味噌豆腐鸡肉锅盖糙米饭配菠菜", "Miso tofu pot over brown rice with spinach", BROWN, [ve("frozen_spinach", 110)]),
      way("味噌豆腐鸡肉锅拌荞麦面配南瓜", "Miso tofu pot with soba and pumpkin", SOBA, [ve("pumpkin", 100)]),
    ],
  }),
];

const SOUTHEAST_ASIAN: Dish[] = [
  dish({
    id: "thai_red_curry_chicken", zh: "清汤红咖喱鸡（丛林咖喱）", en: "Thai jungle curry chicken", sum: "红咖喱酱炒香，加高汤、鸡胸肉块、西葫芦和彩椒煮 15 分钟，挤青柠", sumEn: "Red curry paste fried until fragrant, then chicken, zucchini and pepper simmered in stock 15 minutes, finished with lime.", taste: "红咖喱的辣和香料味，辣度中等，汤清不加椰奶，青柠带酸，鱼露点咸鲜，四季豆西葫芦脆嫩。", tasteEn: "Medium red curry heat and spice in a clear broth without coconut milk, with lime sourness, a little fish sauce and tender-crisp green beans and zucchini.", c: "southeast_asian", m: "stew", t: [12, 30],
    i: [pr("chicken_breast", 105), ve("zucchini", 60), ve("red_bell_pepper", 40), ve("green_beans", 40), se("stock_paste", 2), se("red_curry_paste", 6), se("fish_sauce", 0.5), se("curry_powder", 1), se("lime", 8)],
    ways: [
      way("红咖喱鸡盖米饭配上海青", "Red curry chicken over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("红咖喱鸡盖糙米饭配西兰花", "Red curry chicken over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 100)]),
      way("红咖喱鸡拌米粉配南瓜", "Red curry chicken with rice vermicelli and pumpkin", VERMICELLI, [ve("pumpkin", 100)]),
    ],
  }),
  dish({
    id: "chicken_adobo", zh: "菲律宾酱油醋焖鸡（adobo）", en: "Chicken adobo", sum: "鸡腿肉与洋葱、酱油、米醋和蒜蓉酱一起焖 25 分钟", sumEn: "Chicken thighs with onion, soy sauce, rice vinegar and garlic, braised 25 minutes.", taste: "咸酸口，醋焖过后酸味变柔和，蒜香和黑胡椒明显，酱汁偏稀适合拌饭。", tasteEn: "Salty and tangy; the vinegar mellows as it braises, with clear garlic and black pepper, and a thin sauce that soaks into rice.", c: "southeast_asian", m: "braise", t: [10, 40],
    i: [pr("chicken_thigh", 120), ve("onion", 40), se("reduced_salt_soy_sauce", 6), se("rice_vinegar", 10), se("garlic_paste", 3), se("ground_black_pepper", 0.5)],
    ways: [
      way("酱油醋焖鸡盖米饭配四季豆", "Adobo over rice with green beans", RICE, [ve("frozen_green_beans", 160)]),
      way("酱油醋焖鸡盖糙米饭配番茄黄瓜", "Adobo over brown rice with tomato and cucumber", BROWN, [ve("tomato", 100), ve("cucumber", 60)]),
      way("酱油醋焖鸡拌米粉配上海青", "Adobo with rice vermicelli and bok choy", VERMICELLI, [ve("bok_choy", 160)]),
    ],
  }),
  dish({
    id: "thai_beef_pumpkin_curry", zh: "泰式牛肉南瓜咖喱", en: "Thai beef and pumpkin curry", sum: "牛腱块和南瓜、洋葱加高汤和红咖喱酱，压力锅煮 40 分钟，南瓜压成泥", sumEn: "Beef shank cubes with pumpkin and onion in stock and red curry paste, pressure-cooked 40 minutes, the pumpkin mashed in for body.", taste: "红咖喱的辣不重，南瓜压成泥让汤汁稠而带甜，鱼露点咸鲜，牛腱软烂。", tasteEn: "Mild red curry heat; mashed pumpkin makes the sauce thick and sweet, fish sauce adds savouriness, and the shank is tender.", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 60],
    i: [pr("beef_shank_raw", 105), ve("pumpkin", 180), ve("onion", 30), se("stock_paste", 2.5), se("red_curry_paste", 5), se("fish_sauce", 1)],
    ways: [
      way("南瓜牛肉咖喱盖米饭配上海青", "Beef curry over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("南瓜牛肉咖喱盖糙米饭配四季豆", "Beef curry over brown rice with green beans", BROWN, [ve("frozen_green_beans", 100)]),
      way("南瓜牛肉咖喱拌米粉配黄瓜", "Beef curry with rice vermicelli and cucumber", VERMICELLI, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "bo_kho_beef", zh: "越南番茄炖牛腱（bò kho）", en: "Vietnamese spiced beef and tomato stew (bo kho)", sum: "牛腱块、胡萝卜、番茄碎加五香粉和鱼露，压力锅炖 40 分钟", sumEn: "Beef shank cubes, carrot and crushed tomato with five-spice and fish sauce, pressure-cooked 40 minutes.", taste: "番茄微酸，五香粉带暖香，鱼露咸鲜，牛腱软烂，胡萝卜带甜，汤汁红亮。", tasteEn: "A mild tomato tang with warm five-spice, fish-sauce saltiness, tender shank and sweet carrot in a red broth.", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), ve("carrot", 70), ve("crushed_tomatoes", 130), ve("onion", 40), se("five_spice_powder", 0.8), se("fish_sauce", 1), se("garlic_paste", 2), se("ginger_paste", 2), se("stock_paste", 2)],
    ways: [
      way("越南炖牛腱拌米粉配上海青", "Bo kho with rice vermicelli and bok choy", VERMICELLI, [ve("bok_choy", 125)]),
      way("越南炖牛腱盖米饭配四季豆", "Bo kho over rice with green beans", RICE, [ve("frozen_green_beans", 120)]),
      way("越南炖牛腱盖糙米饭配西兰花", "Bo kho over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 130), tp("lime", 8)]),
    ],
  }),
  dish({
    id: "dry_spice_braised_beef", zh: "干香料炖牛肉（rendang 风味）", en: "Rendang-style dry-spice braised beef", sum: "牛腱块加咖喱粉、肉桂、洋葱和少许高汤，压力锅压 40 分钟，开盖收干", sumEn: "Beef shank cubes with curry powder, cinnamon, onion and a little stock, pressure-cooked 40 minutes, then reduced uncovered until nearly dry.", taste: "咖喱粉、肉桂和孜然的干香料味，开盖收干后味道浓，酱油咸香，青柠提酸，牛腱软烂偏干。", tasteEn: "Dry spice from curry powder, cinnamon and cumin, concentrated by cooking down uncovered; salty soy, a lime lift and tender, fairly dry shank.", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), ve("onion", 60), se("stock_paste", 1.5), se("curry_powder", 3), se("ground_cinnamon", 0.3), se("ground_cumin", 1), se("garlic_paste", 2), se("ginger_paste", 2), se("reduced_salt_soy_sauce", 4), se("lime", 8)],
    ways: [
      way("干香料牛肉盖米饭配四季豆", "Dry-spice beef over rice with green beans", RICE, [ve("frozen_green_beans", 160)]),
      way("干香料牛肉盖糙米饭配上海青", "Dry-spice beef over brown rice with bok choy", BROWN, [ve("bok_choy", 160)]),
      way("干香料牛肉配蒸红薯和胡萝卜", "Dry-spice beef on sweet potato with carrot", SWEET_POTATO, [ve("carrot", 150)]),
    ],
  }),
  dish({
    id: "tom_yum_chicken_soup", zh: "泰式酸辣鸡肉汤（tom yum 风味）", en: "Tom yum style chicken soup", sum: "鸡胸肉、蘑菇、番茄加高汤和红咖喱酱煮 15 分钟，加鱼露，挤足青柠", sumEn: "Chicken breast, mushroom and tomato simmered 15 minutes in a clear stock with red curry paste and fish sauce, finished with plenty of lime.", taste: "酸辣汤，青柠的酸明显，红咖喱酱和是拉差带辣，鱼露咸鲜，蘑菇和番茄清爽，汤清。", tasteEn: "A hot and sour soup with clear lime sourness, heat from red curry paste and sriracha, salty fish sauce, fresh mushrooms and tomato in a clear broth.", c: "southeast_asian", m: "simmer", t: [12, 30],
    i: [pr("chicken_breast", 100), ve("button_mushroom", 80), ve("tomato", 60), se("stock_paste", 2.5), se("red_curry_paste", 4), se("fish_sauce", 0.5), se("lime", 15), se("sriracha", 1)],
    ways: [
      way("酸辣鸡肉汤配米粉和上海青", "Tom yum soup with rice vermicelli and bok choy", VERMICELLI, [ve("bok_choy", 140)]),
      way("酸辣鸡肉汤泡饭配菠菜", "Tom yum soup over rice with spinach", RICE, [ve("frozen_spinach", 110)]),
      way("酸辣鸡肉汤泡糙米饭配西兰花", "Tom yum soup over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "thai_spicy_chicken_stirfry", zh: "泰式辣炒鸡腿丁", en: "Thai spicy diced chicken stir-fry", sum: "鸡腿肉丁与四季豆、彩椒、毛豆大火快炒，加蚝油、鱼露和是拉差辣酱", sumEn: "Diced chicken thigh stir-fried hot with green beans, pepper and edamame, seasoned with oyster sauce, fish sauce and sriracha.", taste: "咸辣微甜，蚝油、鱼露和是拉差的味道，鸡腿丁嫩，四季豆和彩椒脆，快炒带锅气。", tasteEn: "Salty, spicy and slightly sweet from oyster sauce, fish sauce and sriracha; tender chicken thigh and crisp green beans and pepper, stir-fried hot.", c: "southeast_asian", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("chicken_thigh", 120), ve("green_beans", 130), ve("red_bell_pepper", 60), ve("frozen_edamame", 40), se("oyster_sauce", 4), se("fish_sauce", 1.5), se("sriracha", 3), co("canola_oil", 3)],
  }),
  dish({
    id: "shrimp_rice_noodle_stirfry", zh: "虾仁毛豆炒米粉", en: "Shrimp and edamame rice noodle stir-fry", sum: "虾仁和毛豆、胡萝卜、上海青快炒，拌入泡软的米粉和甜辣酱，撒花生", sumEn: "Shrimp, edamame, carrot and bok choy stir-fried quickly, tossed with soaked rice noodles and sweet chili sauce, topped with peanuts.", taste: "甜辣酱的甜辣，鱼露咸鲜，青柠带酸，米粉软滑，虾弹牙，花生脆。", tasteEn: "Sweet and spicy chili sauce with salty fish sauce and lime; soft smooth noodles, springy shrimp and crunchy peanuts.", c: "southeast_asian", m: "stir_fry", t: [14, 18],
    staples: [VERMICELLI],
    i: [pr("white_shrimp", 100), ve("frozen_edamame", 50), ve("carrot", 80), ve("bok_choy", 70), se("sweet_chili_sauce", 8), se("fish_sauce", 1.5), se("lime", 10), tp("peanuts", 5), co("canola_oil", 4)],
  }),
  dish({
    id: "lime_steamed_basa", zh: "青柠蒸龙利鱼", en: "Lime-steamed basa with napa cabbage", sum: "龙利鱼和大白菜、上海青、蘑菇铺盘，淋青柠汁、鱼露和甜辣酱，蒸 10 分钟", sumEn: "Basa fillet on napa cabbage, bok choy and mushroom with lime, fish sauce and sweet chili sauce, steamed 10 minutes.", taste: "青柠的酸、鱼露的咸鲜和甜辣酱的甜辣，龙利鱼细嫩，白菜、上海青和蘑菇清淡出汁。", tasteEn: "Lime sourness, salty fish sauce and sweet-spicy chili sauce; delicate basa with light, juicy cabbage, bok choy and mushrooms.", c: "southeast_asian", m: "steam", eq: ["steamer"], t: [10, 20],
    staples: [RICE, BROWN, VERMICELLI],
    i: [pr("basa_fillet", 140), ve("napa_cabbage", 60), ve("button_mushroom", 30), ve("bok_choy", 120), se("lime", 15), se("fish_sauce", 3), se("sweet_chili_sauce", 6)],
  }),
  dish({
    id: "chicken_larb_lettuce", zh: "泰式青柠鸡丁生菜包（larb 风味）", en: "Larb-style diced chicken in lettuce", sum: "鸡胸肉切小丁炒熟，拌红洋葱、小番茄、青柠汁和鱼露，用生菜包着吃", sumEn: "Small diced chicken breast cooked through, tossed with red onion, cherry tomato, lime and fish sauce, eaten wrapped in lettuce.", taste: "青柠的酸和鱼露的咸鲜，是拉差带辣，鸡丁偏干，红洋葱和小番茄清爽，用生菜包着吃。", tasteEn: "Lime sourness and salty fish sauce with sriracha heat; fairly dry chicken, fresh red onion and cherry tomato, wrapped in lettuce.", c: "southeast_asian", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("chicken_breast", 120), ve("romaine", 120), ve("cucumber", 40), ve("cherry_tomato", 60), ve("red_onion", 20), se("lime", 15), se("fish_sauce", 2.5), se("sriracha", 3)],
  }),
  dish({
    id: "thai_sweet_chili_tofu_chicken", zh: "泰式甜辣豆腐鸡丁", en: "Thai sweet chili tofu and chicken", sum: "鸡腿丁与北豆腐块煎上色，加四季豆、彩椒，拌甜辣酱和鱼露", sumEn: "Chicken thigh dice and firm tofu browned, tossed with green beans and pepper in sweet chili and fish sauce.", taste: "甜辣酱的甜辣，鱼露点咸鲜，甜味偏重，豆腐煎出略韧的外皮，鸡丁嫩，四季豆和彩椒脆。", tasteEn: "Sweet-spicy chili sauce with a little fish sauce, on the sweet side; pan-browned tofu, tender chicken, crisp green beans and pepper.", c: "southeast_asian", m: "stir_fry", t: [13, 15],
    staples: [RICE, BROWN, VERMICELLI],
    i: [pr("firm_tofu", 170), pr("chicken_thigh", 46), ve("green_beans", 110), ve("red_bell_pepper", 60), se("sweet_chili_sauce", 12), se("fish_sauce", 1.5), co("canola_oil", 3)],
  }),
];

const MAINS: Dish[] = [...AMERICAN, ...MEDITERRANEAN, ...ITALIAN, ...CHINESE, ...MEXICAN, ...JAPANESE, ...SOUTHEAST_ASIAN];

/** One way to make a fresh part on the eating day: its equipment, minutes, the card's action and the steps, Chinese then English. */
export const fin = (equipment: Equipment[], minutes: number, act: string, actEn: string, steps: string[], stepsEn: string[]): DishFinish => ({
  equipment,
  minutes,
  act,
  actEn,
  steps,
  stepsEn,
});

// The steps of each side and staple on the day a box is eaten with it
// (docs/671 吃的那天): the first one the kitchen fits is used.
const WATER_MW = "加一勺水，盖上微波高火";
const FINISH: Readonly<Record<string, DishFinish[]>> = {
  // Sides.
  steamed_broccoli_lemon: [
    fin(["steamer"], 5, "蒸西兰花", "steam the broccoli", ["冷冻西兰花直接上锅大火蒸 5 分钟", "淋柠檬汁和橄榄油，撒一点盐"], ["steam the frozen broccoli over high heat for 5 minutes, no thawing", "dress with lemon juice, olive oil and a pinch of salt"]),
    fin(["microwave"], 4, "微波西兰花", "microwave the broccoli", [`冷冻西兰花${WATER_MW} 4 分钟`, "沥干，淋柠檬汁和橄榄油，撒一点盐"], ["microwave the frozen broccoli with a spoon of water, covered, on high for 4 minutes", "drain and dress with lemon juice, olive oil and a pinch of salt"]),
  ],
  garlic_bok_choy: [
    fin(["stove"], 4, "炒上海青", "stir-fry the bok choy", ["上海青洗净切段", "锅里放{oil}，大火炒 3 到 4 分钟", "加蒜蓉酱和一点盐炒匀"], ["wash the bok choy and cut it into pieces", "stir-fry in {oil} over high heat for 3 to 4 minutes", "stir in the garlic paste and a pinch of salt"]),
  ],
  oyster_broccoli: [
    fin(["stove"], 3, "焯西兰花", "blanch the broccoli", ["锅里水烧开，冷冻西兰花下锅焯 2 到 3 分钟", "捞出沥干，淋蚝油和香油"], ["blanch the frozen broccoli in boiling water for 2 to 3 minutes", "drain and dress with the oyster sauce and sesame oil"]),
    fin(["microwave"], 4, "微波西兰花", "microwave the broccoli", [`冷冻西兰花${WATER_MW} 4 分钟`, "沥干，淋蚝油和香油"], ["microwave the frozen broccoli with a spoon of water, covered, on high for 4 minutes", "drain and dress with the oyster sauce and sesame oil"]),
  ],
  goma_ae_spinach: [
    fin(["microwave"], 3, "微波菠菜", "microwave the spinach", ["冷冻菠菜盖上微波高火 3 分钟", "挤干水，拌芝麻酱和生抽"], ["microwave the frozen spinach, covered, on high for 3 minutes", "squeeze it dry and mix with the sesame paste and soy sauce"]),
    fin(["stove"], 2, "焯菠菜", "blanch the spinach", ["锅里水烧开，冷冻菠菜下锅煮 2 分钟", "捞出挤干水，拌芝麻酱和生抽"], ["cook the frozen spinach in boiling water for 2 minutes", "drain, squeeze it dry and mix with the sesame paste and soy sauce"]),
  ],
  greek_cucumber_tomato_salad: [
    fin([], 5, "拌沙拉", "toss the salad", ["黄瓜、番茄切块，红洋葱切细丝", "撒牛至，淋橄榄油和柠檬汁拌匀"], ["cut the cucumber and tomato into chunks and the red onion into thin slices", "sprinkle with oregano and toss with olive oil and lemon juice"]),
  ],
  steamed_pumpkin_soy: [
    fin(["steamer"], 10, "蒸南瓜", "steam the pumpkin", ["南瓜切块，上锅大火蒸 10 分钟到筷子能扎透", "拌酱油和香油"], ["cut the pumpkin into chunks and steam over high heat for 10 minutes, until a chopstick goes through", "toss with the soy sauce and sesame oil"]),
    fin(["microwave"], 6, "微波南瓜", "microwave the pumpkin", [`南瓜切块，${WATER_MW} 6 分钟到筷子能扎透`, "拌酱油和香油"], ["cut the pumpkin into chunks and microwave with a spoon of water, covered, on high for 6 minutes, until a chopstick goes through", "toss with the soy sauce and sesame oil"]),
  ],
  fresh_salsa_salad: [
    fin([], 5, "切番茄碎", "make the salsa", ["番茄、红洋葱、黄瓜切小丁", "挤青柠汁，加一点盐拌匀"], ["dice the tomato, red onion and cucumber", "squeeze over the lime and mix in a pinch of salt"]),
  ],
  sauteed_zucchini_lemon: [
    fin(["stove"], 5, "炒西葫芦", "sauté the zucchini", ["西葫芦切片", "锅里放{oil}，中火炒 4 到 5 分钟到软", "撒意式香草，挤柠檬汁，加一点盐"], ["slice the zucchini", "sauté in {oil} over medium heat for 4 to 5 minutes until soft", "finish with the Italian herbs, a squeeze of lemon and a pinch of salt"]),
  ],
  lemon_green_beans_almond: [
    fin(["microwave"], 4, "微波四季豆", "microwave the green beans", [`冷冻四季豆${WATER_MW} 4 分钟，咬一根全软才算熟`, "拌柠檬汁和一点盐，撒杏仁"], ["microwave the frozen green beans with a spoon of water, covered, on high for 4 minutes; they are done when one bites soft all through", "toss with lemon juice and a pinch of salt and scatter the almonds"]),
    fin(["stove"], 5, "煮四季豆", "boil the green beans", ["锅里水烧开，冷冻四季豆煮 5 分钟到全软", "沥干，拌柠檬汁和一点盐，撒杏仁"], ["boil the frozen green beans for 5 minutes until soft all through", "drain, toss with lemon juice and a pinch of salt and scatter the almonds"]),
  ],
  microwave_spinach_sesame: [
    fin(["microwave"], 4, "微波菠菜", "microwave the spinach", ["冷冻菠菜盖上微波高火 4 分钟", "挤干水，拌酱油和香油，撒芝麻"], ["microwave the frozen spinach, covered, on high for 4 minutes", "squeeze it dry, mix with the soy sauce and sesame oil and scatter the sesame seeds"]),
    fin(["stove"], 2, "焯菠菜", "blanch the spinach", ["锅里水烧开，冷冻菠菜下锅煮 2 分钟", "捞出挤干水，拌酱油和香油，撒芝麻"], ["cook the frozen spinach in boiling water for 2 minutes", "drain, squeeze it dry, mix with the soy sauce and sesame oil and scatter the sesame seeds"]),
  ],
  quick_garlic_spinach: [
    fin(["stove"], 2, "炒菠菜", "stir-fry the spinach", ["菠菜洗净切段", "锅里放{oil}，大火炒 2 分钟到变软", "加蒜蓉酱和一点盐炒匀"], ["wash the spinach and cut it into lengths", "stir-fry in {oil} over high heat for 2 minutes until wilted", "stir in the garlic paste and a pinch of salt"]),
  ],
  steamed_carrot_coins: [
    fin(["steamer"], 10, "蒸胡萝卜", "steam the carrot", ["胡萝卜切厚片，上锅蒸 10 分钟到筷子能扎透", "拌橄榄油、一点盐和黑胡椒"], ["cut the carrot into thick coins and steam for 10 minutes, until a chopstick goes through", "toss with olive oil, a pinch of salt and black pepper"]),
    fin(["microwave"], 5, "微波胡萝卜", "microwave the carrot", [`胡萝卜切厚片，${WATER_MW} 5 分钟`, "拌橄榄油、一点盐和黑胡椒"], ["cut the carrot into thick coins and microwave with a spoon of water, covered, on high for 5 minutes", "toss with olive oil, a pinch of salt and black pepper"]),
  ],
  soy_green_beans_microwave: [
    fin(["microwave"], 4, "微波四季豆", "microwave the green beans", [`冷冻四季豆${WATER_MW} 4 分钟，咬一根全软才算熟`, "拌酱油和香油"], ["microwave the frozen green beans with a spoon of water, covered, on high for 4 minutes; they are done when one bites soft all through", "toss with the soy sauce and sesame oil"]),
    fin(["stove"], 5, "煮四季豆", "boil the green beans", ["锅里水烧开，冷冻四季豆煮 5 分钟到全软", "沥干，拌酱油和香油"], ["boil the frozen green beans for 5 minutes until soft all through", "drain and toss with the soy sauce and sesame oil"]),
  ],
  tomato_cucumber_salad: [
    fin([], 4, "拌番茄黄瓜", "toss the tomato and cucumber", ["番茄和黄瓜切块", "拌橄榄油、米醋和一点盐"], ["cut the tomato and cucumber into chunks", "toss with olive oil, rice vinegar and a pinch of salt"]),
  ],
  purple_cabbage_vinegar: [
    fin([], 5, "拌紫甘蓝", "toss the cabbage", ["紫甘蓝和胡萝卜切细丝", "拌米醋、橄榄油和一点盐"], ["shred the purple cabbage and carrot", "toss with rice vinegar, olive oil and a pinch of salt"]),
  ],
  romaine_cherry_tomato_salad: [
    fin([], 4, "拌生菜沙拉", "toss the salad", ["生菜撕块，小番茄对半切", "拌橄榄油、柠檬汁和一点盐"], ["tear the lettuce and halve the cherry tomatoes", "toss with olive oil, lemon juice and a pinch of salt"]),
  ],

  // Staples cooked at the meal (the plan's rice is cooked at the prep session; a rice is cooked at the meal only outside it).
  [RICE]: riceFinish("白米", "white rice", 40, [4, 30], 25),
  [BROWN]: riceFinish("糙米", "brown rice", 60, [22, 45], 50),
  [GRAINS]: riceFinish("杂粮米", "mixed grains", 50, [20, 45], 45),
  [MILLET]: riceFinish("小米", "millet", 35, [10, 30], 25),
  [QUINOA]: [
    fin(["stove"], 15, "煮藜麦", "cook the quinoa", ["藜麦冲洗，加两倍的水煮开", "盖上盖子小火煮 15 分钟到水吸干"], ["rinse the quinoa and bring it to a boil in twice its volume of water", "cover and simmer on low for 15 minutes until the water is absorbed"]),
  ],
  [PASTA]: pastaFinish("意面", "pasta"),
  [WW_PASTA]: pastaFinish("全麦意面", "whole-wheat pasta"),
  [SOBA]: [
    fin(["stove"], 6, "煮荞麦面", "boil the soba", ["一锅水烧开，荞麦面下锅煮到软", "捞出过凉水，沥干"], ["bring a pot of water to a boil and cook the soba until tender", "rinse under cold water and drain"]),
  ],
  [VERMICELLI]: [
    fin(["kettle"], 10, "泡米粉", "soak the vermicelli", ["烧一壶开水浇在米粉上，泡 10 分钟到软", "沥干"], ["pour boiling water from the kettle over the vermicelli and soak for 10 minutes until soft", "drain"]),
    fin(["stove"], 10, "泡米粉", "soak the vermicelli", ["锅里水烧开后关火，放米粉泡 10 分钟到软", "沥干"], ["bring a pot of water to a boil, take it off the heat and soak the vermicelli for 10 minutes until soft", "drain"]),
  ],
  [SWEET_POTATO]: [
    fin(["steamer"], 25, "蒸红薯", "steam the sweet potato", ["红薯洗净，连皮上锅蒸 25 分钟到筷子能扎透"], ["wash the sweet potato and steam it in its skin for 25 minutes, until a chopstick goes through"]),
    fin(["microwave"], 8, "微波红薯", "microwave the sweet potato", ["红薯洗净，用叉子扎几个孔", "微波高火 8 分钟，中途翻一面，到筷子能扎透"], ["wash the sweet potato and prick it a few times with a fork", "microwave on high for 8 minutes, turning it halfway, until a chopstick goes through"]),
  ],
  [MICROWAVE_POTATO]: [
    fin(["microwave"], 8, "微波土豆", "microwave the potato", ["土豆洗净，用叉子扎几个孔", "微波高火 8 分钟，中途翻一面，到筷子能扎透"], ["wash the potato and prick it a few times with a fork", "microwave on high for 8 minutes, turning it halfway, until a chopstick goes through"]),
  ],
  [BABY_POTATOES]: [
    fin(["steamer"], 20, "蒸小土豆", "steam the baby potatoes", ["小土豆洗净，上锅蒸 20 分钟到筷子能扎透", "拌橄榄油、烟熏红椒粉和一点盐"], ["wash the baby potatoes and steam them for 20 minutes, until a chopstick goes through", "toss with olive oil, smoked paprika and a pinch of salt"]),
    fin(["stove"], 20, "煮小土豆", "boil the baby potatoes", ["小土豆冷水下锅，煮开后再煮 15 分钟到筷子能扎透", "沥干，拌橄榄油、烟熏红椒粉和一点盐"], ["put the baby potatoes in cold water, bring to a boil and simmer 15 minutes, until a chopstick goes through", "drain and toss with olive oil, smoked paprika and a pinch of salt"]),
  ],
  [CORN]: [
    fin(["steamer"], 20, "蒸玉米", "steam the corn", ["糯玉米上锅蒸 20 分钟"], ["steam the corn cobs for 20 minutes"]),
    fin(["stove"], 15, "煮玉米", "boil the corn", ["糯玉米放进开水锅里煮 15 分钟"], ["boil the corn cobs for 15 minutes"]),
  ],
};

/** A rice cooked at the meal: rice cooker, pressure cooker, stove ([pressure minutes, total], stove simmer minutes). */
function riceFinish(zh: string, en: string, cooker: number, pressure: [number, number], stove: number): DishFinish[] {
  return [
    fin(["rice_cooker"], cooker, `煮${zh}`, `cook the ${en}`, [`${zh}淘洗后加水，电饭锅按煮饭键`, "跳到保温后再焖 10 分钟"], [`rinse the ${en}, add water and start the rice cooker`, "leave it 10 minutes after it switches to warm"]),
    fin(["pressure_cooker"], pressure[1], `煮${zh}`, `cook the ${en}`, [`${zh}淘洗后加水，压力锅高压 ${pressure[0]} 分钟`, "自然泄压 10 分钟"], [`rinse the ${en}, add water and cook at high pressure for ${pressure[0]} minutes`, "let the pressure drop on its own for 10 minutes"]),
    fin(["stove"], stove + 10, `煮${zh}`, `cook the ${en}`, [`${zh}淘洗后加水煮开`, `盖上盖子小火煮 ${stove} 分钟，关火焖 10 分钟`], [`rinse the ${en}, add water and bring to a boil`, `cover and simmer on low for ${stove} minutes, then leave covered off the heat for 10 minutes`]),
  ];
}

function pastaFinish(zh: string, en: string): DishFinish[] {
  return [
    fin(["stove"], 10, `煮${zh}`, `boil the ${en}`, ["一锅水烧开，加一点盐", `${zh}下锅煮 10 分钟，捞出沥干`], ["bring a pot of water to a boil with a pinch of salt", `cook the ${en} for 10 minutes and drain`]),
  ];
}

const withFinish = (d: Dish): Dish => {
  const finish = FINISH[d.id];
  return finish ? { ...d, finish } : d;
};

export const SEED_DISHES: readonly Dish[] = [...MAINS, ...SIDES.map(withFinish), ...STAPLES.map(withFinish), ...BREAKFASTS];
