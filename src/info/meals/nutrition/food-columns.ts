// Columns docs/671 数据模型 adds to the food table: sodium, added sugar,
// protein category, not-freezable, grams per piece, deep-coloured vegetable
// and aromatic. Kept out of the
// generated food-table.ts, like POT_PACK_G in foods.ts, so a rebuild of the
// table does not lose them; foods.ts merges them into FOODS. The compound
// seasonings added for docs/671 carry their columns inline (seasonings.ts).

import type { FoodSource, ProteinCategory } from "./foods";

/**
 * Sodium, mg per 100 g. A bare number was read from the row's own source
 * record (Taiwan FDA 鈉, USDA FDC "Sodium, Na", or the label the row cites).
 * Where that record has no sodium figure the entry names the record it was
 * read from instead. whole_wheat_bun has no label of its own: its figure is
 * the Taiwan plain steamed bun's.
 */
export const SODIUM_MG: Readonly<Record<string, number | { mg: number; source: FoodSource }>> = {
  avocado: 8, // USDA FDC 171706, Avocados, raw, California (the NUTRIENT_OVERRIDES row)
  braised_beef_shank: 64, frozen_shrimp: 225, white_shrimp: 178, egg: 147, egg_white: 183, tea_egg: 458,
  century_egg: 590, quail_egg: 89, firm_tofu: 2, soft_tofu: 32, frozen_tofu: 8, dried_tofu: 116,
  spiced_dried_tofu: 445, tofu_skin: 23, soy_milk_unsweetened: 2, frozen_edamame: 359, greek_yogurt: 36,
  plain_yogurt: 70, low_fat_milk: 28, whole_milk: 36, cottage_cheese: 308, cheese_slice: 1594,
  low_fat_cheese_slice: 1598, mozzarella: 619, canned_tuna_water: 247, canned_salmon: 408,
  canned_sardine: 307, canned_mackerel_tomato: 357, salmon: 39, frozen_tilapia_fillet: 46, cod: 54,
  hairtail: 54, scallop: 283, clam: 442, mussel: 301, squid: 239, chicken_breast: 33, chicken_thigh: 68,
  chicken_tender: 44, pork_tenderloin: 46, pork_loin: 40, lean_pork_leg: 41, ground_pork: 61, lean_beef: 58,
  beef_shank_raw: 63, beef_hotpot_slices: 57, sirloin_steak: 46, canned_chickpeas: 212,
  canned_black_beans: 218, canned_kidney_beans: 208, frozen_peas: 21, soybean_dry: 12,
  instant_white_rice: 16, rice_cooked: 2, brown_rice_cooked: 4, multigrain_rice_raw: 2, black_rice_raw: 3,
  millet_raw: 1, quinoa_cooked: 7, oats: 3, whole_wheat_toast: 455, wholegrain_toast: 355, white_toast: 443,
  whole_wheat_tortilla: 617, whole_wheat_pita: 421, steamed_bun: 182, whole_wheat_pasta_dry: 6, pasta_dry: 6,
  soba_dry: 733, soba_fresh: 136, dried_noodles: 362, fresh_noodles: 429, rice_noodles_dry: 197,
  sweet_potato: 51, purple_sweet_potato: 42, potato: 3, baby_potato: 7, sweet_corn_cob: 2, waxy_corn_cob: 1,
  frozen_corn: 3, chinese_yam: 2, taro: 5, broccoli: 13, frozen_broccoli: 11, cauliflower: 14,
  frozen_cauliflower: 33, spinach: 43, frozen_spinach: 46, carrot: 67, onion: 2, red_onion: 4, cabbage: 11,
  red_cabbage: 13, napa_cabbage: 24, bok_choy: 12, pak_choi_white: 6, water_spinach: 29, choy_sum: 21,
  gai_lan: 27, eggplant: 2, green_pepper: 4, red_bell_pepper: 1, yellow_bell_pepper: 1, cucumber: 3,
  loofah: 0, winter_melon: 2, bitter_melon: 1, zucchini: 0, green_beans: 4, frozen_green_beans: 3,
  snow_peas: 0, asparagus: 6, okra: 9, shiitake: 2, king_oyster_mushroom: 3, enoki: 2, button_mushroom: 19,
  wood_ear: 12, kelp_knot: 230, wakame: 9172, nori: 968, tomato: 2, cherry_tomato: 10, romaine: 20,
  iceberg_lettuce: 7, mung_bean_sprouts: 16, soybean_sprouts: 7, celery: 65, chinese_chives: 2,
  garlic_sprouts: 9, scallion: 1, leek: 1, ginger: 4, garlic: 4, white_radish: 27, lotus_root: 16,
  pumpkin: 1, pea_shoots: 4, frozen_mixed_veg: 47, banana: 0, apple: 3, blueberries: 0,
  frozen_blueberries: 1, kiwi: 3, orange: 5, mandarin: 2, grapes: 1, strawberries: 7, pear: 0, peach: 2,
  mango: 1, dragon_fruit: 0, watermelon: 1, cantaloupe: 12, papaya: 3, pineapple: 1, pomelo: 7,
  grapefruit: 4, guava: 0, cherries: 2, butter: 6, peanut_butter: 306, sesame_paste: 4,
  walnuts: 5, almonds: 20, cashews: 10, peanuts: 6, pistachios: 462, mixed_nuts: 4, chia_seeds: 16,
  flaxseed: 46, pumpkin_seeds: 395, light_soy_sauce: 4997, rice_vinegar: 8, black_vinegar: 1571,
  oyster_sauce: 5847, doubanjiang: 5042, chili_sauce: 4948, sweet_chili_sauce: 1968,
  garlic_chili_sauce: 5043, ketchup: 1116, teriyaki_sauce: 1840, curry_roux: 4180, miso: 4153,
  satay_sauce: 421, bbq_sauce: 2604, mapo_sauce: 1753, tomato_pasta_sauce: 768, pesto: 1211, mayonnaise: 980,
  japanese_dressing: 2853, curry_powder: 552, ground_cumin: 241, ground_black_pepper: 7, garlic_powder: 74,
  five_spice_powder: 98, ground_cinnamon: 10, smoked_paprika: 68, chili_powder_blend: 2867,
  poultry_seasoning: 27, dried_oregano: 25, dried_dill: 208, cajun_seasoning: 7920,
  lemon_pepper_seasoning: 11540, garlic_herb_seasoning: 1610, italian_seasoning: 2052,
  fajita_seasoning: 7304, taco_seasoning: 4240, bbq_seasoning: 8352,
  ready_chicken_breast: { mg: 214, source: { kind: "label", note: "Sainsbury's Chargrilled British Chicken Breast Slices, UK label per 100 g (Open Food Facts 00286558)" } },
  microwave_grain_rice: { mg: 8, source: { kind: "label", note: "Tesco Growers Harvest Microwave Wholegrain Rice, UK label per 100 g (Open Food Facts 5059697693564)" } },
  whole_wheat_bun: { mg: 182, source: { kind: "tw", code: "R2400201", name: "白饅頭" } },
  olive_oil: { mg: 2, source: { kind: "usda", fdcId: 171413, dataset: "SR Legacy", name: "Oil, olive, salad or cooking" } },
  sesame_oil: { mg: 0, source: { kind: "usda", fdcId: 171016, dataset: "SR Legacy", name: "Oil, sesame, salad or cooking" } },
  peanut_oil: { mg: 0, source: { kind: "usda", fdcId: 171410, dataset: "SR Legacy", name: "Oil, peanut, salad or cooking" } },
  canola_oil: { mg: 0, source: { kind: "usda", fdcId: 172336, dataset: "SR Legacy", name: "Oil, canola" } },
  honey: { mg: 4, source: { kind: "usda", fdcId: 169640, dataset: "SR Legacy", name: "Honey" } },
};

