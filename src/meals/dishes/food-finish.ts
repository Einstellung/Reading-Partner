// The eating-day steps of the fresh parts that are foods rather than dishes
// (docs/671 吃的那天): a way's add-ons (the vegetables put on the plate with a
// box) and the staple foods a way names (tortillas, bread, a bun, fresh
// noodles). One entry per food the seed ways use; any other food gets the
// steps of its kind (`fallbackFinish`), so no meal is left without steps.

import type { Food } from "../nutrition/foods";
import { fin } from "./seed";
import type { DishFinish } from "./types";

const MW = "加一勺水，盖上微波高火";
const MW_EN = "with a spoon of water, covered, on high for";

export const FOOD_FINISH: Readonly<Record<string, DishFinish[]>> = {
  // Add-ons.
  romaine: [fin([], 2, "洗生菜", "wash the lettuce", ["生菜洗净，撕成块"], ["wash the lettuce and tear it into pieces"])],
  frozen_broccoli: [
    fin(["microwave"], 4, "微波西兰花", "microwave the broccoli", [`冷冻西兰花${MW} 4 分钟`], [`microwave the frozen broccoli ${MW_EN} 4 minutes`]),
    fin(["stove"], 3, "焯西兰花", "blanch the broccoli", ["锅里水烧开，冷冻西兰花焯 3 分钟，捞出沥干"], ["blanch the frozen broccoli in boiling water for 3 minutes and drain"]),
  ],
  bok_choy: [
    fin(["stove"], 4, "炒上海青", "stir-fry the bok choy", ["上海青洗净切段", "锅里放{oil}，大火炒 3 到 4 分钟，加一点盐"], ["wash the bok choy and cut it into pieces", "stir-fry in {oil} over high heat for 3 to 4 minutes with a pinch of salt"]),
  ],
  frozen_green_beans: [
    fin(["microwave"], 4, "微波四季豆", "microwave the green beans", [`冷冻四季豆${MW} 4 分钟，咬一根全软才算熟`], [`microwave the frozen green beans ${MW_EN} 4 minutes; they are done when one bites soft all through`]),
    fin(["stove"], 5, "煮四季豆", "boil the green beans", ["锅里水烧开，冷冻四季豆煮 5 分钟到全软，沥干"], ["boil the frozen green beans for 5 minutes until soft all through, then drain"]),
  ],
  frozen_spinach: [
    fin(["microwave"], 3, "微波菠菜", "microwave the spinach", ["冷冻菠菜盖上微波高火 3 分钟", "挤干水"], ["microwave the frozen spinach, covered, on high for 3 minutes", "squeeze it dry"]),
    fin(["stove"], 2, "焯菠菜", "blanch the spinach", ["锅里水烧开，冷冻菠菜煮 2 分钟", "捞出挤干水"], ["cook the frozen spinach in boiling water for 2 minutes", "drain and squeeze it dry"]),
  ],
  tomato: [fin([], 1, "切番茄", "cut the tomato", ["番茄洗净切块"], ["wash the tomato and cut it into chunks"])],
  cherry_tomato: [fin([], 1, "切小番茄", "halve the cherry tomatoes", ["小番茄洗净，对半切"], ["wash the cherry tomatoes and halve them"])],
  cucumber: [fin([], 1, "切黄瓜", "slice the cucumber", ["黄瓜洗净切片"], ["wash the cucumber and slice it"])],
  red_cabbage: [fin([], 2, "切紫甘蓝", "shred the cabbage", ["紫甘蓝切细丝"], ["shred the red cabbage finely"])],
  lime: [fin([], 1, "切青柠", "cut the lime", ["青柠切块，吃时挤汁"], ["cut the lime into wedges to squeeze over"])],
  red_bell_pepper: [
    fin(["stove"], 3, "炒彩椒", "stir-fry the pepper", ["红彩椒切条", "锅里放{oil}，炒 2 到 3 分钟，加一点盐"], ["cut the red pepper into strips", "stir-fry in {oil} for 2 to 3 minutes with a pinch of salt"]),
  ],
  green_pepper: [
    fin(["stove"], 3, "炒青椒", "stir-fry the pepper", ["青椒切条", "锅里放{oil}，炒 2 到 3 分钟，加一点盐"], ["cut the green pepper into strips", "stir-fry in {oil} for 2 to 3 minutes with a pinch of salt"]),
  ],
  carrot: [
    fin(["microwave"], 5, "微波胡萝卜", "microwave the carrot", [`胡萝卜切片，${MW} 5 分钟`], [`slice the carrot and microwave it ${MW_EN} 5 minutes`]),
    fin(["stove"], 5, "煮胡萝卜", "boil the carrot", ["胡萝卜切片，开水煮 5 分钟到软，沥干"], ["slice the carrot and boil it for 5 minutes until soft, then drain"]),
  ],
  frozen_corn: [
    fin(["microwave"], 2, "微波玉米粒", "microwave the corn", [`冷冻玉米粒${MW} 2 分钟`], [`microwave the frozen corn ${MW_EN} 2 minutes`]),
    fin(["stove"], 3, "煮玉米粒", "boil the corn", ["冷冻玉米粒放进开水里煮 3 分钟，沥干"], ["boil the frozen corn for 3 minutes and drain"]),
  ],
  pumpkin: [
    fin(["microwave"], 6, "微波南瓜", "microwave the pumpkin", [`南瓜切块，${MW} 6 分钟到筷子能扎透`], [`cut the pumpkin into chunks and microwave ${MW_EN} 6 minutes, until a chopstick goes through`]),
    fin(["stove"], 10, "煮南瓜", "boil the pumpkin", ["南瓜切块，开水煮 10 分钟到筷子能扎透，沥干"], ["cut the pumpkin into chunks and boil for 10 minutes until a chopstick goes through, then drain"]),
  ],
  frozen_edamame: [
    fin(["microwave"], 3, "微波毛豆", "microwave the edamame", [`冷冻毛豆仁${MW} 3 分钟`], [`microwave the frozen edamame ${MW_EN} 3 minutes`]),
    fin(["stove"], 4, "煮毛豆", "boil the edamame", ["冷冻毛豆仁放进开水里煮 4 分钟，沥干"], ["boil the frozen edamame for 4 minutes and drain"]),
  ],
  frozen_peas: [
    fin(["microwave"], 2, "微波豌豆", "microwave the peas", [`冷冻豌豆${MW} 2 分钟`], [`microwave the frozen peas ${MW_EN} 2 minutes`]),
    fin(["stove"], 3, "煮豌豆", "boil the peas", ["冷冻豌豆放进开水里煮 3 分钟，沥干"], ["boil the frozen peas for 3 minutes and drain"]),
  ],
  sesame_seeds: [fin([], 1, "撒芝麻", "scatter the sesame", ["吃时撒上芝麻"], ["scatter the sesame seeds over at the table"])],

  // Staple foods a way names.
  corn_tortilla: tortilla("玉米饼皮", "corn tortillas"),
  whole_wheat_tortilla: tortilla("全麦卷饼皮", "whole-wheat tortillas"),
  whole_wheat_pita: [
    fin(["stove"], 2, "热口袋饼", "warm the pita", ["口袋饼放进不放油的平底锅，每面热 1 分钟", "从边上切开成口袋"], ["warm the pita in a dry frying pan, 1 minute a side", "cut it open along the edge"]),
  ],
  whole_wheat_toast: toast("全麦吐司", "whole-wheat bread"),
  white_toast: toast("白吐司", "white bread"),
  fresh_noodles: [
    fin(["stove"], 4, "煮鲜面条", "boil the noodles", ["一锅水烧开，鲜面条下锅煮 3 到 4 分钟到软", "捞出沥干"], ["bring a pot of water to a boil and cook the fresh noodles 3 to 4 minutes until tender", "drain"]),
  ],
  steamed_bun: [
    fin(["steamer"], 10, "蒸馒头", "steam the bun", ["馒头上锅蒸 10 分钟到热透"], ["steam the bun for 10 minutes until hot through"]),
    fin(["microwave"], 1, "热馒头", "warm the bun", ["馒头洒一点水，盖上微波高火 1 分钟到热透"], ["sprinkle the bun with water and microwave it, covered, on high for 1 minute until hot through"]),
  ],
};

