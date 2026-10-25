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
const MICROWAVE_POTATO = "microwave_potato";
const BABY_POTATOES = "steamed_baby_potatoes";
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
  batchStaple({ id: MICROWAVE_POTATO, zh: "微波土豆", en: "Microwaved potato", sum: "土豆洗净扎孔，微波 8 分钟至软，或压力锅蒸 15 分钟", sumEn: "Potato washed and pricked, microwaved about 8 minutes until soft, or steamed 15 minutes in the pressure cooker.", c: "american", m: "steam", eq: ["microwave", "pressure_cooker"], t: [3, 12], i: [st("potato", 270)] }),
  batchStaple({
    id: BABY_POTATOES, zh: "蒸小土豆", en: "Steamed baby potatoes", sum: "小土豆上锅蒸 20 分钟，拌橄榄油、烟熏红椒粉和盐", sumEn: "Baby potatoes steamed 20 minutes, tossed with olive oil, smoked paprika and salt.", c: "american", m: "steam", eq: ["steamer"], t: [5, 25],
    i: [st("baby_potato", 340), oi("olive_oil", 3), se("smoked_paprika", 1), se("salt", 0.3)],
  }),
  batchStaple({ id: CORN, zh: "蒸糯玉米", en: "Steamed waxy corn", sum: "糯玉米带叶上锅蒸 20 分钟", sumEn: "Waxy corn cobs steamed for 20 minutes.", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 25], i: [st("waxy_corn_cob", 121)] }),
];

const SIDES: Dish[] = [
  dish({ id: "steamed_broccoli_lemon", zh: "柠檬清蒸西兰花", en: "Steamed broccoli with lemon", sum: "冷冻西兰花上锅蒸 5 分钟，淋柠檬汁和橄榄油", sumEn: "Frozen broccoli steamed 5 minutes, dressed with lemon and olive oil.", role: "side", c: "mediterranean", m: "steam", eq: ["steamer"], t: [3, 8], i: [ve("frozen_broccoli", 150), se("lemon", 6), oi("olive_oil", 3), se("salt", 0.3)] }),
  dish({ id: "garlic_bok_choy", zh: "蒜蓉炒上海青", en: "Stir-fried bok choy with garlic paste", sum: "上海青大火快炒，加蒜蓉酱和盐调味", sumEn: "Bok choy stir-fried hot with garlic paste and salt.", role: "side", c: "chinese", m: "stir_fry", t: [5, 7], i: [ve("bok_choy", 160), se("garlic_paste", 2), oi("canola_oil", 3), se("salt", 0.3)] }),
  dish({ id: "oyster_broccoli", zh: "蚝油西兰花", en: "Blanched broccoli with oyster sauce", sum: "冷冻西兰花焯水沥干，淋蚝油和香油", sumEn: "Frozen broccoli blanched and drained, dressed with oyster sauce and sesame oil.", role: "side", c: "chinese", m: "greens", t: [5, 8], i: [ve("frozen_broccoli", 150), se("oyster_sauce", 2), oi("sesame_oil", 1.5)] }),
  dish({ id: "goma_ae_spinach", zh: "芝麻酱拌菠菜", en: "Spinach with sesame dressing", sum: "冷冻菠菜解冻挤干，拌芝麻酱和酱油", sumEn: "Frozen spinach thawed and squeezed dry, mixed with sesame paste and soy sauce.", role: "side", c: "japanese", m: "greens", t: [5, 8], i: [ve("frozen_spinach", 150), oi("sesame_paste", 6), se("light_soy_sauce", 1.5)] }),
  dish({ id: "greek_cucumber_tomato_salad", zh: "希腊风黄瓜番茄沙拉", en: "Greek-style cucumber and tomato salad", sum: "黄瓜、番茄、红洋葱切块，撒牛至，淋橄榄油和柠檬汁", sumEn: "Cucumber, tomato and red onion cut up, sprinkled with oregano and dressed with oil and lemon.", role: "side", c: "mediterranean", m: "salad", eq: [], t: [6, 6], i: [ve("cucumber", 75), ve("tomato", 65), ve("red_onion", 10), oi("olive_oil", 3), se("dried_oregano", 0.5), se("lemon", 5)] }),
  dish({ id: "steamed_pumpkin_soy", zh: "酱油蒸南瓜块", en: "Steamed pumpkin with soy sauce", sum: "南瓜切块上锅蒸 10 分钟，拌酱油和香油", sumEn: "Pumpkin cubes steamed 10 minutes, tossed with soy sauce and sesame oil.", role: "side", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 13], i: [ve("pumpkin", 160), se("reduced_salt_soy_sauce", 2), oi("sesame_oil", 1.5)] }),
  dish({ id: "fresh_salsa_salad", zh: "青柠番茄碎（salsa）", en: "Fresh tomato salsa with lime", sum: "番茄、洋葱、黄瓜切小丁，拌青柠汁和盐", sumEn: "Tomato, onion and cucumber diced and mixed with lime juice and salt.", role: "side", c: "mexican", m: "salad", eq: [], t: [6, 6], i: [ve("tomato", 110), ve("red_onion", 20), ve("cucumber", 30), se("lime", 8), se("salt", 0.3)] }),
  dish({ id: "sauteed_zucchini_lemon", zh: "柠檬炒西葫芦", en: "Sauteed zucchini with lemon", sum: "西葫芦切片用橄榄油炒软，加柠檬汁和意式香草", sumEn: "Zucchini slices sauteed soft in olive oil, finished with lemon and Italian herbs.", role: "side", c: "italian", m: "stir_fry", t: [6, 8], i: [ve("zucchini", 150), oi("olive_oil", 4), se("italian_seasoning", 1), se("lemon", 4), se("salt", 0.3)] }),
  dish({ id: "lemon_green_beans_almond", zh: "杏仁柠檬四季豆", en: "Microwaved green beans with almonds", sum: "冷冻四季豆微波加热 3 分钟，拌柠檬汁和盐，撒杏仁", sumEn: "Frozen green beans microwaved 3 minutes, tossed with lemon and salt, topped with almonds.", role: "side", c: "american", m: "microwave", eq: ["microwave"], t: [4, 7], i: [ve("frozen_green_beans", 150), tp("almonds", 6), se("lemon", 5), se("salt", 0.3)] }),

  // Quick sides (hands-on 5 minutes or less, default kitchen, low sodium): the
  // planner adds one to any meal that is short of deep-coloured vegetables
  // (docs/671 多样性).
  dish({ id: "microwave_spinach_sesame", zh: "微波菠菜拌芝麻", en: "Microwaved spinach with sesame", sum: "冷冻菠菜微波加热 4 分钟，挤干水，拌酱油、香油和芝麻", sumEn: "Frozen spinach microwaved 4 minutes and squeezed dry, mixed with soy sauce, sesame oil and sesame seeds.", role: "side", c: "japanese", m: "microwave", eq: ["microwave"], t: [4, 8], i: [ve("frozen_spinach", 150), oi("sesame_seeds", 4), oi("sesame_oil", 1), se("reduced_salt_soy_sauce", 2)] }),
  dish({ id: "quick_garlic_spinach", zh: "蒜蓉快炒菠菜", en: "Quick stir-fried spinach with garlic paste", sum: "菠菜大火快炒 2 分钟，加蒜蓉酱和盐调味", sumEn: "Spinach stir-fried hot for 2 minutes with garlic paste and salt.", role: "side", c: "chinese", m: "stir_fry", t: [4, 6], i: [ve("spinach", 160), se("garlic_paste", 2), oi("canola_oil", 3), se("salt", 0.3)] }),
  dish({ id: "steamed_carrot_coins", zh: "清蒸胡萝卜片", en: "Steamed carrot coins", sum: "胡萝卜切厚片上锅蒸 10 分钟，拌橄榄油、少许盐和黑胡椒", sumEn: "Carrot cut into thick coins and steamed 10 minutes, tossed with olive oil, a pinch of salt and black pepper.", role: "side", c: "american", m: "steam", eq: ["steamer"], t: [3, 13], i: [ve("carrot", 150), oi("olive_oil", 3), se("salt", 0.1), se("ground_black_pepper", 0.3)] }),
  dish({ id: "soy_green_beans_microwave", zh: "酱油四季豆", en: "Microwaved green beans with soy sauce", sum: "冷冻四季豆微波加热 4 分钟，拌酱油和香油", sumEn: "Frozen green beans microwaved 4 minutes, tossed with soy sauce and sesame oil.", role: "side", c: "chinese", m: "microwave", eq: ["microwave"], t: [3, 7], i: [ve("frozen_green_beans", 150), se("reduced_salt_soy_sauce", 3), oi("sesame_oil", 1.5)] }),
  dish({ id: "tomato_cucumber_salad", zh: "番茄黄瓜沙拉", en: "Tomato and cucumber salad", sum: "番茄和黄瓜切块，拌橄榄油、米醋和盐，不用开火", sumEn: "Tomato and cucumber cut up and tossed with olive oil, rice vinegar and salt; no cooking.", role: "side", c: "mediterranean", m: "salad", eq: [], t: [4, 4], i: [ve("tomato", 100), ve("cucumber", 50), oi("olive_oil", 3), se("rice_vinegar", 6), se("salt", 0.3)] }),
  dish({ id: "purple_cabbage_vinegar", zh: "醋拌紫甘蓝丝", en: "Shredded purple cabbage with vinegar", sum: "紫甘蓝和胡萝卜切丝，拌米醋、橄榄油和盐，不用开火", sumEn: "Purple cabbage and carrot shredded and tossed with rice vinegar, olive oil and salt; no cooking.", role: "side", c: "american", m: "salad", eq: [], t: [5, 5], i: [ve("red_cabbage", 130), ve("carrot", 25), oi("olive_oil", 3), se("rice_vinegar", 8), se("salt", 0.3)] }),
  dish({ id: "romaine_cherry_tomato_salad", zh: "生菜小番茄沙拉", en: "Romaine and cherry tomato salad", sum: "罗马生菜撕块，加对半切的小番茄，拌橄榄油和柠檬汁，不用开火", sumEn: "Romaine torn up with halved cherry tomatoes, tossed with olive oil and lemon juice; no cooking.", role: "side", c: "mediterranean", m: "salad", eq: [], t: [4, 4], i: [ve("romaine", 100), ve("cherry_tomato", 60), oi("olive_oil", 3), se("lemon", 6), se("salt", 0.3)] }),
];

