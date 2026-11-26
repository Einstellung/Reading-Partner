// A prep session's shape, shared by the draft card (build-draft-card.ts) and
// the batch cook's screens (screen/batch-cook.ts, screen/prep-view.ts).

import type { Dish } from "../dishes/types";
import { estimateMinutes, type Kitchen } from "../timeline/schedule";
import type { MainSlot, PlanDraft } from "./draft";

/**
 * Hands-on and start-to-finish minutes of one prep session before its steps
 * are written: the timeline's scheduler (timeline/schedule.ts) over one step
 * per pot, each pot's library minutes, hands-on then waiting on its device.
 * One pair of hands, the longest pot first, one pot per device and one per
 * burner. Shown as 「共约」. Once the steps are written the timeline's own
 * minutes are the session's (timeline/view.ts timelineMinutes).
 */
export function prepMinutes(
  dishes: readonly (Pick<Dish, "activeMin" | "totalMin"> & Partial<Pick<Dish, "equipment">>)[],
  kitchen?: Kitchen,
): { activeMin: number; totalMin: number } {
  return estimateMinutes(dishes, kitchen);
}

/** The meal a prep session's pots are first eaten at: lunch after a morning session, dinner after an afternoon one. */
export function mealAtSession(part: PlanDraft["sessions"][number]["part"]): MainSlot | null {
  return part === "morning" ? "lunch" : part === "afternoon" ? "dinner" : null;
}