function tortilla(zh: string, en: string): DishFinish[] {
  return [
    fin(["stove"], 2, "热饼皮", "warm the tortillas", [`${zh}放进不放油的平底锅，每面热 30 秒`], [`warm the ${en} in a dry frying pan, 30 seconds a side`]),
    fin(["microwave"], 1, "热饼皮", "warm the tortillas", [`${zh}用湿厨房纸包住，微波高火 30 秒`], [`wrap the ${en} in a damp paper towel and microwave on high for 30 seconds`]),
  ];
}

function toast(zh: string, en: string): DishFinish[] {
  return [
    fin(["toaster"], 2, "烤吐司", "toast the bread", [`${zh}放进烤面包机烤到微黄`], [`toast the ${en} until golden`]),
    fin(["stove"], 2, "煎吐司", "toast the bread", [`${zh}放进不放油的平底锅，每面煎 1 分钟到微黄`], [`toast the ${en} in a dry frying pan, 1 minute a side until golden`]),
  ];
}

/** Leafy greens are stir-fried; this is how they are told from other fresh vegetables. */
const LEAFY = /菜|叶|菠|苋|芥|青$/;
/** Roots and gourds are microwaved until a chopstick goes through. */
const ROOT = /薯|萝卜|瓜|芋|藕|山药|土豆/;

