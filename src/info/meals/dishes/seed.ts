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
// No pre-packaged mince: its cuts and fat are unknown and it spoils in a day
// or two. Meatballs, kofta and loaves use a named lean cut ground fresh (the
// `gr` lines, ground: true), cooked the same day; every other dish uses whole
// cuts as cubes, slices or dice.

import type { MethodId } from "./methods";
import type { Cuisine, Dish, DishIngredient, DishRole, DishWay, Equipment, IngredientRole } from "./types";

const CREATED_AT = "2026-10-25T00:00:00.000Z";

const line =
  (role: IngredientRole) =>
  (food: string, grams: number): DishIngredient => ({ food, grams, role });
const pr = line("protein");
const ve = line("veg");
const st = line("staple");
const oi = line("oil");
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
}

const dish = (s: Spec): Dish => ({
  id: s.id,
  name: s.zh,
  nameEn: s.en,
  summary: s.sum,
  summaryEn: s.sumEn,
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
  origin: "seed",
  createdAt: CREATED_AT,
});

/** A staple is cooked ahead, so it is a batch dish with no ways. */
const batchStaple = (s: Spec): Dish => ({ ...dish({ ...s, role: "staple" }), prep: "batch" });

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
const BAKED_POTATO = "baked_potato";
const BABY_POTATOES = "roast_baby_potatoes";
const CORN = "steamed_waxy_corn";

const STAPLES: Dish[] = [
  batchStaple({ id: RICE, zh: "米饭", en: "Steamed white rice", sum: "白米淘洗后加水，用电饭锅煮熟", sumEn: "White rice rinsed and cooked with water in a rice cooker.", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 40], i: [st("rice_cooked", 110)] }),
  batchStaple({ id: BROWN, zh: "糙米饭", en: "Brown rice", sum: "糙米淘洗后加水，用电饭锅煮熟", sumEn: "Brown rice rinsed and cooked with water in a rice cooker.", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 60], i: [st("brown_rice_cooked", 163)] }),
  batchStaple({ id: GRAINS, zh: "五谷杂粮饭", en: "Multigrain rice", sum: "杂粮米淘洗后加水，用电饭锅煮熟", sumEn: "Mixed grains rinsed and cooked with water in a rice cooker.", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 50], i: [st("multigrain_rice_raw", 57)] }),
  batchStaple({ id: MILLET, zh: "小米饭", en: "Millet rice", sum: "小米淘洗后加水，用电饭锅煮熟", sumEn: "Millet rinsed and cooked with water in a rice cooker.", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 35], i: [st("millet_raw", 55)] }),
  batchStaple({ id: QUINOA, zh: "藜麦饭", en: "Cooked quinoa", sum: "藜麦冲洗后加水煮 15 分钟，吸干水分", sumEn: "Quinoa rinsed and simmered in water for 15 minutes until the water is absorbed.", c: "mediterranean", m: "grain", t: [5, 20], i: [st("quinoa_cooked", 167)] }),
  batchStaple({ id: PASTA, zh: "水煮意面", en: "Boiled pasta", sum: "意面下入沸盐水煮 10 分钟，捞出沥干", sumEn: "Pasta boiled in salted water for 10 minutes and drained.", c: "italian", m: "grain", t: [5, 15], i: [st("pasta_dry", 54)] }),
  batchStaple({ id: WW_PASTA, zh: "水煮全麦意面", en: "Boiled whole-wheat pasta", sum: "全麦意面下入沸盐水煮 10 分钟，捞出沥干", sumEn: "Whole-wheat pasta boiled in salted water for 10 minutes and drained.", c: "italian", m: "grain", t: [5, 15], i: [st("whole_wheat_pasta_dry", 57)] }),
  batchStaple({ id: SOBA, zh: "水煮荞麦面", en: "Boiled soba noodles", sum: "荞麦面下入沸水煮熟，过凉水沥干", sumEn: "Soba boiled until tender, rinsed cold and drained.", c: "japanese", m: "grain", t: [5, 10], i: [st("soba_fresh", 135)] }),
  batchStaple({ id: VERMICELLI, zh: "泡发米粉", en: "Rice vermicelli", sum: "干米粉用开水泡软，沥干", sumEn: "Dried rice vermicelli soaked in boiling water until soft, then drained.", c: "southeast_asian", m: "grain", eq: ["kettle"], t: [5, 12], i: [st("rice_noodles_dry", 57)] }),
  batchStaple({ id: SWEET_POTATO, zh: "蒸红薯", en: "Steamed sweet potato", sum: "红薯洗净连皮上锅蒸 25 分钟", sumEn: "Sweet potato washed and steamed with the skin on for 25 minutes.", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 30], i: [st("sweet_potato", 174)] }),
  batchStaple({ id: BAKED_POTATO, zh: "烤土豆", en: "Baked potato", sum: "土豆洗净扎孔，烤箱烤 50 分钟至软", sumEn: "Potato washed, pricked and baked 50 minutes until soft.", c: "american", m: "bake", eq: ["oven"], t: [3, 60], i: [st("potato", 270)] }),
  batchStaple({
    id: BABY_POTATOES, zh: "香烤小土豆", en: "Roasted baby potatoes", sum: "小土豆拌橄榄油、烟熏红椒粉和盐，烤箱烤 30 分钟", sumEn: "Baby potatoes tossed with olive oil, smoked paprika and salt, roasted 30 minutes.", c: "american", m: "roast", eq: ["oven"], t: [5, 40],
    i: [st("baby_potato", 340), oi("olive_oil", 3), se("smoked_paprika", 1), se("salt", 0.3)],
  }),
  batchStaple({ id: CORN, zh: "蒸糯玉米", en: "Steamed waxy corn", sum: "糯玉米带叶上锅蒸 20 分钟", sumEn: "Waxy corn cobs steamed for 20 minutes.", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 25], i: [st("waxy_corn_cob", 121)] }),
];

const SIDES: Dish[] = [
  dish({ id: "steamed_broccoli_lemon", zh: "柠檬清蒸西兰花", en: "Steamed broccoli with lemon", sum: "西兰花上锅蒸 5 分钟，淋柠檬汁和橄榄油", sumEn: "Broccoli steamed 5 minutes, dressed with lemon and olive oil.", role: "side", c: "mediterranean", m: "steam", eq: ["steamer"], t: [3, 8], i: [ve("broccoli", 150), se("lemon", 6), oi("olive_oil", 3), se("salt", 0.3)] }),
  dish({ id: "garlic_bok_choy", zh: "蒜蓉炒上海青", en: "Stir-fried bok choy with garlic paste", sum: "上海青大火快炒，加蒜蓉酱和盐调味", sumEn: "Bok choy stir-fried hot with garlic paste and salt.", role: "side", c: "chinese", m: "stir_fry", t: [5, 7], i: [ve("bok_choy", 160), se("garlic_paste", 2), oi("canola_oil", 3), se("salt", 0.3)] }),
  dish({ id: "oyster_gai_lan", zh: "蚝油芥蓝", en: "Blanched gai lan with oyster sauce", sum: "芥蓝焯水沥干，淋蚝油和香油", sumEn: "Gai lan blanched and drained, dressed with oyster sauce and sesame oil.", role: "side", c: "chinese", m: "greens", t: [5, 8], i: [ve("gai_lan", 150), se("oyster_sauce", 2), oi("sesame_oil", 1.5)] }),
  dish({ id: "goma_ae_spinach", zh: "芝麻酱拌菠菜", en: "Spinach with sesame dressing", sum: "冷冻菠菜解冻挤干，拌芝麻酱和酱油", sumEn: "Frozen spinach thawed and squeezed dry, mixed with sesame paste and soy sauce.", role: "side", c: "japanese", m: "greens", t: [5, 8], i: [ve("frozen_spinach", 150), oi("sesame_paste", 6), se("light_soy_sauce", 1.5)] }),
  dish({ id: "greek_cucumber_tomato_salad", zh: "希腊黄瓜番茄沙拉", en: "Greek cucumber and tomato salad", sum: "黄瓜、番茄、红洋葱切块，撒菲达奶酪，淋橄榄油和柠檬汁", sumEn: "Cucumber, tomato and red onion cut up, topped with feta and dressed with oil and lemon.", role: "side", c: "mediterranean", m: "salad", eq: [], t: [6, 6], i: [ve("cucumber", 75), ve("tomato", 65), ve("red_onion", 10), tp("feta", 8), oi("olive_oil", 3), se("dried_oregano", 0.5), se("lemon", 5)] }),
  dish({ id: "yogurt_slaw", zh: "酸奶凉拌卷心菜", en: "Yogurt cabbage slaw", sum: "卷心菜、紫甘蓝、胡萝卜切丝，拌酸奶、米醋和盐", sumEn: "Cabbage, red cabbage and carrot shredded and mixed with yogurt, rice vinegar and salt.", role: "side", c: "american", m: "salad", eq: [], t: [8, 8], i: [ve("cabbage", 100), ve("red_cabbage", 30), ve("carrot", 30), tp("greek_yogurt", 20), se("rice_vinegar", 5), se("salt", 0.3)] }),
  dish({ id: "fresh_salsa_salad", zh: "青柠番茄碎（salsa）", en: "Fresh tomato salsa with lime", sum: "番茄、洋葱、黄瓜切小丁，拌香菜和青柠汁", sumEn: "Tomato, onion and cucumber diced and mixed with coriander and lime juice.", role: "side", c: "mexican", m: "salad", eq: [], t: [6, 6], i: [ve("tomato", 110), ve("red_onion", 20), ve("cucumber", 30), tp("coriander", 3), se("lime", 8), se("salt", 0.3)] }),
  dish({ id: "sauteed_zucchini_basil", zh: "罗勒炒西葫芦", en: "Sauteed zucchini with basil", sum: "西葫芦切片用橄榄油炒软，加柠檬汁，撒罗勒", sumEn: "Zucchini slices sauteed soft in olive oil, finished with lemon and basil.", role: "side", c: "italian", m: "stir_fry", t: [6, 8], i: [ve("zucchini", 150), oi("olive_oil", 4), tp("basil", 3), se("lemon", 4), se("salt", 0.3)] }),
  dish({ id: "lemon_green_beans_almond", zh: "杏仁柠檬四季豆", en: "Microwaved green beans with almonds", sum: "冷冻四季豆微波加热 3 分钟，拌柠檬汁和盐，撒杏仁", sumEn: "Frozen green beans microwaved 3 minutes, tossed with lemon and salt, topped with almonds.", role: "side", c: "american", m: "microwave", eq: ["microwave"], t: [4, 7], i: [ve("frozen_green_beans", 150), tp("almonds", 6), se("lemon", 5), se("salt", 0.3)] }),
];