const BREAKFASTS: Dish[] = [
  dish({
    id: "milk_toast_boiled_egg", zh: "牛奶全麦吐司水煮蛋", en: "Milk, whole-wheat toast and a boiled egg",
    sum: "鸡蛋煮 8 分钟，两片吐司在平底锅煎热，牛奶倒杯即可", sumEn: "Boil the egg 8 minutes, pan-toast two slices of bread, pour the milk.",
    role: "breakfast", c: "american", m: "simmer", eq: ["stove"], t: [4, 12],
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
    sum: "鸡蛋煮 8 分钟，吐司在平底锅煎热，酸奶拌蓝莓", sumEn: "Boil the egg 8 minutes, pan-toast the bread, stir blueberries into the yogurt.",
    role: "breakfast", c: "american", m: "simmer", eq: ["stove"], t: [4, 12],
    i: [pr("plain_yogurt", 150), pr("egg", 50), st("wholegrain_toast", 35), fr("frozen_blueberries", 60)],
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
    i: [pr("greek_yogurt", 200), st("oats", 30), fr("frozen_blueberries", 60), tp("walnuts", 8)],
  }),
  dish({
    id: "pita_egg_yogurt_tomato", zh: "口袋饼水煮蛋酸奶小番茄", en: "Pita with a boiled egg, Greek yogurt and cherry tomatoes",
    sum: "鸡蛋煮 8 分钟，口袋饼切开，配希腊酸奶和小番茄", sumEn: "Boil the egg 8 minutes; serve with sliced pita, Greek yogurt and cherry tomatoes.",
    role: "breakfast", c: "mediterranean", m: "simmer", t: [4, 12],
    i: [pr("egg", 50), pr("greek_yogurt", 100), st("whole_wheat_pita", 40), ve("cherry_tomato", 60), oi("olive_oil", 3)],
  }),
  dish({
    id: "miso_egg_soup_rice_ball_egg", zh: "味噌蛋花汤饭团水煮蛋", en: "Miso egg-drop soup, rice ball and a boiled egg",
    sum: "热水化开味噌煮开，淋入蛋液成蛋花，米饭捏成饭团裹海苔，再配水煮蛋", sumEn: "Dissolve miso in hot water, drop in beaten egg for egg-drop soup; shape rice into a ball wrapped in nori; serve with a boiled egg.",
    role: "breakfast", c: "japanese", m: "simmer", t: [5, 12],
    i: [pr("egg", 50), pr("egg", 50), se("miso", 6), st("rice_cooked", 100), ve("nori", 1)],
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
  // Soy milk maker breakfasts: the dry beans and the water go in the night
  // before with the timer set, so the milk is ready when the user wakes. The
  // line grams are the dry beans, oats and nuts that go into the maker, the
  // water is not a line (it has no nutrition), and the whole-bean milk is
  // drunk unstrained, so the nutrition is the dry ingredients' own. These
  // count as legumes in the plan (docs/671 多样性).
  dish({
    id: "soy_milk_maker_plain", zh: "自磨黄豆浆茶叶蛋馒头", en: "Home-made soy milk, tea egg and steamed bun",
    sum: "前一晚黄豆加水入豆浆机，设好定时；早上馒头微波热 1 分钟，配茶叶蛋", sumEn: "Load the soybeans and water into the soy milk maker the night before and set the timer; in the morning microwave the bun 1 minute and serve with a tea egg.",
    role: "breakfast", c: "chinese", m: "assemble", eq: ["soy_milk_maker", "microwave"], t: [4, 35],
    i: [pr("soybean_dry", 25), pr("tea_egg", 50), st("steamed_bun", 100), fr("mandarin", 100)],
  }),
  dish({
    id: "soy_milk_maker_five_grain", zh: "五谷豆浆水煮蛋半个馒头", en: "Five-grain soy milk, two boiled eggs and half a steamed bun",
    sum: "前一晚黄豆燕麦小米红豆加水入豆浆机定时；早上煮 2 个蛋，配半个馒头", sumEn: "Load the soybeans, oats, millet and adzuki beans with water into the soy milk maker the night before and set the timer; in the morning boil two eggs 8 minutes and serve with half a bun.",
    role: "breakfast", c: "chinese", m: "simmer", eq: ["soy_milk_maker", "stove"], t: [5, 40],
    i: [pr("soybean_dry", 20), st("adzuki_beans_dry", 8), st("oats", 15), st("millet_raw", 10), pr("egg", 100), st("steamed_bun", 50), fr("apple", 100)],
  }),
  dish({
    id: "soy_milk_maker_black_bean_walnut", zh: "黑豆核桃豆浆水煮蛋吐司", en: "Black bean walnut soy milk, boiled egg and toast",
    sum: "前一晚黄豆、黑豆、核桃加水入豆浆机，设好定时；早上煮蛋，配吐司", sumEn: "Load the soybeans, black soybeans and walnuts with water into the soy milk maker the night before and set the timer; in the morning boil the egg 8 minutes and serve with toast.",
    role: "breakfast", c: "chinese", m: "simmer", eq: ["soy_milk_maker", "stove"], t: [5, 40],
    i: [pr("soybean_dry", 20), pr("black_soybean_dry", 10), tp("walnuts", 8), pr("egg", 50), st("whole_wheat_toast", 70)],
  }),
  dish({
    id: "soy_milk_maker_red_date", zh: "红枣豆浆茶叶蛋全麦吐司", en: "Red date soy milk, tea egg and whole-wheat toast",
    sum: "前一晚黄豆、红枣加水入豆浆机，设好定时；早上倒出，配茶叶蛋和全麦吐司", sumEn: "Load the soybeans, dried red dates and water into the soy milk maker the night before and set the timer; in the morning pour it out and serve with a tea egg and whole-wheat toast.",
    role: "breakfast", c: "chinese", m: "assemble", eq: ["soy_milk_maker"], t: [3, 35],
    i: [pr("soybean_dry", 25), fr("red_dates_dried", 10), pr("tea_egg", 50), st("whole_wheat_toast", 70)],
  }),
];

const AMERICAN: Dish[] = [
  dish({
    id: "chicken_bean_chili", zh: "鸡腿丁红芸豆炖菜（chili）", en: "Chicken and kidney bean chili", sum: "鸡腿肉丁、红芸豆、番茄、彩椒加辣椒粉和孜然炖 40 分钟", sumEn: "Diced chicken thigh, kidney beans, tomato and pepper simmered 40 minutes with chili powder and cumin.", c: "american", m: "stew", t: [15, 60],
    i: [pr("chicken_thigh", 125), st("canned_kidney_beans", 80), ve("crushed_tomatoes", 130), ve("onion", 40), ve("red_bell_pepper", 30), se("chili_powder_blend", 3), se("ground_cumin", 1)],
    ways: [
      way("鸡丁豆子炖菜盖糙米饭配菠菜", "Chicken chili over brown rice with spinach", BROWN, [ve("frozen_spinach", 140)]),
      way("鸡丁豆子炖菜卷玉米饼配生菜", "Chicken chili in corn tortillas with lettuce", "corn_tortilla", [ve("romaine", 90), ve("cherry_tomato", 80), tp("lime", 8)]),
      way("鸡丁豆子炖菜配土豆和西兰花", "Chicken chili on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "beef_black_bean_chili", zh: "牛肉黑豆炖菜（chili）", en: "Beef chunk and black bean chili", sum: "牛腱块加黑豆、番茄、彩椒和烟熏红椒粉，小火炖 90 分钟", sumEn: "Beef shank chunks simmered 90 minutes with black beans, tomato, pepper and smoked paprika.", c: "american", m: "stew", t: [15, 120],
    i: [pr("beef_shank_raw", 135), st("canned_black_beans", 80), ve("crushed_tomatoes", 130), ve("onion", 40), ve("red_bell_pepper", 40), se("smoked_paprika", 2), se("ground_cumin", 1), se("chili_powder_blend", 2)],
    ways: [
      way("牛肉黑豆炖菜配蒸红薯和四季豆", "Beef chili on sweet potato with green beans", SWEET_POTATO, [ve("frozen_green_beans", 130), tp("lime", 8)]),
      way("牛肉黑豆炖菜盖糙米饭配生菜", "Beef chili over brown rice with lettuce", BROWN, [ve("romaine", 110), ve("red_bell_pepper", 50)]),
      way("牛肉黑豆炖菜卷全麦饼配紫甘蓝", "Beef chili in a whole-wheat wrap with red cabbage", "whole_wheat_tortilla", [ve("red_cabbage", 110), ve("tomato", 50)]),
    ],
  }),
  dish({
    id: "pressure_cooker_pulled_pork", zh: "压力锅手撕猪肉", en: "Pressure-cooker pulled pork", sum: "猪腿肉加洋葱和烧烤酱，压力锅压 45 分钟后撕散", sumEn: "Pork leg with onion and barbecue sauce, pressure-cooked 45 minutes, then shredded.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 70],
    i: [pr("lean_pork_leg", 120), ve("onion", 50), se("bbq_sauce", 12), se("smoked_paprika", 1.5), se("rice_vinegar", 6), se("stock_paste", 1.25)],
    ways: [
      way("手撕猪肉夹口袋饼配胡萝卜生菜", "Pulled pork in pita with carrot and lettuce", "whole_wheat_pita", [ve("carrot", 70), ve("romaine", 100)]),
      way("手撕猪肉配土豆和西兰花", "Pulled pork on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 160)]),
      way("手撕猪肉盖糙米饭配四季豆", "Pulled pork over brown rice with green beans", BROWN, [ve("frozen_green_beans", 160)]),
    ],
  }),
  dish({
    id: "bbq_pulled_chicken", zh: "烧烤味手撕鸡", en: "BBQ pulled chicken", sum: "鸡胸肉加洋葱、烧烤酱和高汤，压力锅压 15 分钟后撕成丝", sumEn: "Chicken breast with onion, barbecue sauce and stock, pressure-cooked 15 minutes, then shredded.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 35],
    i: [pr("chicken_breast", 108), ve("onion", 50), se("bbq_sauce", 12), se("garlic_powder", 1), se("smoked_paprika", 1.5), se("stock_paste", 1.5)],
    ways: [
      way("烧烤手撕鸡夹口袋饼配生菜番茄", "BBQ chicken in pita with lettuce and tomato", "whole_wheat_pita", [ve("romaine", 90), ve("tomato", 80)]),
      way("烧烤手撕鸡配蒸红薯和四季豆", "BBQ chicken on sweet potato with green beans", SWEET_POTATO, [ve("frozen_green_beans", 160)]),
      way("烧烤手撕鸡盖杂粮饭配玉米", "BBQ chicken over multigrain rice with corn", GRAINS, [ve("frozen_corn", 60), ve("red_cabbage", 100)]),
    ],
  }),
  dish({
    id: "paprika_braised_chicken_thighs", zh: "红椒粉焖鸡腿肉", en: "Paprika braised chicken thighs", sum: "鸡腿肉、胡萝卜、洋葱抹红椒粉，平底锅加盖焖 30 分钟", sumEn: "Chicken thighs, carrot and onion rubbed with paprika and braised under a lid in one pan for 30 minutes.", c: "american", m: "braise", eq: ["stove"], t: [10, 40],
    i: [pr("chicken_thigh", 125), ve("carrot", 70), ve("onion", 50), se("smoked_paprika", 2), se("poultry_seasoning", 1.5), se("garlic_powder", 1), se("salt", 0.4), oi("olive_oil", 3), se("stock_paste", 1.25)],
    ways: [
      way("红椒焖鸡腿配小土豆和生菜", "Paprika chicken with baby potatoes and lettuce", BABY_POTATOES, [ve("romaine", 80), ve("cucumber", 50)]),
      way("红椒焖鸡腿夹口袋饼配番茄黄瓜", "Paprika chicken in pita with tomato and cucumber", "whole_wheat_pita", [ve("tomato", 80), ve("cucumber", 50)]),
      way("红椒焖鸡腿配藜麦和菠菜", "Paprika chicken over quinoa with spinach", QUINOA, [ve("frozen_spinach", 110)]),
    ],
  }),
  dish({
    id: "chicken_vegetable_soup", zh: "鸡肉蔬菜汤", en: "Chicken and vegetable soup", sum: "鸡胸肉、胡萝卜、芹菜、洋葱加高汤小火煮 30 分钟", sumEn: "Chicken breast, carrot, celery and onion simmered in stock for 30 minutes.", c: "american", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 108), ve("carrot", 60), ve("celery", 50), ve("onion", 40), se("stock_paste", 5), se("poultry_seasoning", 1)],
    ways: [
      way("鸡肉蔬菜汤配全麦吐司和生菜", "Chicken soup with whole-wheat toast and lettuce", "whole_wheat_toast", [ve("romaine", 110)]),
      way("鸡肉蔬菜汤加全麦意面配菠菜", "Chicken soup with whole-wheat pasta and spinach", WW_PASTA, [ve("frozen_spinach", 110)]),
      way("鸡肉蔬菜汤泡饭配四季豆", "Chicken soup over rice with green beans", RICE, [ve("frozen_green_beans", 100)]),
    ],
  }),
  dish({
    id: "beef_pot_roast", zh: "蔬菜炖牛腱", en: "Pot roast beef with vegetables", sum: "牛腱切块和胡萝卜、洋葱、番茄一起压力锅炖 45 分钟", sumEn: "Beef shank cubes with carrot, onion and tomato, pressure-cooked 45 minutes.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 75],
    i: [pr("beef_shank_raw", 105), ve("carrot", 70), ve("onion", 50), ve("crushed_tomatoes", 130), se("stock_paste", 1.5), se("garlic_powder", 1), se("ground_black_pepper", 0.5), se("salt", 0.4)],
    ways: [
      way("蔬菜炖牛腱配小土豆和四季豆", "Pot roast with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 130)]),
      way("蔬菜炖牛腱拌全麦意面配生菜", "Pot roast with whole-wheat pasta and lettuce", WW_PASTA, [ve("romaine", 80), ve("cherry_tomato", 70)]),
      way("蔬菜炖牛腱配蒸红薯和西兰花", "Pot roast on sweet potato with broccoli", SWEET_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "beef_mushroom_paprika_stew", zh: "红椒粉蘑菇炖牛肉", en: "Beef and mushroom paprika stew", sum: "牛腱块、蘑菇、洋葱加高汤和红椒粉，压力锅压 40 分钟", sumEn: "Beef shank cubes, mushroom and onion with stock and paprika, pressure-cooked 40 minutes.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 120), ve("button_mushroom", 100), ve("onion", 40), se("stock_paste", 2.5), se("smoked_paprika", 1.5), se("garlic_powder", 1), se("salt", 0.3)],
    ways: [
      way("蘑菇炖牛肉拌全麦意面配彩椒", "Paprika beef with whole-wheat pasta and red pepper", WW_PASTA, [ve("red_bell_pepper", 100)]),
      way("蘑菇炖牛肉盖糙米饭配四季豆", "Paprika beef over brown rice with green beans", BROWN, [ve("frozen_green_beans", 130)]),
      way("蘑菇炖牛肉配土豆和西兰花", "Paprika beef on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "pressure_cooker_pepper_steak", zh: "彩椒炖牛肉（pepper steak）", en: "Pressure-cooker pepper steak", sum: "牛腱块、彩椒、洋葱、番茄碎加酱油，压力锅压 40 分钟", sumEn: "Beef shank cubes with peppers, onion, crushed tomato and soy sauce, pressure-cooked 40 minutes.", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), ve("green_pepper", 60), ve("red_bell_pepper", 50), ve("onion", 50), ve("crushed_tomatoes", 130), se("reduced_salt_soy_sauce", 4), se("garlic_powder", 1), se("ground_black_pepper", 0.5)],
    ways: [
      way("彩椒炖牛肉盖糙米饭配西兰花", "Pepper steak over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("彩椒炖牛肉配土豆和四季豆", "Pepper steak on a microwaved potato with green beans", MICROWAVE_POTATO, [ve("frozen_green_beans", 130)]),
      way("彩椒炖牛肉卷全麦饼配生菜", "Pepper steak in a whole-wheat wrap with lettuce", "whole_wheat_tortilla", [ve("romaine", 90), ve("carrot", 60)]),
    ],
  }),
  dish({
    id: "steak_spinach_salad", zh: "牛排菠菜沙拉", en: "Seared steak and spinach salad", sum: "西冷牛排煎到喜欢的熟度，切片放在菠菜和小番茄上", sumEn: "Sirloin steak pan-seared to taste, sliced over spinach and cherry tomatoes.", c: "american", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, MICROWAVE_POTATO, "whole_wheat_toast"],
    i: [pr("sirloin_steak", 120), ve("spinach", 105), ve("cherry_tomato", 75), ve("red_onion", 20), oi("olive_oil", 4), se("rice_vinegar", 6), se("ground_black_pepper", 0.5), se("salt", 0.4)],
  }),
  dish({
    id: "tuna_cucumber_bowl", zh: "金枪鱼黄瓜沙拉碗", en: "Tuna and cucumber salad bowl", sum: "水浸金枪鱼拌橄榄油和柠檬汁，配黄瓜、生菜和小番茄，不用开火", sumEn: "Canned tuna mixed with olive oil and lemon juice, served on cucumber, lettuce and cherry tomato; no cooking.", c: "american", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast", MICROWAVE_POTATO],
    i: [pr("canned_tuna_water", 125), oi("olive_oil", 4), ve("cucumber", 50), ve("cherry_tomato", 70), ve("romaine", 90), se("lemon", 8), se("salt", 0.2)],
  }),
  dish({
    id: "chicken_cobb_salad", zh: "鸡肉鸡蛋沙拉（Cobb）", en: "Chicken Cobb-style salad", sum: "即食鸡胸肉和水煮蛋切块，铺在生菜和番茄上，淋油醋汁", sumEn: "Ready-cooked chicken and boiled egg over lettuce and tomato with a vinaigrette.", c: "american", m: "assemble", eq: [], t: [10, 10],
    staples: ["whole_wheat_pita", QUINOA],
    i: [pr("ready_chicken_breast", 85), pr("egg", 65), ve("romaine", 120), ve("tomato", 85), oi("olive_oil", 4), se("rice_vinegar", 6)],
  }),
  dish({
    id: "salmon_broccoli_skillet", zh: "香煎三文鱼配西兰花", en: "Pan-seared salmon with broccoli", sum: "三文鱼皮朝下煎熟，冷冻西兰花同锅煎软，挤上柠檬汁", sumEn: "Salmon seared skin-side down, frozen broccoli cooked in the same pan, finished with lemon.", c: "american", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, QUINOA, BROWN],
    i: [pr("salmon", 120), ve("frozen_broccoli", 185), oi("olive_oil", 3), se("lemon", 8), se("lemon_pepper_seasoning", 1), se("salt", 0.2)],
  }),
  dish({
    id: "cajun_shrimp_zucchini", zh: "卡津香料炒虾仁西葫芦", en: "Cajun shrimp with zucchini", sum: "虾仁用卡津香料拌匀，和西葫芦、彩椒大火快炒", sumEn: "Shrimp tossed in Cajun spice and stir-fried quickly with zucchini and pepper.", c: "american", m: "stir_fry", t: [12, 15],
    staples: [BROWN, GRAINS, PASTA],
    i: [pr("white_shrimp", 115), ve("zucchini", 80), ve("red_bell_pepper", 110), se("cajun_seasoning", 1.5), oi("olive_oil", 4)],
  }),
];

const MEDITERRANEAN: Dish[] = [
  dish({
    id: "lemon_herb_braised_chicken", zh: "柠檬香草焖鸡胸", en: "Lemon-herb braised chicken breast", sum: "鸡胸肉和西葫芦、红洋葱加柠檬汁、牛至和少许高汤，加盖焖 15 分钟", sumEn: "Chicken breast with zucchini and red onion, lemon, oregano and a little stock, braised under a lid 15 minutes.", c: "mediterranean", m: "braise", eq: ["stove"], t: [10, 30],
    i: [pr("chicken_breast", 108), ve("zucchini", 80), ve("red_onion", 40), se("lemon", 10), se("dried_oregano", 1), se("salt", 0.4), oi("olive_oil", 4), se("stock_paste", 1.25)],
    ways: [
      way("柠檬焖鸡胸配藜麦和菠菜番茄", "Lemon chicken over quinoa with spinach and tomato", QUINOA, [ve("frozen_spinach", 90), ve("tomato", 80)]),
      way("柠檬焖鸡胸夹口袋饼配生菜番茄", "Lemon chicken in pita with lettuce and tomato", "whole_wheat_pita", [ve("romaine", 80), ve("tomato", 80)]),
      way("柠檬焖鸡胸配小土豆和四季豆", "Lemon chicken with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 130)]),
    ],
  }),
  dish({
    id: "greek_lemon_chicken_soup", zh: "希腊柠檬鸡汤", en: "Greek-style lemon chicken soup", sum: "鸡胸肉、胡萝卜、芹菜加高汤煮软，起锅前挤柠檬汁加干莳萝", sumEn: "Chicken breast, carrot and celery simmered in stock, finished with lemon juice and dried dill.", c: "mediterranean", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 100), ve("carrot", 50), ve("celery", 40), se("stock_paste", 5), se("lemon", 20), se("dried_dill", 0.5)],
    ways: [
      way("柠檬鸡汤配口袋饼和黄瓜", "Lemon chicken soup with pita and cucumber", "whole_wheat_pita", [ve("cucumber", 60), ve("tomato", 80)]),
      way("柠檬鸡汤泡饭配南瓜", "Lemon chicken soup over rice with pumpkin", RICE, [ve("pumpkin", 120)]),
      way("柠檬鸡汤加全麦意面配小番茄", "Lemon chicken soup with whole-wheat pasta and cherry tomatoes", WW_PASTA, [ve("cherry_tomato", 70), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "chicken_chickpea_stew", zh: "鸡肉鹰嘴豆炖菜", en: "Chicken and chickpea stew", sum: "鸡胸肉块、鹰嘴豆、番茄、胡萝卜加孜然和辣椒酱炖 30 分钟", sumEn: "Chicken cubes, chickpeas, tomato and carrot simmered 30 minutes with cumin and harissa.", c: "mediterranean", m: "stew", t: [15, 45],
    i: [pr("chicken_breast", 115), st("canned_chickpeas", 80), ve("crushed_tomatoes", 130), ve("onion", 40), ve("carrot", 40), se("ground_cumin", 1), se("ground_cinnamon", 0.5), se("harissa", 5)],
    ways: [
      way("鹰嘴豆炖鸡配藜麦和黄瓜菠菜", "Chickpea stew over quinoa with cucumber and spinach", QUINOA, [ve("cucumber", 60), ve("frozen_spinach", 80)]),
      way("鹰嘴豆炖鸡夹口袋饼配生菜番茄", "Chickpea stew in pita with lettuce and tomato", "whole_wheat_pita", [ve("romaine", 80), ve("tomato", 80)]),
      way("鹰嘴豆炖鸡盖糙米饭配西兰花", "Chickpea stew over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "tomato_beef_kofta", zh: "番茄汁炖牛肉丸（kofta）", en: "Beef kofta simmered in tomato sauce", sum: "牛后腿肉现绞，拌孜然、红椒粉和洋葱碎捏丸，放进番茄汁煮 20 分钟", sumEn: "Lean beef round ground fresh, mixed with cumin, paprika and onion, rolled into balls and simmered 20 minutes in tomato sauce.", c: "mediterranean", m: "stew", eq: ["stove"], t: [15, 40],
    i: [gr("lean_beef", 110), ve("red_onion", 30), se("ground_cumin", 1.5), se("smoked_paprika", 1.5), se("garlic_powder", 1), se("salt", 0.4), ve("crushed_tomatoes", 130)],
    ways: [
      way("牛肉丸夹口袋饼配黄瓜番茄", "Kofta in pita with cucumber and tomato", "whole_wheat_pita", [ve("cucumber", 70), ve("tomato", 80)]),
      way("牛肉丸配藜麦和小番茄彩椒", "Kofta over quinoa with cherry tomatoes and red pepper", QUINOA, [ve("cherry_tomato", 100), ve("red_bell_pepper", 60)]),
      way("牛肉丸盖米饭配紫甘蓝", "Kofta over rice with red cabbage", RICE, [ve("red_cabbage", 150), tp("lime", 8)]),
    ],
  }),
  dish({
    id: "lemon_dill_steamed_salmon", zh: "柠檬莳萝蒸三文鱼", en: "Lemon-dill steamed salmon", sum: "三文鱼和四季豆、红彩椒淋柠檬汁、撒干莳萝，上锅蒸 10 分钟", sumEn: "Salmon with green beans and red pepper, lemon and dried dill, steamed 10 minutes.", c: "mediterranean", m: "steam", eq: ["steamer"], t: [10, 20],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("salmon", 120), ve("green_beans", 110), ve("red_bell_pepper", 70), se("lemon", 10), se("dried_dill", 0.5), oi("olive_oil", 2), se("salt", 0.3)],
  }),
  dish({
    id: "tomato_braised_cod", zh: "番茄炖鳕鱼", en: "Tomato-braised cod", sum: "番茄、洋葱和西葫芦煮成酱，铺上鳕鱼加盖煮 10 分钟", sumEn: "Tomato, onion and zucchini cooked into a sauce, cod laid on top and cooked under a lid 10 minutes.", c: "mediterranean", m: "stew", eq: ["stove"], t: [10, 25],
    staples: [PASTA, BROWN, "whole_wheat_pita"],
    i: [pr("cod", 140), ve("tomato", 150), ve("onion", 40), ve("zucchini", 50), se("dried_oregano", 1), oi("olive_oil", 4), se("salt", 0.3)],
  }),
  dish({
    id: "lentil_tomato_stew", zh: "番茄扁豆炖菜", en: "Lentil and tomato stew", sum: "扁豆、番茄、胡萝卜、芹菜加高汤和孜然煮 30 分钟，挤柠檬汁", sumEn: "Lentils, tomato, carrot and celery simmered 30 minutes in stock with cumin, finished with lemon.", c: "mediterranean", m: "stew", t: [12, 45],
    i: [st("lentils_dry", 75), ve("crushed_tomatoes", 130), ve("carrot", 50), ve("onion", 40), ve("celery", 30), se("stock_paste", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("lemon", 8)],
    ways: [
      way("番茄扁豆炖菜夹口袋饼配黄瓜", "Lentil stew in pita with cucumber", "whole_wheat_pita", [ve("cucumber", 60), ve("tomato", 80)]),
      way("番茄扁豆炖菜盖糙米饭配菠菜", "Lentil stew over brown rice with spinach", BROWN, [ve("frozen_spinach", 110)]),
      way("番茄扁豆炖菜配土豆和小番茄", "Lentil stew on a microwaved potato with cherry tomatoes", MICROWAVE_POTATO, [ve("cherry_tomato", 70)]),
    ],
  }),
  dish({
    id: "harissa_braised_chicken", zh: "辣椒酱焖鸡腿（harissa）", en: "Harissa braised chicken thighs", sum: "鸡腿肉、彩椒、西葫芦和红洋葱拌北非辣椒酱，压力锅压 10 分钟", sumEn: "Chicken thighs, pepper, zucchini and red onion tossed in harissa, pressure-cooked 10 minutes.", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 30],
    i: [pr("chicken_thigh", 125), ve("red_bell_pepper", 60), ve("zucchini", 50), ve("red_onion", 40), se("harissa", 8), se("ground_cumin", 1), oi("olive_oil", 2), se("salt", 0.3), se("stock_paste", 1.5)],
    ways: [
      way("哈里萨焖鸡腿配藜麦和四季豆", "Harissa chicken over quinoa with green beans", QUINOA, [ve("frozen_green_beans", 100)]),
      way("哈里萨焖鸡腿夹口袋饼配生菜", "Harissa chicken in pita with lettuce", "whole_wheat_pita", [ve("romaine", 80), ve("tomato", 80)]),
      way("哈里萨焖鸡腿配小土豆和胡萝卜", "Harissa chicken with baby potatoes and carrot", BABY_POTATOES, [ve("carrot", 120)]),
    ],
  }),
  dish({
    id: "greek_beef_stifado", zh: "希腊洋葱番茄炖牛腱（stifado）", en: "Greek beef stifado", sum: "牛腱切块和大量洋葱、番茄、肉桂一起压力锅炖 45 分钟", sumEn: "Beef shank cubes with plenty of onion, tomato and cinnamon, pressure-cooked 45 minutes.", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 75],
    i: [pr("beef_shank_raw", 105), ve("onion", 70), ve("crushed_tomatoes", 130), se("ground_cinnamon", 0.5), se("dried_oregano", 1), se("stock_paste", 1.25), se("salt", 0.4)],
    ways: [
      way("洋葱炖牛腱拌意面配生菜", "Stifado with pasta and lettuce", PASTA, [ve("romaine", 110), ve("cherry_tomato", 50)]),
      way("洋葱炖牛腱配小土豆和四季豆", "Stifado with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 160)]),
      way("洋葱炖牛腱盖糙米饭配西兰花", "Stifado over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 160)]),
    ],
  }),
  dish({
    id: "lubia_beef_green_beans", zh: "番茄四季豆炖牛肉（lubia）", en: "Lebanese beef and green bean stew (lubia)", sum: "牛腱块、四季豆、番茄碎加肉桂和孜然，压力锅炖 35 分钟", sumEn: "Beef shank cubes, green beans and crushed tomato with cinnamon and cumin, pressure-cooked 35 minutes.", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 60],
    i: [pr("beef_shank_raw", 105), ve("green_beans", 120), ve("crushed_tomatoes", 130), ve("onion", 40), se("ground_cinnamon", 0.5), se("ground_cumin", 1), se("garlic_paste", 2), oi("olive_oil", 3), se("salt", 0.3)],
    ways: [
      way("四季豆炖牛肉盖米饭配黄瓜", "Lubia over rice with cucumber", RICE, [ve("cucumber", 70)]),
      way("四季豆炖牛肉配藜麦和小番茄", "Lubia over quinoa with cherry tomatoes", QUINOA, [ve("cherry_tomato", 70)]),
      way("四季豆炖牛肉夹口袋饼配生菜", "Lubia in pita with lettuce", "whole_wheat_pita", [ve("romaine", 80), ve("tomato", 80)]),
    ],
  }),
  dish({
    id: "shakshuka", zh: "鸡肉番茄红椒焖蛋（shakshuka）", en: "Shakshuka with chicken", sum: "番茄、彩椒、洋葱炒软煮成酱，拌入鸡肉丝，打入鸡蛋盖盖焖熟", sumEn: "Tomato, pepper and onion cooked into a sauce, shredded chicken stirred in, eggs set in it under a lid.", c: "mediterranean", m: "pan_fry", t: [12, 20],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("egg", 100), pr("ready_chicken_breast", 85), ve("tomato", 170), ve("red_bell_pepper", 70), ve("onion", 30), se("smoked_paprika", 1.5), oi("olive_oil", 2)],
  }),
  dish({
    id: "mediterranean_chicken_salad", zh: "地中海鸡肉沙拉", en: "Mediterranean chicken salad", sum: "即食鸡胸肉拌黄瓜、番茄和红洋葱，淋橄榄油、柠檬汁，撒牛至", sumEn: "Ready-cooked chicken tossed with cucumber, tomato and red onion, dressed with oil and lemon, sprinkled with oregano.", c: "mediterranean", m: "assemble", eq: [], t: [10, 10],
    staples: ["whole_wheat_pita", QUINOA, BABY_POTATOES],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 50), ve("tomato", 120), ve("red_onion", 20), oi("olive_oil", 4), se("dried_oregano", 1), se("lemon", 8)],
  }),
  dish({
    id: "tuna_edamame_salad", zh: "金枪鱼毛豆沙拉", en: "Tuna and edamame salad", sum: "水浸金枪鱼和解冻毛豆拌黄瓜、彩椒和生菜，淋橄榄油和柠檬汁", sumEn: "Canned tuna and thawed edamame tossed with cucumber, red pepper and lettuce, dressed with oil and lemon.", c: "mediterranean", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("canned_tuna_water", 110), pr("frozen_edamame", 70), ve("cucumber", 50), ve("red_bell_pepper", 100), ve("romaine", 70), ve("red_onion", 20), oi("olive_oil", 3), se("lemon", 10)],
  }),
  dish({
    id: "sardine_edamame_salad", zh: "沙丁鱼毛豆沙拉", en: "Sardine and edamame salad", sum: "油浸沙丁鱼和解冻毛豆铺在菠菜、胡萝卜丝上，淋橄榄油和柠檬汁，不用开火", sumEn: "Canned sardines and thawed edamame over spinach and grated carrot, dressed with olive oil and lemon; no cooking.", c: "mediterranean", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("canned_sardine", 90), pr("frozen_edamame", 80), ve("spinach", 160), ve("carrot", 70), ve("red_onion", 15), oi("olive_oil", 3), se("lemon", 10)],
  }),
  dish({
    id: "tomato_shrimp_skillet", zh: "番茄菠菜烩虾", en: "Tomato and spinach shrimp skillet", sum: "番茄煮成酱，下虾煮熟，拌入菠菜，撒牛至", sumEn: "Tomato cooked into a sauce, shrimp poached in it, spinach wilted in, sprinkled with oregano.", c: "mediterranean", m: "stir_fry", t: [12, 18],
    staples: [PASTA, QUINOA, BROWN],
    i: [pr("white_shrimp", 110), ve("tomato", 150), ve("spinach", 80), se("dried_oregano", 1), oi("olive_oil", 3)],
  }),
  dish({
    id: "lemon_seared_cod", zh: "柠檬香煎鳕鱼", en: "Lemon pan-seared cod with broccoli", sum: "鳕鱼煎至两面金黄，冷冻西兰花和豌豆同锅煎软，挤柠檬汁", sumEn: "Cod pan-seared golden on both sides, frozen broccoli and peas softened in the same pan, finished with lemon.", c: "mediterranean", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("cod", 140), ve("frozen_broccoli", 175), ve("frozen_peas", 30), oi("olive_oil", 4), se("lemon", 10), se("salt", 0.4)],
  }),
];

const ITALIAN: Dish[] = [
  dish({
    id: "beef_meatballs_marinara", zh: "意式番茄汁炖牛肉丸", en: "Beef meatballs simmered in marinara", sum: "牛后腿肉现绞，拌面包糠捏丸，放进番茄洋葱酱汁煮 20 分钟", sumEn: "Lean beef round ground fresh, mixed with breadcrumbs, rolled and simmered 20 minutes in a tomato and onion sauce.", c: "italian", m: "stew", eq: ["stove"], t: [18, 40],
    i: [gr("lean_beef", 110), ve("crushed_tomatoes", 130), ve("onion", 30), se("breadcrumbs", 10), se("italian_seasoning", 1.5), se("dried_oregano", 1)],
    ways: [
      way("番茄牛肉丸拌意面配西兰花", "Meatballs with pasta and broccoli", PASTA, [ve("frozen_broccoli", 150)]),
      way("番茄牛肉丸配炒菠菜", "Meatballs over sauteed spinach", null, [ve("frozen_spinach", 150)], 5),
      way("牛肉丸配吐司和番茄生菜", "Meatballs on toast with tomato and lettuce", "white_toast", [ve("tomato", 90), ve("romaine", 80)]),
    ],
  }),
  dish({
    id: "chicken_cacciatore", zh: "意式番茄蘑菇炖鸡（cacciatore）", en: "Chicken cacciatore", sum: "鸡胸肉块、蘑菇、彩椒加番茄和牛至焖煮 30 分钟", sumEn: "Chicken cubes, mushroom and pepper braised 30 minutes in tomato with oregano.", c: "italian", m: "braise", t: [15, 45],
    i: [pr("chicken_breast", 108), ve("crushed_tomatoes", 130), ve("red_bell_pepper", 50), ve("button_mushroom", 50), ve("onion", 30), se("dried_oregano", 1), se("italian_seasoning", 1.5), oi("olive_oil", 3), se("salt", 0.2)],
    ways: [
      way("蘑菇炖鸡拌全麦意面配生菜", "Cacciatore with whole-wheat pasta and lettuce", WW_PASTA, [ve("romaine", 80)]),
      way("蘑菇炖鸡配吐司和菠菜", "Cacciatore on toast with spinach", "white_toast", [ve("frozen_spinach", 100)]),
      way("蘑菇炖鸡配土豆和西兰花", "Cacciatore on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "beef_ragu", zh: "意式番茄炖牛肉块", en: "Italian tomato beef stew", sum: "牛腱块、番茄碎、洋葱、胡萝卜加意式香草，压力锅炖 35 分钟", sumEn: "Beef shank chunks with crushed tomato, onion and carrot and Italian herbs, pressure-cooked 35 minutes.", c: "italian", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 60],
    i: [pr("beef_shank_raw", 105), ve("crushed_tomatoes", 130), ve("onion", 40), ve("carrot", 40), se("italian_seasoning", 1.5), se("dried_oregano", 1), se("salt", 0.2)],
    ways: [
      way("意式炖牛肉拌意面配四季豆", "Beef ragu with pasta and green beans", PASTA, [ve("frozen_green_beans", 130)]),
      way("意式炖牛肉拌全麦意面配小番茄", "Beef ragu with whole-wheat pasta and cherry tomatoes", WW_PASTA, [ve("cherry_tomato", 70), ve("romaine", 80)]),
      way("意式炖牛肉配土豆和西兰花", "Beef ragu on a microwaved potato with broccoli", MICROWAVE_POTATO, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "chicken_mushroom_ragu", zh: "意式鸡腿丁蘑菇番茄酱（ragu）", en: "Chicken thigh and mushroom ragu", sum: "鸡腿肉丁和蘑菇炒香，加番茄碎小火炖 30 分钟", sumEn: "Diced chicken thigh and mushroom sauteed, then simmered 30 minutes in crushed tomato.", c: "italian", m: "stew", t: [15, 45],
    i: [pr("chicken_thigh", 135), ve("button_mushroom", 100), ve("crushed_tomatoes", 130), ve("onion", 30), se("italian_seasoning", 1.5), oi("olive_oil", 2), se("salt", 0.2)],
    ways: [
      way("鸡丁蘑菇酱拌全麦意面配菠菜", "Chicken ragu with whole-wheat pasta and spinach", WW_PASTA, [ve("frozen_spinach", 105)]),
      way("鸡丁蘑菇酱配藜麦和彩椒", "Chicken ragu over quinoa with red pepper", QUINOA, [ve("red_bell_pepper", 100)]),
      way("鸡丁蘑菇酱配吐司和生菜小番茄", "Chicken ragu on toast with lettuce and cherry tomatoes", "white_toast", [ve("romaine", 80), ve("cherry_tomato", 70)]),
    ],
  }),
  dish({
    id: "chicken_minestrone", zh: "意式鸡肉蔬菜汤（minestrone）", en: "Chicken and vegetable minestrone", sum: "鸡胸肉、番茄、胡萝卜、芹菜、西葫芦加高汤和意式香草煮 30 分钟", sumEn: "Chicken breast, tomato, carrot, celery and zucchini simmered 30 minutes in stock with Italian herbs.", c: "italian", m: "simmer", t: [15, 45],
    i: [pr("chicken_breast", 90), ve("crushed_tomatoes", 130), ve("carrot", 40), ve("celery", 30), ve("zucchini", 40), se("stock_paste", 2), se("italian_seasoning", 1.5)],
    ways: [
      way("意式鸡肉汤配全麦吐司和生菜", "Minestrone with whole-wheat toast and lettuce", "whole_wheat_toast", [ve("romaine", 80)]),
      way("意式鸡肉汤加全麦意面配四季豆", "Minestrone with whole-wheat pasta and green beans", WW_PASTA, [ve("frozen_green_beans", 110)]),
      way("意式鸡肉汤泡饭配菠菜", "Minestrone over rice with spinach", RICE, [ve("frozen_spinach", 90)]),
    ],
  }),
  dish({
    id: "chicken_pizzaiola", zh: "意式番茄焖鸡胸（pizzaiola）", en: "Chicken pizzaiola", sum: "鸡胸肉在番茄、洋葱、彩椒酱里加牛至，加盖焖 15 分钟", sumEn: "Chicken breast braised 15 minutes under a lid in tomato, onion and pepper sauce with oregano.", c: "italian", m: "braise", eq: ["stove"], t: [12, 30],
    i: [pr("chicken_breast", 105), ve("crushed_tomatoes", 130), ve("onion", 30), ve("red_bell_pepper", 40), se("dried_oregano", 1.5), oi("olive_oil", 3), se("salt", 0.2)],
    ways: [
      way("番茄焖鸡胸拌意面配生菜", "Pizzaiola with pasta and lettuce", PASTA, [ve("romaine", 150)]),
      way("番茄焖鸡胸配全麦吐司和菠菜", "Pizzaiola on whole-wheat toast with spinach", "whole_wheat_toast", [ve("frozen_spinach", 120)]),
      way("番茄焖鸡胸配小土豆和四季豆", "Pizzaiola with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 130)]),
    ],
  }),
  dish({
    id: "herb_braised_pork_tenderloin", zh: "香草焖猪里脊", en: "Herb-braised pork tenderloin", sum: "猪里脊和彩椒、西葫芦拌意式香草，加少许高汤加盖焖 20 分钟", sumEn: "Pork tenderloin with pepper and zucchini, Italian herbs and a little stock, braised under a lid 20 minutes.", c: "italian", m: "braise", eq: ["stove"], t: [10, 30],
    i: [pr("pork_tenderloin", 120), ve("red_bell_pepper", 60), ve("zucchini", 60), ve("red_onion", 30), se("italian_seasoning", 1.5), se("dried_oregano", 0.5), oi("olive_oil", 3), se("salt", 0.3), se("lemon", 8), se("stock_paste", 1.25)],
    ways: [
      way("香草猪里脊配小土豆和四季豆", "Herb pork with baby potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 130)]),
      way("香草猪里脊拌全麦意面配小番茄", "Herb pork with whole-wheat pasta and cherry tomatoes", WW_PASTA, [ve("cherry_tomato", 70), ve("romaine", 80)]),
      way("香草猪里脊配藜麦和南瓜", "Herb pork over quinoa with pumpkin", QUINOA, [ve("pumpkin", 100)]),
    ],
  }),
  dish({
    id: "italian_lentil_soup", zh: "意式扁豆汤", en: "Italian lentil soup", sum: "扁豆、番茄、胡萝卜、芹菜、洋葱加高汤煮 30 分钟", sumEn: "Lentils, tomato, carrot, celery and onion simmered in stock for 30 minutes.", c: "italian", m: "simmer", t: [12, 45],
    i: [st("lentils_dry", 90), ve("crushed_tomatoes", 130), ve("carrot", 50), ve("celery", 40), ve("onion", 40), se("stock_paste", 2.5), se("dried_oregano", 1)],
    ways: [
      way("意式扁豆汤配全麦吐司和生菜", "Lentil soup with whole-wheat toast and lettuce", "whole_wheat_toast", [ve("romaine", 80), ve("tomato", 80)]),
      way("意式扁豆汤加全麦意面配菠菜", "Lentil soup with whole-wheat pasta and spinach", WW_PASTA, [ve("frozen_spinach", 110)]),
      way("意式扁豆汤配藜麦和小番茄", "Lentil soup with quinoa and cherry tomatoes", QUINOA, [ve("cherry_tomato", 70), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "chicken_meatball_spinach_soup", zh: "鸡肉丸菠菜汤", en: "Chicken meatball and spinach soup", sum: "鸡腿肉现绞，拌面包糠捏成小丸，下入高汤煮熟，加菠菜", sumEn: "Chicken thigh ground fresh, mixed with breadcrumbs into small balls, poached in stock with spinach.", c: "italian", m: "simmer", t: [18, 40],
    i: [gr("chicken_thigh", 100), se("breadcrumbs", 10), ve("frozen_spinach", 80), ve("carrot", 40), ve("onion", 30), se("stock_paste", 2), se("italian_seasoning", 1), se("salt", 0.3)],
    ways: [
      way("鸡肉丸汤加全麦意面配生菜", "Meatball soup with whole-wheat pasta and lettuce", WW_PASTA, [ve("romaine", 80)]),
      way("鸡肉丸汤配全麦吐司和小番茄", "Meatball soup with whole-wheat toast and cherry tomatoes", "whole_wheat_toast", [ve("cherry_tomato", 70)]),
      way("鸡肉丸汤泡饭配豌豆", "Meatball soup over rice with peas", RICE, [ve("frozen_peas", 60)]),
    ],
  }),
  dish({
    id: "shrimp_tomato_mushroom", zh: "番茄蘑菇炒虾仁", en: "Shrimp with cherry tomatoes and mushrooms", sum: "虾仁和小番茄、蘑菇快炒到番茄出汁，撒意式香草", sumEn: "Shrimp, cherry tomato and mushroom stir-fried until the tomato breaks down, sprinkled with Italian herbs.", c: "italian", m: "stir_fry", t: [12, 18],
    staples: [PASTA, WW_PASTA],
    i: [pr("white_shrimp", 115), ve("cherry_tomato", 110), ve("button_mushroom", 60), se("italian_seasoning", 1), oi("olive_oil", 4), se("garlic_paste", 2), se("salt", 0.2)],
  }),
  dish({
    id: "lemon_mushroom_chicken", zh: "柠檬蘑菇煎鸡胸", en: "Lemon chicken with mushrooms and spinach", sum: "鸡胸肉煎熟，蘑菇和菠菜同锅炒软，加柠檬汁和少许高汤收汁", sumEn: "Chicken breast pan-fried, mushroom and spinach wilted in the pan, finished with lemon and a splash of stock.", c: "italian", m: "pan_fry", t: [12, 18],
    staples: [PASTA, BABY_POTATOES, MICROWAVE_POTATO],
    i: [pr("chicken_breast", 108), ve("button_mushroom", 70), ve("spinach", 130), se("lemon", 12), oi("olive_oil", 4), se("salt", 0.4), se("stock_paste", 0.75)],
  }),
  dish({
    id: "italian_tomato_chicken_plate", zh: "意式番茄鸡肉拼盘", en: "Italian tomato chicken plate", sum: "即食鸡胸肉配番茄片和红洋葱，淋橄榄油和柠檬汁，撒意式香草", sumEn: "Ready-cooked chicken with sliced tomato and red onion, dressed with oil and lemon, sprinkled with Italian herbs.", c: "italian", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_toast", QUINOA],
    i: [pr("ready_chicken_breast", 100), ve("tomato", 170), ve("red_onion", 15), se("italian_seasoning", 1), oi("olive_oil", 4), se("lemon", 6)],
  }),
  dish({
    id: "tuna_tomato_spaghetti_sauce", zh: "金枪鱼番茄意面酱", en: "Tuna and tomato sauce", sum: "彩椒和番茄煮成酱，拌入水浸金枪鱼，浇在意面上", sumEn: "Red pepper and tomato cooked into a sauce, canned tuna stirred in, served over pasta.", c: "italian", m: "stir_fry", t: [10, 15],
    staples: [PASTA, WW_PASTA],
    i: [pr("canned_tuna_water", 100), ve("tomato", 150), ve("red_bell_pepper", 80), se("italian_seasoning", 1), oi("olive_oil", 3), se("dried_oregano", 0.5), se("garlic_paste", 2)],
  }),
  dish({
    id: "pork_pepper_medallions", zh: "彩椒煎猪里脊", en: "Pork medallions with peppers and zucchini", sum: "猪里脊切厚片煎熟，彩椒和西葫芦同锅煎软，挤柠檬汁", sumEn: "Thick pork tenderloin slices pan-fried, pepper and zucchini softened in the same pan, finished with lemon.", c: "italian", m: "pan_fry", t: [12, 18],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("pork_tenderloin", 118), ve("red_bell_pepper", 115), ve("zucchini", 60), oi("olive_oil", 4), se("italian_seasoning", 1), se("salt", 0.3), se("lemon", 6)],
  }),
];

const CHINESE: Dish[] = [
  dish({
    id: "tomato_braised_beef_shank", zh: "番茄炖牛腱", en: "Tomato braised beef shank", sum: "牛腱切块和番茄、胡萝卜、洋葱一起压力锅炖 35 分钟", sumEn: "Beef shank cubes with tomato, carrot and onion, pressure-cooked 35 minutes.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 60],
    i: [pr("beef_shank_raw", 105), ve("tomato", 220), ve("carrot", 50), ve("onion", 40), se("garlic_paste", 3), se("ginger_paste", 3), se("reduced_salt_soy_sauce", 5), oi("canola_oil", 3)],
    ways: [
      way("番茄炖牛腱盖米饭配上海青", "Tomato beef over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("番茄炖牛腱拌面配西兰花", "Tomato beef with noodles and broccoli", "fresh_noodles", [ve("frozen_broccoli", 100)]),
      way("番茄炖牛腱配馒头和拍黄瓜", "Tomato beef with a steamed bun and smashed cucumber", "steamed_bun", [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "shiitake_braised_chicken", zh: "香菇黄焖鸡", en: "Shiitake braised chicken thighs", sum: "鸡腿肉块和香菇、青椒加蚝油、酱油焖 25 分钟", sumEn: "Chicken thigh cubes with shiitake and green pepper, braised 25 minutes in oyster and soy sauce.", c: "chinese", m: "stew", t: [15, 40],
    i: [pr("chicken_thigh", 120), ve("shiitake", 80), ve("red_bell_pepper", 70), se("oyster_sauce", 5), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("canola_oil", 3)],
    ways: [
      way("香菇黄焖鸡盖糙米饭配上海青", "Shiitake chicken over brown rice with bok choy", BROWN, [ve("bok_choy", 140)]),
      way("香菇黄焖鸡配糯玉米和四季豆", "Shiitake chicken with waxy corn and green beans", CORN, [ve("frozen_green_beans", 100)]),
      way("香菇黄焖鸡盖杂粮饭配西兰花", "Shiitake chicken over multigrain rice with broccoli", GRAINS, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "yam_wood_ear_chicken", zh: "山药木耳炖鸡", en: "Chicken stew with yam and wood ear", sum: "鸡腿肉块和山药、木耳、香菇加酱油和姜小火炖 30 分钟", sumEn: "Chicken thigh cubes with yam, wood ear and shiitake, simmered 30 minutes in soy sauce and ginger.", c: "chinese", m: "stew", t: [15, 45],
    i: [pr("chicken_thigh", 115), ve("chinese_yam", 70), ve("wood_ear", 35), ve("shiitake", 30), se("reduced_salt_soy_sauce", 4), se("ginger_paste", 3)],
    ways: [
      way("山药木耳炖鸡盖米饭配上海青", "Yam chicken stew over rice with bok choy", RICE, [ve("bok_choy", 140)]),
      way("山药木耳炖鸡盖小米饭配西兰花", "Yam chicken stew over millet rice with broccoli", MILLET, [ve("frozen_broccoli", 140)]),
      way("山药木耳炖鸡配馒头和菠菜", "Yam chicken stew with a steamed bun and spinach", "steamed_bun", [ve("frozen_spinach", 170)]),
    ],
  }),
  dish({
    id: "potato_soy_braised_chicken", zh: "土豆烧鸡", en: "Soy-braised chicken with potato", sum: "鸡腿肉、土豆、胡萝卜加酱油、蚝油和五香粉焖烧 25 分钟", sumEn: "Chicken thigh, potato and carrot braised 25 minutes in soy sauce, oyster sauce and five-spice.", c: "chinese", m: "braise", t: [15, 40],
    i: [pr("chicken_thigh", 115), st("potato", 100), ve("onion", 40), ve("carrot", 50), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 2)],
    ways: [
      way("土豆烧鸡配上海青", "Potato chicken with bok choy", null, [ve("bok_choy", 140)]),
      way("土豆烧鸡盖米饭配西兰花", "Potato chicken over rice with broccoli", RICE, [ve("frozen_broccoli", 125)]),
    ],
  }),
  dish({
    id: "radish_beef_stew", zh: "白萝卜炖牛腱", en: "Beef shank and white radish stew", sum: "牛腱切块和白萝卜、胡萝卜一起压力锅炖 40 分钟", sumEn: "Beef shank cubes with white radish and carrot, pressure-cooked 40 minutes.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 60],
    i: [pr("beef_shank_raw", 105), ve("white_radish", 150), ve("carrot", 60), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("five_spice_powder", 0.5), se("ginger_paste", 3)],
    ways: [
      way("萝卜炖牛腱盖米饭配西兰花", "Radish beef over rice with broccoli", RICE, [ve("frozen_broccoli", 140)]),
      way("萝卜炖牛腱拌面配上海青", "Radish beef with noodles and bok choy", "fresh_noodles", [ve("bok_choy", 140)]),
      way("萝卜炖牛腱配糯玉米和菠菜", "Radish beef with waxy corn and spinach", CORN, [ve("frozen_spinach", 125)]),
    ],
  }),
  dish({
    id: "napa_tofu_meatball_stew", zh: "白菜豆腐炖肉丸", en: "Napa cabbage, tofu and pork meatball stew", sum: "猪后腿瘦肉现绞拌姜捏丸，和白菜、豆腐、米粉炖 25 分钟", sumEn: "Lean pork leg ground fresh and mixed with ginger into balls, simmered 25 minutes with napa cabbage, tofu and a little rice noodle.", c: "chinese", m: "stew", t: [18, 45],
    i: [pr("firm_tofu", 145), gr("lean_pork_leg", 50), ve("napa_cabbage", 100), st("rice_noodles_dry", 12), se("reduced_salt_soy_sauce", 4), se("ginger_paste", 3), oi("sesame_oil", 2), se("salt", 0.3)],
    ways: [
      way("白菜豆腐肉丸盖米饭配上海青", "Tofu meatball stew over rice with bok choy", RICE, [ve("bok_choy", 140)]),
      way("白菜豆腐肉丸配馒头和菠菜", "Tofu meatball stew with a steamed bun and spinach", "steamed_bun", [ve("frozen_spinach", 135)]),
      way("白菜豆腐肉丸盖糙米饭配胡萝卜", "Tofu meatball stew over brown rice with carrot", BROWN, [ve("carrot", 110)]),
    ],
  }),
  dish({
    id: "northeast_iron_pot_chicken", zh: "东北铁锅炖鸡腿", en: "Northeastern iron-pot chicken with potato, corn and green beans", sum: "鸡腿肉块、土豆、玉米段、四季豆加酱油，铁锅小火炖 35 分钟", sumEn: "Chicken thigh pieces, potato, corn on the cob and green beans stewed 35 minutes in a heavy pot with soy sauce.", c: "chinese", m: "stew", t: [15, 50],
    i: [pr("chicken_thigh", 120), st("potato", 80), ve("sweet_corn_cob", 70), ve("green_beans", 90), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 3), se("stock_paste", 2.5)],
    ways: [
      way("铁锅炖鸡腿配馒头和上海青", "Iron-pot chicken with a steamed bun and bok choy", "steamed_bun", [ve("bok_choy", 125)]),
      way("铁锅炖鸡腿盖米饭配番茄", "Iron-pot chicken over rice with tomato", RICE, [ve("tomato", 140)]),
      way("铁锅炖鸡腿盖杂粮饭配西兰花", "Iron-pot chicken over multigrain rice with broccoli", GRAINS, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "potato_soy_braised_beef", zh: "土豆红烧牛腱", en: "Soy-braised beef shank with potato", sum: "牛腱块、土豆、胡萝卜加酱油、蚝油和五香粉，压力锅炖 40 分钟", sumEn: "Beef shank cubes, potato and carrot with soy sauce, oyster sauce and five-spice, pressure-cooked 40 minutes.", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), st("potato", 100), ve("carrot", 50), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 3)],
    ways: [
      way("土豆烧牛腱配青椒", "Potato beef with green pepper", null, [ve("green_pepper", 150)]),
      way("土豆烧牛腱盖米饭配上海青", "Potato beef over rice with bok choy", RICE, [ve("bok_choy", 125)]),
      way("土豆烧牛腱配糯玉米和四季豆", "Potato beef with waxy corn and green beans", CORN, [ve("frozen_green_beans", 130)]),
    ],
  }),
  dish({
    id: "winter_melon_chicken_meatball_soup", zh: "冬瓜鸡肉丸汤", en: "Winter melon and chicken meatball soup", sum: "鸡腿肉现绞拌姜捏成丸，和冬瓜块、香菇在清汤里煮 20 分钟", sumEn: "Chicken thigh ground fresh and mixed with ginger into balls, simmered 20 minutes in a clear broth with winter melon and shiitake.", c: "chinese", m: "simmer", t: [18, 40],
    i: [gr("chicken_thigh", 125), ve("winter_melon", 120), ve("shiitake", 30), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("sesame_oil", 2), se("stock_paste", 3.75)],
    ways: [
      way("冬瓜鸡肉丸汤泡饭配上海青", "Winter melon soup over rice with bok choy", RICE, [ve("bok_choy", 160)]),
      way("冬瓜鸡肉丸汤泡杂粮饭配菠菜", "Winter melon soup over multigrain rice with spinach", GRAINS, [ve("frozen_spinach", 160)]),
      way("冬瓜鸡肉丸汤下面条配番茄", "Winter melon soup with noodles and tomato", "fresh_noodles", [ve("tomato", 170)]),
    ],
  }),
  dish({
    id: "steamed_chicken_shiitake", zh: "香菇滑蒸鸡", en: "Silky steamed chicken with shiitake and wood ear", sum: "鸡腿肉切薄片，拌酱油、姜蓉和少许淀粉，与香菇、木耳铺盘蒸 10 分钟", sumEn: "Chicken thigh sliced thin and coated with soy sauce, ginger paste and a little cornstarch, steamed 10 minutes with shiitake and wood ear.", c: "chinese", m: "steam", eq: ["steamer"], t: [12, 25],
    i: [pr("chicken_thigh", 120), ve("shiitake", 60), ve("wood_ear", 25), se("oyster_sauce", 4), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), se("cornstarch", 3), oi("sesame_oil", 2)],
    ways: [
      way("香菇蒸鸡盖糙米饭配西兰花", "Steamed chicken over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("香菇蒸鸡配蒸红薯和上海青", "Steamed chicken on sweet potato with bok choy", SWEET_POTATO, [ve("bok_choy", 140)]),
      way("香菇蒸鸡配馒头和四季豆", "Steamed chicken with a steamed bun and green beans", "steamed_bun", [ve("frozen_green_beans", 130)]),
    ],
  }),
  dish({
    id: "beef_mapo_tofu", zh: "牛肉丁麻婆豆腐", en: "Mapo tofu with diced beef and peppers", sum: "牛后腿肉切小丁炒散，加麻婆酱和豆瓣酱，下豆腐、青椒煮 8 分钟", sumEn: "Small diced beef round browned, simmered 8 minutes with mapo and chili bean sauce, tofu and green pepper.", c: "chinese", m: "stew", t: [12, 20],
    i: [pr("firm_tofu", 150), pr("lean_beef", 55), ve("green_pepper", 100), se("mapo_sauce", 12), se("doubanjiang", 3), se("sichuan_pepper_powder", 1)],
    ways: [
      way("麻婆豆腐盖米饭配上海青", "Mapo tofu over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("麻婆豆腐盖糙米饭配西兰花", "Mapo tofu over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("麻婆豆腐盖杂粮饭配黄瓜", "Mapo tofu over multigrain rice with cucumber", GRAINS, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "five_spice_braised_chicken", zh: "五香卤鸡胸", en: "Five-spice braised chicken breast", sum: "鸡胸肉与胡萝卜、洋葱用酱油和五香粉小火卤 25 分钟", sumEn: "Chicken breast with carrot and onion, simmered 25 minutes in soy sauce and five-spice.", c: "chinese", m: "braise", t: [10, 40],
    i: [pr("chicken_breast", 108), ve("carrot", 60), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("five_spice_powder", 1), se("ginger_paste", 3)],
    ways: [
      way("五香卤鸡胸盖米饭配青椒", "Five-spice chicken over rice with green pepper", RICE, [ve("green_pepper", 120)]),
      way("五香卤鸡胸拌面配上海青", "Five-spice chicken with noodles and bok choy", "fresh_noodles", [ve("bok_choy", 140)]),
      way("手撕五香鸡拌紫甘蓝", "Shredded five-spice chicken with red cabbage", null, [ve("red_cabbage", 100), tp("sesame_seeds", 3)], 5),
    ],
  }),
  dish({
    id: "tomato_tofu_egg_scramble", zh: "番茄豆腐滑蛋", en: "Tomato tofu and soft scrambled egg", sum: "番茄块炒出汁，下切块北豆腐焖 3 分钟，淋入蛋液炒至刚凝固", sumEn: "Tomato wedges cooked down, firm tofu simmered 3 minutes in the juice, then beaten egg stirred in until just set.", c: "chinese", m: "stir_fry", t: [10, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("egg", 100), pr("firm_tofu", 140), ve("tomato", 200), se("reduced_salt_soy_sauce", 3), se("ketchup", 5), se("salt", 0.4), oi("canola_oil", 5)],
  }),
  dish({
    id: "tomato_shrimp_egg_stirfry", zh: "番茄虾仁炒蛋", en: "Tomato, shrimp and scrambled eggs", sum: "鸡蛋炒到刚凝固盛出，番茄炒出汁，下虾仁和鸡蛋拌匀", sumEn: "Eggs scrambled until just set and set aside, tomato cooked down, shrimp and eggs folded back in.", c: "chinese", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("egg", 52), pr("white_shrimp", 82), ve("tomato", 185), se("reduced_salt_soy_sauce", 3), oi("canola_oil", 5)],
  }),
  dish({
    id: "kung_pao_chicken", zh: "宫保鸡丁", en: "Kung pao chicken", sum: "鸡丁与彩椒、胡萝卜、芹菜大火快炒，加醋、酱油和少许糖，撒花生", sumEn: "Chicken cubes stir-fried hot with pepper, carrot and celery, seasoned with vinegar, soy and a little sugar, topped with peanuts.", c: "chinese", m: "stir_fry", t: [15, 20],
    staples: [RICE, BROWN, MILLET],
    i: [pr("chicken_breast", 105), tp("peanuts", 8), ve("red_bell_pepper", 80), ve("carrot", 70), ve("celery", 50), se("reduced_salt_soy_sauce", 4), se("black_vinegar", 4), se("white_sugar", 3), se("chili_sauce", 3), oi("canola_oil", 4)],
  }),
  dish({
    id: "green_pepper_pork_strips", zh: "青椒肉丝", en: "Pork strips with peppers", sum: "猪腿肉切丝滑炒变色，加青椒、彩椒丝用蚝油和酱油炒熟", sumEn: "Pork strips stir-fried until pale, then cooked with pepper strips in oyster and soy sauce.", c: "chinese", m: "stir_fry", t: [12, 15],
    staples: [RICE, GRAINS, SWEET_POTATO],
    i: [pr("lean_pork_leg", 115), ve("green_pepper", 50), ve("red_bell_pepper", 120), se("reduced_salt_soy_sauce", 3), se("oyster_sauce", 3), se("garlic_paste", 3), oi("canola_oil", 5)],
  }),
  dish({
    id: "steamed_cod_shiitake", zh: "清蒸鳕鱼香菇", en: "Steamed cod with shiitake and bok choy", sum: "鳕鱼与香菇铺盘淋酱油，上锅蒸 10 分钟，配焯上海青", sumEn: "Cod and shiitake on a plate with soy sauce, steamed 10 minutes, served with blanched bok choy.", c: "chinese", m: "steam", eq: ["steamer"], t: [10, 20],
    staples: [RICE, MILLET, CORN],
    i: [pr("cod", 135), ve("shiitake", 40), ve("bok_choy", 140), se("reduced_salt_soy_sauce", 5), se("ginger_paste", 3), oi("sesame_oil", 3)],
  }),
  dish({
    id: "sesame_chicken_cucumber_salad", zh: "麻酱鸡丝拌黄瓜", en: "Sesame chicken and cucumber salad", sum: "即食鸡胸肉撕丝，和黄瓜、紫甘蓝用芝麻酱、醋和酱油拌匀", sumEn: "Ready-cooked chicken shredded and tossed with cucumber and red cabbage in sesame paste, vinegar and soy.", c: "chinese", m: "assemble", eq: [], t: [10, 10],
    staples: [RICE, "steamed_bun", SWEET_POTATO],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 80), ve("red_cabbage", 120), oi("sesame_paste", 8), se("reduced_salt_soy_sauce", 3), se("black_vinegar", 4)],
  }),
  dish({
    id: "tomato_tofu_chicken_stew", zh: "番茄豆腐炖鸡腿", en: "Tomato tofu and chicken thigh stew", sum: "鸡腿肉块与番茄、北豆腐加酱油炖 20 分钟，豆腐吸饱汤汁", sumEn: "Chicken thigh cubes stewed 20 minutes with tomato, firm tofu and soy sauce until the tofu takes up the broth.", c: "chinese", m: "stew", t: [10, 35],
    i: [pr("firm_tofu", 145), pr("chicken_thigh", 55), ve("tomato", 170), ve("onion", 25), se("reduced_salt_soy_sauce", 4), se("ketchup", 8), se("ginger_paste", 2), oi("sesame_oil", 2), se("salt", 0.3)],
    ways: [
      way("豆腐炖鸡腿盖米饭配上海青", "Tofu chicken stew over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("豆腐炖鸡腿盖小米饭配西兰花", "Tofu chicken stew over millet rice with broccoli", MILLET, [ve("frozen_broccoli", 100)]),
      way("豆腐炖鸡腿拌面配菠菜", "Tofu chicken stew with noodles and spinach", "fresh_noodles", [ve("frozen_spinach", 100)]),
    ],
  }),
  dish({
    id: "homestyle_tofu_pork_slices", zh: "家常豆腐炒肉片", en: "Home-style tofu with pork slices", sum: "猪大排切片滑炒，下煎黄的北豆腐块，加青椒、胡萝卜、木耳和豆瓣酱炒熟", sumEn: "Pork loin slices stir-fried until pale, then pan-browned firm tofu, green pepper, carrot and wood ear with chili bean sauce.", c: "chinese", m: "stir_fry", t: [14, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("firm_tofu", 170), pr("pork_loin", 45), ve("green_pepper", 100), ve("carrot", 45), ve("wood_ear", 25), se("doubanjiang", 3), se("reduced_salt_soy_sauce", 4), se("garlic_paste", 2), oi("canola_oil", 4)],
  }),
];

const MEXICAN: Dish[] = [
  dish({
    id: "salsa_shredded_chicken", zh: "墨西哥番茄手撕鸡", en: "Pressure-cooker salsa chicken", sum: "鸡胸肉、番茄碎、洋葱、青椒加墨西哥香料，压力锅压 12 分钟后撕散", sumEn: "Chicken breast with crushed tomato, onion, pepper and taco spice, pressure-cooked 12 minutes, then shredded.", c: "mexican", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 30],
    i: [pr("chicken_breast", 110), ve("crushed_tomatoes", 130), ve("onion", 40), ve("green_pepper", 40), se("taco_seasoning", 2.5), se("lime", 8)],
    ways: [
      way("番茄手撕鸡卷玉米饼配紫甘蓝", "Salsa chicken in corn tortillas with red cabbage", "corn_tortilla", [ve("red_cabbage", 100), ve("tomato", 70), tp("lime", 8)]),
      way("番茄手撕鸡盖糙米饭配彩椒玉米", "Salsa chicken over brown rice with red pepper and corn", BROWN, [ve("red_bell_pepper", 100), ve("frozen_corn", 60)]),
      way("番茄手撕鸡配土豆和生菜番茄", "Salsa chicken on a microwaved potato with lettuce and tomato", MICROWAVE_POTATO, [ve("romaine", 80), ve("tomato", 80)]),
    ],
  }),
  dish({
    id: "orange_carnitas_pork", zh: "青柠孜然手撕猪肉（carnitas）", en: "Pressure-cooker cumin-lime carnitas-style pork", sum: "猪腿肉加洋葱、青柠汁、孜然和牛至，压力锅压 45 分钟后撕散", sumEn: "Pork leg with onion, lime juice, cumin and oregano, pressure-cooked 45 minutes, then shredded.", c: "mexican", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 70],
    i: [pr("lean_pork_leg", 120), ve("onion", 50), se("ground_cumin", 1.5), se("dried_oregano", 1), se("lime", 15), se("salt", 0.4), se("stock_paste", 1.25)],
    ways: [
      way("孜然手撕猪肉卷玉米饼配紫甘蓝", "Carnitas in corn tortillas with red cabbage", "corn_tortilla", [ve("red_cabbage", 100), ve("green_pepper", 60), tp("lime", 8)]),
      way("孜然手撕猪肉盖糙米饭配番茄", "Carnitas over brown rice with tomato", BROWN, [ve("tomato", 100), ve("frozen_corn", 60)]),
      way("孜然手撕猪肉生菜包", "Carnitas lettuce wraps", null, [ve("romaine", 100), ve("cherry_tomato", 70)], 5),
    ],
  }),
  dish({
    id: "beef_barbacoa", zh: "香料炖牛腱（barbacoa）", en: "Beef barbacoa", sum: "牛腱块与洋葱、番茄、辣椒粉和孜然一起压力锅炖 50 分钟后撕散", sumEn: "Beef shank cubes with onion, tomato, chili powder and cumin, pressure-cooked 50 minutes, then shredded.", c: "mexican", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 75],
    i: [pr("beef_shank_raw", 105), ve("onion", 50), ve("crushed_tomatoes", 130), se("chili_powder_blend", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("lime", 8), se("salt", 0.3)],
    ways: [
      way("香料炖牛腱卷玉米饼配紫甘蓝", "Barbacoa in corn tortillas with red cabbage", "corn_tortilla", [ve("red_cabbage", 100), ve("cherry_tomato", 70)]),
      way("香料炖牛腱配蒸红薯和四季豆", "Barbacoa on sweet potato with green beans", SWEET_POTATO, [ve("frozen_green_beans", 150)]),
      way("香料炖牛腱盖糙米饭配玉米生菜", "Barbacoa over brown rice with corn and lettuce", BROWN, [ve("frozen_corn", 60), ve("romaine", 100)]),
    ],
  }),
  dish({
    id: "carne_guisada", zh: "番茄土豆炖牛肉（carne guisada）", en: "Carne guisada beef and potato stew", sum: "牛腱块、土豆、番茄碎、青椒加辣椒粉和孜然，小火炖 100 分钟", sumEn: "Beef shank cubes, potato, crushed tomato and pepper with chili powder and cumin, simmered 100 minutes.", c: "mexican", m: "stew", t: [15, 120],
    i: [pr("beef_shank_raw", 105), st("potato", 70), ve("crushed_tomatoes", 130), ve("onion", 40), ve("green_pepper", 40), se("chili_powder_blend", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("salt", 0.3)],
    ways: [
      way("番茄炖牛肉卷玉米饼配青椒", "Carne guisada in corn tortillas with green pepper", "corn_tortilla", [ve("green_pepper", 120), tp("lime", 8)]),
      way("番茄炖牛肉盖糙米饭配菠菜", "Carne guisada over brown rice with spinach", BROWN, [ve("frozen_spinach", 150)]),
      way("番茄炖牛肉盖杂粮饭配玉米", "Carne guisada over multigrain rice with corn", GRAINS, [ve("frozen_corn", 60), ve("frozen_broccoli", 130)]),
    ],
  }),
  dish({
    id: "chicken_taco_filling", zh: "墨西哥香料手撕鸡腿肉", en: "Taco-spiced shredded chicken thigh", sum: "鸡腿肉块加番茄碎、洋葱、彩椒和墨西哥香料煮 25 分钟，撕散", sumEn: "Chicken thigh pieces cooked 25 minutes with crushed tomato, onion, pepper and taco spice, then shredded.", c: "mexican", m: "stew", t: [12, 40],
    i: [pr("chicken_thigh", 125), ve("crushed_tomatoes", 130), ve("onion", 40), ve("red_bell_pepper", 40), se("taco_seasoning", 3)],
    ways: [
      way("塔可鸡腿肉卷玉米饼配生菜番茄", "Taco chicken in corn tortillas with lettuce and tomato", "corn_tortilla", [ve("romaine", 80), ve("tomato", 80)]),
      way("塔可鸡腿肉盖糙米饭配玉米", "Taco chicken over brown rice with corn", BROWN, [ve("frozen_corn", 50), ve("frozen_green_beans", 110)]),
      way("塔可鸡腿肉配土豆和彩椒", "Taco chicken on a microwaved potato with red pepper", MICROWAVE_POTATO, [ve("red_bell_pepper", 120)]),
    ],
  }),
  dish({
    id: "chicken_tortilla_soup", zh: "墨西哥鸡肉玉米汤", en: "Chicken tortilla soup", sum: "鸡胸肉、玉米粒、番茄、洋葱加高汤和香料煮 25 分钟，挤青柠", sumEn: "Chicken breast, corn, tomato and onion simmered 25 minutes in stock with spice, finished with lime.", c: "mexican", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 95), st("frozen_corn", 40), ve("crushed_tomatoes", 130), ve("onion", 30), ve("green_pepper", 30), se("stock_paste", 2), se("taco_seasoning", 2), se("lime", 8)],
    ways: [
      way("墨西哥鸡汤配玉米饼条和生菜", "Tortilla soup with tortilla strips and lettuce", "corn_tortilla", [ve("romaine", 140)]),
      way("墨西哥鸡汤泡饭配小番茄紫甘蓝", "Tortilla soup over rice with cherry tomatoes and red cabbage", RICE, [ve("cherry_tomato", 100), ve("red_cabbage", 50)]),
    ],
  }),
  dish({
    id: "shrimp_fajita_skillet", zh: "墨西哥彩椒炒虾仁（fajita）", en: "Shrimp fajita skillet", sum: "虾仁与彩椒、青椒、洋葱用烤肉香料大火快炒，挤青柠", sumEn: "Shrimp stir-fried hot with peppers and onion in fajita spice, finished with lime.", c: "mexican", m: "stir_fry", t: [12, 18],
    staples: ["corn_tortilla", "whole_wheat_tortilla", BROWN],
    i: [pr("white_shrimp", 115), ve("red_bell_pepper", 140), ve("green_pepper", 30), ve("onion", 40), se("fajita_seasoning", 2.5), se("lime", 8), oi("canola_oil", 4)],
  }),
  dish({
    id: "fish_tacos_cabbage", zh: "墨西哥鱼肉玉米饼卷", en: "Fish tacos with red cabbage", sum: "罗非鱼片抹香料煎熟撕块，配紫甘蓝丝和番茄卷进玉米饼", sumEn: "Tilapia rubbed with spice and pan-fried, flaked and rolled in a tortilla with red cabbage and tomato.", c: "mexican", m: "pan_fry", t: [12, 15],
    staples: ["corn_tortilla", BROWN],
    i: [pr("frozen_tilapia_fillet", 135), ve("red_cabbage", 110), ve("tomato", 80), se("lime", 10), se("taco_seasoning", 1.5), oi("canola_oil", 3)],
  }),
  dish({
    id: "chicken_burrito_bowl", zh: "鸡肉玉米饭碗", en: "Chicken and corn burrito bowl", sum: "即食鸡胸肉、毛豆、玉米粒、番茄、生菜摆在饭上，挤青柠汁", sumEn: "Ready-cooked chicken, edamame, corn, tomato and lettuce over rice, finished with lime.", c: "mexican", m: "assemble", eq: [], t: [8, 8],
    staples: [BROWN, RICE, "whole_wheat_tortilla"],
    i: [pr("ready_chicken_breast", 85), ve("frozen_edamame", 45), ve("frozen_corn", 50), ve("tomato", 60), ve("romaine", 60), ve("red_onion", 15), se("lime", 8), se("taco_seasoning", 1)],
  }),
  dish({
    id: "mexican_tofu_black_bean_bowl", zh: "墨西哥香料豆腐黑豆碗", en: "Mexican-spiced tofu and black bean bowl", sum: "北豆腐捏碎与黑豆、毛豆、彩椒加塔可调味粉焖煮 15 分钟", sumEn: "Crumbled firm tofu, black beans, edamame and peppers simmered 15 minutes with taco seasoning and lime.", c: "mexican", m: "stew", t: [10, 25],
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
    id: "teriyaki_braised_chicken", zh: "照烧焖鸡胸", en: "Teriyaki braised chicken", sum: "鸡胸肉和洋葱加照烧酱，平底锅加盖焖 15 分钟，撒芝麻", sumEn: "Chicken breast and onion in teriyaki sauce, braised under a lid in a pan 15 minutes, sprinkled with sesame.", c: "japanese", m: "braise", eq: ["stove"], t: [10, 25],
    i: [pr("chicken_breast", 108), ve("onion", 40), se("teriyaki_sauce", 12), tp("sesame_seeds", 2)],
    ways: [
      way("照烧鸡胸盖米饭配西兰花", "Teriyaki chicken over rice with broccoli", RICE, [ve("frozen_broccoli", 160)]),
      way("照烧鸡胸拌荞麦面配上海青", "Teriyaki chicken with soba and bok choy", SOBA, [ve("bok_choy", 160)]),
      way("照烧鸡胸盖糙米饭配南瓜毛豆", "Teriyaki chicken over brown rice with pumpkin and edamame", BROWN, [ve("pumpkin", 100), ve("frozen_edamame", 60)]),
    ],
  }),
  dish({
    id: "nikujaga", zh: "土豆炖牛肉（肉じゃが）", en: "Nikujaga beef and potato simmer", sum: "牛肉片、土豆、洋葱、胡萝卜用酱油、味醂和高汤煮 25 分钟", sumEn: "Beef slices, potato, onion and carrot simmered 25 minutes in soy sauce, mirin and stock.", c: "japanese", m: "simmer", t: [15, 40],
    i: [pr("lean_beef", 110), st("potato", 100), ve("onion", 50), ve("carrot", 40), se("reduced_salt_soy_sauce", 4), se("mirin", 5), se("stock_paste", 2.5)],
    ways: [
      way("土豆炖牛肉盖米饭配四季豆", "Nikujaga over rice with green beans", RICE, [ve("frozen_green_beans", 130)]),
      way("土豆炖牛肉配上海青", "Nikujaga with bok choy", null, [ve("bok_choy", 140)]),
      way("土豆炖牛肉盖糙米饭配毛豆", "Nikujaga over brown rice with edamame", BROWN, [ve("frozen_edamame", 35), ve("bok_choy", 120)]),
    ],
  }),
  dish({
    id: "gyudon_beef", zh: "牛丼（牛肉洋葱）", en: "Gyudon beef and onion simmer", sum: "牛肉片和洋葱用酱油、味醂和高汤小火煮 15 分钟", sumEn: "Beef slices and onion simmered 15 minutes in soy sauce, mirin and stock.", c: "japanese", m: "simmer", t: [10, 25],
    i: [pr("beef_hotpot_slices", 110), ve("onion", 80), se("reduced_salt_soy_sauce", 4), se("mirin", 6), se("stock_paste", 2.5), se("ginger_paste", 2)],
    ways: [
      way("牛丼盖米饭配菠菜", "Gyudon over rice with spinach", RICE, [ve("frozen_spinach", 150)]),
      way("牛丼盖糙米饭配西兰花毛豆", "Gyudon over brown rice with broccoli and edamame", BROWN, [ve("frozen_broccoli", 120), ve("frozen_edamame", 35)]),
      way("牛丼拌荞麦面配胡萝卜", "Gyudon with soba and carrot", SOBA, [ve("carrot", 80), ve("bok_choy", 80)]),
    ],
  }),
  dish({
    id: "miso_pork_mushroom_stew", zh: "味噌猪肉蘑菇煲", en: "Miso pork and mushroom stew", sum: "猪腿肉片与白蘑菇、洋葱用味噌、味醂和高汤焖 20 分钟", sumEn: "Pork slices with mushroom and onion, braised 20 minutes in miso, mirin and stock.", c: "japanese", m: "braise", t: [12, 35],
    i: [pr("lean_pork_leg", 120), ve("button_mushroom", 90), ve("onion", 30), se("miso", 8), se("mirin", 3), se("ginger_paste", 2), se("stock_paste", 2)],
    ways: [
      way("味噌猪肉煲盖米饭配上海青", "Miso pork over rice with bok choy", RICE, [ve("bok_choy", 125)]),
      way("味噌猪肉煲盖糙米饭配西兰花", "Miso pork over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("味噌猪肉煲拌荞麦面配四季豆", "Miso pork with soba and green beans", SOBA, [ve("frozen_green_beans", 140)]),
    ],
  }),
  dish({
    id: "japanese_chicken_curry", zh: "日式咖喱鸡", en: "Japanese chicken curry", sum: "鸡胸肉块、土豆、胡萝卜、洋葱加高汤煮软，溶入咖喱块", sumEn: "Chicken cubes, potato, carrot and onion simmered in stock until soft, then thickened with curry roux.", c: "japanese", m: "stew", t: [15, 40],
    i: [pr("chicken_breast", 100), st("potato", 60), ve("carrot", 50), ve("onion", 50), se("curry_roux", 8), se("stock_paste", 2)],
    ways: [
      way("咖喱鸡盖米饭配南瓜", "Curry chicken over rice with pumpkin", RICE, [ve("pumpkin", 110)]),
      way("咖喱鸡盖糙米饭配西兰花", "Curry chicken over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
      way("咖喱鸡拌荞麦面配上海青", "Curry chicken with soba and bok choy", SOBA, [ve("bok_choy", 125)]),
    ],
  }),
  dish({
    id: "soy_mirin_chicken_dice", zh: "酱油味醂煮鸡腿丁", en: "Soy and mirin simmered chicken thigh", sum: "鸡腿肉丁加洋葱、酱油、味醂和姜，煮到收汁", sumEn: "Diced chicken thigh with onion, soy sauce, mirin and ginger, cooked down until the liquid is gone.", c: "japanese", m: "simmer", t: [12, 20],
    i: [pr("chicken_thigh", 140), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("mirin", 5), se("ginger_paste", 3)],
    ways: [
      way("酱油鸡腿丁盖米饭配西兰花", "Soy chicken over rice with broccoli", RICE, [ve("frozen_broccoli", 160)]),
      way("酱油鸡腿丁盖糙米饭配菠菜毛豆", "Soy chicken over brown rice with spinach and edamame", BROWN, [ve("frozen_spinach", 110), ve("frozen_edamame", 50)]),
      way("酱油鸡腿丁拌荞麦面配上海青", "Soy chicken with soba and bok choy", SOBA, [ve("bok_choy", 160), tp("sesame_seeds", 3)]),
    ],
  }),
  dish({
    id: "miso_salmon_spinach", zh: "味噌煎三文鱼配菠菜", en: "Miso salmon with spinach", sum: "三文鱼抹味噌和味醂腌 10 分钟后煎熟，菠菜同锅炒软", sumEn: "Salmon marinated 10 minutes in miso and mirin, pan-fried, with spinach wilted in the same pan.", c: "japanese", m: "pan_fry", t: [12, 18],
    staples: [RICE, BROWN, SOBA],
    i: [pr("salmon", 120), se("miso", 8), se("mirin", 3), ve("spinach", 180), oi("canola_oil", 2)],
  }),
  dish({
    id: "mackerel_cucumber_rice_bowl", zh: "茄汁鲭鱼黄瓜饭碗", en: "Tomato mackerel and cucumber rice bowl", sum: "罐头茄汁鲭鱼和黄瓜片、紫甘蓝丝摆在饭上，淋醋撒芝麻，不用开火", sumEn: "Canned mackerel in tomato sauce over rice with cucumber and red cabbage, rice vinegar and sesame; no cooking.", c: "japanese", m: "assemble", eq: [], t: [6, 6],
    staples: [RICE, BROWN, MILLET],
    i: [pr("canned_mackerel_tomato", 130), ve("cucumber", 60), ve("red_cabbage", 110), se("rice_vinegar", 4), tp("sesame_seeds", 3)],
  }),
  dish({
    id: "cold_soba_chicken", zh: "凉荞麦面鸡丝", en: "Cold soba with chicken and cucumber", sum: "荞麦面煮熟过凉水，拌鸡丝、毛豆、黄瓜、胡萝卜、紫甘蓝丝和海苔，淋酱油醋汁", sumEn: "Soba boiled and rinsed cold, tossed with shredded chicken, edamame, cucumber, carrot, red cabbage and nori in a soy-vinegar dressing.", c: "japanese", m: "assemble", eq: [], t: [10, 10],
    staples: [SOBA],
    i: [pr("ready_chicken_breast", 90), ve("frozen_edamame", 50), ve("cucumber", 60), ve("carrot", 60), ve("red_cabbage", 60), ve("nori", 1), tp("sesame_seeds", 3), se("reduced_salt_soy_sauce", 4), se("rice_vinegar", 4), oi("sesame_oil", 2)],
  }),
  dish({
    id: "teriyaki_tofu_chicken_dice", zh: "照烧豆腐鸡丁", en: "Teriyaki tofu and chicken dice", sum: "鸡腿丁与北豆腐块煎上色，加彩椒、胡萝卜和照烧汁收汁，撒芝麻", sumEn: "Chicken thigh dice and firm tofu browned, then red pepper, carrot and teriyaki sauce reduced to a glaze, sprinkled with sesame.", c: "japanese", m: "pan_fry", t: [12, 15],
    staples: [RICE, BROWN, SOBA],
    i: [pr("firm_tofu", 170), pr("chicken_thigh", 45), ve("red_bell_pepper", 125), ve("carrot", 50), se("teriyaki_sauce", 12), tp("sesame_seeds", 2), oi("canola_oil", 3)],
  }),
  dish({
    id: "miso_tofu_chicken_pot", zh: "日式豆腐味噌鸡肉锅", en: "Japanese miso tofu and chicken pot", sum: "鸡腿肉块与白萝卜、胡萝卜、香菇煮 15 分钟，下北豆腐，化入味噌", sumEn: "Chicken thigh cubes simmered 15 minutes with daikon, carrot and shiitake, then firm tofu, with miso stirred in.", c: "japanese", m: "simmer", t: [10, 30],
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
    id: "thai_red_curry_chicken", zh: "清汤红咖喱鸡（丛林咖喱）", en: "Thai jungle curry chicken", sum: "红咖喱酱炒香，加高汤、鸡胸肉块、西葫芦和彩椒煮 15 分钟，挤青柠", sumEn: "Red curry paste fried until fragrant, then chicken, zucchini and pepper simmered in stock 15 minutes, finished with lime.", c: "southeast_asian", m: "stew", t: [12, 30],
    i: [pr("chicken_breast", 105), ve("zucchini", 60), ve("red_bell_pepper", 40), ve("green_beans", 40), se("stock_paste", 2), se("red_curry_paste", 6), se("fish_sauce", 0.5), se("curry_powder", 1), se("lime", 8)],
    ways: [
      way("红咖喱鸡盖米饭配上海青", "Red curry chicken over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("红咖喱鸡盖糙米饭配西兰花", "Red curry chicken over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 100)]),
      way("红咖喱鸡拌米粉配南瓜", "Red curry chicken with rice vermicelli and pumpkin", VERMICELLI, [ve("pumpkin", 100)]),
    ],
  }),
  dish({
    id: "chicken_adobo", zh: "菲律宾酱油醋焖鸡（adobo）", en: "Chicken adobo", sum: "鸡腿肉与洋葱、酱油、米醋和蒜蓉酱一起焖 25 分钟", sumEn: "Chicken thighs with onion, soy sauce, rice vinegar and garlic, braised 25 minutes.", c: "southeast_asian", m: "braise", t: [10, 40],
    i: [pr("chicken_thigh", 120), ve("onion", 40), se("reduced_salt_soy_sauce", 6), se("rice_vinegar", 10), se("garlic_paste", 3), se("ground_black_pepper", 0.5)],
    ways: [
      way("酱油醋焖鸡盖米饭配四季豆", "Adobo over rice with green beans", RICE, [ve("frozen_green_beans", 160)]),
      way("酱油醋焖鸡盖糙米饭配番茄黄瓜", "Adobo over brown rice with tomato and cucumber", BROWN, [ve("tomato", 100), ve("cucumber", 60)]),
      way("酱油醋焖鸡拌米粉配上海青", "Adobo with rice vermicelli and bok choy", VERMICELLI, [ve("bok_choy", 160)]),
    ],
  }),
  dish({
    id: "thai_beef_pumpkin_curry", zh: "泰式牛肉南瓜咖喱", en: "Thai beef and pumpkin curry", sum: "牛腱块和南瓜、洋葱加高汤和红咖喱酱，压力锅煮 40 分钟，南瓜压成泥", sumEn: "Beef shank cubes with pumpkin and onion in stock and red curry paste, pressure-cooked 40 minutes, the pumpkin mashed in for body.", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 60],
    i: [pr("beef_shank_raw", 105), ve("pumpkin", 180), ve("onion", 30), se("stock_paste", 2.5), se("red_curry_paste", 5), se("fish_sauce", 1)],
    ways: [
      way("南瓜牛肉咖喱盖米饭配上海青", "Beef curry over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("南瓜牛肉咖喱盖糙米饭配四季豆", "Beef curry over brown rice with green beans", BROWN, [ve("frozen_green_beans", 100)]),
      way("南瓜牛肉咖喱拌米粉配黄瓜", "Beef curry with rice vermicelli and cucumber", VERMICELLI, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "bo_kho_beef", zh: "越南番茄炖牛腱（bò kho）", en: "Vietnamese spiced beef and tomato stew (bo kho)", sum: "牛腱块、胡萝卜、番茄碎加五香粉和鱼露，压力锅炖 40 分钟", sumEn: "Beef shank cubes, carrot and crushed tomato with five-spice and fish sauce, pressure-cooked 40 minutes.", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), ve("carrot", 70), ve("crushed_tomatoes", 130), ve("onion", 40), se("five_spice_powder", 0.8), se("fish_sauce", 1), se("garlic_paste", 2), se("ginger_paste", 2), se("stock_paste", 2)],
    ways: [
      way("越南炖牛腱拌米粉配上海青", "Bo kho with rice vermicelli and bok choy", VERMICELLI, [ve("bok_choy", 125)]),
      way("越南炖牛腱盖米饭配四季豆", "Bo kho over rice with green beans", RICE, [ve("frozen_green_beans", 120)]),
      way("越南炖牛腱盖糙米饭配西兰花", "Bo kho over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 130), tp("lime", 8)]),
    ],
  }),
  dish({
    id: "dry_spice_braised_beef", zh: "干香料炖牛肉（rendang 风味）", en: "Rendang-style dry-spice braised beef", sum: "牛腱块加咖喱粉、肉桂、洋葱和少许高汤，压力锅压 40 分钟，开盖收干", sumEn: "Beef shank cubes with curry powder, cinnamon, onion and a little stock, pressure-cooked 40 minutes, then reduced uncovered until nearly dry.", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 65],
    i: [pr("beef_shank_raw", 105), ve("onion", 60), se("stock_paste", 1.5), se("curry_powder", 3), se("ground_cinnamon", 0.3), se("ground_cumin", 1), se("garlic_paste", 2), se("ginger_paste", 2), se("reduced_salt_soy_sauce", 4), se("lime", 8)],
    ways: [
      way("干香料牛肉盖米饭配四季豆", "Dry-spice beef over rice with green beans", RICE, [ve("frozen_green_beans", 160)]),
      way("干香料牛肉盖糙米饭配上海青", "Dry-spice beef over brown rice with bok choy", BROWN, [ve("bok_choy", 160)]),
      way("干香料牛肉配蒸红薯和胡萝卜", "Dry-spice beef on sweet potato with carrot", SWEET_POTATO, [ve("carrot", 150)]),
    ],
  }),
  dish({
    id: "tom_yum_chicken_soup", zh: "泰式酸辣鸡肉汤（tom yum 风味）", en: "Tom yum style chicken soup", sum: "鸡胸肉、蘑菇、番茄加高汤和红咖喱酱煮 15 分钟，加鱼露，挤足青柠", sumEn: "Chicken breast, mushroom and tomato simmered 15 minutes in a clear stock with red curry paste and fish sauce, finished with plenty of lime.", c: "southeast_asian", m: "simmer", t: [12, 30],
    i: [pr("chicken_breast", 100), ve("button_mushroom", 80), ve("tomato", 60), se("stock_paste", 2.5), se("red_curry_paste", 4), se("fish_sauce", 0.5), se("lime", 15), se("sriracha", 1)],
    ways: [
      way("酸辣鸡肉汤配米粉和上海青", "Tom yum soup with rice vermicelli and bok choy", VERMICELLI, [ve("bok_choy", 140)]),
      way("酸辣鸡肉汤泡饭配菠菜", "Tom yum soup over rice with spinach", RICE, [ve("frozen_spinach", 110)]),
      way("酸辣鸡肉汤泡糙米饭配西兰花", "Tom yum soup over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 140)]),
    ],
  }),
  dish({
    id: "thai_spicy_chicken_stirfry", zh: "泰式辣炒鸡腿丁", en: "Thai spicy diced chicken stir-fry", sum: "鸡腿肉丁与四季豆、彩椒、毛豆大火快炒，加蚝油、鱼露和是拉差辣酱", sumEn: "Diced chicken thigh stir-fried hot with green beans, pepper and edamame, seasoned with oyster sauce, fish sauce and sriracha.", c: "southeast_asian", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("chicken_thigh", 120), ve("green_beans", 130), ve("red_bell_pepper", 60), ve("frozen_edamame", 40), se("oyster_sauce", 4), se("fish_sauce", 1.5), se("sriracha", 3), oi("canola_oil", 3)],
  }),
  dish({
    id: "shrimp_rice_noodle_stirfry", zh: "虾仁毛豆炒米粉", en: "Shrimp and edamame rice noodle stir-fry", sum: "虾仁和毛豆、胡萝卜、上海青快炒，拌入泡软的米粉和甜辣酱，撒花生", sumEn: "Shrimp, edamame, carrot and bok choy stir-fried quickly, tossed with soaked rice noodles and sweet chili sauce, topped with peanuts.", c: "southeast_asian", m: "stir_fry", t: [14, 18],
    staples: [VERMICELLI],
    i: [pr("white_shrimp", 100), ve("frozen_edamame", 50), ve("carrot", 80), ve("bok_choy", 70), se("sweet_chili_sauce", 8), se("fish_sauce", 1.5), se("lime", 10), tp("peanuts", 5), oi("canola_oil", 4)],
  }),
  dish({
    id: "lime_steamed_basa", zh: "青柠蒸龙利鱼", en: "Lime-steamed basa with napa cabbage", sum: "龙利鱼和大白菜、上海青、蘑菇铺盘，淋青柠汁、鱼露和甜辣酱，蒸 10 分钟", sumEn: "Basa fillet on napa cabbage, bok choy and mushroom with lime, fish sauce and sweet chili sauce, steamed 10 minutes.", c: "southeast_asian", m: "steam", eq: ["steamer"], t: [10, 20],
    staples: [RICE, BROWN, VERMICELLI],
    i: [pr("basa_fillet", 140), ve("napa_cabbage", 60), ve("button_mushroom", 30), ve("bok_choy", 120), se("lime", 15), se("fish_sauce", 3), se("sweet_chili_sauce", 6)],
  }),
  dish({
    id: "chicken_larb_lettuce", zh: "泰式青柠鸡丁生菜包（larb 风味）", en: "Larb-style diced chicken in lettuce", sum: "鸡胸肉切小丁炒熟，拌红洋葱、小番茄、青柠汁和鱼露，用生菜包着吃", sumEn: "Small diced chicken breast cooked through, tossed with red onion, cherry tomato, lime and fish sauce, eaten wrapped in lettuce.", c: "southeast_asian", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("chicken_breast", 120), ve("romaine", 120), ve("cucumber", 40), ve("cherry_tomato", 60), ve("red_onion", 20), se("lime", 15), se("fish_sauce", 2.5), se("sriracha", 3)],
  }),
  dish({
    id: "thai_sweet_chili_tofu_chicken", zh: "泰式甜辣豆腐鸡丁", en: "Thai sweet chili tofu and chicken", sum: "鸡腿丁与北豆腐块煎上色，加四季豆、彩椒，拌甜辣酱和鱼露", sumEn: "Chicken thigh dice and firm tofu browned, tossed with green beans and pepper in sweet chili and fish sauce.", c: "southeast_asian", m: "stir_fry", t: [13, 15],
    staples: [RICE, BROWN, VERMICELLI],
    i: [pr("firm_tofu", 170), pr("chicken_thigh", 46), ve("green_beans", 110), ve("red_bell_pepper", 60), se("sweet_chili_sauce", 12), se("fish_sauce", 1.5), oi("canola_oil", 3)],
  }),
];

const MAINS: Dish[] = [...AMERICAN, ...MEDITERRANEAN, ...ITALIAN, ...CHINESE, ...MEXICAN, ...JAPANESE, ...SOUTHEAST_ASIAN];

export const SEED_DISHES: readonly Dish[] = [...MAINS, ...SIDES, ...STAPLES, ...BREAKFASTS];
