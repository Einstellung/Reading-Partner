// What Apply on a dinner card actually does (docs/73), and what the AI is told
// afterwards.
//
// The same shape as info/briefer/card-actions.ts: sequences over ports rather
// than over the live store, so "a second click does nothing" and "a failed
// write changes nothing on screen" are testable without React and without a
// filesystem. The tools that drafted these cards wrote nothing; this is the
// only write.

import type { DinnerCharterCardData, DinnerPlanCardData } from "./cards";
import { deriveShoppingList, reconcileShoppingList } from "./shopping";
import type {
  Deviation,
  DinnerCharter,
  DinnerState,
  ShoppingItem,
  WeekPlan,
} from "./types";
import { applyDeviation, weekId } from "./week";

export interface DinnerPorts {
  // The charter, the week and the list as they are NOW. A card sits in the
  // conversation for the rest of the day, and the week it adjusts may have
  // moved on since it was drafted.
  current(): Promise<DinnerState>;
  saveCharter(charter: DinnerCharter): Promise<unknown>;
  savePlan(plan: WeekPlan, shopping: readonly ShoppingItem[]): Promise<unknown>;
  saveDeviation(
    deviation: Deviation,
    plan: WeekPlan,
    shopping: readonly ShoppingItem[],
  ): Promise<unknown>;
  // The host's clock and calendar. Never the model's (docs/73 事实不经模型).
  now(): number;
  today(): string;
  // The host reloads the screen.
  changed(): void;
}

export interface Applied {
  // False when nothing was written — the card was already applied, or the
  // write failed and the sequence stopped.
  ok: boolean;
  // The synthetic user turn telling the AI what the reader just did. Empty when
  // nothing happened, because there is then nothing to tell it.
  note: string;
}

const NOTHING: Applied = { ok: false, note: "" };

/**
 * The charter card's Apply. One household, so a second charter replaces the
 * first rather than accumulating.
 */
export async function applyCharter(
  card: DinnerCharterCardData,
  ports: DinnerPorts,
): Promise<Applied> {
  if (card.phase === "applied") return NOTHING;
  const charter: DinnerCharter = {
    people: card.people,
    stores: card.stores,
    kitchen: card.kitchen,
    dislikes: card.dislikes,
    nightsCooking: card.nightsCooking,
    nightsOut: card.nightsOut,
    nightsDelivery: card.nightsDelivery,
    text: card.text,
    updatedAt: ports.now(),
  };
  try {
    await ports.saveCharter(charter);
  } catch {
    return NOTHING;
  }
  ports.changed();
  return { ok: true, note: charterNote(charter) };
}

/**
 * The plan card's Apply: write the week, and the shopping list derived from it
 * in the same write.
 *
 * The list is derived here rather than carried on the card, because it is a
 * fact about the week and the day it is bought on, and a card drafted last
 * night would have yesterday's freeze-on-arrival marks. Ticks already made
 * survive an adjustment (reconcileShoppingList) — a re-derived list that came
 * back blank would send the reader round the shop twice.
 */
export async function applyPlan(
  card: DinnerPlanCardData,
  ports: DinnerPorts,
): Promise<Applied> {
  if (card.phase === "applied") return NOTHING;
  const state = await ports.current();
  const previous = card.adjustment ? state.plan : null;
  const plan: WeekPlan = {
    id: weekId(card.startDate),
    startDate: card.startDate,
    days: card.days,
    dishes: card.dishes,
    createdAt: previous?.createdAt ?? ports.now(),
    revision: (previous?.revision ?? 0) + 1,
  };
  const shopping = reconcileShoppingList(
    state.shopping,
    deriveShoppingList(plan, ports.today()),
  );
  try {
    await ports.savePlan(plan, shopping);
  } catch {
    return NOTHING;
  }
  ports.changed();
  return { ok: true, note: planNote(card, shopping) };
}

/**
 * A night that went differently, recorded.
 *
 * Not a card: the reader says one sentence and the bookkeeping is the
 * program's, so there is nothing to approve. It moves that night and, at most,
 * the night that was going to eat its base; the dates that come back are the
 * ones now without a dinner, for the AI to propose an adjustment for. The week
 * is never re-planned here.
 *
 * Nothing in this slice calls it yet — whoever wires the chat decides whether
 * the sentence reaches it through a tool or through the host (docs/73).
 */
export async function recordDeviation(
  deviation: Deviation,
  ports: DinnerPorts,
): Promise<Applied & { attention: string[] }> {
  const state = await ports.current();
  if (!state.plan) return { ...NOTHING, attention: [] };
  const { plan, attention } = applyDeviation(state.plan, deviation);
  const shopping = reconcileShoppingList(
    state.shopping,
    deriveShoppingList(plan, ports.today()),
  );
  const said: Deviation = {
    ...deviation,
    changed: attention.length
      ? `${attention.join(", ")} now has nothing planned.`
      : "Nothing else moved.",
    at: deviation.at || ports.now(),
  };
  try {
    await ports.saveDeviation(said, plan, shopping);
  } catch {
    return { ...NOTHING, attention: [] };
  }
  ports.changed();
  return { ok: true, note: deviationNote(said, attention), attention };
}

// --- the synthetic turns -----------------------------------------------------
//
// Said in the reader's voice, like sourceAddedNote and labFiledNote
// (info/briefer/call.ts): it is their gesture the AI is being told about.

export function charterNote(charter: DinnerCharter): string {
  return `Saved what you understood about our dinners: ${charter.text}`;
}

export function planNote(
  card: DinnerPlanCardData,
  shopping: readonly ShoppingItem[],
): string {
  const freeze = shopping.filter((i) => i.freezeOnArrival).length;
  const list =
    ` The shopping list is on my screen — ${shopping.length} things` +
    (freeze ? `, ${freeze} to freeze when I get home.` : ".") +
    " Don't read it back to me.";
  if (card.adjustment) {
    return `Applied the change to ${card.changedDates.join(", ")}.${list}`;
  }
  return `Saved this week's dinners.${list}`;
}

export function deviationNote(deviation: Deviation, attention: readonly string[]): string {
  const head = `${deviation.date}: ${deviation.said}`;
  return attention.length
    ? `${head} That leaves ${attention.join(" and ")} without a dinner — sort out those days only.`
    : `${head} Nothing else needs to change.`;
}
