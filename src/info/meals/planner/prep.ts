// A prep session's shape, shared by the draft card (build-draft-card.ts) and
// the batch cook's screens (screen/batch-cook.ts, screen/prep-view.ts).

import type { Dish } from "../dishes/types";
import type { MainSlot, PlanDraft } from "./draft";

/**
 * Hands-on and start-to-finish minutes of one prep session: one pair of hands,
 * the longest pot started first, each pot's hands-on part before its waiting.
 * Shown as 「共约」, an estimate until the timeline (docs/671 时间线与语音).
 */
export function prepMinutes(dishes: readonly Pick<Dish, "activeMin" | "totalMin">[]): { activeMin: number; totalMin: number } {
  const sorted = [...dishes].sort((a, b) => b.totalMin - a.totalMin);
  let hands = 0;
  let end = 0;
  for (const d of sorted) {
    end = Math.max(end, hands + Math.max(d.totalMin, d.activeMin));
    hands += d.activeMin;
  }
  return { activeMin: hands, totalMin: Math.max(end, hands) };
}

/** The meal a prep session's pots are first eaten at: lunch after a morning session, dinner after an afternoon one. */
export function mealAtSession(part: PlanDraft["sessions"][number]["part"]): MainSlot | null {
  return part === "morning" ? "lunch" : part === "afternoon" ? "dinner" : null;
}
