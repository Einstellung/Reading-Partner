// Compound seasonings and pastes added for docs/671 调味: dishes season with a
// ready-made paste, powder or sauce so nobody chops garlic, ginger or scallion.
// Hand-maintained, appended to the generated rows by foods.ts. Each row cites
// the record or label its numbers were read from; sodium and added sugar are
// the same record's (added sugar: the label's total sugars, or for mirin and
// sugar their carbohydrate, per docs/671 入库检查; single spices count 0).

import type { Food } from "./foods";

const pantry = { en: "", category: "pantry", keeps: "pantry" } as const;

export const COMPOUND_SEASONINGS: readonly Food[] = [
  { id: "garlic_paste", zh: "蒜蓉（管装）", aliases: ["蒜泥", "管装蒜蓉", "蒜蓉酱"], ...pantry, roles: ["sauce"], kcal: 101, protein: 3.8, fat: 0.4, carbs: 19.9, minG: 2, maxG: 10, tags: [], sodium: 393, addedSugar: 4.7, source: { kind: "label", note: "Tesco Crushed Garlic, UK label per 100 g (Open Food Facts 5053947370366)" } },
  { id: "ginger_paste", zh: "姜蓉（管装）", aliases: ["姜泥", "管装姜蓉", "姜蓉"], ...pantry, roles: ["sauce"], kcal: 21, protein: 0.7, fat: 0.5, carbs: 2.8, minG: 2, maxG: 10, tags: [], sodium: 332, addedSugar: 0.5, source: { kind: "label", note: "Tesco Ginger Paste, UK label per 100 g (Open Food Facts 5053947370311)" } },
  { id: "ground_ginger", zh: "姜粉", aliases: ["生姜粉"], ...pantry, roles: ["sauce"], kcal: 335, protein: 9.0, fat: 4.2, carbs: 71.6, minG: 1, maxG: 3, tags: [], sodium: 27, addedSugar: 0, source: { kind: "usda", fdcId: 170926, dataset: "SR Legacy", name: "Spices, ginger, ground" } },
  { id: "sichuan_pepper_powder", zh: "花椒粉", aliases: [], ...pantry, roles: ["sauce"], kcal: 271, protein: 10.0, fat: 9.2, carbs: 63.2, minG: 1, maxG: 3, tags: ["spicy"], sodium: 565, addedSugar: 0, source: { kind: "tw", code: "P0100801", name: "花椒粉" } },
  { id: "reduced_salt_soy_sauce", zh: "减盐酱油", aliases: ["减盐生抽", "低钠酱油", "薄盐酱油"], ...pantry, roles: ["sauce"], kcal: 57, protein: 9.1, fat: 0.3, carbs: 5.6, minG: 5, maxG: 20, tags: ["soy", "gluten"], sodium: 3598, addedSugar: 0.5, source: { kind: "usda", fdcId: 172473, dataset: "SR Legacy", name: "Soy sauce made from soy and wheat (shoyu), low sodium" } },
  { id: "hoisin_sauce", zh: "海鲜酱", aliases: ["海鲜酱汁"], ...pantry, roles: ["sauce"], kcal: 220, protein: 3.3, fat: 3.4, carbs: 44.1, minG: 5, maxG: 20, tags: ["soy", "gluten"], sodium: 1615, addedSugar: 27.3, source: { kind: "usda", fdcId: 172886, dataset: "SR Legacy", name: "Sauce, hoisin, ready-to-serve" } },
  { id: "fish_sauce", zh: "鱼露", aliases: [], ...pantry, roles: ["sauce"], kcal: 64, protein: 10.2, fat: 0.2, carbs: 5.3, minG: 2, maxG: 10, tags: ["seafood", "fish"], sodium: 8908, addedSugar: 5.0, source: { kind: "tw", code: "P0800401", name: "魚露" } },
  { id: "mirin", zh: "味醂", aliases: ["味淋", "日式甜料酒"], ...pantry, roles: ["sauce"], kcal: 212, protein: 0, fat: 0, carbs: 53.0, minG: 5, maxG: 20, tags: [], sodium: 20, addedSugar: 53.0, source: { kind: "label", note: "Yutaka Mirin, label per 100 g (Open Food Facts 5014276512018)" } },
  { id: "white_sugar", zh: "白砂糖", aliases: ["白糖", "砂糖"], ...pantry, roles: ["sauce"], kcal: 387, protein: 0, fat: 0, carbs: 100.0, minG: 1, maxG: 10, tags: [], sodium: 1, addedSugar: 100.0, source: { kind: "usda", fdcId: 169655, dataset: "SR Legacy", name: "Sugars, granulated" } },
  { id: "gochujang", zh: "韩式辣酱", aliases: ["苦椒酱", "韩国辣椒酱"], ...pantry, roles: ["sauce"], kcal: 233, protein: 5.0, fat: 2.2, carbs: 42.2, minG: 5, maxG: 20, tags: ["soy", "gluten", "spicy"], sodium: 2640, addedSugar: 25.2, source: { kind: "label", note: "Sempio Gochujang Korean Chili Paste, label per 100 g (Open Food Facts 8801005000178)" } },
  { id: "chili_crisp", zh: "油辣椒（辣椒脆）", aliases: ["老干妈", "香辣脆"], ...pantry, roles: ["sauce", "fat"], kcal: 617, protein: 12.8, fat: 60.2, carbs: 8.1, minG: 3, maxG: 15, tags: ["soy", "spicy"], sodium: 2360, addedSugar: 2.0, source: { kind: "label", note: "Lao Gan Ma Spicy Sauce, label per 100 g (Open Food Facts 6921804700207)" } },
  { id: "sriracha", zh: "是拉差辣椒酱", aliases: ["是拉差"], ...pantry, roles: ["sauce"], kcal: 139, protein: 2.3, fat: 1.2, carbs: 28.0, minG: 3, maxG: 15, tags: ["spicy"], sodium: 2872, addedSugar: 22.0, source: { kind: "label", note: "Flying Goose Sriracha, label per 100 g (Open Food Facts 8853662056005)" } },
  { id: "red_curry_paste", zh: "泰式红咖喱酱", aliases: ["红咖喱酱"], ...pantry, roles: ["sauce"], kcal: 136, protein: 6.1, fat: 1.6, carbs: 24.2, minG: 5, maxG: 30, tags: ["seafood", "spicy"], sodium: 5586, addedSugar: 7.3, source: { kind: "label", note: "Mae Ploy Red Curry Paste, label per 100 g (Open Food Facts 0044738102346)" } },
  { id: "tikka_masala_paste", zh: "印度玛莎拉咖喱酱", aliases: ["提卡玛莎拉酱"], ...pantry, roles: ["sauce"], kcal: 270, protein: 3.0, fat: 22.9, carbs: 7.8, minG: 10, maxG: 40, tags: [], sodium: 1880, addedSugar: 0.8, source: { kind: "label", note: "Patak's Tikka Masala Spice Paste, label per 100 g (Open Food Facts 5011308000994)" } },
  { id: "harissa", zh: "哈里萨辣酱", aliases: ["哈里萨"], ...pantry, roles: ["sauce"], kcal: 72, protein: 2.9, fat: 1.0, carbs: 11.0, minG: 5, maxG: 20, tags: ["spicy"], sodium: 680, addedSugar: 6.9, source: { kind: "label", note: "Le Phare du Cap Bon Harissa, label per 100 g (Open Food Facts 6194049100013)" } },
  { id: "zaatar", zh: "扎塔香料", aliases: ["扎塔尔"], ...pantry, roles: ["sauce"], kcal: 337, protein: 11.0, fat: 8.8, carbs: 49.0, minG: 2, maxG: 6, tags: [], sodium: 1600, addedSugar: 0, source: { kind: "label", note: "Euroma Za'atar, Dutch label per 100 g (Open Food Facts 8717600176913)" } },
];