/**
 * Added sugar, g per 100 g, for the seasoning rows; every other row is a whole
 * or plain food and counts 0. Following docs/671 入库检查 (糖、蜂蜜、味醂、甜酱的
 * 碳水): the total sugars of the row's own record or label; where the record
 * has no sugar figure, its carbohydrate, so a sweet sauce counts in full;
 * honey counts its carbohydrate. Single spices and plain seed pastes have
 * nothing added and count 0.
 */
export const ADDED_SUGAR_G: Readonly<Record<string, number>> = {
  peanut_butter: 17.9, sesame_paste: 0, light_soy_sauce: 14.7, rice_vinegar: 2.4, black_vinegar: 8.7,
  oyster_sauce: 32.2, doubanjiang: 12.2, chili_sauce: 11.5, sweet_chili_sauce: 28.1, garlic_chili_sauce: 7.8,
  ketchup: 26.7, teriyaki_sauce: 39.2, curry_roux: 10, miso: 18, satay_sauce: 10.4, bbq_sauce: 32.1,
  mapo_sauce: 23.1, tomato_pasta_sauce: 6.6, pesto: 4.6, mayonnaise: 11.4, japanese_dressing: 25.4,
  honey: 79.6,
  curry_powder: 0, ground_cumin: 0, ground_black_pepper: 0, garlic_powder: 0, five_spice_powder: 0,
  ground_cinnamon: 0, smoked_paprika: 0, chili_powder_blend: 0, poultry_seasoning: 0, dried_oregano: 0,
  dried_dill: 0,
  cajun_seasoning: 6.9, lemon_pepper_seasoning: 12, garlic_herb_seasoning: 4.2, italian_seasoning: 19.3,
  fajita_seasoning: 14.5, taco_seasoning: 11, bbq_seasoning: 19.1,
};

