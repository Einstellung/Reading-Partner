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

/** [hands-on, total] minutes. */
type Minutes = [number, number];

interface Spec {
  id: string;
  zh: string;
  en: string;
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
  batchStaple({ id: RICE, zh: "米饭", en: "Steamed white rice", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 40], i: [st("rice_cooked", 110)] }),
  batchStaple({ id: BROWN, zh: "糙米饭", en: "Brown rice", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 60], i: [st("brown_rice_cooked", 163)] }),
  batchStaple({ id: GRAINS, zh: "五谷杂粮饭", en: "Multigrain rice", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 50], i: [st("multigrain_rice_raw", 57)] }),
  batchStaple({ id: MILLET, zh: "小米饭", en: "Millet rice", c: "chinese", m: "grain", eq: ["rice_cooker"], t: [3, 35], i: [st("millet_raw", 55)] }),
  batchStaple({ id: QUINOA, zh: "藜麦饭", en: "Cooked quinoa", c: "mediterranean", m: "grain", t: [5, 20], i: [st("quinoa_cooked", 167)] }),
  batchStaple({ id: PASTA, zh: "水煮意面", en: "Boiled pasta", c: "italian", m: "grain", t: [5, 15], i: [st("pasta_dry", 54)] }),
  batchStaple({ id: WW_PASTA, zh: "水煮全麦意面", en: "Boiled whole-wheat pasta", c: "italian", m: "grain", t: [5, 15], i: [st("whole_wheat_pasta_dry", 57)] }),
  batchStaple({ id: SOBA, zh: "水煮荞麦面", en: "Boiled soba noodles", c: "japanese", m: "grain", t: [5, 10], i: [st("soba_fresh", 135)] }),
  batchStaple({ id: VERMICELLI, zh: "泡发米粉", en: "Rice vermicelli", c: "southeast_asian", m: "grain", eq: ["kettle"], t: [5, 12], i: [st("rice_noodles_dry", 57)] }),
  batchStaple({ id: SWEET_POTATO, zh: "蒸红薯", en: "Steamed sweet potato", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 30], i: [st("sweet_potato", 174)] }),
  batchStaple({ id: BAKED_POTATO, zh: "烤土豆", en: "Baked potato", c: "american", m: "bake", eq: ["oven"], t: [3, 60], i: [st("potato", 270)] }),
  batchStaple({
    id: BABY_POTATOES, zh: "香烤小土豆", en: "Roasted baby potatoes", c: "american", m: "roast", eq: ["oven"], t: [5, 40],
    i: [st("baby_potato", 340), oi("olive_oil", 3), se("smoked_paprika", 1), se("salt", 0.3)],
  }),
  batchStaple({ id: CORN, zh: "蒸糯玉米", en: "Steamed waxy corn", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 25], i: [st("waxy_corn_cob", 121)] }),
];

const SIDES: Dish[] = [
  dish({ id: "steamed_broccoli_lemon", zh: "柠檬清蒸西兰花", en: "Steamed broccoli with lemon", role: "side", c: "mediterranean", m: "steam", eq: ["steamer"], t: [3, 8], i: [ve("broccoli", 150), se("lemon", 6), oi("olive_oil", 3), se("salt", 0.3)] }),
  dish({ id: "garlic_bok_choy", zh: "蒜蓉炒上海青", en: "Stir-fried bok choy with garlic paste", role: "side", c: "chinese", m: "stir_fry", t: [5, 7], i: [ve("bok_choy", 160), se("garlic_paste", 2), oi("canola_oil", 3), se("salt", 0.3)] }),
  dish({ id: "oyster_gai_lan", zh: "蚝油芥蓝", en: "Blanched gai lan with oyster sauce", role: "side", c: "chinese", m: "greens", t: [5, 8], i: [ve("gai_lan", 150), se("oyster_sauce", 2), oi("sesame_oil", 1.5)] }),
  dish({ id: "goma_ae_spinach", zh: "芝麻酱拌菠菜", en: "Spinach with sesame dressing", role: "side", c: "japanese", m: "greens", t: [5, 8], i: [ve("frozen_spinach", 150), oi("sesame_paste", 6), se("light_soy_sauce", 1.5)] }),
  dish({ id: "greek_cucumber_tomato_salad", zh: "希腊黄瓜番茄沙拉", en: "Greek cucumber and tomato salad", role: "side", c: "mediterranean", m: "salad", eq: [], t: [6, 6], i: [ve("cucumber", 75), ve("tomato", 65), ve("red_onion", 10), tp("feta", 8), oi("olive_oil", 3), se("dried_oregano", 0.5), se("lemon", 5)] }),
  dish({ id: "yogurt_slaw", zh: "酸奶凉拌卷心菜", en: "Yogurt cabbage slaw", role: "side", c: "american", m: "salad", eq: [], t: [8, 8], i: [ve("cabbage", 100), ve("red_cabbage", 30), ve("carrot", 30), tp("greek_yogurt", 20), se("rice_vinegar", 5), se("salt", 0.3)] }),
  dish({ id: "fresh_salsa_salad", zh: "青柠鲜番茄莎莎", en: "Fresh tomato salsa with lime", role: "side", c: "mexican", m: "salad", eq: [], t: [6, 6], i: [ve("tomato", 110), ve("red_onion", 20), ve("cucumber", 30), tp("coriander", 3), se("lime", 8), se("salt", 0.3)] }),
  dish({ id: "sauteed_zucchini_basil", zh: "罗勒炒西葫芦", en: "Sauteed zucchini with basil", role: "side", c: "italian", m: "stir_fry", t: [6, 8], i: [ve("zucchini", 150), oi("olive_oil", 4), tp("basil", 3), se("lemon", 4), se("salt", 0.3)] }),
  dish({ id: "lemon_green_beans_almond", zh: "杏仁柠檬四季豆", en: "Microwaved green beans with almonds", role: "side", c: "american", m: "microwave", eq: ["microwave"], t: [4, 7], i: [ve("frozen_green_beans", 150), tp("almonds", 6), se("lemon", 5), se("salt", 0.3)] }),
];

