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

const CHINESE: Dish[] = [
  dish({
    id: "tomato_braised_beef_shank", zh: "番茄炖牛腱", en: "Tomato braised beef shank", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 60],
    i: [pr("beef_shank_raw", 105), ve("tomato", 220), ve("carrot", 50), ve("onion", 40), se("garlic_paste", 3), se("ginger_paste", 3), se("reduced_salt_soy_sauce", 5), oi("canola_oil", 3)],
    ways: [
      way("牛腱配米饭和焯上海青", "Beef over rice with blanched bok choy", RICE, [ve("bok_choy", 100)]),
      way("牛腱拌面配焯菜心", "Beef with noodles and blanched choy sum", "fresh_noodles", [ve("choy_sum", 100)]),
      way("牛腱配馒头和拍黄瓜", "Beef with a steamed bun and cucumber", "steamed_bun", [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "shiitake_braised_chicken", zh: "香菇黄焖鸡", en: "Shiitake braised chicken thighs", c: "chinese", m: "stew", t: [15, 40],
    i: [pr("chicken_thigh", 120), ve("shiitake", 80), ve("green_pepper", 70), se("oyster_sauce", 5), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("canola_oil", 3)],
    ways: [
      way("黄焖鸡配糙米饭和上海青", "Chicken over brown rice with bok choy", BROWN, [ve("bok_choy", 100)]),
      way("黄焖鸡配糯玉米和黄瓜", "Chicken with waxy corn and cucumber", CORN, [ve("cucumber", 80)]),
      way("黄焖鸡配杂粮饭和西兰花", "Chicken over multigrain rice with broccoli", GRAINS, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "yam_wood_ear_chicken", zh: "山药木耳炖鸡", en: "Chicken stew with yam and wood ear", c: "chinese", m: "stew", t: [15, 45],
    i: [pr("chicken_thigh", 115), ve("chinese_yam", 120), ve("wood_ear", 60), ve("shiitake", 40), se("reduced_salt_soy_sauce", 4), se("ginger_paste", 3)],
    ways: [
      way("炖鸡配米饭和芥蓝", "Stew over rice with blanched gai lan", RICE, [ve("gai_lan", 100)]),
      way("炖鸡配小米饭和菜心", "Stew over millet rice with choy sum", MILLET, [ve("choy_sum", 100)]),
      way("炖鸡配馒头和黄瓜", "Stew with a steamed bun and cucumber", "steamed_bun", [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "potato_soy_braised_chicken", zh: "土豆烧鸡", en: "Soy-braised chicken with potato", c: "chinese", m: "braise", t: [15, 40],
    i: [pr("chicken_thigh", 115), st("potato", 100), ve("onion", 40), ve("carrot", 50), se("reduced_salt_soy_sauce", 5), se("oyster_sauce", 3), se("five_spice_powder", 0.5), se("ginger_paste", 2)],
    ways: [
      way("土豆烧鸡配焯上海青", "Chicken and potato with blanched bok choy", null, [ve("bok_choy", 100)]),
      way("土豆烧鸡配米饭和拍黄瓜", "Chicken and potato over rice with cucumber", RICE, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "radish_beef_stew", zh: "白萝卜炖牛腱", en: "Beef shank and white radish stew", c: "chinese", m: "pressure_cook", eq: ["pressure_cooker"], t: [15, 60],
    i: [pr("beef_shank_raw", 105), ve("white_radish", 200), ve("carrot", 40), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("five_spice_powder", 0.5), se("ginger_paste", 3)],
    ways: [
      way("炖牛腱配米饭和菜心", "Stew over rice with choy sum", RICE, [ve("choy_sum", 100)]),
      way("炖牛腱拌面配上海青", "Stew with noodles and bok choy", "fresh_noodles", [ve("bok_choy", 100)]),
      way("炖牛腱配糯玉米和黄瓜", "Stew with waxy corn and cucumber", CORN, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "winter_melon_chicken_meatball_soup", zh: "冬瓜鸡肉丸汤", en: "Winter melon and chicken meatball soup", c: "chinese", m: "simmer", t: [18, 40],
    i: [pr("chicken_mince", 125), ve("winter_melon", 200), ve("shiitake", 30), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("sesame_oil", 2), se("low_sodium_stock", 150)],
    ways: [
      way("肉丸汤配米饭和上海青", "Soup with rice and bok choy", RICE, [ve("bok_choy", 100)]),
      way("肉丸汤配杂粮饭和芥蓝", "Soup with multigrain rice and gai lan", GRAINS, [ve("gai_lan", 100)]),
      way("肉丸汤下面条", "Soup with noodles and choy sum", "fresh_noodles", [ve("choy_sum", 100)]),
    ],
  }),
  dish({
    id: "steamed_chicken_shiitake", zh: "香菇蒸鸡", en: "Steamed chicken with shiitake and wood ear", c: "chinese", m: "steam", eq: ["steamer"], t: [12, 30],
    i: [pr("chicken_thigh", 120), ve("shiitake", 80), ve("wood_ear", 40), se("oyster_sauce", 4), se("reduced_salt_soy_sauce", 3), se("ginger_paste", 3), oi("sesame_oil", 2)],
    ways: [
      way("蒸鸡配糙米饭和菜心", "Chicken over brown rice with choy sum", BROWN, [ve("choy_sum", 100)]),
      way("蒸鸡配蒸红薯和上海青", "Chicken with steamed sweet potato and bok choy", SWEET_POTATO, [ve("bok_choy", 100)]),
      way("蒸鸡配馒头和拍黄瓜", "Chicken with a steamed bun and cucumber", "steamed_bun", [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "beef_mapo_tofu", zh: "牛肉麻婆豆腐", en: "Mapo tofu with beef and peppers", c: "chinese", m: "stew", t: [12, 20],
    i: [pr("lean_beef_mince", 85), pr("soft_tofu", 120), ve("green_pepper", 100), se("mapo_sauce", 12), se("doubanjiang", 3), se("sichuan_pepper_powder", 1)],
    ways: [
      way("麻婆豆腐配米饭和上海青", "Mapo tofu over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("麻婆豆腐配糙米饭和西兰花", "Mapo tofu over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("麻婆豆腐配杂粮饭和芥蓝", "Mapo tofu over multigrain rice with gai lan", GRAINS, [ve("gai_lan", 100)]),
    ],
  }),
  dish({
    id: "five_spice_braised_chicken", zh: "五香卤鸡胸", en: "Five-spice braised chicken breast", c: "chinese", m: "braise", t: [10, 40],
    i: [pr("chicken_breast", 108), ve("carrot", 60), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("five_spice_powder", 1), se("ginger_paste", 3)],
    ways: [
      way("卤鸡配米饭和菜心", "Chicken over rice with choy sum", RICE, [ve("choy_sum", 100)]),
      way("卤鸡拌面配上海青", "Chicken with noodles and bok choy", "fresh_noodles", [ve("bok_choy", 100)]),
      way("手撕卤鸡凉拌黄瓜", "Shredded chicken with sesame cucumber salad", null, [ve("cucumber", 110), tp("sesame_seeds", 3)], 5),
    ],
  }),
  dish({
    id: "tomato_shrimp_egg_stirfry", zh: "番茄虾仁炒蛋", en: "Tomato, shrimp and scrambled eggs", c: "chinese", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("egg", 55), pr("white_shrimp", 85), ve("tomato", 150), se("reduced_salt_soy_sauce", 3), oi("canola_oil", 5)],
  }),
  dish({
    id: "kung_pao_chicken", zh: "宫保鸡丁", en: "Kung pao chicken", c: "chinese", m: "stir_fry", t: [15, 20],
    staples: [RICE, BROWN, MILLET],
    i: [pr("chicken_breast", 105), tp("peanuts", 8), ve("green_pepper", 60), ve("carrot", 50), ve("celery", 50), se("reduced_salt_soy_sauce", 4), se("black_vinegar", 4), se("white_sugar", 3), se("chili_sauce", 3), oi("canola_oil", 4)],
  }),
  dish({
    id: "green_pepper_pork_strips", zh: "青椒肉丝", en: "Pork strips with peppers", c: "chinese", m: "stir_fry", t: [12, 15],
    staples: [RICE, GRAINS, SWEET_POTATO],
    i: [pr("lean_pork_leg", 115), ve("green_pepper", 100), ve("red_bell_pepper", 50), se("reduced_salt_soy_sauce", 3), se("oyster_sauce", 3), se("garlic_paste", 3), oi("canola_oil", 5)],
  }),
  dish({
    id: "steamed_cod_shiitake", zh: "清蒸鳕鱼香菇", en: "Steamed cod with shiitake and bok choy", c: "chinese", m: "steam", eq: ["steamer"], t: [10, 20],
    staples: [RICE, MILLET, CORN],
    i: [pr("cod", 135), ve("shiitake", 60), ve("bok_choy", 90), se("reduced_salt_soy_sauce", 5), se("ginger_paste", 3), oi("sesame_oil", 3)],
  }),
  dish({
    id: "sesame_chicken_cucumber_salad", zh: "麻酱鸡丝拌黄瓜", en: "Sesame chicken and cucumber salad", c: "chinese", m: "assemble", eq: [], t: [10, 10],
    staples: [RICE, "steamed_bun", SWEET_POTATO],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 130), ve("red_cabbage", 40), oi("sesame_paste", 8), se("reduced_salt_soy_sauce", 3), se("black_vinegar", 4)],
  }),
];

const MEXICAN: Dish[] = [
  dish({
    id: "salsa_shredded_chicken", zh: "莎莎手撕鸡", en: "Slow-cooker salsa chicken", c: "mexican", m: "slow_cook", eq: ["slow_cooker"], t: [10, 300],
    i: [pr("chicken_breast", 110), ve("crushed_tomatoes", 80), ve("onion", 40), ve("green_pepper", 40), se("taco_seasoning", 2.5), se("lime", 8)],
    ways: [
      way("鸡肉玉米饼塔可", "Chicken tacos in corn tortillas", "corn_tortilla", [ve("cabbage", 60), tp("coriander", 3), tp("lime", 8)]),
      way("鸡肉墨西哥饭碗", "Chicken burrito bowl over brown rice", BROWN, [ve("frozen_corn", 60), ve("tomato", 50), fr("avocado", 30)]),
      way("鸡肉烤土豆配酸奶", "Chicken on a baked potato with yogurt", BAKED_POTATO, [tp("greek_yogurt", 25), ve("romaine", 60), tp("coriander", 3)]),
    ],
  }),
  dish({
    id: "orange_carnitas_pork", zh: "橙香手撕猪肉", en: "Orange carnitas-style pork", c: "mexican", m: "slow_cook", eq: ["slow_cooker"], t: [10, 420],
    i: [pr("lean_pork_leg", 120), ve("onion", 50), fr("orange", 40), se("ground_cumin", 1.5), se("dried_oregano", 1), se("lime", 8), se("salt", 0.4)],
    ways: [
      way("猪肉玉米饼塔可", "Carnitas tacos with cabbage and lime", "corn_tortilla", [ve("cabbage", 60), tp("coriander", 3), tp("lime", 8)]),
      way("猪肉饭碗配菠萝", "Carnitas rice bowl with pineapple", BROWN, [ve("tomato", 65), fr("pineapple", 60)]),
      way("猪肉生菜卷", "Carnitas lettuce wraps", null, [ve("romaine", 100), ve("cherry_tomato", 50)], 5),
    ],
  }),
  dish({
    id: "beef_barbacoa", zh: "墨西哥炖牛腱", en: "Beef barbacoa", c: "mexican", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 75],
    i: [pr("beef_shank_raw", 105), ve("onion", 50), ve("crushed_tomatoes", 60), se("chili_powder_blend", 2), se("ground_cumin", 1), se("dried_oregano", 1), se("lime", 8), se("salt", 0.3)],
    ways: [
      way("牛肉玉米饼塔可", "Barbacoa tacos with red cabbage", "corn_tortilla", [ve("red_cabbage", 60), tp("coriander", 3)]),
      way("牛肉烤红薯配酸奶", "Barbacoa on sweet potato with yogurt", SWEET_POTATO, [ve("cabbage", 60), tp("greek_yogurt", 20)]),
      way("牛肉糙米饭配玉米", "Barbacoa over brown rice with corn", BROWN, [ve("frozen_corn", 60), ve("romaine", 50)]),
    ],
  }),
  dish({
    id: "turkey_taco_meat", zh: "火鸡塔可肉酱", en: "Turkey taco meat", c: "mexican", m: "stew", t: [12, 30],
    i: [pr("ground_turkey", 125), ve("crushed_tomatoes", 80), ve("onion", 40), ve("red_bell_pepper", 40), se("taco_seasoning", 3)],
    ways: [
      way("肉酱玉米饼塔可", "Tacos in corn tortillas with lettuce", "corn_tortilla", [ve("romaine", 60), ve("tomato", 50)]),
      way("肉酱糙米饭碗", "Taco rice bowl with corn", BROWN, [ve("frozen_corn", 50), ve("cucumber", 60)]),
      way("肉酱烤土豆配奶酪", "Taco baked potato with cheese", BAKED_POTATO, [tp("mozzarella", 15), ve("romaine", 60)]),
    ],
  }),
  dish({
    id: "chicken_tortilla_soup", zh: "墨西哥鸡肉玉米汤", en: "Chicken tortilla soup", c: "mexican", m: "simmer", t: [12, 40],
    i: [pr("chicken_breast", 95), st("frozen_corn", 40), ve("crushed_tomatoes", 80), ve("onion", 30), ve("green_pepper", 30), se("low_sodium_stock", 150), se("taco_seasoning", 2), se("lime", 8), tp("coriander", 3)],
    ways: [
      way("汤配玉米饼脆片和牛油果", "Soup with tortilla strips and avocado", "corn_tortilla", [fr("avocado", 30), ve("romaine", 50)]),
      way("汤泡饭配紫甘蓝", "Soup over rice with red cabbage", RICE, [ve("cherry_tomato", 50), ve("cabbage", 50)]),
    ],
  }),
  dish({
    id: "shrimp_fajita_skillet", zh: "虾仁法吉塔", en: "Shrimp fajita skillet", c: "mexican", m: "stir_fry", t: [12, 18],
    staples: ["corn_tortilla", "whole_wheat_tortilla", BROWN],
    i: [pr("white_shrimp", 115), ve("red_bell_pepper", 70), ve("green_pepper", 50), ve("onion", 40), se("fajita_seasoning", 2.5), se("lime", 8), oi("canola_oil", 4)],
  }),
  dish({
    id: "fish_tacos_cabbage", zh: "鱼肉卷心菜塔可", en: "Fish tacos with cabbage", c: "mexican", m: "pan_fry", t: [12, 15],
    staples: ["corn_tortilla", BROWN],
    i: [pr("frozen_tilapia_fillet", 135), ve("cabbage", 80), ve("red_cabbage", 30), ve("tomato", 40), se("lime", 10), tp("coriander", 3), se("taco_seasoning", 1.5), oi("canola_oil", 3)],
  }),
  dish({
    id: "chicken_burrito_bowl", zh: "鸡肉黑豆饭碗", en: "Chicken and black bean burrito bowl", c: "mexican", m: "assemble", eq: [], t: [8, 8],
    staples: [BROWN, RICE, "whole_wheat_tortilla"],
    i: [pr("ready_chicken_breast", 100), st("canned_black_beans", 50), ve("tomato", 60), ve("romaine", 60), ve("red_onion", 15), fr("avocado", 30), se("lime", 8), tp("coriander", 3)],
  }),
];

const JAPANESE: Dish[] = [
  dish({
    id: "baked_teriyaki_chicken", zh: "烤照烧鸡胸", en: "Baked teriyaki chicken", c: "japanese", m: "bake", eq: ["oven"], t: [10, 35],
    i: [pr("chicken_breast", 108), ve("onion", 40), se("teriyaki_sauce", 12), tp("sesame_seeds", 2)],
    ways: [
      way("照烧鸡配米饭和西兰花", "Teriyaki chicken over rice with broccoli", RICE, [ve("frozen_broccoli", 90)]),
      way("照烧鸡拌荞麦面配黄瓜", "Teriyaki chicken with soba and cucumber", SOBA, [ve("cucumber", 80)]),
      way("照烧鸡配糙米饭和菠菜", "Teriyaki chicken over brown rice with spinach", BROWN, [ve("frozen_spinach", 70)]),
    ],
  }),
  dish({
    id: "nikujaga", zh: "土豆炖牛肉", en: "Nikujaga beef and potato simmer", c: "japanese", m: "simmer", t: [15, 40],
    i: [pr("lean_beef", 110), st("potato", 100), ve("onion", 50), ve("carrot", 40), se("reduced_salt_soy_sauce", 4), se("mirin", 5), se("low_sodium_stock", 100)],
    ways: [
      way("炖肉配米饭和菠菜", "Simmer over rice with spinach", RICE, [ve("frozen_spinach", 70)]),
      way("炖肉配焯上海青", "Simmer with blanched bok choy", null, [ve("bok_choy", 100)]),
      way("炖肉配糙米饭和黄瓜", "Simmer over brown rice with cucumber", BROWN, [ve("cucumber", 80)]),
    ],
  }),
  dish({
    id: "miso_pork_cabbage_stew", zh: "味噌猪肉卷心菜煲", en: "Miso pork and cabbage stew", c: "japanese", m: "braise", t: [12, 35],
    i: [pr("lean_pork_leg", 120), ve("cabbage", 120), ve("onion", 30), se("miso", 8), se("mirin", 3), se("ginger_paste", 2), se("low_sodium_stock", 80)],
    ways: [
      way("味噌煲配米饭和黄瓜", "Stew over rice with cucumber", RICE, [ve("cucumber", 80)]),
      way("味噌煲配糙米饭和西兰花", "Stew over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("味噌煲配荞麦面和上海青", "Stew with soba and bok choy", SOBA, [ve("bok_choy", 100)]),
    ],
  }),
  dish({
    id: "japanese_chicken_curry", zh: "日式咖喱鸡", en: "Japanese chicken curry", c: "japanese", m: "stew", t: [15, 40],
    i: [pr("chicken_breast", 100), st("potato", 60), ve("carrot", 50), ve("onion", 50), se("curry_roux", 8), se("low_sodium_stock", 150)],
    ways: [
      way("咖喱配米饭和黄瓜", "Curry over rice with cucumber", RICE, [ve("cucumber", 70)]),
      way("咖喱配糙米饭和西兰花", "Curry over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("咖喱拌荞麦面配菠菜", "Curry over soba with spinach", SOBA, [ve("frozen_spinach", 70)]),
    ],
  }),
  dish({
    id: "chicken_soboro", zh: "鸡肉松", en: "Chicken soboro (simmered mince)", c: "japanese", m: "simmer", t: [12, 20],
    i: [pr("chicken_mince", 140), ve("onion", 30), se("reduced_salt_soy_sauce", 5), se("mirin", 5), se("ginger_paste", 3)],
    ways: [
      way("鸡肉松盖饭配上海青", "Soboro rice bowl with bok choy", RICE, [ve("bok_choy", 100)]),
      way("鸡肉松糙米饭配菠菜黄瓜", "Soboro over brown rice with spinach and cucumber", BROWN, [ve("frozen_spinach", 70), ve("cucumber", 40)]),
      way("鸡肉松拌荞麦面", "Soboro over soba with cucumber and sesame", SOBA, [ve("cucumber", 100), tp("sesame_seeds", 3)]),
    ],
  }),
  dish({
    id: "miso_salmon_bok_choy", zh: "味噌煎三文鱼配上海青", en: "Miso salmon with bok choy", c: "japanese", m: "pan_fry", t: [12, 18],
    staples: [RICE, BROWN, SOBA],
    i: [pr("salmon", 120), se("miso", 8), se("mirin", 3), ve("bok_choy", 120), oi("canola_oil", 2)],
  }),
  dish({
    id: "cold_soba_chicken", zh: "凉荞麦面鸡丝", en: "Cold soba with chicken and cucumber", c: "japanese", m: "assemble", eq: [], t: [10, 10],
    staples: [SOBA],
    i: [pr("ready_chicken_breast", 105), ve("cucumber", 120), ve("nori", 1), tp("sesame_seeds", 3), se("reduced_salt_soy_sauce", 4), se("rice_vinegar", 4), oi("sesame_oil", 2)],
  }),
];

const SOUTHEAST_ASIAN: Dish[] = [
  dish({
    id: "thai_red_curry_chicken", zh: "泰式红咖喱鸡", en: "Thai red curry chicken", c: "southeast_asian", m: "stew", t: [12, 30],
    i: [pr("chicken_breast", 105), ve("zucchini", 60), ve("red_bell_pepper", 40), ve("green_beans", 40), se("light_coconut_milk", 50), se("red_curry_paste", 6), se("fish_sauce", 1), tp("basil", 3)],
    ways: [
      way("咖喱配米饭和上海青", "Curry over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("咖喱配糙米饭和西兰花", "Curry over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
      way("咖喱拌米粉配豆芽", "Curry over rice vermicelli with bean sprouts", VERMICELLI, [ve("mung_bean_sprouts", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "chicken_adobo", zh: "菲式醋焖鸡", en: "Chicken adobo", c: "southeast_asian", m: "braise", t: [10, 40],
    i: [pr("chicken_thigh", 120), ve("onion", 40), se("reduced_salt_soy_sauce", 6), se("rice_vinegar", 10), se("garlic_paste", 3), se("ground_black_pepper", 0.5)],
    ways: [
      way("醋焖鸡配米饭和上海青", "Adobo over rice with bok choy", RICE, [ve("bok_choy", 100)]),
      way("醋焖鸡配糙米饭和番茄黄瓜", "Adobo over brown rice with tomato and cucumber", BROWN, [ve("tomato", 60), ve("cucumber", 60)]),
      way("醋焖鸡拌米粉配菜心", "Adobo over rice vermicelli with choy sum", VERMICELLI, [ve("choy_sum", 100)]),
    ],
  }),
  dish({
    id: "thai_beef_pumpkin_curry", zh: "泰式牛肉南瓜咖喱", en: "Thai beef and pumpkin curry", c: "southeast_asian", m: "pressure_cook", eq: ["pressure_cooker"], t: [12, 60],
    i: [pr("beef_shank_raw", 105), ve("pumpkin", 150), ve("onion", 30), se("light_coconut_milk", 50), se("red_curry_paste", 5), se("fish_sauce", 1)],
    ways: [
      way("咖喱配米饭和芥蓝", "Curry over rice with gai lan", RICE, [ve("gai_lan", 100)]),
      way("咖喱配糙米饭和四季豆", "Curry over brown rice with green beans", BROWN, [ve("frozen_green_beans", 90)]),
      way("咖喱拌米粉配豆芽", "Curry over rice vermicelli with bean sprouts", VERMICELLI, [ve("mung_bean_sprouts", 60), ve("cucumber", 50)]),
    ],
  }),
  dish({
    id: "tom_kha_chicken_soup", zh: "椰奶鸡肉汤", en: "Tom kha chicken soup", c: "southeast_asian", m: "simmer", t: [12, 30],
    i: [pr("chicken_breast", 100), ve("button_mushroom", 80), ve("tomato", 60), se("light_coconut_milk", 60), se("low_sodium_stock", 100), se("red_curry_paste", 4), se("fish_sauce", 1.5), se("lime", 10), tp("coriander", 3)],
    ways: [
      way("椰奶汤配米粉和豆芽", "Soup with rice vermicelli and bean sprouts", VERMICELLI, [ve("mung_bean_sprouts", 60), ve("bok_choy", 60)]),
      way("椰奶汤配米饭和菜心", "Soup over rice with choy sum", RICE, [ve("choy_sum", 100)]),
      way("椰奶汤配糙米饭和西兰花", "Soup over brown rice with broccoli", BROWN, [ve("frozen_broccoli", 90)]),
    ],
  }),
  dish({
    id: "thai_basil_chicken", zh: "罗勒鸡肉末", en: "Thai basil minced chicken", c: "southeast_asian", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("chicken_mince", 140), ve("green_beans", 100), ve("red_bell_pepper", 50), tp("basil", 8), se("oyster_sauce", 4), se("fish_sauce", 1.5), oi("canola_oil", 3)],
  }),
  dish({
    id: "shrimp_rice_noodle_stirfry", zh: "虾仁炒米粉", en: "Shrimp and bean sprout rice noodle stir-fry", c: "southeast_asian", m: "stir_fry", t: [14, 18],
    staples: [VERMICELLI],
    i: [pr("white_shrimp", 115), ve("mung_bean_sprouts", 80), ve("chinese_chives", 40), ve("carrot", 30), se("sweet_chili_sauce", 8), se("fish_sauce", 1.5), se("lime", 10), tp("peanuts", 5), oi("canola_oil", 4)],
  }),
  dish({
    id: "chicken_larb_lettuce", zh: "香草鸡肉末沙拉", en: "Chicken larb with lettuce", c: "southeast_asian", m: "stir_fry", t: [12, 15],
    staples: [RICE, BROWN, GRAINS],
    i: [pr("chicken_mince", 140), ve("romaine", 100), ve("cucumber", 60), tp("mint", 3), tp("coriander", 3), se("lime", 15), se("fish_sauce", 2.5), se("sriracha", 3)],
  }),
];

const MAINS: Dish[] = [...AMERICAN, ...MEDITERRANEAN, ...ITALIAN, ...CHINESE, ...MEXICAN, ...JAPANESE, ...SOUTHEAST_ASIAN];

export const SEED_DISHES: readonly Dish[] = [...MAINS, ...SIDES, ...STAPLES, ...BREAKFASTS];