const BREAKFASTS: Dish[] = [
  dish({
    id: "milk_toast_boiled_egg", zh: "牛奶全麦吐司水煮蛋", en: "Milk, whole-wheat toast and a boiled egg",
    sum: "鸡蛋煮 8 分钟，两片吐司烤热，牛奶倒杯即可", sumEn: "Boil the egg 8 minutes, toast two slices of bread, pour the milk.",
    role: "breakfast", c: "american", m: "simmer", eq: ["stove", "toaster"], t: [4, 12],
    i: [pr("low_fat_milk", 250), pr("egg", 100), st("whole_wheat_toast", 70)],
  }),
  dish({
    id: "soy_milk_bun_tea_egg", zh: "豆浆馒头茶叶蛋", en: "Soy milk, steamed bun and tea egg",
    sum: "馒头上锅蒸热，配现成的茶叶蛋、豆浆和橘子", sumEn: "Steam the bun until hot; serve with a ready tea egg, soy milk and a mandarin.",
    role: "breakfast", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 8],
    i: [pr("soy_milk_unsweetened", 250), pr("tea_egg", 50), st("steamed_bun", 50), fr("mandarin", 100)],
  }),
  dish({
    id: "yogurt_blueberry_toast_egg", zh: "酸奶蓝莓吐司水煮蛋", en: "Yogurt with blueberries, toast and a boiled egg",
    sum: "鸡蛋煮 8 分钟，吐司烤热，酸奶拌蓝莓", sumEn: "Boil the egg 8 minutes, toast the bread, stir blueberries into the yogurt.",
    role: "breakfast", c: "american", m: "simmer", eq: ["stove", "toaster"], t: [4, 12],
    i: [pr("plain_yogurt", 150), pr("egg", 50), st("wholegrain_toast", 35), fr("blueberries", 60)],
  }),
  dish({
    id: "milk_oats_banana", zh: "牛奶燕麦片香蕉水煮蛋", en: "Milk, oat cereal, banana and a boiled egg",
    sum: "鸡蛋煮 8 分钟，燕麦片倒进牛奶泡软，切香蕉片放上面", sumEn: "Boil the egg 8 minutes, soak the oats in milk and top with sliced banana.",
    role: "breakfast", c: "american", m: "assemble", eq: [], t: [3, 3],
    i: [pr("low_fat_milk", 250), pr("egg", 50), st("oats", 30), fr("banana", 80)],
  }),
  dish({
    id: "microwave_egg_cheese_tortilla", zh: "鸡蛋奶酪玉米饼卷", en: "Scrambled egg and cheese tortilla",
    sum: "鸡蛋打散微波 1 分半炒熟，和奶酪片、番茄一起卷进玉米饼", sumEn: "Microwave the beaten egg 90 seconds, then roll it with cheese and tomato in corn tortillas.",
    role: "breakfast", c: "mexican", m: "microwave", eq: ["microwave"], t: [4, 5],
    i: [pr("egg", 100), pr("cheese_slice", 10), st("corn_tortilla", 60), ve("tomato", 50)],
  }),
  dish({
    id: "yogurt_oats_blueberry_walnut", zh: "希腊酸奶燕麦蓝莓核桃", en: "Greek yogurt, oats, blueberries and walnuts",
    sum: "燕麦片拌进希腊酸奶，放上蓝莓和核桃碎，不用开火", sumEn: "Stir oats into Greek yogurt and top with blueberries and chopped walnuts; no cooking.",
    role: "breakfast", c: "american", m: "assemble", eq: [], t: [3, 3],
    i: [pr("greek_yogurt", 200), st("oats", 30), fr("blueberries", 60), tp("walnuts", 8)],
  }),
  dish({
    id: "pita_egg_yogurt_tomato", zh: "口袋饼水煮蛋酸奶小番茄", en: "Pita with a boiled egg, Greek yogurt and cherry tomatoes",
    sum: "鸡蛋煮 8 分钟，口袋饼切开，配希腊酸奶和小番茄", sumEn: "Boil the egg 8 minutes; serve with sliced pita, Greek yogurt and cherry tomatoes.",
    role: "breakfast", c: "mediterranean", m: "simmer", t: [4, 12],
    i: [pr("egg", 50), pr("greek_yogurt", 100), st("whole_wheat_pita", 40), ve("cherry_tomato", 60), oi("olive_oil", 3)],
  }),
  dish({
    id: "miso_tofu_soup_rice_ball_egg", zh: "味噌豆腐汤饭团水煮蛋", en: "Miso tofu soup, rice ball and a boiled egg",
    sum: "豆腐丁放进热水化开味噌煮 3 分钟，米饭捏成饭团裹海苔，配水煮蛋", sumEn: "Simmer tofu cubes in miso broth 3 minutes; shape rice into a ball wrapped in nori; serve with a boiled egg.",
    role: "breakfast", c: "japanese", m: "simmer", t: [5, 12],
    i: [pr("firm_tofu", 80), pr("egg", 50), se("miso", 6), st("rice_cooked", 100), ve("nori", 1)],
  }),
  dish({
    id: "chicken_wrap_milk", zh: "鸡胸肉口袋饼配牛奶", en: "Chicken pita with milk",
    sum: "即食鸡胸肉撕丝，和黄瓜一起塞进口袋饼，配一杯牛奶", sumEn: "Shred ready-cooked chicken, stuff it into a pita with cucumber, serve with a glass of milk.",
    role: "breakfast", c: "american", m: "assemble", eq: [], t: [4, 4],
    i: [pr("ready_chicken_breast", 60), pr("low_fat_milk", 250), st("whole_wheat_pita", 40), ve("cucumber", 40)],
  }),
  dish({
    id: "sweet_potato_egg_soy_milk", zh: "蒸红薯水煮蛋豆浆", en: "Steamed sweet potato, boiled egg and soy milk",
    sum: "红薯和鸡蛋放进同一个蒸锅蒸 15 分钟，配一杯豆浆", sumEn: "Steam the sweet potato and egg together for 15 minutes; serve with soy milk.",
    role: "breakfast", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 18],
    i: [pr("soy_milk_unsweetened", 250), pr("egg", 50), st("sweet_potato", 150)],
  }),
];

