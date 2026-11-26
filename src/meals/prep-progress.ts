// The prep's progress on the stored plan (docs/671 时间线与语音): Start sets the
// clock, each tap or spoken event is written into the run. The run lives in
// the plan's planner record next to preppedAt, so it syncs with the plan; it
// does not bump the revision, which counts re-solves and adjustments.
// Done is still apply.ts markPrepDone.

import type { MealsPorts } from "./apply";
import type { PrepRun, WeekPlan } from "./plan/types";
import { reschedule, runMinute, startRun, type StepEvent } from "./timeline/run";
import type { Kitchen } from "./timeline/schedule";
import { withPackStep, type PrepStep } from "./timeline/steps";
import { runFor } from "./timeline/view";

export type PrepProgressPorts = Pick<MealsPorts, "current" | "savePlan" | "now" | "changed">;

/** The session's stored steps, as the run follows them. */
export interface PrepTimeline {
  /** The stored entry's key (recipe/prep-steps.ts prepStepsKey). */
  key: string;
  steps: readonly PrepStep[];
  kitchen: Kitchen;
}

async function saveRun(ports: PrepProgressPorts, plan: WeekPlan, run: PrepRun, shopping: Parameters<MealsPorts["savePlan"]>[1]): Promise<boolean> {
  if (!plan.planner) return false;
  try {
    await ports.savePlan({ ...plan, planner: { ...plan.planner, prepRun: run } }, shopping);
  } catch {
    return false;
  }
  ports.changed();
  return true;
}

/**
 * Start the timeline now. A run already following these steps is kept, so a
 * second Start (or one from the other device) does not move the clock.
 */
export async function startPrep(ports: PrepProgressPorts, key: string): Promise<PrepRun | null> {
  const state = await ports.current();
  const plan = state.plan;
  if (!plan?.planner) return null;
  const had = runFor(plan.planner.prepRun, key);
  if (had) return had;
  const run = startRun(key, ports.now());
  return (await saveRun(ports, plan, run, state.shopping)) ? run : null;
}

export interface RecordedEvent {
  run: PrepRun;
  /** False when the event changed nothing (no such step, or it is done). */
  applied: boolean;
}

/** Write one event into the running timeline, at the run's current minute. Null when nothing is running for these steps. */
export async function recordPrepEvent(ports: PrepProgressPorts, timeline: PrepTimeline, event: StepEvent): Promise<RecordedEvent | null> {
  const state = await ports.current();
  const plan = state.plan;
  const run = runFor(plan?.planner?.prepRun, timeline.key);
  if (!plan || !run) return null;
  const next = reschedule(withPackStep(timeline.steps), timeline.kitchen, run, event, runMinute(run, ports.now()));
  if (!next.applied) return { run, applied: false };
  if (!(await saveRun(ports, plan, next.run, state.shopping))) return null;
  return { run: next.run, applied: true };
}
