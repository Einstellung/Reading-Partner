// What the prep page's timeline section and the prep voice read (docs/671
// 时间线与语音): the lanes, the merged step list with each step's status, and
// once started the clock times, all from the stored steps and the run. The
// spoken sentences (next, now, left, a timer running out) are built here from
// the same view and go to TTS as they are, never through the model.
//
// Before the start there are only minutes; clock times exist only after it,
// as the start plus minutes.

import { formatDateTime, t } from "../../../i18n";
import type { PrepRun } from "../plan/types";
import { planRun, runMinute, statusesAt, type StepStatus } from "./run";
import type { Kitchen } from "./schedule";
import { COUNTER, PACK_STEP_ID, withPackStep, type LaneDevice, type PrepStep } from "./steps";

export interface TimelineInput {
  /** The stored steps (the program's last step is added here). */
  steps: readonly PrepStep[];
  kitchen: Kitchen;
  /** They box their meals: words the last step. */
  boxes: boolean;
  /** The run under way, or null before the start. */
  run: PrepRun | null;
  /** Milliseconds. */
  now: number;
}

export interface TimelineStepView {
  id: string;
  /** The number the step is called by: its place in the plan before the start. */
  n: number;
  text: string;
  device: LaneDevice;
  deviceLabel: string;
  pot: string | null;
  activeMin: number;
  waitMin: number;
  status: StepStatus;
  /** Minutes from the start. */
  start: number;
  end: number;
  /** Clock times (ms), only once started. */
  startAt: number | null;
  endAt: number | null;
  /** The program's last step, not the model's. */
  program: boolean;
}

export interface TimelineSegmentView {
  step: string;
  n: number;
  kind: "active" | "wait";
  status: StepStatus;
  start: number;
  end: number;
  startAt: number | null;
  endAt: number | null;
}

export interface TimelineLaneView {
  id: string;
  device: LaneDevice;
  label: string;
  segments: TimelineSegmentView[];
}

export interface TimelineView {
  started: boolean;
  startedAt: number | null;
  /** The minute of the run it was read at; 0 before the start. */
  minute: number;
  activeMin: number;
  totalMin: number;
  /** Minutes to the end, and hands-on minutes still ahead. */
  leftMin: number;
  handsLeftMin: number;
  /** Clock time (ms) of the end, once started. */
  endsAt: number | null;
  lanes: TimelineLaneView[];
  /** The merged list, in the order the steps are done. */
  steps: TimelineStepView[];
  /** The step the hands are on, or should be on now; null while the hands wait. */
  current: string | null;
  /** The next step still to start, hands-on ones first. */
  next: string | null;
}

export function deviceLabel(device: LaneDevice): string {
  return device === COUNTER ? t("meals.timeline.counter") : t(`meals.equipment.${device}`);
}

/**
 * The minutes of a session with written steps: the timeline's, which every
 * place that shows the session's minutes uses once the steps exist
 * (planner/prep.ts estimates them before).
 */
export function timelineMinutes(steps: readonly PrepStep[], kitchen: Kitchen): { activeMin: number; totalMin: number } {
  const plan = planRun(withPackStep(steps), kitchen, null, 0);
  return { activeMin: plan.activeMin, totalMin: plan.totalMin };
}

/** A run that follows other steps than the stored ones is not this timeline's. */
export function runFor(run: PrepRun | null | undefined, key: string): PrepRun | null {
  return run && run.key === key ? run : null;
}