const BREAKFASTS: Dish[] = [
  dish({ id: "milk_toast_banana", zh: "牛奶全麦吐司香蕉", en: "Milk, whole-wheat toast and banana", role: "breakfast", c: "american", m: "toast", eq: ["toaster"], t: [3, 4], i: [pr("low_fat_milk", 250), st("whole_wheat_toast", 45), fr("banana", 60)] }),
  dish({ id: "boiled_egg_toast_orange", zh: "水煮蛋吐司橙子", en: "Boiled eggs, toast and orange", role: "breakfast", c: "american", m: "simmer", t: [4, 12], i: [pr("egg", 85), st("white_toast", 30), fr("orange", 120)] }),
  dish({ id: "yogurt_oats_blueberry", zh: "希腊酸奶燕麦蓝莓", en: "Greek yogurt, oats and blueberries", role: "breakfast", c: "american", m: "assemble", eq: [], t: [3, 3], i: [pr("plain_yogurt", 250), st("oats", 20), fr("blueberries", 60)] }),
  dish({ id: "soy_milk_bun_mandarin", zh: "豆浆馒头橘子", en: "Soy milk, steamed bun and mandarin", role: "breakfast", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 8], i: [pr("soy_milk_unsweetened", 300), st("steamed_bun", 50), fr("mandarin", 100)] }),
  dish({ id: "tea_egg_bun_apple", zh: "茶叶蛋全麦馒头苹果", en: "Tea egg, whole-wheat bun and apple", role: "breakfast", c: "chinese", m: "steam", eq: ["steamer"], t: [3, 8], i: [pr("tea_egg", 85), st("whole_wheat_bun", 50), fr("apple", 100)] }),
  dish({ id: "egg_tortilla_mango", zh: "鸡蛋卷饼芒果", en: "Microwaved egg tortilla with salsa and mango", role: "breakfast", c: "mexican", m: "microwave", eq: ["microwave"], t: [4, 5], i: [pr("egg", 85), st("whole_wheat_tortilla", 30), ve("tomato", 50), fr("mango", 80)] }),
  dish({ id: "cottage_cheese_toast_strawberry", zh: "茅屋奶酪吐司草莓", en: "Cottage cheese on toast with strawberries", role: "breakfast", c: "american", m: "toast", eq: ["toaster"], t: [3, 4], i: [pr("cottage_cheese", 110), st("wholegrain_toast", 35), fr("strawberries", 80)] }),
  dish({ id: "yogurt_zaatar_pita", zh: "扎塔酸奶口袋饼", en: "Greek yogurt dip with za'atar and pita", role: "breakfast", c: "mediterranean", m: "assemble", eq: [], t: [4, 4], i: [pr("plain_yogurt", 220), st("whole_wheat_pita", 25), ve("cherry_tomato", 60), oi("olive_oil", 2), se("zaatar", 2)] }),
  dish({ id: "miso_tofu_rice_ball", zh: "味噌豆腐汤配米饭团", en: "Miso tofu soup with a rice ball", role: "breakfast", c: "japanese", m: "simmer", t: [5, 8], i: [pr("firm_tofu", 110), se("miso", 6), st("rice_cooked", 50), ve("nori", 1)] }),
  dish({ id: "oat_milk_porridge_peanut", zh: "牛奶燕麦粥花生酱", en: "Microwaved oat porridge with peanut butter", role: "breakfast", c: "american", m: "microwave", eq: ["microwave"], t: [3, 5], i: [pr("low_fat_milk", 300), st("oats", 25), fr("banana", 40), tp("peanut_butter", 5)] }),
];

