// The dish picture, drawn (docs/73 图片): which of the week's dishes still want
// one, and what the image model is told. Pure; the pass that draws is
// dish-draw-sweep.ts.
//
// The prompt is the plan's own facts put in a sentence by the program — the
// dish's English name, its main foods from the food table, the method line —
// and never a model's rewording of them (docs/73 事实不经模型).

import { dishArtId } from "./dish-art";
import { dishDrawingKey, normalizeSearchName, type PhotoCache } from "./dish-photos";
import { foodById } from "../nutrition/foods";
import {
  isDishDrawing,
  isDishDrawingClaim,
  MEAL_KEYS,
  type DishPhotoEntry,
  type Meal,
  type WeekPlan,
} from "../plan/types";

// Each picture is a paid call. A week has at most a dozen-odd made dishes, and
// most of them repeat from earlier weeks; the rest arrive over two or three
// rounds rather than all at once on a fresh install.
export const MAX_DRAWINGS_PER_ROUND = 6;

// How long a device's claim on a dish keeps the others off it. A picture takes
// seconds to a minute; a claim older than this is a device that went away
// mid-draw, and the dish is anyone's again.
export const DRAWING_CLAIM_MS = 15 * 60 * 1000;

// The foods named in the prompt. The dish name carries the rest.
const PROMPT_FOODS = 4;

/** Where a drawn picture's bytes are kept: named for their own hash. */
export const DRAWINGS_DIR = "meals-pictures";

export function drawingPath(hash: string, mediaType: string): string {
  const ext = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
  return `${DRAWINGS_DIR}/${hash}.${ext}`;
}

/** One dish to draw: where the answer goes, and what the model is told. */
export interface DishToDraw {
  key: string;
  prompt: string;
}

/** The meal's main foods by English name: protein, staple and produce first, oils and sauces left out. */
function mainFoods(meal: Pick<Meal, "items">): string[] {
  const front: string[] = [];
  const back: string[] = [];
  for (const item of meal.items ?? []) {
    const food = foodById(item.foodId);
    const en = normalizeSearchName(food?.en ?? "");
    if (!food || !en || front.includes(en) || back.includes(en)) continue;
    const main = item.role === "protein" || item.role === "staple" || food.category === "produce";
    (main ? front : back).push(en);
  }
  return (front.length ? front : back).slice(0, PROMPT_FOODS);
}

/**
 * What the image model is asked to draw for one made meal. Plain: the dish as
 * it is served, and the four things that must not be in it.
 */
export function dishPicturePrompt(meal: Pick<Meal, "searchName" | "name" | "items" | "method">): string {
  const dish = normalizeSearchName(meal.searchName ?? "") || (meal.name ?? "").trim();
  const foods = mainFoods(meal);
  const method = (meal.method ?? "").trim().replace(/\s+/g, " ");
  const parts = [`A photograph of ${dish}, a home-cooked dish, served on a plate on a table.`];
  if (foods.length) parts.push(`It is made with ${foods.join(", ")}.`);
  if (method) parts.push(`How it is made: ${method}`);
  parts.push("Natural light. No text, no people, no hands.");
  return parts.join(" ");
}

/**
 * Whether a dish still wants a drawing: nothing under its key, a drawing older
 * than the reader's "the pictures are wrong", or a claim that has lapsed.
 */
export function wantsDrawing(entry: DishPhotoEntry | undefined, now: number, askedAt = 0): boolean {
  if (!entry) return true;
  if (isDishDrawingClaim(entry) && now - entry.drawingSince < DRAWING_CLAIM_MS) return false;
  if (isDishDrawing(entry)) return entry.drawnAt < askedAt;
  return true;
}

/**
 * The entry a device writes before it draws a dish: a claim, on top of the
 * picture the dish already has if it is being drawn again, so the old one stays
 * on screen until the new one lands.
 */
export function claimEntry(entry: DishPhotoEntry | undefined, since: number): DishPhotoEntry {
  if (entry && isDishDrawing(entry)) return { drawing: entry.drawing, drawnAt: entry.drawnAt, drawingSince: since };
  return { drawingSince: since };
}

/**
 * The cache with this device's claims under `keys`, written at `since`, taken
 * back: a dish drawn before keeps its old picture, one never drawn loses the
 * entry. A claim of another time is another round's and stays. Null when
 * nothing changed.
 */
export function withClaimsReleased(
  cache: PhotoCache,
  keys: readonly string[],
  since: number,
): Record<string, DishPhotoEntry> | null {
  const next: Record<string, DishPhotoEntry> = { ...cache };
  let changed = false;
  for (const key of keys) {
    const entry = next[key];
    if (!entry || !isDishDrawingClaim(entry) || entry.drawingSince !== since) continue;
    if (isDishDrawing(entry)) next[key] = { drawing: entry.drawing, drawnAt: entry.drawnAt };
    else delete next[key];
    changed = true;
  }
  return changed ? next : null;
}

/** The cache keys of the week's made dishes, each once. */
export function weekDishKeys(plan: WeekPlan | null | undefined): string[] {
  const keys = new Set<string>();
  for (const day of plan?.days ?? []) {
    for (const k of MEAL_KEYS) {
      const key = day[k].mode === "make" ? dishDrawingKey(day[k].searchName ?? "") : "";
      if (key) keys.add(key);
    }
  }
  return [...keys];
}

/**
 * The week's made dishes that have no drawing yet, at most one round's worth.
 * A dish the library has a picture of (dish-art.ts) is never drawn.
 */
export function dishesToDraw(
  plan: WeekPlan,
  cache: PhotoCache,
  now: number,
  opts: { askedAt?: number; skip?: (key: string) => boolean } = {},
): DishToDraw[] {
  const out: DishToDraw[] = [];
  const seen = new Set<string>();
  for (const day of plan.days) {
    for (const k of MEAL_KEYS) {
      const meal = day[k];
      if (meal.mode !== "make" || dishArtId(meal.searchName)) continue;
      const key = dishDrawingKey(meal.searchName ?? "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (opts.skip?.(key)) continue;
      if (!wantsDrawing(cache[key], now, opts.askedAt ?? 0)) continue;
      out.push({ key, prompt: dishPicturePrompt(meal) });
    }
  }
  return out.slice(0, MAX_DRAWINGS_PER_ROUND);
}
