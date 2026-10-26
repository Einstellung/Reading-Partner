// The shopping list in whole retail packs (docs/671 整包与开封, 给用户看的量).
// Every food the solved plan uses is added up, times the people eating, and
// bought the way a shop sells it: whole packs of perishables, whole pieces of
// loose produce, whole eggs. What a perishable pack leaves over is computed
// with the day it spoils once opened; a leftover no meal uses goes back to the
// model as a draft problem (checks.ts). Pantry and long-keeping foods, food
// bought frozen, and raw meat and fish (what no meal uses is frozen raw,
// storage.ts) are not checked. Raw meat and fish wait in the fridge until
// their cooking day when they keep that long and are frozen the day they are
// bought when they do not. Grams stay inside the program: what the user reads
// is packs, pieces and "about" weights.

import { t } from "../../../i18n";
import { foodById, type Food } from "../nutrition/foods";
import type { PackKind } from "../nutrition/food-columns";
import { isBatchMain, type PlanDraft, type PlanSlot } from "./draft";
import type { SolvedPlan } from "./solve";

export type PackBuy =
  | { by: "pack"; count: number; packG: number; kind: PackKind; /** The weight on the label when it is not what the plan counts (a tin of beans is drained). */ labelG?: number }
  | { by: "piece"; count: number; pieceG: number }
  | { by: "unit"; count: number }
  | { by: "onHand" }
  | { by: "weight" };

export interface PackLine {
  food: string;
  /** What the plan needs, times the people eating. Never shown. */
  grams: number;
  buy: PackBuy;
  /** The first plan day a meal or a prep session uses it. */
  firstDay: number;
  /** The last plan day a meal or a prep session uses it. */
  lastDay: number;
  /** Raw meat or fish some meal cooks after it stops keeping raw: portioned and frozen the day it is bought. */
  freeze: boolean;
  /** Bought frozen (fish fillets, shrimp, frozen vegetables): kept frozen. */
  frozen: boolean;
  /** For perishables only: what is bought but no meal uses, and the day an opened pack of it spoils. */
  leftover: { grams: number; spoilsDay: number } | null;
}

/** A leftover under this share of one pack or piece, or under the grams, is noise from rounding, not a problem. */
export const LEFTOVER_IGNORE = { share: 0.2, grams: 50 } as const;

/**
 * The shelf-life classes whose leftover packs are checked: fresh produce,
 * tofu, fresh noodles. A w1 pack (milk, yogurt, bread, tortillas) keeps past
 * a 3-day plan into the next one, so its leftover is not a problem.
 */
const LEFTOVER_CHECKED: ReadonlySet<string> = new Set(["d1-2", "d3-5"]);

/** Whole packs or pieces for a weight, a few grams over a whole one not counting as another. */
const wholeCount = (grams: number, unit: number) => Math.max(1, Math.ceil(grams / unit - 0.02));

/** A food whose leftover pack is held to being finished: fresh produce, tofu, fresh noodles bought in packs. */
export function leftoverChecked(food: Food): boolean {
  return LEFTOVER_CHECKED.has(food.keeps) && !!food.pack && !onHand(food) && !isRawFlesh(food) && !isBoughtFrozen(food) && !food.boughtDry;
}

/** The list is bought by day 1: a food's keeping days count from it. */
export const SHOP_DAY = 1;

/** Days raw meat and fish keep in the fridge after the day they are bought, by shelf-life class (the low end). */
const RAW_KEEP_DAYS: Readonly<Record<string, number>> = { "d1-2": 1, "d3-5": 3 };

/** Raw meat, poultry or fish bought fresh. */
export function isRawFlesh(food: Food): boolean {
  return food.category === "protein" && food.keeps in RAW_KEEP_DAYS && ["meat", "poultry", "seafood"].includes(food.proteinCategory ?? "");
}

/** The last plan day raw meat or fish bought on SHOP_DAY can be cooked without freezing it first. */
export function rawKeepsUntil(food: Food): number {
  return SHOP_DAY + (RAW_KEEP_DAYS[food.keeps] ?? 0);
}

/** Sold frozen and kept frozen. */
export function isBoughtFrozen(food: Food): boolean {
  return food.category === "frozen";
}

/**
 * A seasoning, oil or spread: kept on hand, never bought for one plan. Fresh
 * produce is not (a lemon is bought), nor is a food with a retail pack (nuts,
 * sliced cheese).
 */
function onHand(food: Food): boolean {
  if (food.boughtDry) return true;
  if (food.category === "produce" || food.pack) return false;
  const keeps = food.keeps === "pantry" || food.keeps === "w2plus";
  return keeps && (food.roles.includes("sauce") || food.roles.includes("fat")) && !food.roles.includes("protein");
}