/** Docs/671 多样性: 禽、畜、鱼虾、蛋、豆制品、奶, plus canned pulses. Every protein food has one. */
export const PROTEIN_CATEGORY: Readonly<Record<string, ProteinCategory>> = {
  ready_chicken_breast: "poultry", chicken_breast: "poultry", chicken_thigh: "poultry", chicken_tender: "poultry",
  braised_beef_shank: "meat", pork_tenderloin: "meat", pork_loin: "meat", lean_pork_leg: "meat",
  ground_pork: "meat", lean_beef: "meat", beef_shank_raw: "meat", beef_hotpot_slices: "meat",
  sirloin_steak: "meat",
  frozen_shrimp: "seafood", white_shrimp: "seafood", canned_tuna_water: "seafood", canned_salmon: "seafood",
  canned_sardine: "seafood", canned_mackerel_tomato: "seafood", salmon: "seafood",
  frozen_tilapia_fillet: "seafood", cod: "seafood", hairtail: "seafood", scallop: "seafood", clam: "seafood",
  mussel: "seafood", squid: "seafood",
  egg: "egg", egg_white: "egg", tea_egg: "egg", century_egg: "egg", quail_egg: "egg",
  firm_tofu: "soy", soft_tofu: "soy", frozen_tofu: "soy", dried_tofu: "soy", spiced_dried_tofu: "soy",
  tofu_skin: "soy", soy_milk_unsweetened: "soy", frozen_edamame: "soy", soybean_dry: "soy",
  soybean_sprouts: "soy",
  greek_yogurt: "dairy", plain_yogurt: "dairy", low_fat_milk: "dairy", whole_milk: "dairy",
  cottage_cheese: "dairy", cheese_slice: "dairy", low_fat_cheese_slice: "dairy", mozzarella: "dairy",
  canned_chickpeas: "legume", canned_black_beans: "legume", canned_kidney_beans: "legume",
};

/**
 * A dish with any of these in it is not frozen (docs/671 一锅): boiled eggs,
 * tofu, potato and leafy greens as the doc names them, plus salad leaves,
 * sprouts, cucumber, milk and yogurt, mayonnaise and avocado, which turn
 * watery, split or brown when thawed.
 */
