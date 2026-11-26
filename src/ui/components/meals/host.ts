// The decisions the meals host makes that need no React: which screens are the
// meals line's, where the conversation's scroll position is kept, how the call
// gets out of the way of a plan just applied.

import type { HomeScreen } from "../base/shell-nav";
import { navigateAway } from "../chat/call/call-layout";
import { mealsPosition, type MealsCallAnchor } from "../../../meals/conversation/anchor";
import type { MealsState } from "../../../meals/plan/types";

/** The screens of the meals line. They share one hook, one thread and one sidebar item. */
export function isMealsScreen(screen: HomeScreen | null): boolean {
  return (
    screen === "meals" ||
    screen === "meals-shopping" ||
    screen === "meals-day" ||
    screen === "meals-recipe" ||
    screen === "meals-prep" ||
    screen === "meals-method" ||
    screen === "meals-onboarding"
  );
}

/**
 * The key the conversation's scroll position is stored under
 * (ui/components/common/scroll-memory.ts). The thread is one standing thread,
 * so the key is the thread's alone; the prefix keeps it out of the reading
 * thread-id space.
 */
export function mealsStickKey(threadId: string): string {
  return `meals:${threadId}`;
}

/**
 * After a plan is applied: the host opens the plan's batch cook (or the Meals
 * page for null), and the call gets out of its way the way a card that opens
 * content does (docs/ui/22): into the pip where there is one, hung up where
 * the chat is the whole screen.
 */
export function leaveForAppliedPlan(
  session: string | null,
  pipCards: boolean,
  to: { open: (session: string | null) => void; swap: () => void; hangUp: () => void },
): void {
  to.open(session);
  if (navigateAway(pipCards) === "swap") to.swap();
  else to.hangUp();
}

/**
 * The corner position card as it stands now. The conversation changes the plan
 * it is about, so the card is drawn from the meals as last read; until they
 * have been read it is the anchor's copy.
 */
export function mealsCallPosition(anchor: MealsCallAnchor, state: MealsState | null): MealsCallAnchor["position"] {
  return state ? mealsPosition(state) : anchor.position;
}
