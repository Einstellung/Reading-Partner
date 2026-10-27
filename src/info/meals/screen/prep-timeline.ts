// The prep page's timeline section (docs/671 备餐页 3, 时间线与语音): what the
// lane overview and the step list draw, read off timeline/view.ts. Before the
// start there are only minutes; once started, clock times from the start. The
// page reads the view again once a minute while a run is under way.

import { formatDateTime, t } from "../../../i18n";
import type { Profile } from "../nutrition/targets";
import { MORE_DEFAULT_MIN, type StepEvent, type StepStatus } from "../timeline/run";
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

// --- the overview --------------------------------------------------------------

export interface OverviewBar {
  key: string;
  n: number;
  kind: "active" | "wait";
  state: StepStatus;
  current: boolean;
  /** Percent of the track. */
  left: number;
  width: number;
  /** Wide enough to carry its number. */
  showN: boolean;
}

export interface OverviewView {
  lanes: { id: string; label: string; bars: OverviewBar[] }[];
  /** Percent of the track; minutes before the start, clock times after. */
  ticks: { key: number; label: string; at: number; align: "start" | "center" | "end" }[];
  /** The run's minute, percent of the track, while it runs. */
  now: number | null;
}

const TICK_STEPS = [5, 10, 15, 20, 30, 45, 60, 90, 120];
/** Round minutes for the one clock tick between the start and the end, largest first. */
const CLOCK_STEPS = [60, 30, 15, 10, 5];
/** A bar this many percent wide carries its number (about 17 px on a phone). */
const NUMBER_FROM = 7;

/**
 * The scale under the lanes: round minutes and the end. Clock times are
 * about a fifth of a phone's track wide, so they get the start, the end and
 * one round minute in the middle third.
 */
export function tickMinutes(total: number, clock: boolean): number[] {
  if (clock) {
    const mid = CLOCK_STEPS.map((s) => Math.round(total / 2 / s) * s).find((m) => m >= total / 3 && m <= (total * 2) / 3);
    return mid ? [0, mid, total] : [0, total];
  }
  const most = 5;
  const step = TICK_STEPS.find((s) => Math.ceil(total / s) <= most) ?? Math.ceil(total / most);
  const out: number[] = [];
  for (let m = 0; m < total - step * 0.4; m += step) out.push(m);
  out.push(total);
  return out;
}

export function overviewView(view: TimelineView, phase: PrepPhase): OverviewView {
  const total = Math.max(1, view.totalMin);
  const pct = (m: number) => Math.min(100, Math.max(0, (m / total) * 100));
  const over = phase === "finished";
  const lanes = view.lanes.map((lane) => ({
    id: lane.id,
    label: lane.label,
    bars: lane.segments
      .filter((s) => s.end > s.start)
      .map((s) => {
        const width = pct(s.end) - pct(s.start);
        return {
          key: `${s.step}:${s.kind}`,
          n: s.n,
          kind: s.kind,
          state: over ? ("done" as const) : s.status,
          current: !over && phase === "running" && s.step === view.current && s.kind === "active",
          left: pct(s.start),
          width,
          showN: width >= NUMBER_FROM,
        };
      }),
  }));
  const clock = view.startedAt;
  const ticks = tickMinutes(view.totalMin, clock !== null).map((m, i, all) => ({
    key: m,
    label: clock !== null ? clockText(clock + m * 60_000) : String(m),
    at: pct(m),
    align: i === 0 ? ("start" as const) : i === all.length - 1 ? ("end" as const) : ("center" as const),
  }));
  return { lanes, ticks, now: phase === "running" ? pct(view.minute) : null };
}

// --- the step list -------------------------------------------------------------

export type StepAction = "started" | "done" | "late";

export interface StepRowView {
  id: string;
  n: number;
  text: string;
  device: string;
  /** 「动手 10 分 · 等 30 分」 before the start, 「14:05 – 14:15」 after. */
  when: string;
  state: StepStatus;
  /** 「在做」「在等」 while it runs. */
  label: string | null;
  current: boolean;
  actions: StepAction[];
}

function minutesText(s: Pick<TimelineStepView, "activeMin" | "waitMin">): string {
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

export function stepRows(view: TimelineView, phase: PrepPhase): StepRowView[] {
  const over = phase === "finished";
  return view.steps.map((s) => {
    const state: StepStatus = over ? "done" : s.status;
    const label = phase !== "running" ? null : state === "doing" ? t("meals.timeline.now") : state === "waiting" ? t("meals.timeline.waiting") : null;
    return {
      id: s.id,
      n: s.n,
      text: s.text,
      device: s.deviceLabel,
      when: s.startAt !== null && s.endAt !== null ? `${clockText(s.startAt)} – ${clockText(s.endAt)}` : minutesText(s),
      state,
      label,
      current: phase === "running" && s.id === view.current,
      actions: stepActions(s, view, phase),
    };
  });
}