export const NOT_FREEZABLE: ReadonlySet<string> = new Set([
  "egg", "egg_white", "tea_egg", "century_egg", "quail_egg",
  "firm_tofu", "soft_tofu",
  "potato", "baby_potato",
  "spinach", "bok_choy", "pak_choi_white", "water_spinach", "choy_sum", "gai_lan", "pea_shoots",
  "chinese_chives", "romaine", "iceberg_lettuce", "mung_bean_sprouts", "soybean_sprouts", "cucumber",
  "greek_yogurt", "plain_yogurt", "cottage_cheese", "low_fat_milk", "whole_milk", "soy_milk_unsweetened",
  "mayonnaise", "avocado",
]);

/**
 * Edible grams of one piece of countable produce, for the shopping list and
 * the gather list ("2 个，约 240 g"). Never used to round solved grams; that
 * is what `unit` is for. Each is the USDA SR Legacy household measure named in
 * the comment (the medium size where there are several).
 */
export const PIECE_G: Readonly<Record<string, { grams: number; label: string; fdcId: number }>> = {
  apple: { grams: 182, label: "个", fdcId: 171688 }, // 1 medium (3" dia)
  banana: { grams: 118, label: "根", fdcId: 173944 }, // 1 medium
  orange: { grams: 131, label: "个", fdcId: 169097 }, // 1 fruit (2-5/8" dia)
  mandarin: { grams: 88, label: "个", fdcId: 169105 }, // 1 medium
  kiwi: { grams: 69, label: "个", fdcId: 168153 }, // 1 fruit (2" dia)
  pear: { grams: 178, label: "个", fdcId: 169118 }, // 1 medium
  peach: { grams: 150, label: "个", fdcId: 169928 }, // 1 medium
  mango: { grams: 336, label: "个", fdcId: 169910 }, // 1 fruit without refuse
  avocado: { grams: 201, label: "个", fdcId: 171705 }, // 1 avocado
  grapefruit: { grams: 246, label: "个", fdcId: 174673 }, // twice 0.5 fruit
  pomelo: { grams: 609, label: "个", fdcId: 167754 }, // 1 fruit without refuse
  tomato: { grams: 123, label: "个", fdcId: 170457 }, // 1 medium whole
  onion: { grams: 110, label: "个", fdcId: 170000 }, // 1 medium
  red_onion: { grams: 110, label: "个", fdcId: 170000 }, // 1 medium onion
  carrot: { grams: 61, label: "根", fdcId: 170393 }, // 1 medium
  potato: { grams: 213, label: "个", fdcId: 170026 }, // 1 medium
  sweet_potato: { grams: 130, label: "个", fdcId: 168482 }, // 1 sweetpotato, 5" long
  purple_sweet_potato: { grams: 130, label: "个", fdcId: 168482 }, // 1 sweetpotato, 5" long
  cucumber: { grams: 301, label: "根", fdcId: 168409 }, // 1 cucumber (8-1/4")
  eggplant: { grams: 548, label: "个", fdcId: 169228 }, // 1 eggplant, unpeeled
  zucchini: { grams: 196, label: "根", fdcId: 169291 }, // 1 medium
  green_pepper: { grams: 119, label: "个", fdcId: 170427 }, // 1 medium
  red_bell_pepper: { grams: 119, label: "个", fdcId: 170108 }, // 1 medium
  yellow_bell_pepper: { grams: 186, label: "个", fdcId: 169383 }, // 1 large, the only size listed
  sweet_corn_cob: { grams: 102, label: "根", fdcId: 169998 }, // 1 ear, medium, kernels
  waxy_corn_cob: { grams: 102, label: "根", fdcId: 169998 }, // 1 ear, medium, kernels
  cauliflower: { grams: 588, label: "颗", fdcId: 169986 }, // 1 head medium
  cabbage: { grams: 908, label: "颗", fdcId: 169975 }, // 1 head, medium
  shiitake: { grams: 19, label: "朵", fdcId: 169242 }, // 1 piece whole
};