export function timelineView(input: TimelineInput): TimelineView {
  const steps = withPackStep(input.steps);
  const run = input.run;
  const minute = run ? runMinute(run, input.now) : 0;
  const plan = planRun(steps, input.kitchen, run, minute);
  const status = statusesAt(steps, run, plan, minute);
  const clock = (m: number) => (run ? run.startedAt + m * 60_000 : null);
  const own = steps.length - 1;
  const numberOf = (id: string) => (id === PACK_STEP_ID ? own + 1 : Number(id) || 0);
  const byId = new Map(steps.map((s) => [s.id, s]));

  const list: TimelineStepView[] = plan.order.map((id) => {
    const s = byId.get(id)!;
    const p = plan.placements[id]!;
    const program = id === PACK_STEP_ID;
    return {
      id,
      n: numberOf(id),
      text: program ? t(input.boxes ? "meals.timeline.packBoxes" : "meals.timeline.packPots") : s.text,
      device: s.device,
      deviceLabel: deviceLabel(s.device),
      pot: s.pot,
      activeMin: s.active,
      waitMin: s.wait,
      status: status[id]!,
      start: p.start,
      end: p.end,
      startAt: clock(p.start),
      endAt: clock(p.end),
      program,
    };
  });

  const perDevice = new Map<LaneDevice, number>();
  for (const lane of plan.lanes) perDevice.set(lane.device, (perDevice.get(lane.device) ?? 0) + 1);
  const lanes: TimelineLaneView[] = plan.lanes.map((lane) => ({
    id: lane.id,
    device: lane.device,
    label: (perDevice.get(lane.device) ?? 1) > 1 ? `${deviceLabel(lane.device)} ${lane.slot}` : deviceLabel(lane.device),
    segments: lane.segments.map((seg) => ({
      ...seg,
      n: numberOf(seg.step),
      status: status[seg.step]!,
      startAt: clock(seg.start),
      endAt: clock(seg.end),
    })),
  }));

  const doing = list.filter((s) => s.status === "doing" && s.activeMin > 0);
  const todo = list.filter((s) => s.status === "todo");
  const handsLeftMin = Object.values(plan.placements).reduce((sum, p) => sum + Math.max(0, p.handsEnd - Math.max(p.start, minute)), 0);
  return {
    started: !!run,
    startedAt: run?.startedAt ?? null,
    minute,
    activeMin: plan.activeMin,
    totalMin: plan.totalMin,
    leftMin: Math.max(0, plan.totalMin - minute),
    handsLeftMin,
    endsAt: clock(plan.totalMin),
    lanes,
    steps: list,
    current: doing[0]?.id ?? null,
    next: (todo.find((s) => s.activeMin > 0) ?? todo[0])?.id ?? null,
  };
}

// --- spoken -------------------------------------------------------------------

const minutesWord = (count: number) => t("meals.timeline.minutes", { count: Math.max(1, Math.round(count)) });
const clockWord = (ms: number) => formatDateTime(new Date(ms), { hour: "numeric", minute: "2-digit" });
const stepOf = (v: TimelineView, id: string | null) => (id ? (v.steps.find((s) => s.id === id) ?? null) : null);
const allDone = (v: TimelineView) => v.steps.every((s) => s.status === "done");

/** 「下一步……」: the next step to start, and how long until it can. */
export function sayNext(v: TimelineView): string {
  if (allDone(v)) return t("meals.timeline.sayDone");
  const next = stepOf(v, v.next);
  if (!next) return t("meals.timeline.sayLast");
  if (next.start <= v.minute) return t("meals.timeline.sayNext", { step: next.text });
  return t("meals.timeline.sayNextIn", { step: next.text, minutes: minutesWord(next.start - v.minute) });
}

/** 「现在该干什么」: the step the hands are on, else what is running and what comes next. */
export function sayNow(v: TimelineView): string {
  if (allDone(v)) return t("meals.timeline.sayDone");
  const current = stepOf(v, v.current);
  if (current) return t("meals.timeline.sayNow", { step: current.text });
  const waiting = v.steps.filter((s) => s.status === "waiting").sort((a, b) => a.end - b.end)[0];
  if (!waiting) return sayNext(v);
  const wait = t("meals.timeline.sayWaiting", { device: waiting.deviceLabel, minutes: minutesWord(waiting.end - v.minute) });
  return `${wait} ${sayNext(v)}`;
}

/** 「还要多久」: minutes to the end and how many of them are hands-on; the end's clock time once started. */
export function sayLeft(v: TimelineView): string {
  if (allDone(v)) return t("meals.timeline.sayDone");
  if (v.endsAt === null) return t("meals.timeline.sayLeftBefore", { minutes: minutesWord(v.totalMin), hands: minutesWord(v.activeMin) });
  return t("meals.timeline.sayLeft", { minutes: minutesWord(v.leftMin), hands: minutesWord(v.handsLeftMin), time: clockWord(v.endsAt) });
}

/** A waiting step whose minutes ran out (「压力锅到点了，下一步……」), read at the next quiet moment. */
export function sayDue(v: TimelineView, stepId: string): string {
  const step = stepOf(v, stepId);
  const due = step ? t("meals.timeline.sayDue", { device: step.deviceLabel }) : "";
  return [due, sayNow(v)].filter(Boolean).join(" ");
}