const AMERICAN: Dish[] = [
  dish({
    id: "chicken_bean_chili", zh: "美式鸡腿丁红芸豆炖菜（chili）", en: "Chicken and kidney bean chili", sum: "鸡腿肉丁、红芸豆、番茄、彩椒加辣椒粉和孜然炖 40 分钟", sumEn: "Diced chicken thigh, kidney beans, tomato and pepper simmered 40 minutes with chili powder and cumin.", c: "american", m: "stew", t: [15, 60],
    i: [pr("chicken_thigh", 125), st("canned_kidney_beans", 50), ve("crushed_tomatoes", 130), ve("onion", 40), ve("green_pepper", 30), se("chili_powder_blend", 3), se("ground_cumin", 1)],
    ways: [
      way("鸡丁豆子炖菜盖糙米饭", "Chili over brown rice", BROWN, [ve("red_cabbage", 40), tp("lime", 8)]),
      way("鸡丁豆子炖菜卷玉米饼", "Chili in corn tortillas with lime and coriander", "corn_tortilla", [ve("cabbage", 40), tp("coriander", 3), tp("lime", 8)]),
      way("鸡丁豆子炖菜配烤土豆和菲达奶酪", "Chili on a baked potato with feta", BAKED_POTATO, [tp("feta", 12), ve("cherry_tomato", 50)]),
    ],
  }),
  dish({
    id: "beef_black_bean_chili", zh: "美式牛肉块黑豆炖菜（chili）", en: "Beef chunk and black bean chili", sum: "牛腱块加黑豆、番茄、彩椒和烟熏红椒粉，小火炖 90 分钟", sumEn: "Beef shank chunks simmered 90 minutes with black beans, tomato, pepper and smoked paprika.", c: "american", m: "stew", t: [15, 120],
    i: [pr("beef_shank_raw", 105), st("canned_black_beans", 50), ve("crushed_tomatoes", 120), ve("onion", 40), ve("red_bell_pepper", 40), se("smoked_paprika", 2), se("ground_cumin", 1), se("chili_powder_blend", 2)],
    ways: [
      way("牛肉块黑豆炖菜配蒸红薯", "Chili over steamed sweet potato", SWEET_POTATO, [ve("cabbage", 50), tp("coriander", 3), tp("lime", 8)]),
      way("牛肉块黑豆炖菜盖糙米饭配牛油果", "Chili over brown rice with avocado", BROWN, [fr("avocado", 30), ve("romaine", 50)]),
      way("牛肉块黑豆炖菜卷全麦饼", "Chili in a whole-wheat wrap with yogurt", "whole_wheat_tortilla", [ve("cabbage", 50), tp("greek_yogurt", 20)]),
    ],
  }),
  dish({
    id: "slow_cooker_pulled_pork", zh: "慢炖手撕猪肉", en: "Slow-cooker pulled pork", sum: "猪腿肉加洋葱和烧烤酱，慢炖锅低温炖 8 小时后撕散", sumEn: "Pork leg with onion and barbecue sauce, slow-cooked 8 hours on low, then shredded.", c: "american", m: "slow_cook", eq: ["slow_cooker"], t: [10, 480],
    i: [pr("lean_pork_leg", 120), ve("onion", 50), se("bbq_sauce", 12), se("smoked_paprika", 1.5), se("rice_vinegar", 6)],
    ways: [
      way("手撕猪肉夹口袋饼配凉拌菜", "Pulled pork in pita with slaw", "whole_wheat_pita", [ve("cabbage", 70), ve("carrot", 30)]),
      way("手撕猪肉配烤土豆和西兰花", "Pulled pork on a baked potato with broccoli", BAKED_POTATO, [ve("frozen_broccoli", 90)]),
      way("手撕猪肉盖饭配菠萝", "Pulled pork rice bowl with pineapple", BROWN, [fr("pineapple", 60), ve("cucumber", 70)]),
    ],
  }),
  dish({
    id: "bbq_pulled_chicken", zh: "烧烤味手撕鸡", en: "BBQ pulled chicken", sum: "鸡胸肉加洋葱、烧烤酱和高汤，压力锅压 15 分钟后撕成丝", sumEn: "Chicken breast with onion, barbecue sauce and stock, pressure-cooked 15 minutes, then shredded.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 35],
    i: [pr("chicken_breast", 108), ve("onion", 50), se("bbq_sauce", 12), se("garlic_powder", 1), se("smoked_paprika", 1.5), se("low_sodium_stock", 60)],
    ways: [
      way("手撕鸡夹口袋饼", "BBQ chicken in pita with lettuce and tomato", "whole_wheat_pita", [ve("romaine", 60), ve("tomato", 50)]),
      way("手撕鸡配蒸红薯和四季豆", "BBQ chicken on sweet potato with green beans", SWEET_POTATO, [ve("frozen_green_beans", 90)]),
      way("手撕鸡杂粮饭配玉米", "BBQ chicken over multigrain rice with corn", GRAINS, [ve("frozen_corn", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "sheet_pan_paprika_chicken_thighs", zh: "红椒粉烤鸡腿肉", en: "Sheet-pan paprika chicken thighs", sum: "鸡腿肉、胡萝卜、洋葱抹红椒粉铺满烤盘，烤箱烤 35 分钟", sumEn: "Chicken thighs, carrot and onion rubbed with paprika, roasted on one tray for 35 minutes.", c: "american", m: "roast", eq: ["oven"], t: [10, 45],
    i: [pr("chicken_thigh", 125), ve("carrot", 70), ve("onion", 50), se("smoked_paprika", 2), se("poultry_seasoning", 1.5), se("garlic_powder", 1), se("salt", 0.4), oi("olive_oil", 3)],
    ways: [
      way("红椒粉烤鸡腿配烤小土豆和沙拉", "Chicken with roasted potatoes and salad", BABY_POTATOES, [ve("romaine", 60), ve("cucumber", 50)]),
      way("红椒粉烤鸡腿夹口袋饼配酸奶", "Chicken in pita with yogurt", "whole_wheat_pita", [tp("greek_yogurt", 25), ve("tomato", 50), ve("cucumber", 40)]),
      way("红椒粉烤鸡腿盖藜麦配菠菜苹果", "Chicken over quinoa with spinach and apple", QUINOA, [ve("spinach", 60), fr("apple", 60)]),
    ],
  }),
  dish({
    id: "chicken_vegetable_soup", zh: "鸡肉蔬菜汤", en: "Chicken and vegetable soup", sum: "鸡胸肉、胡萝卜、芹菜、洋葱加高汤小火煮 30 分钟", sumEn: "Chicken breast, carrot, celery and onion simmered in stock for 30 minutes.", c: "american", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 108), ve("carrot", 60), ve("celery", 50), ve("onion", 40), se("low_sodium_stock", 250), se("poultry_seasoning", 1), se("salt", 0.4), tp("parsley", 3)],
    ways: [
      way("鸡肉蔬菜汤配全麦吐司和苹果", "Soup with whole-wheat toast and an apple", "whole_wheat_toast", [fr("apple", 80), ve("romaine", 50)]),
      way("鸡肉蔬菜汤加意面", "Chicken noodle soup", WW_PASTA, [ve("frozen_spinach", 70)]),
      way("鸡肉蔬菜汤泡饭配豌豆", "Soup over rice with peas", RICE, [ve("frozen_peas", 60), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "beef_pot_roast", zh: "蔬菜炖牛腱", en: "Pot roast beef with vegetables", sum: "牛腱切块和胡萝卜、洋葱、番茄一起压力锅炖 45 分钟", sumEn: "Beef shank cubes with carrot, onion and tomato, pressure-cooked 45 minutes.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 75],
    i: [pr("beef_shank_raw", 105), ve("carrot", 70), ve("onion", 50), ve("crushed_tomatoes", 60), se("low_sodium_stock", 100), se("garlic_powder", 1), se("ground_black_pepper", 0.5), se("salt", 0.4)],
    ways: [
      way("蔬菜炖牛腱配烤小土豆和四季豆", "Pot roast with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
      way("蔬菜炖牛腱拌意面", "Pot roast over pasta", WW_PASTA, [ve("romaine", 60), ve("cherry_tomato", 50)]),
      way("蔬菜炖牛腱配蒸红薯和西兰花", "Pot roast with sweet potato and broccoli", SWEET_POTATO, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "slow_cooker_pepper_steak", zh: "彩椒洋葱慢炖牛肉（pepper steak）", en: "Slow-cooker pepper steak", sum: "牛腱块、彩椒、洋葱、番茄碎加酱油，慢炖锅炖 7 小时", sumEn: "Beef shank cubes with peppers, onion, crushed tomato and soy sauce, slow-cooked 7 hours.", c: "american", m: "slow_cook", eq: ["slow_cooker"], t: [10, 450],
    i: [pr("beef_shank_raw", 105), ve("green_pepper", 60), ve("red_bell_pepper", 50), ve("onion", 50), ve("crushed_tomatoes", 60), se("reduced_salt_soy_sauce", 4), se("garlic_powder", 1), se("ground_black_pepper", 0.5)],
    ways: [
      way("彩椒炖牛肉盖糙米饭配西兰花", "Pepper steak over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("彩椒炖牛肉配烤土豆和四季豆", "Pepper steak on a baked potato with green beans", BAKED_POTATO, [ve("frozen_green_beans", 90)]),
      way("彩椒炖牛肉卷全麦饼", "Pepper steak in a whole-wheat wrap with slaw", "whole_wheat_tortilla", [ve("cabbage", 60), ve("carrot", 30)]),
    ],
  }),
  dish({
    id: "beef_meatloaf", zh: "烤牛肉糕（meatloaf）", en: "Beef meatloaf", sum: "牛后腿肉现绞，拌鸡蛋、燕麦、洋葱和胡萝卜，压成块烤 45 分钟", sumEn: "Lean beef round ground fresh, mixed with egg, oats, onion and carrot, pressed into a loaf and baked 45 minutes.", c: "american", m: "bake", eq: ["oven"], t: [15, 60],
    i: [gr("lean_beef", 95), pr("egg", 60), st("oats", 10), ve("onion", 40), ve("carrot", 40), se("ketchup", 12), se("garlic_powder", 1), se("salt", 0.3)],
    ways: [
      way("牛肉糕配烤土豆和四季豆", "Meatloaf with a baked potato and green beans", BAKED_POTATO, [ve("frozen_green_beans", 90)]),
      way("牛肉糕夹吐司", "Meatloaf sandwich on toast", "white_toast", [ve("tomato", 60), ve("romaine", 40)]),
      way("牛肉糕配米饭和西兰花", "Meatloaf with rice and broccoli", RICE, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "oven_crumbed_chicken_tenders", zh: "烤箱面包糠鸡柳", en: "Oven-baked crumbed chicken tenders", sum: "鸡柳裹蛋白和面包糠，淋橄榄油，烤箱烤 20 分钟", sumEn: "Chicken tenders coated in egg white and breadcrumbs, drizzled with oil and baked 20 minutes.", c: "american", m: "bake", eq: ["oven"], t: [15, 35],
    i: [pr("chicken_tender", 90), pr("egg_white", 40), se("breadcrumbs", 12), se("garlic_powder", 1), se("smoked_paprika", 1.5), oi("olive_oil", 4)],
    ways: [
      way("面包糠鸡柳配蔬菜沙拉", "Tenders on a big salad", null, [ve("romaine", 70), ve("cucumber", 50), ve("cherry_tomato", 50)], 5),
      way("面包糠鸡柳夹口袋饼配凉拌菜", "Tenders in pita with slaw", "whole_wheat_pita", [ve("cabbage", 70), ve("carrot", 40)]),
      way("面包糠鸡柳配烤小土豆和西兰花", "Tenders with roasted potatoes and broccoli", BABY_POTATOES, [ve("frozen_broccoli", 100)]),
    ],
  }),
  dish({
    id: "steak_spinach_salad", zh: "牛排菠菜沙拉", en: "Seared steak and spinach salad", sum: "西冷牛排煎到喜欢的熟度，切片放在菠菜和小番茄上", sumEn: "Sirloin steak pan-seared to taste, sliced over spinach and cherry tomatoes.", c: "american", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, BAKED_POTATO, "whole_wheat_toast"],
    i: [pr("sirloin_steak", 120), ve("spinach", 80), ve("cherry_tomato", 60), ve("red_onion", 20), oi("olive_oil", 4), se("rice_vinegar", 6), se("ground_black_pepper", 0.5), se("salt", 0.4)],
  }),
  dish({
    id: "tuna_cucumber_bowl", zh: "金枪鱼黄瓜沙拉碗", en: "Tuna and cucumber salad bowl", sum: "水浸金枪鱼拌希腊酸奶，配黄瓜、芹菜和生菜，不用开火", sumEn: "Canned tuna mixed with Greek yogurt, served on cucumber, celery and lettuce; no cooking.", c: "american", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast", BAKED_POTATO],
    i: [pr("canned_tuna_water", 125), tp("greek_yogurt", 30), ve("cucumber", 60), ve("celery", 40), ve("romaine", 50), se("lemon", 8)],
  }),
  dish({
    id: "chicken_cobb_salad", zh: "鸡肉鸡蛋牛油果沙拉（Cobb）", en: "Chicken Cobb-style salad", sum: "即食鸡胸肉和水煮蛋切块，铺在生菜和番茄上，淋油醋汁", sumEn: "Ready-cooked chicken and boiled egg over lettuce and tomato with avocado and a vinaigrette.", c: "american", m: "assemble", eq: [], t: [10, 10],
    staples: ["whole_wheat_pita", QUINOA],
    i: [pr("ready_chicken_breast", 85), pr("egg", 65), ve("romaine", 90), ve("tomato", 60), fr("avocado", 30), oi("olive_oil", 3), se("rice_vinegar", 6)],
  }),
  dish({
    id: "salmon_asparagus_skillet", zh: "香煎三文鱼配芦笋", en: "Pan-seared salmon with asparagus", sum: "三文鱼皮朝下煎熟，芦笋同锅煎软，挤上柠檬汁", sumEn: "Salmon seared skin-side down, asparagus cooked in the same pan, finished with lemon.", c: "american", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, QUINOA, BROWN],
    i: [pr("salmon", 120), ve("asparagus", 130), oi("olive_oil", 3), se("lemon", 8), se("lemon_pepper_seasoning", 1), se("salt", 0.2)],
  }),
  dish({
    id: "cajun_shrimp_zucchini", zh: "卡津香料炒虾仁西葫芦", en: "Cajun shrimp with zucchini", sum: "虾仁用卡津香料拌匀，和西葫芦、彩椒大火快炒", sumEn: "Shrimp tossed in Cajun spice and stir-fried quickly with zucchini and pepper.", c: "american", m: "stir_fry", t: [12, 15],
    staples: [BROWN, GRAINS, PASTA],
    i: [pr("white_shrimp", 115), ve("zucchini", 130), ve("red_bell_pepper", 50), se("cajun_seasoning", 1.5), oi("olive_oil", 4)],
  }),
];

const MEDITERRANEAN: Dish[] = [
  dish({
    id: "lemon_herb_roast_chicken", zh: "柠檬香草烤鸡胸", en: "Lemon-herb roast chicken breast", sum: "鸡胸肉和西葫芦、红洋葱淋橄榄油和柠檬汁，撒牛至烤 25 分钟", sumEn: "Chicken breast with zucchini and red onion, dressed with oil, lemon and oregano, roasted 25 minutes.", c: "mediterranean", m: "roast", eq: ["oven"], t: [10, 40],
    i: [pr("chicken_breast", 108), ve("zucchini", 80), ve("red_onion", 40), se("lemon", 10), se("dried_oregano", 1), se("salt", 0.4), oi("olive_oil", 4)],
    ways: [
      way("柠檬烤鸡胸盖藜麦配黄瓜番茄", "Chicken over quinoa with cucumber and tomato", QUINOA, [ve("cucumber", 60), ve("tomato", 50)]),
      way("柠檬烤鸡胸夹口袋饼配酸奶", "Chicken in pita with yogurt", "whole_wheat_pita", [tp("greek_yogurt", 25), ve("romaine", 50), ve("tomato", 40)]),
      way("柠檬烤鸡胸配烤小土豆和四季豆", "Chicken with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
    ],
  }),
  dish({
    id: "greek_lemon_chicken_soup", zh: "希腊柠檬鸡汤", en: "Greek-style lemon chicken soup", sum: "鸡胸肉、胡萝卜、芹菜加高汤煮软，起锅前挤柠檬汁撒莳萝", sumEn: "Chicken breast, carrot and celery simmered in stock, finished with lemon juice and dill.", c: "mediterranean", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 100), ve("carrot", 50), ve("celery", 40), se("low_sodium_stock", 200), se("lemon", 20), tp("dill", 3)],
    ways: [
      way("柠檬鸡汤配口袋饼和黄瓜番茄", "Soup with pita and a cucumber tomato plate", "whole_wheat_pita", [ve("cucumber", 60), ve("tomato", 50)]),
      way("柠檬鸡汤泡饭配菠菜", "Soup over rice with spinach", RICE, [ve("frozen_spinach", 70)]),
      way("柠檬鸡汤加全麦意面", "Soup with whole-wheat pasta", WW_PASTA, [ve("cherry_tomato", 60), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "chicken_chickpea_stew", zh: "鸡肉鹰嘴豆炖菜", en: "Chicken and chickpea stew", sum: "鸡胸肉块、鹰嘴豆、番茄、胡萝卜加孜然和辣椒酱炖 30 分钟", sumEn: "Chicken cubes, chickpeas, tomato and carrot simmered 30 minutes with cumin and harissa.", c: "mediterranean", m: "stew", t: [15, 45],
    i: [pr("chicken_breast", 100), st("canned_chickpeas", 60), ve("crushed_tomatoes", 100), ve("onion", 40), ve("carrot", 40), se("ground_cumin", 1), se("ground_cinnamon", 0.5), se("harissa", 5)],
    ways: [
      way("鸡肉鹰嘴豆炖菜配藜麦和黄瓜", "Stew over quinoa with cucumber", QUINOA, [ve("cucumber", 60), tp("parsley", 3)]),
      way("鸡肉鹰嘴豆炖菜夹口袋饼配酸奶", "Stew in pita with yogurt", "whole_wheat_pita", [tp("greek_yogurt", 30), ve("romaine", 50)]),
      way("鸡肉鹰嘴豆炖菜盖糙米饭配菠菜", "Stew over brown rice with spinach", BROWN, [ve("frozen_spinach", 70), tp("lemon", 8)]),
    ],
  }),
  dish({
    id: "baked_beef_kofta", zh: "香料烤牛肉丸（kofta）", en: "Baked beef kofta", sum: "牛后腿肉现绞，拌孜然、红椒粉和洋葱碎，捏丸烤箱烤 20 分钟", sumEn: "Lean beef round ground fresh, mixed with cumin, paprika and onion, rolled into balls and baked 20 minutes.", c: "mediterranean", m: "bake", eq: ["oven"], t: [15, 35],
    i: [gr("lean_beef", 110), ve("red_onion", 30), tp("parsley", 3), se("ground_cumin", 1.5), se("smoked_paprika", 1.5), se("garlic_powder", 1), se("salt", 0.4)],
    ways: [
      way("香料牛肉丸夹口袋饼配黄瓜酸奶", "Kofta in pita with cucumber yogurt", "whole_wheat_pita", [tp("greek_yogurt", 25), ve("cucumber", 70), ve("tomato", 40)]),
      way("香料牛肉丸配藜麦和番茄沙拉", "Kofta over quinoa with tomato salad", QUINOA, [ve("cherry_tomato", 70), ve("cucumber", 50), tp("mint", 2)]),
      way("香料牛肉丸配米饭和紫甘蓝", "Kofta over rice with red cabbage", RICE, [ve("red_cabbage", 70), tp("lemon", 8)]),
    ],
  }),
  dish({
    id: "lemon_dill_roast_salmon", zh: "柠檬莳萝烤三文鱼", en: "Lemon-dill roast salmon", sum: "三文鱼和小番茄、西葫芦同烤盘，淋柠檬汁撒莳萝烤 15 分钟", sumEn: "Salmon with cherry tomato and zucchini on one tray, lemon and dill, roasted 15 minutes.", c: "mediterranean", m: "roast", eq: ["oven"], t: [10, 25],
    i: [pr("salmon", 120), ve("cherry_tomato", 70), ve("zucchini", 60), se("lemon", 10), tp("dill", 3), oi("olive_oil", 2), se("salt", 0.3)],
    ways: [
      way("烤三文鱼配烤小土豆和四季豆", "Salmon with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
      way("烤三文鱼藜麦沙拉", "Salmon over a quinoa salad", QUINOA, [ve("cucumber", 60), ve("romaine", 40)]),
      way("烤三文鱼拌冷全麦意面", "Salmon with cold whole-wheat pasta", WW_PASTA, [ve("cucumber", 60), ve("spinach", 50)]),
    ],
  }),
  dish({
    id: "tomato_baked_cod", zh: "番茄烤鳕鱼", en: "Tomato baked cod", sum: "鳕鱼铺在番茄、洋葱和西葫芦上，烤箱烤 20 分钟", sumEn: "Cod laid over tomato, onion and zucchini and baked 20 minutes.", c: "mediterranean", m: "bake", eq: ["oven"], t: [10, 30],
    i: [pr("cod", 140), ve("crushed_tomatoes", 100), ve("onion", 40), ve("zucchini", 50), se("dried_oregano", 1), oi("olive_oil", 4), se("salt", 0.3)],
    ways: [
      way("番茄烤鳕鱼拌意面配沙拉", "Cod over pasta with a green salad", PASTA, [ve("romaine", 60)]),
      way("番茄烤鳕鱼盖糙米饭配西兰花", "Cod over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("番茄烤鳕鱼夹口袋饼配黄瓜酸奶", "Cod in pita with cucumber and yogurt", "whole_wheat_pita", [ve("cucumber", 60), tp("greek_yogurt", 20)]),
    ],
  }),
  dish({
    id: "lentil_tomato_stew", zh: "番茄扁豆炖菜", en: "Lentil and tomato stew with feta", sum: "扁豆、番茄、胡萝卜、芹菜加高汤和孜然煮 30 分钟，撒菲达奶酪", sumEn: "Lentils, tomato, carrot and celery simmered 30 minutes in stock with cumin, topped with feta.", c: "mediterranean", m: "stew", t: [12, 45],
    i: [st("lentils_dry", 75), ve("crushed_tomatoes", 100), ve("carrot", 50), ve("onion", 40), ve("celery", 30), se("low_sodium_stock", 150), se("ground_cumin", 1), se("dried_oregano", 1), tp("feta", 15), se("lemon", 8)],
    ways: [
      way("番茄扁豆炖菜夹口袋饼配酸奶", "Stew in pita with yogurt and cucumber", "whole_wheat_pita", [tp("greek_yogurt", 30), ve("cucumber", 60)]),
      way("番茄扁豆炖菜盖糙米饭配菠菜", "Stew over brown rice with spinach", BROWN, [ve("frozen_spinach", 70)]),
      way("番茄扁豆炖菜配烤土豆和菲达奶酪", "Stew on a baked potato with feta", BAKED_POTATO, [tp("feta", 10), ve("cherry_tomato", 50)]),
    ],
  }),
  dish({
    id: "harissa_chicken_traybake", zh: "辣椒酱烤鸡腿（harissa）", en: "Harissa chicken thigh traybake", sum: "鸡腿肉、彩椒、西葫芦和红洋葱拌北非辣椒酱，铺烤盘烤 35 分钟", sumEn: "Chicken thighs, pepper, zucchini and red onion tossed in harissa and roasted on one tray 35 minutes.", c: "mediterranean", m: "roast", eq: ["oven"], t: [10, 45],
    i: [pr("chicken_thigh", 125), ve("red_bell_pepper", 60), ve("zucchini", 50), ve("red_onion", 40), se("harissa", 8), se("ground_cumin", 1), oi("olive_oil", 2), se("salt", 0.3)],
    ways: [
      way("辣椒酱烤鸡腿盖藜麦配黄瓜", "Chicken over quinoa with cucumber", QUINOA, [ve("cucumber", 60), tp("parsley", 3)]),
      way("辣椒酱烤鸡腿夹口袋饼配酸奶", "Chicken in pita with yogurt", "whole_wheat_pita", [tp("greek_yogurt", 25), ve("romaine", 50), ve("tomato", 40)]),
      way("辣椒酱烤鸡腿配烤小土豆和沙拉", "Chicken with roasted potatoes and salad", BABY_POTATOES, [ve("romaine", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "greek_beef_stifado", zh: "希腊洋葱番茄炖牛腱（stifado）", en: "Greek beef stifado", sum: "牛腱切块和大量洋葱、番茄、肉桂一起压力锅炖 45 分钟", sumEn: "Beef shank cubes with plenty of onion, tomato and cinnamon, pressure-cooked 45 minutes.", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 75],
    i: [pr("beef_shank_raw", 105), ve("onion", 70), ve("crushed_tomatoes", 100), se("ground_cinnamon", 0.5), se("dried_oregano", 1), se("low_sodium_stock", 80), se("salt", 0.4)],
    ways: [
      way("洋葱番茄炖牛腱拌意面", "Stifado over pasta with salad", PASTA, [ve("romaine", 50), ve("cucumber", 40)]),
      way("洋葱番茄炖牛腱配烤小土豆和四季豆", "Stifado with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
      way("洋葱番茄炖牛腱盖糙米饭配西兰花", "Stifado over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "lubia_beef_green_beans", zh: "黎巴嫩番茄四季豆炖牛肉（lubia）", en: "Lebanese beef and green bean stew (lubia)", sum: "牛腱块、四季豆、番茄碎加肉桂和孜然，压力锅炖 35 分钟", sumEn: "Beef shank cubes, green beans and crushed tomato with cinnamon and cumin, pressure-cooked 35 minutes.", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 60],
    i: [pr("beef_shank_raw", 105), ve("green_beans", 120), ve("crushed_tomatoes", 100), ve("onion", 40), se("ground_cinnamon", 0.5), se("ground_cumin", 1), se("garlic_paste", 2), oi("olive_oil", 3), se("salt", 0.3)],
    ways: [
      way("四季豆炖牛肉配米饭和黄瓜", "Stew over rice with cucumber", RICE, [ve("cucumber", 70)]),
      way("四季豆炖牛肉配藜麦和酸奶", "Stew over quinoa with yogurt", QUINOA, [tp("greek_yogurt", 25), ve("cherry_tomato", 50)]),
      way("四季豆炖牛肉夹口袋饼配生菜", "Stew in pita with lettuce", "whole_wheat_pita", [ve("romaine", 60), ve("tomato", 40)]),
    ],
  }),
  dish({
    id: "shakshuka", zh: "番茄红椒焖蛋（shakshuka）", en: "Shakshuka with feta", sum: "番茄、彩椒、洋葱炒软煮成酱，打入鸡蛋盖盖焖熟，撒菲达奶酪", sumEn: "Tomato, pepper and onion cooked into a sauce, eggs set in it under a lid, topped with feta.", c: "mediterranean", m: "pan_fry", t: [12, 20],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("egg", 110), pr("egg_white", 40), tp("feta", 8), ve("crushed_tomatoes", 100), ve("red_bell_pepper", 70), ve("onion", 30), se("smoked_paprika", 1.5), oi("olive_oil", 2)],
  }),
  dish({
    id: "greek_chicken_salad", zh: "希腊鸡肉沙拉", en: "Greek chicken salad", sum: "即食鸡胸肉拌黄瓜、番茄、红洋葱和菲达奶酪，淋橄榄油和柠檬汁", sumEn: "Ready-cooked chicken tossed with cucumber, tomato, red onion and feta, dressed with oil and lemon.", c: "mediterranean", m: "assemble", eq: [], t: [10, 10],
    staples: ["whole_wheat_pita", QUINOA, BABY_POTATOES],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 70), ve("tomato", 70), ve("red_onion", 20), tp("feta", 15), oi("olive_oil", 3), se("dried_oregano", 1), se("lemon", 8)],
  }),
  dish({
    id: "tuna_chickpea_salad", zh: "金枪鱼鹰嘴豆沙拉", en: "Tuna and chickpea salad", sum: "水浸金枪鱼和鹰嘴豆拌黄瓜、小番茄，淋橄榄油和柠檬汁", sumEn: "Canned tuna and chickpeas tossed with cucumber and cherry tomato, dressed with oil and lemon.", c: "mediterranean", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("canned_tuna_water", 110), st("canned_chickpeas", 60), ve("cucumber", 60), ve("cherry_tomato", 60), ve("red_onion", 20), oi("olive_oil", 3), se("lemon", 10), tp("parsley", 3)],
  }),
  dish({
    id: "tomato_shrimp_feta_skillet", zh: "番茄菲达奶酪烩虾", en: "Tomato and feta shrimp skillet", sum: "番茄和西葫芦煮成酱，下虾煮熟，撒碎菲达奶酪", sumEn: "Tomato and zucchini cooked into a sauce, shrimp poached in it, crumbled feta on top.", c: "mediterranean", m: "stir_fry", t: [12, 18],
    staples: [PASTA, QUINOA, BROWN],
    i: [pr("white_shrimp", 110), tp("feta", 10), ve("crushed_tomatoes", 100), ve("zucchini", 60), se("dried_oregano", 1), oi("olive_oil", 3)],
  }),
  dish({
    id: "lemon_seared_cod", zh: "柠檬香煎鳕鱼", en: "Lemon pan-seared cod with tomatoes", sum: "鳕鱼煎至两面金黄，小番茄和西葫芦同锅煎软，挤柠檬汁", sumEn: "Cod pan-seared golden on both sides, cherry tomato and zucchini softened in the same pan, finished with lemon.", c: "mediterranean", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("cod", 140), ve("cherry_tomato", 100), ve("zucchini", 60), oi("olive_oil", 4), se("lemon", 10), tp("parsley", 3), se("salt", 0.4)],
  }),
];

const ITALIAN: Dish[] = [
  dish({
    id: "beef_meatballs_marinara", zh: "意式番茄汁烤牛肉丸", en: "Baked beef meatballs in marinara", sum: "牛后腿肉现绞，拌蛋白和面包糠捏丸烤 20 分钟，浸入番茄洋葱酱汁", sumEn: "Lean beef round ground fresh, mixed with egg white and breadcrumbs, rolled and baked 20 minutes, then simmered in a tomato and onion sauce.", c: "italian", m: "bake", eq: ["oven"], t: [18, 40],
    i: [gr("lean_beef", 110), pr("egg_white", 40), ve("crushed_tomatoes", 150), ve("onion", 30), se("breadcrumbs", 8), se("italian_seasoning", 1.5), se("dried_oregano", 1), tp("basil", 3)],
    ways: [
      way("牛肉丸拌意面", "Meatballs with spaghetti and salad", PASTA, [ve("romaine", 50)]),
      way("牛肉丸配炒西葫芦", "Meatballs over sauteed zucchini", null, [ve("zucchini", 150)], 5),
      way("牛肉丸夹吐司配菠菜", "Meatballs on toast with spinach", "white_toast", [ve("spinach", 60)]),
    ],
  }),
  dish({
    id: "chicken_cacciatore", zh: "意式番茄蘑菇炖鸡（cacciatore）", en: "Chicken cacciatore", sum: "鸡胸肉块、蘑菇、彩椒加番茄和牛至焖煮 30 分钟", sumEn: "Chicken cubes, mushroom and pepper braised 30 minutes in tomato with oregano.", c: "italian", m: "braise", t: [15, 45],
    i: [pr("chicken_breast", 108), ve("crushed_tomatoes", 100), ve("red_bell_pepper", 50), ve("button_mushroom", 50), ve("onion", 30), se("dried_oregano", 1), se("italian_seasoning", 1.5), oi("olive_oil", 3), se("salt", 0.2)],
    ways: [
      way("番茄蘑菇炖鸡拌全麦意面", "Cacciatore over whole-wheat pasta", WW_PASTA, [ve("romaine", 50)]),
      way("番茄蘑菇炖鸡配全麦吐司和菠菜", "Cacciatore with toast and spinach", "white_toast", [ve("spinach", 60)]),
      way("番茄蘑菇炖鸡配烤土豆和西兰花", "Cacciatore on a baked potato with broccoli", BAKED_POTATO, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "beef_ragu", zh: "意式番茄炖牛肉块", en: "Italian tomato beef stew", sum: "牛腱块、番茄碎、洋葱、胡萝卜加意式香草，压力锅炖 35 分钟", sumEn: "Beef shank chunks with crushed tomato, onion and carrot and Italian herbs, pressure-cooked 35 minutes.", c: "italian", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 60],
    i: [pr("beef_shank_raw", 105), ve("crushed_tomatoes", 140), ve("onion", 40), ve("carrot", 40), se("italian_seasoning", 1.5), se("dried_oregano", 1), se("salt", 0.2)],
    ways: [
      way("番茄炖牛肉块拌意面配炒西葫芦", "Beef stew over spaghetti with sauteed zucchini", PASTA, [ve("zucchini", 70)]),
      way("番茄炖牛肉块拌全麦意面配沙拉", "Beef stew over whole-wheat pasta with salad", WW_PASTA, [ve("cherry_tomato", 40), ve("romaine", 50)]),
      way("番茄炖牛肉块配烤土豆和奶酪", "Beef stew on a baked potato with mozzarella", BAKED_POTATO, [tp("mozzarella", 15), ve("frozen_broccoli", 80)]),
    ],
  }),
  dish({
    id: "chicken_mushroom_ragu", zh: "意式鸡腿丁蘑菇番茄酱（ragu）", en: "Chicken thigh and mushroom ragu", sum: "鸡腿肉丁和蘑菇炒香，加番茄碎小火炖 30 分钟", sumEn: "Diced chicken thigh and mushroom sauteed, then simmered 30 minutes in crushed tomato.", c: "italian", m: "stew", t: [15, 45],
    i: [pr("chicken_thigh", 135), ve("button_mushroom", 100), ve("crushed_tomatoes", 100), ve("onion", 30), se("italian_seasoning", 1.5), oi("olive_oil", 2), se("salt", 0.2)],
    ways: [
      way("鸡丁蘑菇番茄酱拌全麦意面配西葫芦", "Ragu with whole-wheat pasta and zucchini", WW_PASTA, [ve("zucchini", 70)]),
      way("鸡丁蘑菇番茄酱配藜麦和菠菜", "Ragu over quinoa with spinach", QUINOA, [ve("spinach", 60)]),
      way("鸡丁蘑菇番茄酱抹吐司配沙拉", "Ragu on toast with tomato and salad", "white_toast", [ve("romaine", 50), ve("cherry_tomato", 50)]),
    ],
  }),
  dish({
    id: "chicken_minestrone", zh: "意式鸡肉蔬菜汤（minestrone）", en: "Chicken and vegetable minestrone", sum: "鸡胸肉、番茄、胡萝卜、芹菜、西葫芦加高汤煮 30 分钟，撒罗勒", sumEn: "Chicken breast, tomato, carrot, celery and zucchini simmered 30 minutes in stock, finished with basil.", c: "italian", m: "simmer", t: [15, 45],
    i: [pr("chicken_breast", 90), ve("crushed_tomatoes", 80), ve("carrot", 40), ve("celery", 30), ve("zucchini", 40), se("low_sodium_stock", 100), tp("basil", 3), se("italian_seasoning", 1), se("salt", 0.3)],
    ways: [
      way("意式鸡肉蔬菜汤配全麦吐司", "Minestrone with whole-wheat toast and salad", "whole_wheat_toast", [ve("romaine", 50)]),
      way("意式鸡肉蔬菜汤加全麦意面", "Minestrone with whole-wheat pasta", WW_PASTA, [ve("frozen_spinach", 70)]),
      way("意式鸡肉蔬菜汤泡饭配豌豆", "Minestrone over rice with peas", RICE, [ve("frozen_peas", 60)]),
    ],
  }),
  dish({
    id: "chicken_pizzaiola", zh: "番茄奶酪烤鸡胸", en: "Chicken pizzaiola", sum: "鸡胸肉盖上番茄、洋葱、彩椒酱和马苏里拉奶酪，烤箱烤 25 分钟", sumEn: "Chicken breast topped with tomato, onion and pepper sauce and mozzarella, baked 25 minutes.", c: "italian", m: "bake", eq: ["oven"], t: [12, 35],
    i: [pr("chicken_breast", 105), ve("crushed_tomatoes", 120), ve("onion", 30), ve("red_bell_pepper", 40), se("dried_oregano", 1), oi("olive_oil", 3), tp("mozzarella", 20), se("salt", 0.2)],
    ways: [
      way("番茄奶酪烤鸡胸拌意面配沙拉", "Pizzaiola over pasta with salad", PASTA, [ve("romaine", 60)]),
      way("番茄奶酪烤鸡胸配全麦吐司和菠菜", "Pizzaiola on toast with spinach", "whole_wheat_toast", [ve("spinach", 60)]),
      way("番茄奶酪烤鸡胸配烤小土豆和四季豆", "Pizzaiola with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
    ],
  }),
  dish({
    id: "herb_roast_pork_tenderloin", zh: "香草烤猪里脊", en: "Herb-roasted pork tenderloin", sum: "猪里脊和彩椒、西葫芦抹意式香草和橄榄油，烤箱烤 25 分钟", sumEn: "Pork tenderloin with pepper and zucchini, rubbed with Italian herbs and oil, roasted 25 minutes.", c: "italian", m: "roast", eq: ["oven"], t: [10, 40],
    i: [pr("pork_tenderloin", 120), ve("red_bell_pepper", 60), ve("zucchini", 60), ve("red_onion", 30), se("italian_seasoning", 1.5), se("dried_oregano", 0.5), oi("olive_oil", 3), se("salt", 0.3), se("lemon", 8)],
    ways: [
      way("香草烤猪里脊配烤小土豆和四季豆", "Pork with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
      way("香草烤猪里脊拌全麦意面", "Pork with whole-wheat pasta and tomatoes", WW_PASTA, [ve("cherry_tomato", 60), ve("romaine", 40)]),
      way("香草烤猪里脊配藜麦和菠菜", "Pork over quinoa with spinach", QUINOA, [ve("spinach", 60)]),
    ],
  }),
  dish({
    id: "italian_lentil_soup", zh: "意式扁豆汤", en: "Italian lentil soup", sum: "扁豆、番茄、胡萝卜、芹菜、洋葱加高汤煮 30 分钟", sumEn: "Lentils, tomato, carrot, celery and onion simmered in stock for 30 minutes.", c: "italian", m: "simmer", t: [12, 45],
    i: [st("lentils_dry", 90), ve("crushed_tomatoes", 80), ve("carrot", 50), ve("celery", 40), ve("onion", 40), se("low_sodium_stock", 250), se("dried_oregano", 1), tp("parsley", 3), se("salt", 0.3)],
    ways: [
      way("意式扁豆汤配全麦吐司", "Soup with whole-wheat toast and salad", "whole_wheat_toast", [ve("romaine", 50), ve("tomato", 40)]),
      way("意式扁豆汤加全麦意面", "Soup with whole-wheat pasta and spinach", WW_PASTA, [ve("frozen_spinach", 70)]),
      way("意式扁豆汤配藜麦沙拉", "Soup with a cool quinoa salad", QUINOA, [ve("cherry_tomato", 60), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "chicken_meatball_spinach_soup", zh: "鸡肉丸菠菜汤", en: "Chicken meatball and spinach soup", sum: "鸡腿肉现绞，拌蛋白和面包糠捏成小丸，下入高汤煮熟，加菠菜", sumEn: "Chicken thigh ground fresh, mixed with egg white and breadcrumbs into small balls, poached in stock with spinach.", c: "italian", m: "simmer", t: [18, 40],
    i: [gr("chicken_thigh", 100), pr("egg_white", 45), se("breadcrumbs", 8), ve("frozen_spinach", 80), ve("carrot", 40), ve("onion", 30), se("low_sodium_stock", 100), se("italian_seasoning", 1), se("salt", 0.3)],
    ways: [
      way("鸡肉丸菠菜汤加全麦意面", "Soup with small pasta", WW_PASTA, [ve("romaine", 50)]),
      way("鸡肉丸菠菜汤配全麦吐司和番茄", "Soup with toast and tomato", "whole_wheat_toast", [ve("cherry_tomato", 60)]),
      way("鸡肉丸菠菜汤泡饭配豌豆", "Soup over rice with peas", RICE, [ve("frozen_peas", 60)]),
    ],
  }),
  dish({
    id: "shrimp_tomato_basil_pasta", zh: "番茄罗勒炒虾仁", en: "Shrimp with cherry tomatoes and basil", sum: "虾仁和小番茄、西葫芦快炒到番茄出汁，起锅撒罗勒", sumEn: "Shrimp, cherry tomato and zucchini stir-fried until the tomato breaks down, finished with basil.", c: "italian", m: "stir_fry", t: [12, 18],
    staples: [PASTA, WW_PASTA],
    i: [pr("white_shrimp", 115), ve("cherry_tomato", 110), ve("zucchini", 60), tp("basil", 4), oi("olive_oil", 4), se("garlic_paste", 2), se("salt", 0.2)],
  }),
  dish({
    id: "lemon_mushroom_chicken", zh: "柠檬蘑菇煎鸡胸", en: "Lemon chicken with mushrooms and spinach", sum: "鸡胸肉煎熟，蘑菇和菠菜同锅炒软，加柠檬汁和少许高汤收汁", sumEn: "Chicken breast pan-fried, mushroom and spinach wilted in the pan, finished with lemon and a splash of stock.", c: "italian", m: "pan_fry", t: [12, 18],
    staples: [PASTA, BABY_POTATOES, BAKED_POTATO],
    i: [pr("chicken_breast", 108), ve("button_mushroom", 100), ve("spinach", 60), se("lemon", 12), tp("parsley", 3), oi("olive_oil", 4), se("salt", 0.4), se("low_sodium_stock", 30)],
  }),
  dish({
    id: "caprese_chicken_plate", zh: "番茄马苏里拉鸡肉拼盘（Caprese）", en: "Caprese chicken plate", sum: "即食鸡胸肉配番茄片、马苏里拉奶酪和罗勒，淋橄榄油和柠檬汁", sumEn: "Ready-cooked chicken with sliced tomato, mozzarella and basil, dressed with oil and lemon.", c: "italian", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_toast", QUINOA],
    i: [pr("ready_chicken_breast", 100), tp("mozzarella", 25), ve("tomato", 130), tp("basil", 4), oi("olive_oil", 3), se("lemon", 5)],
  }),
  dish({
    id: "tuna_tomato_spaghetti_sauce", zh: "金枪鱼番茄意面酱", en: "Tuna and tomato sauce", sum: "西葫芦和番茄碎煮成酱，拌入水浸金枪鱼，浇在意面上", sumEn: "Zucchini and crushed tomato cooked into a sauce, canned tuna stirred in, served over pasta.", c: "italian", m: "stir_fry", t: [10, 15],
    staples: [PASTA, WW_PASTA],
    i: [pr("canned_tuna_water", 100), ve("crushed_tomatoes", 100), ve("zucchini", 50), tp("basil", 3), oi("olive_oil", 3), se("dried_oregano", 0.5), se("garlic_paste", 2)],
  }),
  dish({
    id: "pork_pepper_medallions", zh: "彩椒煎猪里脊", en: "Pork medallions with peppers and zucchini", sum: "猪里脊切厚片煎熟，彩椒和西葫芦同锅煎软，挤柠檬汁", sumEn: "Thick pork tenderloin slices pan-fried, pepper and zucchini softened in the same pan, finished with lemon.", c: "italian", m: "pan_fry", t: [12, 18],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("pork_tenderloin", 118), ve("red_bell_pepper", 70), ve("zucchini", 70), oi("olive_oil", 4), se("italian_seasoning", 1), se("salt", 0.3), se("lemon", 6)],
  }),
];

const CHINESE: Dish[] = [
  dish({
    id: "tomato_braised_beef_shank", zh: "番茄炖牛腱", en: "Tomato braised beef shank", sum: "牛腱切块和番茄、胡萝卜、洋葱一起压力锅炖 35 分钟", sumEn: "Beef shank cubes with tomato, carrot and onion, pressure-cooked 35 minutes.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 60],
    i: [pr("beef_shank_raw", 105), ve("tomato", 220), ve("carrot", 50), ve("onion", 40), se("garlic_paste", 3), se("ginger_paste", 3), se("reduced_salt_soy_sauce", 5), oi("canola_oil", 3)],
    ways: [
      way("番茄炖牛腱配米饭和焯上海青", "Beef over rice with blanched bok choy", RICE, [ve("bok_choy", 100)]),
      way("番茄炖牛腱拌面配焯菜心", "Beef with noodles and blanched choy sum", "fresh_noodles", [ve("choy_sum", 100)]),
      way("番茄炖牛腱配馒头和拍黄瓜", "Beef with a steamed bun and cucumber", "steamed_bun", [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "shiitake_braised_chicken", zh: "香菇黄焖鸡", en: "Shiitake braised chicken thighs", sum: "鸡腿肉块和香菇、青椒加蚝油、酱油焖 25 分钟", sumEn: "Chicken thigh cubes with shiitake and green pepper, braised 25 minutes in oyster and soy sauce.", c: "chinese", m: "stew", t: [15, 40],
    i: [pr("chicken_thigh", 120), ve("shiitake", 80), ve("green_pepper", 70), se("oyster_sauce", 5), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("canola_oil", 3)],
    ways: [
      way("香菇黄焖鸡配糙米饭和上海青", "Chicken over brown rice with bok choy", BROWN, [ve("bok_choy", 100)]),
      way("香菇黄焖鸡配糯玉米和黄瓜", "Chicken with waxy corn and cucumber", CORN, [ve("cucumber", 80)]),
      way("香菇黄焖鸡配杂粮饭和西兰花", "Chicken over multigrain rice with broccoli", GRAINS, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "yam_wood_ear_chicken", zh: "山药木耳炖鸡", en: "Chicken stew with yam and wood ear", sum: "鸡腿肉块和山药、木耳、香菇加酱油和姜小火炖 30 分钟", sumEn: "Chicken thigh cubes with yam, wood ear and shiitake, simmered 30 minutes in soy sauce and ginger.", c: "chinese", m: "stew", t: [15, 45],
    i: [pr("chicken_thigh", 115), ve("chinese_yam", 120), ve("wood_ear", 60), ve("shiitake", 40), se("reduced_salt_soy_sauce", 4), se("ginger_paste", 3)],
    ways: [
      way("山药木耳炖鸡配米饭和芥蓝", "Stew over rice with blanched gai lan", RICE, [ve("gai_lan", 100)]),
      way("山药木耳炖鸡配小米饭和菜心", "Stew over millet rice with choy sum", MILLET, [ve("choy_sum", 100)]),
      way("山药木耳炖鸡配馒头和黄瓜", "Stew with a steamed bun and cucumber", "steamed_bun", [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "potato_soy_braised_chicken", zh: "土豆烧鸡", en: "Soy-braised chicken with potato", sum: "鸡腿肉、土豆、胡萝卜加酱油、蚝油和五香粉焖烧 25 分钟", sumEn: "Chicken thigh, potato and carrot braised 25 minutes in soy sauce, oyster sauce and five-spice.", c: "chinese", m: "braise", t: [15, 40],
    i: [pr("chicken_thigh", 115), st("potato", 100), ve("onion", 40), ve("carrot", 50), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 2)],
    ways: [
      way("土豆烧鸡配焯上海青", "Chicken and potato with blanched bok choy", null, [ve("bok_choy", 100)]),
      way("土豆烧鸡配米饭和拍黄瓜", "Chicken and potato over rice with cucumber", RICE, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "radish_beef_stew", zh: "白萝卜炖牛腱", en: "Beef shank and white radish stew", sum: "牛腱切块和白萝卜、胡萝卜一起压力锅炖 40 分钟", sumEn: "Beef shank cubes with white radish and carrot, pressure-cooked 40 minutes.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 60],
    i: [pr("beef_shank_raw", 105), ve("white_radish", 200), ve("carrot", 40), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("five_spice_powder", 0.5), se("ginger_paste", 3)],
    ways: [
      way("白萝卜炖牛腱配米饭和菜心", "Stew over rice with choy sum", RICE, [ve("choy_sum", 100)]),
      way("白萝卜炖牛腱拌面配上海青", "Stew with noodles and bok choy", "fresh_noodles", [ve("bok_choy", 100)]),
      way("白萝卜炖牛腱配糯玉米和黄瓜", "Stew with waxy corn and cucumber", CORN, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "napa_tofu_meatball_stew", zh: "白菜豆腐炖肉丸", en: "Napa cabbage, tofu and pork meatball stew", sum: "猪后腿瘦肉现绞拌姜捏丸，和白菜、豆腐、米粉炖 25 分钟", sumEn: "Lean pork leg ground fresh and mixed with ginger into balls, simmered 25 minutes with napa cabbage, tofu and a little rice noodle.", c: "chinese", m: "stew", t: [18, 45],
    i: [gr("lean_pork_leg", 85), pr("soft_tofu", 110), ve("napa_cabbage", 130), st("rice_noodles_dry", 12), se("reduced_salt_soy_sauce", 4), se("ginger_paste", 3), oi("sesame_oil", 2), se("salt", 0.3)],
    ways: [
      way("白菜豆腐肉丸配米饭和上海青", "Stew with rice and bok choy", RICE, [ve("bok_choy", 100)]),
      way("白菜豆腐肉丸配馒头和拍黄瓜", "Stew with a steamed bun and cucumber", "steamed_bun", [ve("cucumber", 80)]),
      way("白菜豆腐肉丸配糙米饭和菜心", "Stew with brown rice and choy sum", BROWN, [ve("choy_sum", 100)]),
    ],
  }),
  dish({
    id: "northeast_iron_pot_chicken", zh: "东北铁锅炖鸡腿肉（配土豆玉米四季豆）", en: "Northeastern iron-pot chicken with potato, corn and green beans", sum: "鸡腿肉块、土豆、玉米段、四季豆加酱油，铁锅小火炖 35 分钟", sumEn: "Chicken thigh pieces, potato, corn on the cob and green beans stewed 35 minutes in a heavy pot with soy sauce.", c: "chinese", m: "stew", t: [15, 50],
    i: [pr("chicken_thigh", 120), st("potato", 80), ve("sweet_corn_cob", 70), ve("green_beans", 90), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 3), se("low_sodium_stock", 100)],
    ways: [
      way("铁锅炖鸡腿肉配馒头和拍黄瓜", "Stew with a steamed bun and cucumber", "steamed_bun", [ve("cucumber", 80)]),
      way("铁锅炖鸡腿肉配米饭和上海青", "Stew over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("铁锅炖鸡腿肉配杂粮饭和菜心", "Stew over multigrain rice with choy sum", GRAINS, [ve("choy_sum", 100)]),
    ],
  }),
  dish({
    id: "potato_soy_braised_beef", zh: "土豆红烧牛腱", en: "Soy-braised beef shank with potato", sum: "牛腱块、土豆、胡萝卜加酱油、蚝油和五香粉，压力锅炖 40 分钟", sumEn: "Beef shank cubes, potato and carrot with soy sauce, oyster sauce and five-spice, pressure-cooked 40 minutes.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), st("potato", 100), ve("carrot", 50), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 3)],
    ways: [
      way("土豆红烧牛腱配焯上海青", "Beef and potato with blanched bok choy", null, [ve("bok_choy", 100)]),
      way("土豆红烧牛腱配米饭和拍黄瓜", "Beef and potato over rice with cucumber", RICE, [ve("cucumber", 80)]),
      way("土豆红烧牛腱配糯玉米和菜心", "Beef and potato with waxy corn and choy sum", CORN, [ve("choy_sum", 100)]),
    ],
  }),
  dish({
    id: "winter_melon_chicken_meatball_soup", zh: "冬瓜鸡肉丸汤", en: "Winter melon and chicken meatball soup", sum: "鸡腿肉现绞拌姜捏成丸，和冬瓜块、香菇在清汤里煮 20 分钟", sumEn: "Chicken thigh ground fresh and mixed with ginger into balls, simmered 20 minutes in a clear broth with winter melon and shiitake.", c: "chinese", m: "simmer", t: [18, 40],
    i: [gr("chicken_thigh", 125), ve("winter_melon", 200), ve("shiitake", 30), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("sesame_oil", 2), se("low_sodium_stock", 150)],
    ways: [
      way("冬瓜鸡肉丸汤配米饭和上海青", "Soup with rice and bok choy", RICE, [ve("bok_choy", 100)]),
      way("冬瓜鸡肉丸汤配杂粮饭和芥蓝", "Soup with multigrain rice and gai lan", GRAINS, [ve("gai_lan", 100)]),
      way("冬瓜鸡肉丸汤下面条配菜心", "Soup with noodles and choy sum", "fresh_noodles", [ve("choy_sum", 100)]),
    ],
  }),
  dish({
    id: "steamed_chicken_shiitake", zh: "香菇蒸鸡", en: "Steamed chicken with shiitake and wood ear", sum: "鸡腿肉块与香菇、木耳用蚝油和酱油拌匀，上锅蒸 20 分钟", sumEn: "Chicken thigh cubes with shiitake and wood ear, mixed with oyster and soy sauce, steamed 20 minutes.", c: "chinese", m: "steam", eq: ["steamer"], t: [12, 30],
    i: [pr("chicken_thigh", 120), ve("shiitake", 80), ve("wood_ear", 40), se("oyster_sauce", 4), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("sesame_oil", 2)],
    ways: [
      way("香菇蒸鸡配糙米饭和菜心", "Chicken over brown rice with choy sum", BROWN, [ve("choy_sum", 100)]),
      way("香菇蒸鸡配蒸红薯和上海青", "Chicken with steamed sweet potato and bok choy", SWEET_POTATO, [ve("bok_choy", 100)]),
      way("香菇蒸鸡配馒头和拍黄瓜", "Chicken with a steamed bun and cucumber", "steamed_bun", [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "beef_mapo_tofu", zh: "牛肉丁麻婆豆腐", en: "Mapo tofu with diced beef and peppers", sum: "牛后腿肉切小丁炒散，加麻婆酱和豆瓣酱，下豆腐、青椒煮 8 分钟", sumEn: "Small diced beef round browned, simmered 8 minutes with mapo and chili bean sauce, tofu and green pepper.", c: "chinese", m: "stew", t: [12, 20],
    i: [pr("lean_beef", 85), pr("soft_tofu", 120), ve("green_pepper", 100), se("mapo_sauce", 12), se("doubanjiang", 3), se("sichuan_pepper_powder", 1)],
    ways: [
      way("牛肉丁麻婆豆腐配米饭和上海青", "Mapo tofu over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("牛肉丁麻婆豆腐配糙米饭和西兰花", "Mapo tofu over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("牛肉丁麻婆豆腐配杂粮饭和芥蓝", "Mapo tofu over multigrain rice with gai lan", GRAINS, [ve("gai_lan", 100)]),
    ],
  }),
  dish({
    id: "five_spice_braised_chicken", zh: "五香卤鸡胸", en: "Five-spice braised chicken breast", sum: "鸡胸肉与胡萝卜、洋葱用酱油和五香粉小火卤 25 分钟", sumEn: "Chicken breast with carrot and onion, simmered 25 minutes in soy sauce and five-spice.", c: "chinese", m: "braise", t: [10, 40],
    i: [pr("chicken_breast", 108), ve("carrot", 60), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("five_spice_powder", 1), se("ginger_paste", 3)],
    ways: [
      way("五香卤鸡胸配米饭和菜心", "Chicken over rice with choy sum", RICE, [ve("choy_sum", 100)]),
      way("五香卤鸡胸拌面配上海青", "Chicken with noodles and bok choy", "fresh_noodles", [ve("bok_choy", 100)]),
      way("五香卤鸡胸手撕拌黄瓜", "Shredded chicken with sesame cucumber salad", null, [ve("cucumber", 110), tp("sesame_seeds", 3)], 5),
    ],
  }),
  dish({
    id: "tomato_shrimp_egg_stirfry", zh: "番茄虾仁炒蛋", en: "Tomato, shrimp and scrambled eggs", sum: "鸡蛋炒到刚凝固盛出，番茄炒出汁，下虾仁和鸡蛋拌匀", sumEn: "Eggs scrambled until just set and set aside, tomato cooked down, shrimp and eggs folded back in.", c: "chinese", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("egg", 55), pr("white_shrimp", 85), ve("tomato", 150), se("reduced_salt_soy_sauce", 3), oi("canola_oil", 5)],
  }),
  dish({
    id: "kung_pao_chicken", zh: "宫保鸡丁", en: "Kung pao chicken", sum: "鸡丁与青椒、胡萝卜、芹菜大火快炒，加醋、酱油和少许糖，撒花生", sumEn: "Chicken cubes stir-fried hot with pepper, carrot and celery, seasoned with vinegar, soy and a little sugar, topped with peanuts.", c: "chinese", m: "stir_fry", t: [15, 20],
    staples: [RICE, BROWN, MILLET],
    i: [pr("chicken_breast", 105), tp("peanuts", 8), ve("green_pepper", 60), ve("carrot", 50), ve("celery", 50), se("reduced_salt_soy_sauce", 4), se("black_vinegar", 4), se("white_sugar", 3), se("chili_sauce", 3), oi("canola_oil", 4)],
  }),
  dish({
    id: "green_pepper_pork_strips", zh: "青椒肉丝", en: "Pork strips with peppers", sum: "猪腿肉切丝滑炒变色，加青椒、彩椒丝用蚝油和酱油炒熟", sumEn: "Pork strips stir-fried until pale, then cooked with pepper strips in oyster and soy sauce.", c: "chinese", m: "stir_fry", t: [12, 15],
    staples: [RICE, GRAINS, SWEET_POTATO],
    i: [pr("lean_pork_leg", 115), ve("green_pepper", 100), ve("red_bell_pepper", 50), se("reduced_salt_soy_sauce", 3), se("oyster_sauce", 3), se("garlic_paste", 3), oi("canola_oil", 5)],
  }),
  dish({
    id: "steamed_cod_shiitake", zh: "清蒸鳕鱼香菇", en: "Steamed cod with shiitake and bok choy", sum: "鳕鱼与香菇铺盘淋酱油，上锅蒸 10 分钟，配焯上海青", sumEn: "Cod and shiitake on a plate with soy sauce, steamed 10 minutes, served with blanched bok choy.", c: "chinese", m: "steam", eq: ["steamer"], t: [10, 20],
    staples: [RICE, MILLET, CORN],
    i: [pr("cod", 135), ve("shiitake", 60), ve("bok_choy", 90), se("reduced_salt_soy_sauce", 5), se("ginger_paste", 3), oi("sesame_oil", 3)],
  }),
  dish({
    id: "sesame_chicken_cucumber_salad", zh: "麻酱鸡丝拌黄瓜", en: "Sesame chicken and cucumber salad", sum: "即食鸡胸肉撕丝，和黄瓜、紫甘蓝用芝麻酱、醋和酱油拌匀", sumEn: "Ready-cooked chicken shredded and tossed with cucumber and red cabbage in sesame paste, vinegar and soy.", c: "chinese", m: "assemble", eq: [], t: [10, 10],
    staples: [RICE, "steamed_bun", SWEET_POTATO],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 130), ve("red_cabbage", 40), oi("sesame_paste", 8), se("reduced_salt_soy_sauce", 3), se("black_vinegar", 4)],
  }),
];

const MEXICAN: Dish[] = [
  dish({
    id: "salsa_shredded_chicken", zh: "墨西哥番茄手撕鸡", en: "Slow-cooker salsa chicken", sum: "鸡胸肉、番茄碎、洋葱、青椒加墨西哥香料，慢炖锅炖 5 小时后撕散", sumEn: "Chicken breast with crushed tomato, onion, pepper and taco spice, slow-cooked 5 hours, then shredded.", c: "mexican", m: "slow_cook", eq: ["slow_cooker"], t: [10, 300],
    i: [pr("chicken_breast", 110), ve("crushed_tomatoes", 80), ve("onion", 40), ve("green_pepper", 40), se("taco_seasoning", 2.5), se("lime", 8)],
    ways: [
      way("墨西哥手撕鸡卷玉米饼", "Chicken tacos in corn tortillas", "corn_tortilla", [ve("cabbage", 60), tp("coriander", 3), tp("lime", 8)]),
      way("墨西哥手撕鸡糙米饭碗", "Chicken burrito bowl over brown rice", BROWN, [ve("frozen_corn", 60), ve("tomato", 50), fr("avocado", 30)]),
      way("墨西哥手撕鸡配烤土豆和酸奶", "Chicken on a baked potato with yogurt", BAKED_POTATO, [tp("greek_yogurt", 25), ve("romaine", 60), tp("coriander", 3)]),
    ],
  }),
  dish({
    id: "orange_carnitas_pork", zh: "橙香墨西哥手撕猪肉（carnitas）", en: "Orange carnitas-style pork", sum: "猪腿肉加洋葱、橙子、孜然和牛至，慢炖锅炖 7 小时后撕散", sumEn: "Pork leg with onion, orange, cumin and oregano, slow-cooked 7 hours, then shredded.", c: "mexican", m: "slow_cook", eq: ["slow_cooker"], t: [10, 420],
    i: [pr("lean_pork_leg", 120), ve("onion", 50), fr("orange", 40), se("ground_cumin", 1.5), se("dried_oregano", 1), se("lime", 8), se("salt", 0.4)],
    ways: [
      way("橙香手撕猪肉卷玉米饼", "Carnitas tacos with cabbage and lime", "corn_tortilla", [ve("cabbage", 60), tp("coriander", 3), tp("lime", 8)]),
      way("橙香手撕猪肉糙米饭碗配菠萝", "Carnitas rice bowl with pineapple", BROWN, [ve("tomato", 65), fr("pineapple", 60)]),
      way("橙香手撕猪肉生菜包", "Carnitas lettuce wraps", null, [ve("romaine", 100), ve("cherry_tomato", 50)], 5),
    ],
  }),
  dish({
    id: "beef_barbacoa", zh: "墨西哥香料炖牛腱（barbacoa）", en: "Beef barbacoa", sum: "牛腱块与洋葱、番茄、辣椒粉和孜然一起压力锅炖 50 分钟后撕散", sumEn: "Beef shank cubes with onion, tomato, chili powder and cumin, pressure-cooked 50 minutes, then shredded.", c: "mexican", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 75],
    i: [pr("beef_shank_raw", 105), ve("onion", 50), ve("crushed_tomatoes", 60), se("chili_powder_blend", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("lime", 8), se("salt", 0.3)],
    ways: [
      way("香料炖牛腱卷玉米饼", "Barbacoa tacos with red cabbage", "corn_tortilla", [ve("red_cabbage", 60), tp("coriander", 3)]),
      way("香料炖牛腱配蒸红薯和酸奶", "Barbacoa on sweet potato with yogurt", SWEET_POTATO, [ve("cabbage", 60), tp("greek_yogurt", 20)]),
      way("香料炖牛腱盖糙米饭配玉米", "Barbacoa over brown rice with corn", BROWN, [ve("frozen_corn", 60), ve("romaine", 50)]),
    ],
  }),
  dish({
    id: "carne_guisada", zh: "墨西哥番茄土豆炖牛肉（carne guisada）", en: "Carne guisada beef and potato stew", sum: "牛腱块、土豆、番茄碎、青椒加辣椒粉和孜然，小火炖 100 分钟", sumEn: "Beef shank cubes, potato, crushed tomato and pepper with chili powder and cumin, simmered 100 minutes.", c: "mexican", m: "stew", t: [15, 120],
    i: [pr("beef_shank_raw", 105), st("potato", 70), ve("crushed_tomatoes", 90), ve("onion", 40), ve("green_pepper", 40), se("chili_powder_blend", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("salt", 0.3)],
    ways: [
      way("番茄土豆炖牛肉卷玉米饼", "Stew in corn tortillas with cabbage and coriander", "corn_tortilla", [ve("cabbage", 60), tp("coriander", 3), tp("lime", 8)]),
      way("番茄土豆炖牛肉盖糙米饭配牛油果", "Stew over brown rice with avocado", BROWN, [fr("avocado", 30), ve("romaine", 50)]),
      way("番茄土豆炖牛肉配杂粮饭和玉米", "Stew over multigrain rice with corn", GRAINS, [ve("frozen_corn", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "chicken_taco_filling", zh: "墨西哥香料手撕鸡腿肉", en: "Taco-spiced shredded chicken thigh", sum: "鸡腿肉块加番茄碎、洋葱、彩椒和墨西哥香料煮 25 分钟，撕散", sumEn: "Chicken thigh pieces cooked 25 minutes with crushed tomato, onion, pepper and taco spice, then shredded.", c: "mexican", m: "stew", t: [12, 40],
    i: [pr("chicken_thigh", 125), ve("crushed_tomatoes", 80), ve("onion", 40), ve("red_bell_pepper", 40), se("taco_seasoning", 3)],
    ways: [
      way("手撕鸡腿肉卷玉米饼", "Tacos in corn tortillas with lettuce", "corn_tortilla", [ve("romaine", 60), ve("tomato", 50)]),
      way("手撕鸡腿肉糙米饭碗", "Taco rice bowl with corn", BROWN, [ve("frozen_corn", 50), ve("cucumber", 60)]),
      way("手撕鸡腿肉配烤土豆和奶酪", "Taco baked potato with cheese", BAKED_POTATO, [tp("mozzarella", 15), ve("romaine", 60)]),
    ],
  }),
  dish({
    id: "chicken_tortilla_soup", zh: "墨西哥鸡肉玉米汤", en: "Chicken tortilla soup", sum: "鸡胸肉、玉米粒、番茄、洋葱加高汤和香料煮 25 分钟，挤青柠", sumEn: "Chicken breast, corn, tomato and onion simmered 25 minutes in stock with spice, finished with lime.", c: "mexican", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 95), st("frozen_corn", 40), ve("crushed_tomatoes", 80), ve("onion", 30), ve("green_pepper", 30), se("low_sodium_stock", 150), se("taco_seasoning", 2), se("lime", 8), tp("coriander", 3)],
    ways: [
      way("墨西哥鸡肉玉米汤配玉米饼和牛油果", "Soup with tortilla strips and avocado", "corn_tortilla", [fr("avocado", 30), ve("romaine", 50)]),
      way("墨西哥鸡肉玉米汤泡饭配紫甘蓝", "Soup over rice with red cabbage", RICE, [ve("cherry_tomato", 50), ve("cabbage", 50)]),
    ],
  }),
  dish({
    id: "shrimp_fajita_skillet", zh: "墨西哥彩椒炒虾仁（fajita）", en: "Shrimp fajita skillet", sum: "虾仁与彩椒、青椒、洋葱用烤肉香料大火快炒，挤青柠", sumEn: "Shrimp stir-fried hot with peppers and onion in fajita spice, finished with lime.", c: "mexican", m: "stir_fry", t: [12, 18],
    staples: ["corn_tortilla", "whole_wheat_tortilla", BROWN],
    i: [pr("white_shrimp", 115), ve("red_bell_pepper", 70), ve("green_pepper", 50), ve("onion", 40), se("fajita_seasoning", 2.5), se("lime", 8), oi("canola_oil", 4)],
  }),
  dish({
    id: "fish_tacos_cabbage", zh: "墨西哥鱼肉玉米饼卷", en: "Fish tacos with cabbage", sum: "罗非鱼片抹香料煎熟撕块，配卷心菜丝和番茄卷进玉米饼", sumEn: "Tilapia rubbed with spice and pan-fried, flaked and rolled in a tortilla with cabbage and tomato.", c: "mexican", m: "pan_fry", t: [12, 15],
    staples: ["corn_tortilla", BROWN],
    i: [pr("frozen_tilapia_fillet", 135), ve("cabbage", 80), ve("red_cabbage", 30), ve("tomato", 40), se("lime", 10), tp("coriander", 3), se("taco_seasoning", 1.5), oi("canola_oil", 3)],
  }),
  dish({
    id: "chicken_burrito_bowl", zh: "鸡肉黑豆饭碗", en: "Chicken and black bean burrito bowl", sum: "即食鸡胸肉、黑豆、番茄、生菜和牛油果摆在饭上，挤青柠汁", sumEn: "Ready-cooked chicken, black beans, tomato, lettuce and avocado over rice, finished with lime.", c: "mexican", m: "assemble", eq: [], t: [8, 8],
    staples: [BROWN, RICE, "whole_wheat_tortilla"],
    i: [pr("ready_chicken_breast", 100), st("canned_black_beans", 50), ve("tomato", 60), ve("romaine", 60), ve("red_onion", 15), fr("avocado", 30), se("lime", 8), tp("coriander", 3)],
  }),
];

const JAPANESE: Dish[] = [
  dish({
    id: "baked_teriyaki_chicken", zh: "烤照烧鸡胸", en: "Baked teriyaki chicken", sum: "鸡胸肉和洋葱刷照烧酱，烤箱烤 25 分钟，撒芝麻", sumEn: "Chicken breast and onion brushed with teriyaki sauce, baked 25 minutes, sprinkled with sesame.", c: "japanese", m: "bake", eq: ["oven"], t: [10, 35],
    i: [pr("chicken_breast", 108), ve("onion", 40), se("teriyaki_sauce", 12), tp("sesame_seeds", 2)],
    ways: [
      way("照烧鸡胸盖米饭配西兰花", "Teriyaki chicken over rice with broccoli", RICE, [ve("frozen_broccoli", 90)]),
      way("照烧鸡胸拌荞麦面配黄瓜", "Teriyaki chicken with soba and cucumber", SOBA, [ve("cucumber", 80)]),
      way("照烧鸡胸盖糙米饭配菠菜", "Teriyaki chicken over brown rice with spinach", BROWN, [ve("frozen_spinach", 70)]),
    ],
  }),
  dish({
    id: "nikujaga", zh: "日式酱油土豆炖牛肉（肉じゃが）", en: "Nikujaga beef and potato simmer", sum: "牛肉片、土豆、洋葱、胡萝卜用酱油、味醂和高汤煮 25 分钟", sumEn: "Beef slices, potato, onion and carrot simmered 25 minutes in soy sauce, mirin and stock.", c: "japanese", m: "simmer", t: [15, 40],
    i: [pr("lean_beef", 110), st("potato", 100), ve("onion", 50), ve("carrot", 40), se("reduced_salt_soy_sauce", 4), se("mirin", 5), se("low_sodium_stock", 100)],
    ways: [
      way("日式土豆炖牛肉盖米饭配菠菜", "Simmer over rice with spinach", RICE, [ve("frozen_spinach", 70)]),
      way("日式土豆炖牛肉配焯上海青", "Simmer with blanched bok choy", null, [ve("bok_choy", 100)]),
      way("日式土豆炖牛肉盖糙米饭配黄瓜", "Simmer over brown rice with cucumber", BROWN, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "gyudon_beef", zh: "日式牛肉洋葱盖饭料（牛丼）", en: "Gyudon beef and onion simmer", sum: "牛肉片和洋葱用酱油、味醂和高汤小火煮 15 分钟", sumEn: "Beef slices and onion simmered 15 minutes in soy sauce, mirin and stock.", c: "japanese", m: "simmer", t: [10, 25],
    i: [pr("beef_hotpot_slices", 110), ve("onion", 80), se("reduced_salt_soy_sauce", 4), se("mirin", 6), se("low_sodium_stock", 100), se("ginger_paste", 2)],
    ways: [
      way("牛丼盖米饭配菠菜", "Gyudon over rice with spinach", RICE, [ve("frozen_spinach", 70)]),
      way("牛丼盖糙米饭配黄瓜", "Gyudon over brown rice with cucumber", BROWN, [ve("cucumber", 80)]),
      way("牛丼拌荞麦面配上海青", "Gyudon over soba with bok choy", SOBA, [ve("bok_choy", 100), tp("sesame_seeds", 3)]),
    ],
  }),
  dish({
    id: "miso_pork_cabbage_stew", zh: "味噌猪肉卷心菜煲", en: "Miso pork and cabbage stew", sum: "猪腿肉片与卷心菜、洋葱用味噌、味醂和高汤焖 20 分钟", sumEn: "Pork slices with cabbage and onion, braised 20 minutes in miso, mirin and stock.", c: "japanese", m: "braise", t: [12, 35],
    i: [pr("lean_pork_leg", 120), ve("cabbage", 120), ve("onion", 30), se("miso", 8), se("mirin", 3), se("ginger_paste", 2), se("low_sodium_stock", 80)],
    ways: [
      way("味噌猪肉煲配米饭和黄瓜", "Stew over rice with cucumber", RICE, [ve("cucumber", 80)]),
      way("味噌猪肉煲配糙米饭和西兰花", "Stew over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("味噌猪肉煲配荞麦面和上海青", "Stew with soba and bok choy", SOBA, [ve("bok_choy", 100)]),
    ],
  }),
  dish({
    id: "japanese_chicken_curry", zh: "日式咖喱鸡", en: "Japanese chicken curry", sum: "鸡胸肉块、土豆、胡萝卜、洋葱加高汤煮软，溶入咖喱块", sumEn: "Chicken cubes, potato, carrot and onion simmered in stock until soft, then thickened with curry roux.", c: "japanese", m: "stew", t: [15, 40],
    i: [pr("chicken_breast", 100), st("potato", 60), ve("carrot", 50), ve("onion", 50), se("curry_roux", 8), se("low_sodium_stock", 150)],
    ways: [
      way("日式咖喱鸡盖米饭配黄瓜", "Curry over rice with cucumber", RICE, [ve("cucumber", 70)]),
      way("日式咖喱鸡盖糙米饭配西兰花", "Curry over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("日式咖喱鸡拌荞麦面配菠菜", "Curry over soba with spinach", SOBA, [ve("frozen_spinach", 70)]),
    ],
  }),
  dish({
    id: "soy_mirin_chicken_dice", zh: "日式酱油味醂煮鸡腿丁", en: "Soy and mirin simmered chicken thigh", sum: "鸡腿肉丁加洋葱、酱油、味醂和姜，煮到收汁", sumEn: "Diced chicken thigh with onion, soy sauce, mirin and ginger, cooked down until the liquid is gone.", c: "japanese", m: "simmer", t: [12, 20],
    i: [pr("chicken_thigh", 140), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("mirin", 5), se("ginger_paste", 3)],
    ways: [
      way("酱油鸡腿丁盖饭配上海青", "Chicken rice bowl with bok choy", RICE, [ve("bok_choy", 100)]),
      way("酱油鸡腿丁盖糙米饭配菠菜黄瓜", "Chicken over brown rice with spinach and cucumber", BROWN, [ve("frozen_spinach", 70), ve("cucumber", 40)]),
      way("酱油鸡腿丁拌荞麦面配黄瓜", "Chicken over soba with cucumber and sesame", SOBA, [ve("cucumber", 100), tp("sesame_seeds", 3)]),
    ],
  }),
  dish({
    id: "miso_salmon_bok_choy", zh: "味噌煎三文鱼配上海青", en: "Miso salmon with bok choy", sum: "三文鱼抹味噌和味醂腌 10 分钟后煎熟，上海青同锅炒软", sumEn: "Salmon marinated 10 minutes in miso and mirin, pan-fried, with bok choy wilted in the same pan.", c: "japanese", m: "pan_fry", t: [12, 18],
    staples: [RICE, BROWN, SOBA],
    i: [pr("salmon", 120), se("miso", 8), se("mirin", 3), ve("bok_choy", 120), oi("canola_oil", 2)],
  }),
  dish({
    id: "cold_soba_chicken", zh: "凉荞麦面鸡丝", en: "Cold soba with chicken and cucumber", sum: "荞麦面煮熟过凉水，拌鸡丝、黄瓜丝、海苔，淋酱油醋汁", sumEn: "Soba boiled and rinsed cold, tossed with shredded chicken, cucumber and nori in a soy-vinegar dressing.", c: "japanese", m: "assemble", eq: [], t: [10, 10],
    staples: [SOBA],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 120), ve("nori", 1), tp("sesame_seeds", 3), se("reduced_salt_soy_sauce", 4), se("rice_vinegar", 4), oi("sesame_oil", 2)],
  }),
];

const SOUTHEAST_ASIAN: Dish[] = [
  dish({
    id: "thai_red_curry_chicken", zh: "泰式红咖喱鸡", en: "Thai red curry chicken", sum: "红咖喱酱炒香，加椰奶、鸡胸肉块、西葫芦和彩椒煮 15 分钟，撒罗勒", sumEn: "Red curry paste fried until fragrant, then chicken, zucchini and pepper simmered in coconut milk 15 minutes, finished with basil.", c: "southeast_asian", m: "stew", t: [12, 30],
    i: [pr("chicken_breast", 105), ve("zucchini", 60), ve("red_bell_pepper", 40), ve("green_beans", 40), se("light_coconut_milk", 50), se("red_curry_paste", 6), se("fish_sauce", 1), tp("basil", 3)],
    ways: [
      way("泰式红咖喱鸡配米饭和上海青", "Curry over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("泰式红咖喱鸡配糙米饭和西兰花", "Curry over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("泰式红咖喱鸡拌米粉配豆芽", "Curry over rice vermicelli with bean sprouts", VERMICELLI, [ve("mung_bean_sprouts", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "chicken_adobo", zh: "菲律宾酱油醋焖鸡（adobo）", en: "Chicken adobo", sum: "鸡腿肉与洋葱、酱油、米醋和蒜蓉酱一起焖 25 分钟", sumEn: "Chicken thighs with onion, soy sauce, rice vinegar and garlic, braised 25 minutes.", c: "southeast_asian", m: "braise", t: [10, 40],
    i: [pr("chicken_thigh", 120), ve("onion", 40), se("reduced_salt_soy_sauce", 6), se("rice_vinegar", 10), se("garlic_paste", 3), se("ground_black_pepper", 0.5)],
    ways: [
      way("酱油醋焖鸡配米饭和上海青", "Adobo over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("酱油醋焖鸡配糙米饭和番茄黄瓜", "Adobo over brown rice with tomato and cucumber", BROWN, [ve("tomato", 60), ve("cucumber", 60)]),
      way("酱油醋焖鸡拌米粉配菜心", "Adobo over rice vermicelli with choy sum", VERMICELLI, [ve("choy_sum", 100)]),
    ],
  }),
  dish({
    id: "thai_beef_pumpkin_curry", zh: "泰式牛肉南瓜咖喱", en: "Thai beef and pumpkin curry", sum: "牛腱块和南瓜、洋葱加椰奶和红咖喱酱，压力锅煮 40 分钟", sumEn: "Beef shank cubes with pumpkin and onion in coconut milk and red curry paste, pressure-cooked 40 minutes.", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 60],
    i: [pr("beef_shank_raw", 105), ve("pumpkin", 150), ve("onion", 30), se("light_coconut_milk", 50), se("red_curry_paste", 5), se("fish_sauce", 1)],
    ways: [
      way("泰式牛肉南瓜咖喱配米饭和芥蓝", "Curry over rice with gai lan", RICE, [ve("gai_lan", 100)]),
      way("泰式牛肉南瓜咖喱配糙米饭和四季豆", "Curry over brown rice with green beans", BROWN, [ve("frozen_green_beans", 90)]),
      way("泰式牛肉南瓜咖喱拌米粉配豆芽", "Curry over rice vermicelli with bean sprouts", VERMICELLI, [ve("mung_bean_sprouts", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "bo_kho_beef", zh: "越南香料番茄炖牛腱（bò kho）", en: "Vietnamese spiced beef and tomato stew (bo kho)", sum: "牛腱块、胡萝卜、番茄碎加五香粉和鱼露，压力锅炖 40 分钟", sumEn: "Beef shank cubes, carrot and crushed tomato with five-spice and fish sauce, pressure-cooked 40 minutes.", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), ve("carrot", 70), ve("crushed_tomatoes", 80), ve("onion", 40), se("five_spice_powder", 0.8), se("fish_sauce", 1.5), se("garlic_paste", 2), se("ginger_paste", 2), se("low_sodium_stock", 80)],
    ways: [
      way("越南炖牛腱拌米粉配豆芽", "Bo kho over rice vermicelli with bean sprouts", VERMICELLI, [ve("mung_bean_sprouts", 60), tp("coriander", 3)]),
      way("越南炖牛腱配米饭和上海青", "Bo kho over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("越南炖牛腱配糙米饭和黄瓜", "Bo kho over brown rice with cucumber", BROWN, [ve("cucumber", 80), tp("lime", 8)]),
    ],
  }),
  dish({
    id: "tom_kha_chicken_soup", zh: "泰式椰奶鸡肉汤", en: "Tom kha chicken soup", sum: "鸡胸肉、蘑菇、番茄加高汤、椰奶和红咖喱酱煮 15 分钟，挤青柠", sumEn: "Chicken breast, mushroom and tomato simmered 15 minutes in stock, coconut milk and red curry paste, finished with lime.", c: "southeast_asian", m: "simmer", t: [12, 30],
    i: [pr("chicken_breast", 100), ve("button_mushroom", 80), ve("tomato", 60), se("light_coconut_milk", 60), se("low_sodium_stock", 100), se("red_curry_paste", 4), se("fish_sauce", 1.5), se("lime", 10), tp("coriander", 3)],
    ways: [
      way("泰式椰奶鸡肉汤配米粉和豆芽", "Soup with rice vermicelli and bean sprouts", VERMICELLI, [ve("mung_bean_sprouts", 60), ve("bok_choy", 60)]),
      way("泰式椰奶鸡肉汤泡饭配菜心", "Soup over rice with choy sum", RICE, [ve("choy_sum", 100)]),
      way("泰式椰奶鸡肉汤泡糙米饭配西兰花", "Soup over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "thai_basil_chicken", zh: "泰式罗勒炒鸡腿丁", en: "Thai basil diced chicken", sum: "鸡腿肉丁与四季豆、彩椒大火快炒，加蚝油、鱼露，最后拌入罗勒", sumEn: "Diced chicken thigh stir-fried hot with green beans and pepper, seasoned with oyster sauce and fish sauce, basil folded in at the end.", c: "southeast_asian", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("chicken_thigh", 140), ve("green_beans", 100), ve("red_bell_pepper", 50), tp("basil", 8), se("oyster_sauce", 4), se("fish_sauce", 1.5), oi("canola_oil", 3)],
  }),
  dish({
    id: "shrimp_rice_noodle_stirfry", zh: "虾仁炒米粉", en: "Shrimp and bean sprout rice noodle stir-fry", sum: "虾仁和豆芽、韭菜、胡萝卜快炒，拌入泡软的米粉和甜辣酱，撒花生", sumEn: "Shrimp, bean sprouts, chives and carrot stir-fried quickly, tossed with soaked rice noodles and sweet chili sauce, topped with peanuts.", c: "southeast_asian", m: "stir_fry", t: [14, 18],
    staples: [VERMICELLI],
    i: [pr("white_shrimp", 115), ve("mung_bean_sprouts", 80), ve("chinese_chives", 40), ve("carrot", 30), se("sweet_chili_sauce", 8), se("fish_sauce", 1.5), se("lime", 10), tp("peanuts", 5), oi("canola_oil", 4)],
  }),
  dish({
    id: "chicken_larb_lettuce", zh: "泰式香草鸡丁拌菜（larb）", en: "Diced chicken larb with lettuce", sum: "鸡胸肉切小丁炒熟，拌薄荷、香菜、青柠汁和鱼露，用生菜包着吃", sumEn: "Small diced chicken breast cooked through, tossed with mint, coriander, lime and fish sauce, eaten wrapped in lettuce.", c: "southeast_asian", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("chicken_breast", 120), ve("romaine", 100), ve("cucumber", 60), tp("mint", 3), tp("coriander", 3), se("lime", 15), se("fish_sauce", 2.5), se("sriracha", 3)],
  }),
];

const MAINS: Dish[] = [...AMERICAN, ...MEDITERRANEAN, ...ITALIAN, ...CHINESE, ...MEXICAN, ...JAPANESE, ...SOUTHEAST_ASIAN];

export const SEED_DISHES: readonly Dish[] = [...MAINS, ...SIDES, ...STAPLES, ...BREAKFASTS];