/**
 * Deep-coloured vegetables (深色蔬菜, docs/671 入库检查): the Chinese dietary
 * guideline counts dark green, red, orange and purple ones, and asks that half
 * of the day's vegetables be of them. Pale or light-green vegetables (cabbage,
 * cucumber, zucchini, celery, mushrooms, sprouts, legumes) and
 * yellow ones are not in it.
 */
export const DEEP_COLOR: ReadonlySet<string> = new Set([
  // Dark green
  "spinach", "frozen_spinach", "broccoli", "frozen_broccoli", "bok_choy", "pak_choi_white", "water_spinach",
  "choy_sum", "gai_lan", "pea_shoots", "romaine", "green_beans", "frozen_green_beans", "green_pepper", "chinese_chives",
  // Red, orange and purple
  "tomato", "cherry_tomato", "carrot", "red_bell_pepper", "pumpkin", "red_cabbage",
]);

/**
 * Aromatics and sauce bases (docs/671 入库检查): they season the dish or are
 * its sauce, so their grams are not vegetables eaten. They are still veg lines
 * (onion browned in the pot, tinned tomatoes as the sauce); they just do not
 * count toward the real-vegetable minimum.
 */
export const AROMATIC: ReadonlySet<string> = new Set([
  "onion", "red_onion", "garlic", "ginger", "scallion", "leek", "crushed_tomatoes",
]);

/**
 * Whole-grain staples (docs/671 多样性, 全谷物): brown rice, mixed grains,
 * millet, quinoa, oats, buckwheat, whole-wheat bread, pasta, wraps and buns,
 * and corn. White rice, white flour, potato and sweet potato are staples but
 * not whole grain. "含全谷吐司" is sold as wholegrain bread and counts.
 */
export const WHOLE_GRAIN: ReadonlySet<string> = new Set([
  "brown_rice_cooked", "microwave_grain_rice", "multigrain_rice_raw", "black_rice_raw", "millet_raw",
  "quinoa_cooked", "oats", "whole_wheat_toast", "wholegrain_toast", "whole_wheat_tortilla", "whole_wheat_pita",
  "whole_wheat_bun", "whole_wheat_pasta_dry", "soba_dry", "soba_fresh", "sweet_corn_cob", "waxy_corn_cob",
  "frozen_corn", "corn_tortilla",
]);

/** How a pack is sold, for the shopping list's words (盒、袋、块、盒装奶、颗、把、条). */
export type PackKind = "box" | "bag" | "block" | "carton" | "head" | "bunch" | "loaf";

/**
 * The usual retail pack and how many days it keeps once opened or cut
 * (docs/671 整包与开封), for perishable foods only: shelf-life class d1-2,
 * d3-5 or w1. Pack grams are common supermarket sizes in China and the US
 * (a 1 lb bag of green beans, an 8 oz box of mushrooms, a 400 g block of firm
 * tofu, a 1 L carton), not a database figure; opened days follow the
 * refrigerated after-opening figures of USDA FoodKeeper, the low end where it
 * gives a range. Raw meat and fish are frozen in portions the day they are
 * bought, so their opened days never count; they carry the pack for the list.
 * Countable produce bought loose (tomatoes, peppers, cucumbers) has no pack:
 * one piece (PIECE_G) is the unit and PIECE_OPEN_DAYS says how long a cut one
 * keeps.
 */
