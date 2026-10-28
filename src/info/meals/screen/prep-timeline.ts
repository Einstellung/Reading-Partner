// The prep page's timeline section (docs/671 备餐页 3, 时间线与语音): the phase,
// the clock and the taps every step offers, read off timeline/view.ts. The
// graph itself is prep-graph.ts. Before the start there are only minutes; once
// started, clock times from the start. The page reads the view again once a
// minute while a run is under way.

import { formatDateTime, t } from "../../../i18n";
import type { Profile } from "../nutrition/targets";
import { MORE_DEFAULT_MIN, type StepEvent } from "../timeline/run";
import { kitchenFor } from "../timeline/schedule";
import type { PrepStep } from "../timeline/steps";
import { timelineMinutes, type TimelineStepView, type TimelineView } from "../timeline/view";

/** The session's stored steps as the page and the entries see them. */
export type PrepStepsStatus =
  // No session, or no steps yet and nothing asked for them (the Meals page and the tile).
  | { kind: "none" }
  | { kind: "reading" }
  | { kind: "writing" }
  | { kind: "ready"; key: string; at: number; steps: readonly PrepStep[] }
  | { kind: "failed" };

/** The timeline's minutes once the steps are written, for every place that shows the session's minutes. */
export function writtenMinutes(
  status: PrepStepsStatus,
  profile: Pick<Profile, "burners"> | null | undefined,
): { activeMin: number; totalMin: number } | null {
  return status.kind === "ready" ? timelineMinutes(status.steps, kitchenFor(profile)) : null;
}

/** Before the start, under way, or over. Done (preppedAt) ends it, started or not. */
export type PrepPhase = "before" | "running" | "finished";

export function prepPhase(view: Pick<TimelineView, "started"> | null, done: boolean): PrepPhase {
  if (done) return "finished";
  return view?.started ? "running" : "before";
}

/** The screen stays on only while a run is under way on this page. */
export function wantsWakeLock(phase: PrepPhase): boolean {
  return phase === "running";
}

/** 「慢了」: minutes more, the first being the default when nothing is said (run.ts). */
export const LATE_CHIPS: readonly number[] = [MORE_DEFAULT_MIN, 10];

export function lateEvent(step: string, minutes: number): StepEvent {
  return { step, event: "more", minutes };
}

/**
 * Milliseconds until the run's minute moves on, a little after it so the
 * floor lands on the new minute. A start in the future (another device's
 * clock) is checked again within a minute.
 */
export function msToNextMinute(now: number, startedAt: number): number {
  const SLACK = 50;
  if (now < startedAt) return Math.min(60_000, startedAt - now) + SLACK;
  return 60_000 - ((now - startedAt) % 60_000) + SLACK;
}

export function clockText(ms: number): string {
  return formatDateTime(new Date(ms), { hour: "numeric", minute: "2-digit" });
}

/** 「12:40 结束」 in the top bar while a run is under way. */
export function endsText(view: TimelineView | null, phase: PrepPhase): string | null {
  if (phase !== "running" || !view || view.endsAt === null) return null;
  return t("meals.timeline.ends", { time: clockText(view.endsAt) });
}

// --- per step ------------------------------------------------------------------

export type StepAction = "started" | "done" | "late";

/** 「动手 10 分 · 等 30 分」: a step's minutes before the start. */
export function minutesText(s: Pick<TimelineStepView, "activeMin" | "waitMin">): string {
  const parts: string[] = [];
  if (s.activeMin > 0) parts.push(t("meals.timeline.hands", { minutes: s.activeMin }));
  if (s.waitMin > 0) parts.push(t("meals.timeline.wait", { minutes: s.waitMin }));
  return parts.join(" · ");
}

/** What a tap can say about a step: start the next one, finish or stretch the one under way or waiting. */
export function stepActions(step: Pick<TimelineStepView, "id" | "status">, view: Pick<TimelineView, "next">, phase: PrepPhase): StepAction[] {
  if (phase !== "running") return [];
  if (step.status === "doing" || step.status === "waiting") return ["done", "late"];
  if (step.status === "todo" && step.id === view.next) return ["started"];
  return [];
}