export function buyFor(food: Food, grams: number): PackBuy {
  if (onHand(food)) return { by: "onHand" };
  if (food.pack) return { by: "pack", count: wholeCount(grams, food.pack.grams), packG: food.pack.grams, kind: food.pack.kind, ...(food.pack.labelG ? { labelG: food.pack.labelG } : {}) };
  if (food.unit) return { by: "unit", count: Math.max(1, Math.round(grams / food.unit.grams)) };
  if (food.piece) return { by: "piece", count: wholeCount(grams, food.piece.grams), pieceG: food.piece.grams };
  return { by: "weight" };
}

/** The day each meal's main lines are needed: a pot's on its prep session's day. */
function dayNeeded(draft: PlanDraft, day: number, slot: PlanSlot): number {
  if (slot === "breakfast") return day;
  const main = draft.days[day - 1]?.[slot].main;
  if (!main || !isBatchMain(main)) return day;
  const batch = draft.batches.find((b) => b.id === main.batch);
  const session = draft.sessions.find((s) => s.id === batch?.session);
  return session?.day ?? day;
}

export function packList(plan: SolvedPlan, draft: PlanDraft, people = 1): PackLine[] {
  const need = new Map<string, { grams: number; firstDay: number; lastDay: number }>();
  const add = (food: string, grams: number, day: number) => {
    const had = need.get(food);
    need.set(food, {
      grams: (had?.grams ?? 0) + grams * people,
      firstDay: Math.min(had?.firstDay ?? day, day),
      lastDay: Math.max(had?.lastDay ?? day, day),
    });
  };
  for (const d of plan.days) {
    for (const slot of ["breakfast", "lunch", "dinner"] as const) {
      for (const l of d.meals[slot].lines) add(l.food, l.grams, l.source === "main" ? dayNeeded(draft, d.day, slot) : d.day);
    }
    for (const l of [...d.fruit, ...d.snack]) add(l.food, l.grams, d.day);
  }
  const out: PackLine[] = [];
  for (const [id, n] of need) {
    const food = foodById(id);
    if (!food) continue;
    const buy = buyFor(food, n.grams);
    const raw = isRawFlesh(food);
    const freeze = raw && n.lastDay > rawKeepsUntil(food);
    const frozen = isBoughtFrozen(food);
    // Loose produce is bought by the piece, so what is left is less than one
    // piece; only packs are held to finishing (docs/671 整包与开封).
    const checked = leftoverChecked(food) && buy.by === "pack";
    const leftover: PackLine["leftover"] =
      checked && buy.by === "pack"
        ? { grams: Math.max(0, buy.count * buy.packG - n.grams), spoilsDay: n.firstDay + (food.pack?.openDays ?? 0) }
        : null;
    out.push({ food: id, grams: n.grams, buy, firstDay: n.firstDay, lastDay: n.lastDay, freeze, frozen, leftover });
  }
  return out.sort((a, b) => a.firstDay - b.firstDay || a.food.localeCompare(b.food));
}

/** A leftover worth sending back: at least a fifth of a pack and at least 50 g. */
export function leftoverMatters(line: PackLine): boolean {
  if (!line.leftover || line.buy.by !== "pack") return false;
  return line.leftover.grams >= Math.max(LEFTOVER_IGNORE.share * line.buy.packG, LEFTOVER_IGNORE.grams);
}

/** The name a food is shown by: its Chinese name without the trailing note. */
export function shownName(food: Food): string {
  return food.zh.replace(/（[^）]*）$/, "");
}

/** The name a food is bought and kept by: a food planned cooked but bought dry goes by its dry name (糙米, not 糙米饭). */
export function boughtName(food: Food): string {
  return food.boughtDry?.zh ?? shownName(food);
}

const about = (g: number) => Math.max(10, Math.round(g / 10) * 10);

/** How much to buy, in the reader's language: "1 盒（约 500 g）", "2 个（约 250 g）", "家里常备". */
export function buyText(line: PackLine): string {
  const b = line.buy;
  if (b.by === "pack") return t("meals.pack.about", { qty: t(`meals.pack.${b.kind}`, { count: b.count }), grams: b.count * (b.labelG ?? b.packG) });
  if (b.by === "piece") return t("meals.pack.about", { qty: t("meals.pack.piece", { count: b.count }), grams: about(b.count * b.pieceG) });
  if (b.by === "unit") return t("meals.pack.piece", { count: b.count });
  if (b.by === "onHand") return t("meals.pack.onHand");
  return "";
}

/** One line of the list as the reader sees it: "去皮鸡腿肉 1 盒（约 500 g）". */
export function packLineText(line: PackLine): string {
  const food = foodById(line.food);
  const name = food ? boughtName(food) : line.food;
  if (line.buy.by === "weight") return t("meals.pack.about", { qty: name, grams: about(line.grams) });
  return `${name} ${buyText(line)}`;
}

/** What to do with it once bought: "买回当天分装冷冻", "买回直接冷冻", or nothing. */
export function keepText(line: PackLine): string {
  if (line.frozen) return t("meals.pack.keepFrozen");
  if (line.freeze) return t("meals.pack.freeze");
  return "";
}

/** "一锅分 3 顿". */
export function potText(meals: number): string {
  return t("meals.pack.pot", { count: meals });
}