const AMERICAN: Dish[] = [
  dish({
    id: "turkey_bean_chili", zh: "火鸡豆子辣酱", en: "Turkey and kidney bean chili", c: "american", m: "stew", t: [15, 60],
    i: [pr("ground_turkey", 125), st("canned_kidney_beans", 50), ve("crushed_tomatoes", 130), ve("onion", 40), ve("green_pepper", 30), se("chili_powder_blend", 3), se("ground_cumin", 1)],
    ways: [
      way("辣酱盖糙米饭", "Chili over brown rice", BROWN, [ve("red_cabbage", 40), tp("lime", 8)]),
      way("辣酱卷玉米饼", "Chili in corn tortillas with lime and coriander", "corn_tortilla", [ve("cabbage", 40), tp("coriander", 3), tp("lime", 8)]),
      way("辣酱烤土豆配菲达", "Chili on a baked potato with feta", BAKED_POTATO, [tp("feta", 12), ve("cherry_tomato", 50)]),
    ],
  }),
  dish({
    id: "beef_black_bean_chili", zh: "牛肉黑豆辣酱", en: "Beef and black bean chili", c: "american", m: "stew", t: [15, 60],
    i: [pr("lean_beef_mince", 110), st("canned_black_beans", 50), ve("crushed_tomatoes", 120), ve("onion", 40), ve("red_bell_pepper", 40), se("smoked_paprika", 2), se("ground_cumin", 1), se("chili_powder_blend", 2)],
    ways: [
      way("辣酱配蒸红薯", "Chili over steamed sweet potato", SWEET_POTATO, [ve("cabbage", 50), tp("coriander", 3), tp("lime", 8)]),
      way("辣酱糙米饭配牛油果", "Chili over brown rice with avocado", BROWN, [fr("avocado", 30), ve("romaine", 50)]),
      way("辣酱全麦卷饼", "Chili in a whole-wheat wrap with yogurt", "whole_wheat_tortilla", [ve("cabbage", 50), tp("greek_yogurt", 20)]),
    ],
  }),
  dish({
    id: "slow_cooker_pulled_pork", zh: "慢炖手撕猪肉", en: "Slow-cooker pulled pork", c: "american", m: "slow_cook", eq: ["slow_cooker"], t: [10, 480],
    i: [pr("lean_pork_leg", 120), ve("onion", 50), se("bbq_sauce", 12), se("smoked_paprika", 1.5), se("rice_vinegar", 6)],
    ways: [
      way("手撕猪肉口袋饼配凉拌菜", "Pulled pork in pita with slaw", "whole_wheat_pita", [ve("cabbage", 70), ve("carrot", 30)]),
      way("手撕猪肉烤土豆配西兰花", "Pulled pork on a baked potato with broccoli", BAKED_POTATO, [ve("frozen_broccoli", 90)]),
      way("手撕猪肉饭配菠萝", "Pulled pork rice bowl with pineapple", BROWN, [fr("pineapple", 60), ve("cucumber", 70)]),
    ],
  }),
  dish({
    id: "bbq_pulled_chicken", zh: "烧烤味手撕鸡", en: "BBQ pulled chicken", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [10, 35],
    i: [pr("chicken_breast", 108), ve("onion", 50), se("bbq_sauce", 12), se("garlic_powder", 1), se("smoked_paprika", 1.5), se("low_sodium_stock", 60)],
    ways: [
      way("手撕鸡口袋饼", "BBQ chicken in pita with lettuce and tomato", "whole_wheat_pita", [ve("romaine", 60), ve("tomato", 50)]),
      way("手撕鸡烤红薯配四季豆", "BBQ chicken on sweet potato with green beans", SWEET_POTATO, [ve("frozen_green_beans", 90)]),
      way("手撕鸡杂粮饭配玉米", "BBQ chicken over multigrain rice with corn", GRAINS, [ve("frozen_corn", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "sheet_pan_paprika_chicken_thighs", zh: "烤盘红椒鸡腿肉", en: "Sheet-pan paprika chicken thighs", c: "american", m: "roast", eq: ["oven"], t: [10, 45],
    i: [pr("chicken_thigh", 125), ve("carrot", 70), ve("onion", 50), se("smoked_paprika", 2), se("poultry_seasoning", 1.5), se("garlic_powder", 1), se("salt", 0.4), oi("olive_oil", 3)],
    ways: [
      way("鸡腿配烤小土豆和沙拉", "Chicken with roasted potatoes and salad", BABY_POTATOES, [ve("romaine", 60), ve("cucumber", 50)]),
      way("鸡腿口袋饼配酸奶", "Chicken in pita with yogurt", "whole_wheat_pita", [tp("greek_yogurt", 25), ve("tomato", 50), ve("cucumber", 40)]),
      way("鸡腿藜麦配苹果菠菜", "Chicken over quinoa with spinach and apple", QUINOA, [ve("spinach", 60), fr("apple", 60)]),
    ],
  }),
  dish({
    id: "turkey_sloppy_joe", zh: "火鸡肉酱", en: "Turkey sloppy joe mix", c: "american", m: "stew", t: [12, 35],
    i: [pr("ground_turkey", 125), ve("onion", 40), ve("green_pepper", 50), ve("crushed_tomatoes", 80), se("ketchup", 12), se("garlic_powder", 1), se("chili_powder_blend", 1.5), se("rice_vinegar", 4)],
    ways: [
      way("肉酱全麦吐司", "Open-faced on whole-wheat toast", "whole_wheat_toast", [ve("tomato", 50), ve("romaine", 40)]),
      way("肉酱烤土豆配西兰花", "Over a baked potato with broccoli", BAKED_POTATO, [ve("frozen_broccoli", 90)]),
      way("肉酱糙米饭配凉拌菜", "Over brown rice with slaw", BROWN, [ve("red_cabbage", 50), ve("carrot", 30)]),
    ],
  }),
  dish({
    id: "chicken_vegetable_soup", zh: "鸡肉蔬菜汤", en: "Chicken and vegetable soup", c: "american", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 108), ve("carrot", 60), ve("celery", 50), ve("onion", 40), se("low_sodium_stock", 250), se("poultry_seasoning", 1), se("salt", 0.4), tp("parsley", 3)],
    ways: [
      way("鸡汤配全麦吐司和苹果", "Soup with whole-wheat toast and an apple", "whole_wheat_toast", [fr("apple", 80), ve("romaine", 50)]),
      way("鸡汤加意面", "Chicken noodle soup", WW_PASTA, [ve("frozen_spinach", 70)]),
      way("鸡汤泡饭配豌豆", "Soup over rice with peas", RICE, [ve("frozen_peas", 60), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "beef_pot_roast", zh: "炖牛腱蔬菜", en: "Pot roast beef with vegetables", c: "american", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 75],
    i: [pr("beef_shank_raw", 105), ve("carrot", 70), ve("onion", 50), ve("crushed_tomatoes", 60), se("low_sodium_stock", 100), se("garlic_powder", 1), se("ground_black_pepper", 0.5), se("salt", 0.4)],
    ways: [
      way("炖牛肉配烤小土豆和四季豆", "Pot roast with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
      way("炖牛肉拌意面", "Pot roast over pasta", WW_PASTA, [ve("romaine", 60), ve("cherry_tomato", 50)]),
      way("炖牛肉配烤红薯和西兰花", "Pot roast with sweet potato and broccoli", SWEET_POTATO, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "turkey_meatloaf", zh: "火鸡肉饼", en: "Turkey meatloaf", c: "american", m: "bake", eq: ["oven"], t: [15, 60],
    i: [pr("ground_turkey", 95), pr("egg", 60), st("oats", 10), ve("onion", 40), ve("carrot", 40), se("ketchup", 12), se("garlic_powder", 1), se("salt", 0.3)],
    ways: [
      way("肉饼配烤土豆和四季豆", "Meatloaf with a baked potato and green beans", BAKED_POTATO, [ve("frozen_green_beans", 90)]),
      way("肉饼三明治", "Meatloaf sandwich on toast", "white_toast", [ve("tomato", 60), ve("romaine", 40)]),
      way("肉饼配米饭和西兰花", "Meatloaf with rice and broccoli", RICE, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "oven_crumbed_chicken_tenders", zh: "烤箱面包糠鸡柳", en: "Oven-baked crumbed chicken tenders", c: "american", m: "bake", eq: ["oven"], t: [15, 35],
    i: [pr("chicken_tender", 90), pr("egg_white", 40), se("breadcrumbs", 12), se("garlic_powder", 1), se("smoked_paprika", 1.5), oi("olive_oil", 4)],
    ways: [
      way("鸡柳沙拉", "Tenders on a big salad", null, [ve("romaine", 70), ve("cucumber", 50), ve("cherry_tomato", 50)], 5),
      way("鸡柳口袋饼配凉拌菜", "Tenders in pita with slaw", "whole_wheat_pita", [ve("cabbage", 70), ve("carrot", 40)]),
      way("鸡柳配烤小土豆", "Tenders with roasted potatoes and broccoli", BABY_POTATOES, [ve("frozen_broccoli", 100)]),
    ],
  }),
  dish({
    id: "turkey_stuffed_peppers", zh: "火鸡肉烤彩椒", en: "Turkey stuffed peppers", c: "american", m: "bake", eq: ["oven"], t: [20, 55],
    i: [pr("ground_turkey", 120), ve("red_bell_pepper", 150), ve("crushed_tomatoes", 50), ve("onion", 30), se("chili_powder_blend", 2), se("ground_cumin", 1), tp("mozzarella", 15)],
    ways: [
      way("彩椒配糙米饭", "Peppers with brown rice", BROWN, [ve("cucumber", 50), tp("parsley", 3)]),
      way("彩椒配烤土豆", "Peppers with a baked potato", BAKED_POTATO, [ve("romaine", 50)]),
      way("彩椒配藜麦", "Peppers over quinoa", QUINOA, [ve("cucumber", 50), tp("coriander", 3)]),
    ],
  }),
  dish({
    id: "steak_spinach_salad", zh: "牛排菠菜沙拉", en: "Seared steak and spinach salad", c: "american", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, BAKED_POTATO, "whole_wheat_toast"],
    i: [pr("sirloin_steak", 120), ve("spinach", 80), ve("cherry_tomato", 60), ve("red_onion", 20), oi("olive_oil", 4), se("rice_vinegar", 6), se("ground_black_pepper", 0.5), se("salt", 0.4)],
  }),
  dish({
    id: "tuna_cucumber_bowl", zh: "金枪鱼黄瓜沙拉碗", en: "Tuna and cucumber salad bowl", c: "american", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast", BAKED_POTATO],
    i: [pr("canned_tuna_water", 125), tp("greek_yogurt", 30), ve("cucumber", 60), ve("celery", 40), ve("romaine", 50), se("lemon", 8)],
  }),
  dish({
    id: "chicken_cobb_salad", zh: "鸡肉科布沙拉", en: "Chicken Cobb-style salad", c: "american", m: "assemble", eq: [], t: [10, 10],
    staples: ["whole_wheat_pita", QUINOA],
    i: [pr("ready_chicken_breast", 85), pr("egg", 65), ve("romaine", 90), ve("tomato", 60), fr("avocado", 30), oi("olive_oil", 3), se("rice_vinegar", 6)],
  }),
  dish({
    id: "salmon_asparagus_skillet", zh: "香煎三文鱼配芦笋", en: "Pan-seared salmon with asparagus", c: "american", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, QUINOA, BROWN],
    i: [pr("salmon", 120), ve("asparagus", 130), oi("olive_oil", 3), se("lemon", 8), se("lemon_pepper_seasoning", 1), se("salt", 0.2)],
  }),
  dish({
    id: "cajun_shrimp_zucchini", zh: "卡津虾炒西葫芦", en: "Cajun shrimp with zucchini", c: "american", m: "stir_fry", t: [12, 15],
    staples: [BROWN, GRAINS, PASTA],
    i: [pr("white_shrimp", 115), ve("zucchini", 130), ve("red_bell_pepper", 50), se("cajun_seasoning", 1.5), oi("olive_oil", 4)],
  }),
];

const MEDITERRANEAN: Dish[] = [
  dish({
    id: "lemon_herb_roast_chicken", zh: "柠檬香草烤鸡胸", en: "Lemon-herb roast chicken breast", c: "mediterranean", m: "roast", eq: ["oven"], t: [10, 40],
    i: [pr("chicken_breast", 108), ve("zucchini", 80), ve("red_onion", 40), se("lemon", 10), se("dried_oregano", 1), se("salt", 0.4), oi("olive_oil", 4)],
    ways: [
      way("烤鸡配藜麦和黄瓜番茄", "Chicken over quinoa with cucumber and tomato", QUINOA, [ve("cucumber", 60), ve("tomato", 50)]),
      way("烤鸡口袋饼配酸奶", "Chicken in pita with yogurt", "whole_wheat_pita", [tp("greek_yogurt", 25), ve("romaine", 50), ve("tomato", 40)]),
      way("烤鸡配烤小土豆和四季豆", "Chicken with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
    ],
  }),
  dish({
    id: "greek_lemon_chicken_soup", zh: "希腊柠檬鸡汤", en: "Greek-style lemon chicken soup", c: "mediterranean", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 100), ve("carrot", 50), ve("celery", 40), se("low_sodium_stock", 200), se("lemon", 20), tp("dill", 3)],
    ways: [
      way("汤配口袋饼和黄瓜番茄", "Soup with pita and a cucumber tomato plate", "whole_wheat_pita", [ve("cucumber", 60), ve("tomato", 50)]),
      way("汤泡饭配菠菜", "Soup over rice with spinach", RICE, [ve("frozen_spinach", 70)]),
      way("汤加全麦意面", "Soup with whole-wheat pasta", WW_PASTA, [ve("cherry_tomato", 60), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "chicken_chickpea_stew", zh: "鸡肉鹰嘴豆炖菜", en: "Chicken and chickpea stew", c: "mediterranean", m: "stew", t: [15, 45],
    i: [pr("chicken_breast", 100), st("canned_chickpeas", 60), ve("crushed_tomatoes", 100), ve("onion", 40), ve("carrot", 40), se("ground_cumin", 1), se("ground_cinnamon", 0.5), se("harissa", 5)],
    ways: [
      way("炖菜配藜麦和黄瓜", "Stew over quinoa with cucumber", QUINOA, [ve("cucumber", 60), tp("parsley", 3)]),
      way("炖菜口袋饼配酸奶", "Stew in pita with yogurt", "whole_wheat_pita", [tp("greek_yogurt", 30), ve("romaine", 50)]),
      way("炖菜糙米饭配菠菜", "Stew over brown rice with spinach", BROWN, [ve("frozen_spinach", 70), tp("lemon", 8)]),
    ],
  }),
  dish({
    id: "baked_turkey_kofta", zh: "烤火鸡肉丸", en: "Baked turkey kofta", c: "mediterranean", m: "bake", eq: ["oven"], t: [15, 35],
    i: [pr("ground_turkey", 125), ve("red_onion", 30), tp("parsley", 3), se("ground_cumin", 1.5), se("smoked_paprika", 1.5), se("garlic_powder", 1), se("salt", 0.4)],
    ways: [
      way("肉丸口袋饼配黄瓜酸奶", "Kofta in pita with cucumber yogurt", "whole_wheat_pita", [tp("greek_yogurt", 25), ve("cucumber", 70), ve("tomato", 40)]),
      way("肉丸藜麦配番茄沙拉", "Kofta over quinoa with tomato salad", QUINOA, [ve("cherry_tomato", 70), ve("cucumber", 50), tp("mint", 2)]),
      way("肉丸米饭配紫甘蓝", "Kofta over rice with red cabbage", RICE, [ve("red_cabbage", 70), tp("lemon", 8)]),
    ],
  }),
  dish({
    id: "lemon_dill_roast_salmon", zh: "柠檬莳萝烤三文鱼", en: "Lemon-dill roast salmon", c: "mediterranean", m: "roast", eq: ["oven"], t: [10, 25],
    i: [pr("salmon", 120), ve("cherry_tomato", 70), ve("zucchini", 60), se("lemon", 10), tp("dill", 3), oi("olive_oil", 2), se("salt", 0.3)],
    ways: [
      way("三文鱼配烤小土豆和四季豆", "Salmon with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
      way("三文鱼藜麦沙拉", "Salmon over a quinoa salad", QUINOA, [ve("cucumber", 60), ve("romaine", 40)]),
      way("三文鱼冷意面", "Salmon with cold whole-wheat pasta", WW_PASTA, [ve("cucumber", 60), ve("spinach", 50)]),
    ],
  }),
  dish({
    id: "tomato_baked_cod", zh: "番茄烤鳕鱼", en: "Tomato baked cod", c: "mediterranean", m: "bake", eq: ["oven"], t: [10, 30],
    i: [pr("cod", 140), ve("crushed_tomatoes", 100), ve("onion", 40), ve("zucchini", 50), se("dried_oregano", 1), oi("olive_oil", 4), se("salt", 0.3)],
    ways: [
      way("烤鳕鱼拌意面", "Cod over pasta with a green salad", PASTA, [ve("romaine", 60)]),
      way("烤鳕鱼糙米饭配西兰花", "Cod over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("烤鳕鱼口袋饼", "Cod in pita with cucumber and yogurt", "whole_wheat_pita", [ve("cucumber", 60), tp("greek_yogurt", 20)]),
    ],
  }),
  dish({
    id: "lentil_tomato_stew", zh: "番茄扁豆炖菜", en: "Lentil and tomato stew with feta", c: "mediterranean", m: "stew", t: [12, 45],
    i: [st("lentils_dry", 75), ve("crushed_tomatoes", 100), ve("carrot", 50), ve("onion", 40), ve("celery", 30), se("low_sodium_stock", 150), se("ground_cumin", 1), se("dried_oregano", 1), tp("feta", 15), se("lemon", 8)],
    ways: [
      way("扁豆炖菜口袋饼配酸奶", "Stew in pita with yogurt and cucumber", "whole_wheat_pita", [tp("greek_yogurt", 30), ve("cucumber", 60)]),
      way("扁豆炖菜糙米饭配菠菜", "Stew over brown rice with spinach", BROWN, [ve("frozen_spinach", 70)]),
      way("扁豆炖菜烤土豆配菲达", "Stew on a baked potato with feta", BAKED_POTATO, [tp("feta", 10), ve("cherry_tomato", 50)]),
    ],
  }),
  dish({
    id: "harissa_chicken_traybake", zh: "哈里萨烤鸡腿", en: "Harissa chicken thigh traybake", c: "mediterranean", m: "roast", eq: ["oven"], t: [10, 45],
    i: [pr("chicken_thigh", 125), ve("red_bell_pepper", 60), ve("zucchini", 50), ve("red_onion", 40), se("harissa", 8), se("ground_cumin", 1), oi("olive_oil", 2), se("salt", 0.3)],
    ways: [
      way("鸡腿藜麦配黄瓜", "Chicken over quinoa with cucumber", QUINOA, [ve("cucumber", 60), tp("parsley", 3)]),
      way("鸡腿口袋饼配酸奶", "Chicken in pita with yogurt", "whole_wheat_pita", [tp("greek_yogurt", 25), ve("romaine", 50), ve("tomato", 40)]),
      way("鸡腿配烤小土豆和沙拉", "Chicken with roasted potatoes and salad", BABY_POTATOES, [ve("romaine", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "greek_beef_stifado", zh: "希腊炖牛肉", en: "Greek beef stifado", c: "mediterranean", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 75],
    i: [pr("beef_shank_raw", 105), ve("onion", 70), ve("crushed_tomatoes", 100), se("ground_cinnamon", 0.5), se("dried_oregano", 1), se("low_sodium_stock", 80), se("salt", 0.4)],
    ways: [
      way("炖牛肉拌意面", "Stifado over pasta with salad", PASTA, [ve("romaine", 50), ve("cucumber", 40)]),
      way("炖牛肉配烤小土豆和四季豆", "Stifado with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
      way("炖牛肉糙米饭配西兰花", "Stifado over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "shakshuka", zh: "番茄红椒煎蛋", en: "Shakshuka with feta", c: "mediterranean", m: "pan_fry", t: [12, 20],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("egg", 110), pr("egg_white", 40), tp("feta", 8), ve("crushed_tomatoes", 100), ve("red_bell_pepper", 70), ve("onion", 30), se("smoked_paprika", 1.5), oi("olive_oil", 2)],
  }),
  dish({
    id: "greek_chicken_salad", zh: "希腊鸡肉沙拉", en: "Greek chicken salad", c: "mediterranean", m: "assemble", eq: [], t: [10, 10],
    staples: ["whole_wheat_pita", QUINOA, BABY_POTATOES],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 70), ve("tomato", 70), ve("red_onion", 20), tp("feta", 15), oi("olive_oil", 3), se("dried_oregano", 1), se("lemon", 8)],
  }),
  dish({
    id: "tuna_chickpea_salad", zh: "金枪鱼鹰嘴豆沙拉", en: "Tuna and chickpea salad", c: "mediterranean", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_pita", "whole_wheat_toast"],
    i: [pr("canned_tuna_water", 110), st("canned_chickpeas", 60), ve("cucumber", 60), ve("cherry_tomato", 60), ve("red_onion", 20), oi("olive_oil", 3), se("lemon", 10), tp("parsley", 3)],
  }),
  dish({
    id: "tomato_shrimp_feta_skillet", zh: "番茄菲达虾", en: "Tomato and feta shrimp skillet", c: "mediterranean", m: "stir_fry", t: [12, 18],
    staples: [PASTA, QUINOA, BROWN],
    i: [pr("white_shrimp", 110), tp("feta", 10), ve("crushed_tomatoes", 100), ve("zucchini", 60), se("dried_oregano", 1), oi("olive_oil", 3)],
  }),
  dish({
    id: "lemon_seared_cod", zh: "柠檬香煎鳕鱼", en: "Lemon pan-seared cod with tomatoes", c: "mediterranean", m: "pan_fry", t: [12, 15],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("cod", 140), ve("cherry_tomato", 100), ve("zucchini", 60), oi("olive_oil", 4), se("lemon", 10), tp("parsley", 3), se("salt", 0.4)],
  }),
];

const ITALIAN: Dish[] = [
  dish({
    id: "turkey_meatballs_marinara", zh: "烤火鸡肉丸配番茄酱", en: "Baked turkey meatballs in marinara", c: "italian", m: "bake", eq: ["oven"], t: [18, 40],
    i: [pr("ground_turkey", 105), pr("egg_white", 40), ve("crushed_tomatoes", 150), ve("onion", 30), se("breadcrumbs", 8), se("italian_seasoning", 1.5), se("dried_oregano", 1), tp("basil", 3)],
    ways: [
      way("肉丸意面", "Meatballs with spaghetti and salad", PASTA, [ve("romaine", 50)]),
      way("肉丸配西葫芦", "Meatballs over sauteed zucchini", null, [ve("zucchini", 150)], 5),
      way("肉丸配吐司和菠菜", "Meatballs on toast with spinach", "white_toast", [ve("spinach", 60)]),
    ],
  }),
  dish({
    id: "chicken_cacciatore", zh: "猎人炖鸡", en: "Chicken cacciatore", c: "italian", m: "braise", t: [15, 45],
    i: [pr("chicken_breast", 108), ve("crushed_tomatoes", 100), ve("red_bell_pepper", 50), ve("button_mushroom", 50), ve("onion", 30), se("dried_oregano", 1), se("italian_seasoning", 1.5), oi("olive_oil", 3), se("salt", 0.2)],
    ways: [
      way("炖鸡拌全麦意面", "Cacciatore over whole-wheat pasta", WW_PASTA, [ve("romaine", 50)]),
      way("炖鸡配烤吐司和菠菜", "Cacciatore with toast and spinach", "white_toast", [ve("spinach", 60)]),
      way("炖鸡配烤土豆", "Cacciatore on a baked potato with broccoli", BAKED_POTATO, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "beef_ragu", zh: "牛肉肉酱", en: "Beef ragu", c: "italian", m: "stew", t: [15, 60],
    i: [pr("lean_beef_mince", 115), ve("crushed_tomatoes", 140), ve("onion", 30), ve("carrot", 30), ve("celery", 20), se("italian_seasoning", 1.5), se("dried_oregano", 1), se("salt", 0.2)],
    ways: [
      way("肉酱意面配西葫芦", "Ragu with spaghetti and sauteed zucchini", PASTA, [ve("zucchini", 70)]),
      way("肉酱全麦意面配沙拉", "Ragu with whole-wheat pasta and salad", WW_PASTA, [ve("cherry_tomato", 40), ve("romaine", 50)]),
      way("肉酱烤土豆配奶酪", "Ragu on a baked potato with mozzarella", BAKED_POTATO, [tp("mozzarella", 15), ve("frozen_broccoli", 80)]),
    ],
  }),
  dish({
    id: "chicken_mushroom_ragu", zh: "鸡肉蘑菇肉酱", en: "Chicken and mushroom ragu", c: "italian", m: "stew", t: [15, 45],
    i: [pr("chicken_mince", 140), ve("button_mushroom", 100), ve("crushed_tomatoes", 100), ve("onion", 30), se("italian_seasoning", 1.5), oi("olive_oil", 2), se("salt", 0.2)],
    ways: [
      way("肉酱全麦意面配西葫芦", "Ragu with whole-wheat pasta and zucchini", WW_PASTA, [ve("zucchini", 70)]),
      way("肉酱藜麦配菠菜", "Ragu over quinoa with spinach", QUINOA, [ve("spinach", 60)]),
      way("肉酱吐司配番茄", "Ragu on toast with tomato and salad", "white_toast", [ve("romaine", 50), ve("cherry_tomato", 50)]),
    ],
  }),
  dish({
    id: "chicken_minestrone", zh: "意式鸡肉蔬菜浓汤", en: "Chicken and vegetable minestrone", c: "italian", m: "simmer", t: [15, 45],
    i: [pr("chicken_breast", 90), ve("crushed_tomatoes", 80), ve("carrot", 40), ve("celery", 30), ve("zucchini", 40), se("low_sodium_stock", 100), tp("basil", 3), se("italian_seasoning", 1), se("salt", 0.3)],
    ways: [
      way("浓汤配全麦吐司", "Minestrone with whole-wheat toast and salad", "whole_wheat_toast", [ve("romaine", 50)]),
      way("浓汤加全麦意面", "Minestrone with whole-wheat pasta", WW_PASTA, [ve("frozen_spinach", 70)]),
      way("浓汤泡饭配豌豆", "Minestrone over rice with peas", RICE, [ve("frozen_peas", 60)]),
    ],
  }),
  dish({
    id: "chicken_pizzaiola", zh: "番茄奶酪烤鸡胸", en: "Chicken pizzaiola", c: "italian", m: "bake", eq: ["oven"], t: [12, 35],
    i: [pr("chicken_breast", 105), ve("crushed_tomatoes", 120), ve("onion", 30), ve("red_bell_pepper", 40), se("dried_oregano", 1), oi("olive_oil", 3), tp("mozzarella", 20), se("salt", 0.2)],
    ways: [
      way("烤鸡配意面和沙拉", "Pizzaiola over pasta with salad", PASTA, [ve("romaine", 60)]),
      way("烤鸡配烤吐司和菠菜", "Pizzaiola on toast with spinach", "whole_wheat_toast", [ve("spinach", 60)]),
      way("烤鸡配烤小土豆和四季豆", "Pizzaiola with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
    ],
  }),
  dish({
    id: "herb_roast_pork_tenderloin", zh: "香草烤猪里脊", en: "Herb-roasted pork tenderloin", c: "italian", m: "roast", eq: ["oven"], t: [10, 40],
    i: [pr("pork_tenderloin", 120), ve("red_bell_pepper", 60), ve("zucchini", 60), ve("red_onion", 30), se("italian_seasoning", 1.5), se("dried_oregano", 0.5), oi("olive_oil", 3), se("salt", 0.3), se("lemon", 8)],
    ways: [
      way("猪里脊配烤小土豆和四季豆", "Pork with roasted potatoes and green beans", BABY_POTATOES, [ve("frozen_green_beans", 90)]),
      way("猪里脊拌全麦意面", "Pork with whole-wheat pasta and tomatoes", WW_PASTA, [ve("cherry_tomato", 60), ve("romaine", 40)]),
      way("猪里脊藜麦配菠菜", "Pork over quinoa with spinach", QUINOA, [ve("spinach", 60)]),
    ],
  }),
  dish({
    id: "italian_lentil_soup", zh: "意式扁豆汤", en: "Italian lentil soup", c: "italian", m: "simmer", t: [12, 45],
    i: [st("lentils_dry", 90), ve("crushed_tomatoes", 80), ve("carrot", 50), ve("celery", 40), ve("onion", 40), se("low_sodium_stock", 250), se("dried_oregano", 1), tp("parsley", 3), se("salt", 0.3)],
    ways: [
      way("扁豆汤配全麦吐司", "Soup with whole-wheat toast and salad", "whole_wheat_toast", [ve("romaine", 50), ve("tomato", 40)]),
      way("扁豆汤加全麦意面", "Soup with whole-wheat pasta and spinach", WW_PASTA, [ve("frozen_spinach", 70)]),
      way("扁豆汤配藜麦沙拉", "Soup with a cool quinoa salad", QUINOA, [ve("cherry_tomato", 60), ve("cucumber", 40)]),
    ],
  }),
  dish({
    id: "chicken_meatball_spinach_soup", zh: "鸡肉丸菠菜汤", en: "Chicken meatball and spinach soup", c: "italian", m: "simmer", t: [18, 40],
    i: [pr("chicken_mince", 100), pr("egg_white", 45), se("breadcrumbs", 8), ve("frozen_spinach", 80), ve("carrot", 40), ve("onion", 30), se("low_sodium_stock", 100), se("italian_seasoning", 1), se("salt", 0.3)],
    ways: [
      way("肉丸汤加全麦意面", "Soup with small pasta", WW_PASTA, [ve("romaine", 50)]),
      way("肉丸汤配吐司和番茄", "Soup with toast and tomato", "whole_wheat_toast", [ve("cherry_tomato", 60)]),
      way("肉丸汤泡饭配豌豆", "Soup over rice with peas", RICE, [ve("frozen_peas", 60)]),
    ],
  }),
  dish({
    id: "shrimp_tomato_basil_pasta", zh: "番茄罗勒鲜虾", en: "Shrimp with cherry tomatoes and basil", c: "italian", m: "stir_fry", t: [12, 18],
    staples: [PASTA, WW_PASTA],
    i: [pr("white_shrimp", 115), ve("cherry_tomato", 110), ve("zucchini", 60), tp("basil", 4), oi("olive_oil", 4), se("garlic_paste", 2), se("salt", 0.2)],
  }),
  dish({
    id: "lemon_mushroom_chicken", zh: "柠檬蘑菇煎鸡胸", en: "Lemon chicken with mushrooms and spinach", c: "italian", m: "pan_fry", t: [12, 18],
    staples: [PASTA, BABY_POTATOES, BAKED_POTATO],
    i: [pr("chicken_breast", 108), ve("button_mushroom", 100), ve("spinach", 60), se("lemon", 12), tp("parsley", 3), oi("olive_oil", 4), se("salt", 0.4), se("low_sodium_stock", 30)],
  }),
  dish({
    id: "caprese_chicken_plate", zh: "卡布里斯鸡肉拼盘", en: "Caprese chicken plate", c: "italian", m: "assemble", eq: [], t: [8, 8],
    staples: ["whole_wheat_toast", QUINOA],
    i: [pr("ready_chicken_breast", 100), tp("mozzarella", 25), ve("tomato", 130), tp("basil", 4), oi("olive_oil", 3), se("lemon", 5)],
  }),
  dish({
    id: "tuna_tomato_spaghetti_sauce", zh: "金枪鱼番茄酱", en: "Tuna and tomato sauce", c: "italian", m: "stir_fry", t: [10, 15],
    staples: [PASTA, WW_PASTA],
    i: [pr("canned_tuna_water", 100), ve("crushed_tomatoes", 100), ve("zucchini", 50), tp("basil", 3), oi("olive_oil", 3), se("dried_oregano", 0.5), se("garlic_paste", 2)],
  }),
  dish({
    id: "pork_pepper_medallions", zh: "彩椒煎猪里脊", en: "Pork medallions with peppers and zucchini", c: "italian", m: "pan_fry", t: [12, 18],
    staples: [BABY_POTATOES, QUINOA, WW_PASTA],
    i: [pr("pork_tenderloin", 118), ve("red_bell_pepper", 70), ve("zucchini", 70), oi("olive_oil", 4), se("italian_seasoning", 1), se("salt", 0.3), se("lemon", 6)],
  }),
];

const MAINS: Dish[] = [...AMERICAN, ...MEDITERRANEAN, ...ITALIAN];

export const SEED_DISHES: readonly Dish[] = [...MAINS, ...SIDES, ...STAPLES, ...BREAKFASTS];
