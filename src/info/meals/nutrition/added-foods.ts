// Foods the dish library needs that the generated table lacks (docs/671 菜库):
// salt, citrus, minces, lentils, canned tomatoes, stock, coconut milk, feta,
// corn tortillas, breadcrumbs, sesame and fresh herbs. Hand-maintained like
// seasonings.ts and appended to the generated rows by foods.ts, with the
// docs/671 columns inline. Every number is read from the record the row
// cites: USDA FDC SR Legacy, or the label for the coconut milk. Added sugar
// follows food-columns.ts: the record's total sugars for the prepared
// seasonings (stock, coconut milk, breadcrumbs), 0 for single foods.

import type { Food } from "./foods";

const usda = (fdcId: number, name: string) => ({ kind: "usda", fdcId, dataset: "SR Legacy", name }) as const;
type Shared = Pick<Food, "category" | "keeps" | "roles" | "minG" | "maxG" | "addedSugar"> & Partial<Food>;
const herb = (): Shared & Pick<Food, "tags"> => ({ category: "produce", keeps: "d3-5", roles: ["sauce"], minG: 1, maxG: 15, tags: [], addedSugar: 0 });
const mince = (): Shared => ({ roles: ["protein"], category: "protein", keeps: "d1-2", minG: 80, maxG: 250, potG: 500, addedSugar: 0 });