export const RETAIL_PACK: Readonly<Record<string, { grams: number; kind: PackKind; openDays: number }>> = {
  chicken_thigh: { grams: 500, kind: "box", openDays: 1 },
  chicken_breast: { grams: 500, kind: "box", openDays: 1 },
  beef_shank_raw: { grams: 600, kind: "box", openDays: 1 },
  lean_beef: { grams: 500, kind: "box", openDays: 1 },
  lean_pork_leg: { grams: 500, kind: "box", openDays: 1 },
  pork_loin: { grams: 500, kind: "box", openDays: 1 },
  pork_tenderloin: { grams: 500, kind: "box", openDays: 1 },
  salmon: { grams: 300, kind: "box", openDays: 1 },
  white_shrimp: { grams: 400, kind: "box", openDays: 1 },
  ready_chicken_breast: { grams: 200, kind: "box", openDays: 3 },
  firm_tofu: { grams: 400, kind: "block", openDays: 3 },
  soy_milk_unsweetened: { grams: 1000, kind: "carton", openDays: 7 },
  low_fat_milk: { grams: 1000, kind: "carton", openDays: 7 },
  whole_milk: { grams: 1000, kind: "carton", openDays: 7 },
  greek_yogurt: { grams: 500, kind: "box", openDays: 7 },
  plain_yogurt: { grams: 500, kind: "box", openDays: 7 },
  fresh_noodles: { grams: 500, kind: "bag", openDays: 3 },
  soba_fresh: { grams: 400, kind: "bag", openDays: 3 },
  corn_tortilla: { grams: 300, kind: "bag", openDays: 10 },
  whole_wheat_pita: { grams: 300, kind: "bag", openDays: 7 },
  whole_wheat_toast: { grams: 450, kind: "loaf", openDays: 7 },
  wholegrain_toast: { grams: 450, kind: "loaf", openDays: 7 },
  white_toast: { grams: 450, kind: "loaf", openDays: 7 },
  spinach: { grams: 300, kind: "bag", openDays: 3 },
  bok_choy: { grams: 500, kind: "bag", openDays: 4 },
  romaine: { grams: 300, kind: "head", openDays: 5 },
  cherry_tomato: { grams: 300, kind: "box", openDays: 5 },
  green_beans: { grams: 450, kind: "bag", openDays: 5 },
  button_mushroom: { grams: 250, kind: "box", openDays: 5 },
  shiitake: { grams: 150, kind: "box", openDays: 5 },
  celery: { grams: 450, kind: "bunch", openDays: 7 },
  napa_cabbage: { grams: 1000, kind: "head", openDays: 7 },
  red_cabbage: { grams: 700, kind: "head", openDays: 7 },
  white_radish: { grams: 500, kind: "head", openDays: 7 },
  winter_melon: { grams: 500, kind: "block", openDays: 3 },
  chinese_yam: { grams: 400, kind: "bag", openDays: 7 },
  blueberries: { grams: 170, kind: "box", openDays: 5 },
  strawberries: { grams: 450, kind: "box", openDays: 3 },
  grapes: { grams: 500, kind: "bag", openDays: 5 },
};

/** Days a cut piece of loose produce keeps in the fridge (FoodKeeper, cut vegetables). */
export const PIECE_OPEN_DAYS = 3;

/**
 * Foods planned at their cooked or soaked weight but bought dry and kept in
 * the pantry (rice, quinoa, dried wood ear). The list says they are on hand
 * rather than packing the cooked weight.
 */
export const BOUGHT_DRY: ReadonlySet<string> = new Set(["rice_cooked", "brown_rice_cooked", "quinoa_cooked", "wood_ear"]);

/**
 * Rows whose generated numbers are replaced. The table's avocado is a Taiwan
 * variety (D0900301, 80 kcal and 6.8 g fat per 100 g); the avocado sold in
 * China and the US is Hass, so the row reads USDA FDC 171706 (SR Legacy,
 * "Avocados, raw, California") instead.
 */
export const NUTRIENT_OVERRIDES: Readonly<
  Record<string, { kcal: number; protein: number; fat: number; carbs: number; source: FoodSource }>
> = {
  avocado: {
    kcal: 167, protein: 2.0, fat: 15.4, carbs: 8.6,
    source: { kind: "usda", fdcId: 171706, dataset: "SR Legacy", name: "Avocados, raw, California" },
  },
};
