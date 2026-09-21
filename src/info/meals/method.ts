// How a dish is made (docs/73 做法): the steps, written once and kept.
//
// Asked the first time someone opens the day, not when the week is planned.
// Most dishes of a week are never opened, and a week of steps written up front
// is a week of tokens spent on nothing. It is one headless turn — no thread, no
// card, nothing the reader approves — because the steps are not a change to
// their week: they are the dish they already agreed to, said in order.
//
// Nothing here throws. A method that cannot be written is a day with no steps
// on it, which is the state every day starts in.

import type { Dish, DishMethod, MealsCharter, WeekPlan } from "./types";
import { HANDS_ON_LIMIT } from "./week";

// A step longer than this is a paragraph, and a paragraph is not a step.
export const MAX_STEP_CHARS = 200;
export const MAX_STEPS = 10;

export interface MethodPorts {
  // The week as it stands. The dish is looked up here rather than passed in, so
  // two callers cannot disagree about which dish an id means.
  plan(): Promise<WeekPlan | null>;
  charter(): Promise<MealsCharter | null>;
  // One headless model turn: the system prompt and the dish, back as text.
  // Rejects like any model call; every rejection here is a null method.
  ask(system: string, user: string): Promise<string>;
  saveDishMethod(dishId: string, method: DishMethod): Promise<unknown>;
  now(): number;
}

/**
 * What the model is told before it writes a method: the household's kitchen and
 * the constraints the dish was planned under, because steps that need a second
 * pan are steps for a different dish.
 */
export function methodSystemPrompt(charter: MealsCharter | null): string {
  const lines = [
    "You write the steps for one dish, for someone who is about to cook it tonight.",
    "",
    "The dish was planned under hard constraints and the steps have to hold them:",
    "one pot or pan, no more than " + HANDS_ON_LIMIT + " minutes hands-on, no more washing up",
    "than a single meal, and — where the dish has a base and a fresh part — the base cooked",
    "once and the fresh part added at serving.",
    "",
    "Between 1 and " + MAX_STEPS + " steps. One line each, in the order they are done,",
    "in the language the dish is named in. No quantities: they are on the shopping list",
    "already. No calories, no grams of anything nutritional, no nutrition talk at all.",
    "No encouragement and no preamble.",
    "",
    'Answer with JSON and nothing else: {"steps": ["...", "..."], "note": "..."}.',
    "`note` is optional and is the one thing worth knowing that is not a step",
    '("the fifteen minutes it simmers are yours"). Leave it out when there is none.',
  ];
  if (charter) {
    lines.push(
      "",
      "The kitchen: " + (charter.kitchen || "not said") + ".",
      `${charter.people} eating.`,
    );
    if (charter.dislikes.length) lines.push(`Never used: ${charter.dislikes.join(", ")}.`);
  }
  return lines.join("\n");
}

/** The dish, as the turn is given it. */
export function methodUserText(dish: Dish): string {
  const lines = [`Dish: ${dish.name}`];
  if (dish.oneLine) lines.push(dish.oneLine);
  if (dish.base) lines.push(`Base, cooked ahead: ${dish.base}`);
  if (dish.fresh) lines.push(`Added at serving: ${dish.fresh}`);
  lines.push(`Hands-on: about ${dish.handsOnMinutes} minutes.`);
  lines.push(
    "Ingredients: " + dish.ingredients.map((i) => `${i.name} (${i.qty})`).join(", "),
  );
  return lines.join("\n");
}

/**
 * The method out of a model's reply, or null.
 *
 * Null for anything that is not the shape asked for: no steps, too many steps,
 * a step that is a paragraph. Null stores nothing — a bad reply leaves the day
 * as it was, and the next open asks again.
 */
export function parseMethod(raw: string, now: number): DishMethod | null {
  const json = firstJsonObject(raw);
  if (!json) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  if (!Array.isArray(obj.steps)) return null;
  const steps = obj.steps
    .map((s) => String(s ?? "").trim())
    .filter((s) => s !== "");
  if (steps.length === 0 || steps.length > MAX_STEPS) return null;
  if (steps.some((s) => s.length > MAX_STEP_CHARS)) return null;
  const note = String(obj.note ?? "").trim();
  const method: DishMethod = { steps, writtenAt: now };
  if (note && note.length <= MAX_STEP_CHARS * 2) method.note = note;
  return method;
}

// The first balanced {...} in the text. A model that wrapped its JSON in a
// fence or in a sentence still answered the question.
function firstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

// One turn per dish, however many callers ask at once. Two days of the week may
// cook the same dish and the screen opens both; without this the second open
// pays for a turn whose answer it then overwrites.
const inFlight = new Map<string, Promise<DishMethod | null>>();

/**
 * The dish's steps: the stored ones, or one headless turn that writes them.
 *
 * Null when there is no such dish in the week, when the model answered with
 * something that is not a method, or when the call failed. Never throws.
 */
export function ensureDishMethod(
  dishId: string,
  ports: MethodPorts,
): Promise<DishMethod | null> {
  const running = inFlight.get(dishId);
  if (running) return running;
  const task = write(dishId, ports).finally(() => {
    inFlight.delete(dishId);
  });
  inFlight.set(dishId, task);
  return task;
}

async function write(dishId: string, ports: MethodPorts): Promise<DishMethod | null> {
  try {
    const plan = await ports.plan();
    const dish = plan?.dishes.find((d) => d.id === dishId) ?? null;
    if (!dish) return null;
    if (dish.method) return dish.method;
    const charter = await ports.charter().catch(() => null);
    const reply = await ports.ask(methodSystemPrompt(charter), methodUserText(dish));
    const method = parseMethod(reply, ports.now());
    if (!method) return null;
    await ports.saveDishMethod(dishId, method);
    return method;
  } catch {
    return null;
  }
}

/** Forget what is in flight. Tests only; production has one process. */
export function resetMethodsInFlight(): void {
  inFlight.clear();
}