export const ADDED_FOODS: readonly Food[] = [
  { id: "salt", zh: "盐", aliases: ["食盐", "精盐"], en: "salt", roles: ["sauce"], category: "pantry", keeps: "pantry", kcal: 0, protein: 0, fat: 0, carbs: 0, minG: 0.5, maxG: 5, tags: [], sodium: 38758, addedSugar: 0, source: usda(173468, "Salt, table") },
  { id: "lemon", zh: "柠檬", aliases: ["鲜柠檬", "柠檬汁"], en: "lemon", roles: ["sauce"], category: "produce", keeps: "w2plus", kcal: 29, protein: 1.1, fat: 0.3, carbs: 9.3, minG: 5, maxG: 60, tags: [], sodium: 2, addedSugar: 0, piece: { grams: 84, label: "个" }, source: usda(167746, "Lemons, raw, without peel") },
  { id: "lime", zh: "青柠", aliases: ["青柠檬", "青柠汁"], en: "lime", roles: ["sauce"], category: "produce", keeps: "w2plus", kcal: 30, protein: 0.7, fat: 0.2, carbs: 10.5, minG: 5, maxG: 60, tags: [], sodium: 2, addedSugar: 0, piece: { grams: 67, label: "个" }, source: usda(168155, "Limes, raw") },
  { id: "light_coconut_milk", zh: "低脂椰浆", aliases: ["淡椰浆", "低脂椰奶", "椰浆"], en: "coconut milk", roles: ["sauce"], category: "pantry", keeps: "pantry", kcal: 61, protein: 0.4, fat: 6.0, carbs: 1.3, minG: 30, maxG: 200, tags: [], sodium: 40, addedSugar: 0.8, source: { kind: "label", note: "Tesco Light Coconut Milk, UK label per 100 g (Open Food Facts 5054269746730)" } },
  { id: "ground_turkey", zh: "火鸡肉末（生）", aliases: ["火鸡肉糜", "火鸡绞肉"], en: "turkey mince", ...mince(), kcal: 150, protein: 18.7, fat: 8.3, carbs: 0, tags: ["poultry"], sodium: 69, proteinCategory: "poultry", source: usda(172850, "Turkey, ground, 93% lean, 7% fat, raw") },
  { id: "lean_beef_mince", zh: "瘦牛肉末（生）", aliases: ["瘦牛肉糜", "牛肉末", "牛肉馅", "牛绞肉"], en: "minced beef", ...mince(), kcal: 137, protein: 21.4, fat: 5.0, carbs: 0, tags: ["beef"], sodium: 66, proteinCategory: "meat", source: usda(171790, "Beef, ground, 95% lean meat / 5% fat, raw") },
  { id: "chicken_mince", zh: "鸡肉末（生）", aliases: ["鸡肉糜", "鸡肉馅", "鸡绞肉"], en: "ground chicken", ...mince(), kcal: 143, protein: 17.4, fat: 8.1, carbs: 0, tags: ["poultry"], sodium: 60, proteinCategory: "poultry", source: usda(171116, "Chicken, ground, raw") },
  { id: "crushed_tomatoes", zh: "番茄碎罐头", aliases: ["罐头番茄碎", "碎番茄罐头", "番茄罐头"], en: "tinned tomatoes", roles: ["veg"], category: "pantry", keeps: "pantry", kcal: 32, protein: 1.6, fat: 0.3, carbs: 7.3, minG: 50, maxG: 300, tags: [], sodium: 186, addedSugar: 0, source: usda(170501, "Tomatoes, crushed, canned") },
  { id: "low_sodium_stock", zh: "低钠鸡汤（高汤）", aliases: ["低钠高汤", "低盐高汤", "低钠鸡高汤"], en: "chicken stock", roles: ["sauce"], category: "pantry", keeps: "pantry", kcal: 16, protein: 2.0, fat: 0.6, carbs: 1.2, minG: 50, maxG: 500, tags: ["poultry"], sodium: 30, addedSugar: 0.1, source: usda(171609, "Soup, chicken broth, low sodium, canned") },
  { id: "red_lentils_dry", zh: "红扁豆（干）", aliases: ["红小扁豆", "红兵豆"], en: "lentils", roles: ["protein", "staple"], category: "pantry", keeps: "pantry", kcal: 358, protein: 23.9, fat: 2.2, carbs: 63.1, minG: 30, maxG: 120, tags: [], sodium: 7, addedSugar: 0, proteinCategory: "legume", source: usda(174284, "Lentils, pink or red, raw") },
  { id: "lentils_dry", zh: "绿扁豆（干）", aliases: ["棕扁豆", "褐扁豆", "兵豆", "小扁豆"], en: "lentils", roles: ["protein", "staple"], category: "pantry", keeps: "pantry", kcal: 352, protein: 24.6, fat: 1.1, carbs: 63.4, minG: 30, maxG: 120, tags: [], sodium: 6, addedSugar: 0, proteinCategory: "legume", source: usda(172420, "Lentils, raw") },
  { id: "feta", zh: "菲达奶酪", aliases: ["菲达", "希腊白奶酪"], en: "feta", roles: ["dairy", "fat"], category: "dairy", keeps: "w1", kcal: 265, protein: 14.2, fat: 21.5, carbs: 3.9, minG: 10, maxG: 40, tags: ["dairy"], sodium: 1139, addedSugar: 0, proteinCategory: "dairy", source: usda(173420, "Cheese, feta") },
  { id: "corn_tortilla", zh: "玉米饼皮", aliases: ["玉米薄饼", "墨西哥玉米饼"], en: "corn tortillas", roles: ["staple"], category: "grains", keeps: "w1", kcal: 218, protein: 5.7, fat: 2.9, carbs: 44.6, minG: 24, maxG: 150, tags: [], sodium: 45, addedSugar: 0, piece: { grams: 24, label: "张" }, source: usda(175036, "Tortillas, ready-to-bake or -fry, corn") },
  { id: "breadcrumbs", zh: "面包糠", aliases: ["面包屑", "日式面包糠"], en: "breadcrumbs", roles: ["sauce"], category: "pantry", keeps: "pantry", kcal: 395, protein: 13.4, fat: 5.3, carbs: 72.0, minG: 5, maxG: 30, tags: ["gluten"], sodium: 732, addedSugar: 6.2, source: usda(174928, "Bread, crumbs, dry, grated, plain") },
  { id: "sesame_seeds", zh: "芝麻", aliases: ["白芝麻", "熟芝麻"], en: "sesame seed", roles: ["fat"], category: "pantry", keeps: "pantry", kcal: 573, protein: 17.7, fat: 49.7, carbs: 23.5, minG: 2, maxG: 15, defaultG: 5, tags: [], sodium: 11, addedSugar: 0, source: usda(170150, "Seeds, sesame seeds, whole, dried") },
  { id: "coriander", zh: "香菜", aliases: ["芫荽", "鲜香菜"], en: "coriander", ...herb(), kcal: 23, protein: 2.1, fat: 0.5, carbs: 3.7, sodium: 46, source: usda(169997, "Coriander (cilantro) leaves, raw") },
  { id: "parsley", zh: "欧芹", aliases: ["洋香菜", "巴西里", "鲜欧芹"], en: "parsley", ...herb(), kcal: 36, protein: 3.0, fat: 0.8, carbs: 6.3, sodium: 56, source: usda(170416, "Parsley, fresh") },
  { id: "basil", zh: "罗勒", aliases: ["鲜罗勒", "甜罗勒"], en: "basil", ...herb(), kcal: 23, protein: 3.2, fat: 0.6, carbs: 2.7, sodium: 4, source: usda(172232, "Basil, fresh") },
  { id: "dill", zh: "莳萝（鲜）", aliases: ["鲜莳萝"], en: "dill", ...herb(), kcal: 43, protein: 3.5, fat: 1.1, carbs: 7.0, sodium: 61, source: usda(172233, "Dill weed, fresh") },
  { id: "mint", zh: "薄荷", aliases: ["鲜薄荷", "留兰香"], en: "mint", ...herb(), kcal: 44, protein: 3.3, fat: 0.7, carbs: 8.4, sodium: 30, source: usda(173475, "Spearmint, fresh") },
];
