// What the meals conversation is anchored to (docs/73): the thread it writes
// to, what it lays on the desk, and the corner position card.
//
// One thread per household, not one per week: planning next week is the same
// conversation as saying last night went differently. So it has a book of its
// own rather than a day's, which also keeps its thread id unique across every
// thread file (docs/pitfall/209).

import type { DeskRef } from "../../desk";
import { t } from "../../i18n";
import { INFO_MEALS_KIND } from "../desk";
import type { MealsFocus } from "../tools";
import type { MealsState } from "../plan/types";
import { leftToBuy } from "../plan/shopping";

export interface MealsCallAnchor {
  // The thread this conversation writes to, and the thread file it lives in.
  threadId: string;
  bookKey: string;
  // A first user turn to send when the thread is empty: what the screen's
  // button said, in the reader's voice. Sent once, gated on the on-disk thread
  // being empty, so a reopened conversation never repeats it.
  kickoff?: string;
  // The chat window's empty-state heading and composer placeholder.
  emptyTitle: string;
  placeholder: string;
  // What this conversation lays on the desk, in prompt order (src/desk).
  desk: DeskRef[];
  // The corner position card.
  position: { title: string; sourceName?: string; line: string | null };
}

/** The standing meals thread, and the file it lives in. */
export const MEALS_THREAD_ID = "meals";
export const MEALS_BOOK_ID = "info-meals";

/** What the screen's button says to start a week off. */
export function mealsKickoff(): string {
  return t("meals.anchor.kickoff");
}

/** The meals conversation: the household, the week, and the tools for both. */
export function mealsAnchor(
  state: MealsState,
  today: string,
  // `focus` is which of the screens the reader pressed Ask on. It rides on the
  // desk rather than forking the thread: one standing conversation, whatever
  // they are looking at (docs/73).
  opts?: { kickoff?: string; focus?: MealsFocus },
): MealsCallAnchor {
  return {
    threadId: MEALS_THREAD_ID,
    bookKey: MEALS_BOOK_ID,
    emptyTitle: t("meals.anchor.title"),
    placeholder: t("meals.anchor.placeholder"),
    desk: [{ kind: INFO_MEALS_KIND, ref: { state, today, ...(opts?.focus ? { focus: opts.focus } : {}) } }],
    position: mealsPosition(state),
    ...(opts?.kickoff ? { kickoff: opts.kickoff } : {}),
  };
}

/**
 * The corner position card as the meals stand now. The conversation changes
 * the plan it is about, so the card is drawn from the meals as last read rather
 * than from the anchor's copy.
 */
export function mealsPosition(state: MealsState): MealsCallAnchor["position"] {
  return { title: t("meals.anchor.title"), line: mealsLine(state) };
}

function mealsLine(state: MealsState): string | null {
  if (!state.plan) return t("meals.anchor.noPlan");
  const left = leftToBuy(state.shopping);
  return left ? t("meals.anchor.leftToBuy", { count: left }) : t("meals.anchor.thisWeek");
}