/**
 * Steps by the food's kind for a food with no entry of its own: frozen
 * vegetables microwaved, leafy greens stir-fried, roots microwaved, a staple
 * reheated or warmed, anything else washed and cut. `name` is the food's
 * shown name in each language.
 */
export function fallbackFinish(food: Food, name: { zh: string; en: string }): DishFinish[] {
  const { zh, en } = name;
  if (food.roles.includes("staple")) {
    return [
      fin(["microwave"], 2, `热${zh}`, `warm the ${en}`, [`${zh}洒一点水，盖上微波高火 2 分钟到热透`], [`sprinkle the ${en} with water and microwave it, covered, on high for 2 minutes until hot through`]),
      fin(["stove"], 3, `热${zh}`, `warm the ${en}`, [`${zh}放进锅里加一点水，盖上中小火热 3 分钟`], [`warm the ${en} in a covered pan with a splash of water over medium-low for 3 minutes`]),
    ];
  }
  if (food.category === "frozen") {
    return [
      fin(["microwave"], 3, `微波${zh}`, `microwave the ${en}`, [`${zh}${MW} 3 分钟`], [`microwave the ${en} ${MW_EN} 3 minutes`]),
      fin(["stove"], 4, `煮${zh}`, `boil the ${en}`, [`${zh}放进开水里煮 4 分钟，沥干`], [`boil the ${en} for 4 minutes and drain`]),
    ];
  }
  if (food.category === "produce" && LEAFY.test(food.zh)) {
    return [fin(["stove"], 3, `炒${zh}`, `stir-fry the ${en}`, [`${zh}洗净切段`, "锅里放{oil}，大火炒 2 到 3 分钟，加一点盐"], [`wash the ${en} and cut it into pieces`, "stir-fry in {oil} over high heat for 2 to 3 minutes with a pinch of salt"])];
  }
  if (food.category === "produce" && ROOT.test(food.zh)) {
    return [
      fin(["microwave"], 5, `微波${zh}`, `microwave the ${en}`, [`${zh}切块，${MW} 5 分钟到筷子能扎透`], [`cut the ${en} into chunks and microwave ${MW_EN} 5 minutes, until a chopstick goes through`]),
      fin(["stove"], 8, `煮${zh}`, `boil the ${en}`, [`${zh}切块，开水煮 8 分钟到筷子能扎透，沥干`], [`cut the ${en} into chunks and boil for 8 minutes until a chopstick goes through, then drain`]),
    ];
  }
  return [fin([], 2, `切${zh}`, `cut the ${en}`, [`${zh}洗净切好`], [`wash and cut the ${en}`])];
}
