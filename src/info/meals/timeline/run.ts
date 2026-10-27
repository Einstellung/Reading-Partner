// A prep session under way (docs/671 时间线与语音): when it started and what
// the reader has said or tapped about each step, and the timeline laid out
// again from that. Program only; the model sends events, never times.
//
// Only facts are kept (plan/types.ts PrepRun): the start, and per step the
// minute it started, its hands-on part ended, it ended, or the minute the
// reader now expects it to end ("more"). Everything else is laid out again at
// the minute asked for:
//
// - a step under way stays where it started;
// - a hands-on part that runs over its estimate is not taken as done: it ends
//   no earlier than now, and the steps after it move with it;
// - a waiting part is timed by the program and over when its minutes are;
// - a step that needs the hands and has not started starts now at the
//   earliest; a waiting-only step starts as soon as it can.

import type { PrepRun, PrepStepRun } from "../plan/types";
import { schedule, type Kitchen, type Pin, type Placement, type Timeline } from "./schedule";
import { MAX_STEP_MIN, type PrepStep } from "./steps";

export type StepEventKind = "done" | "started" | "more";

/** What the reader said or tapped about a step. `minutes` is how much longer, for "more". */
export interface StepEvent {
  step: string;
  event: StepEventKind;
  minutes?: number;
}

/** 「我慢了」 with no number: a starting value (docs/671 待定). */
export const MORE_DEFAULT_MIN = 5;

export type StepStatus = "todo" | "doing" | "waiting" | "done";

/** A run started at `at` (ms) over the steps stored under `key`. */
export function startRun(key: string, at: number): PrepRun {
  return { key, startedAt: at, steps: {} };
}

/** Whole minutes from the run's start to `nowMs`. */
export function runMinute(run: Pick<PrepRun, "startedAt">, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - run.startedAt) / 60_000));
}

function pinsAt(steps: readonly PrepStep[], run: PrepRun, now: number): Map<string, Pin> {
  const pins = new Map<string, Pin>();
  for (const s of steps) {
    const r = run.steps[s.id];
    if (r?.started === undefined) continue;
    const start = r.started;
    const handsEnd = r.handsDone ?? (s.active === 0 ? start : Math.max(r.handsUntil ?? start + s.active, now));
    const end = r.done ?? Math.max(handsEnd, r.waitUntil ?? handsEnd + s.wait);
    pins.set(s.id, { start, handsEnd: Math.max(start, handsEnd), end: Math.max(handsEnd, end) });
  }
  return pins;
}

/** The timeline at minute `now` of a run, or the plan before any start when there is no run. */
export function planRun(steps: readonly PrepStep[], kitchen: Kitchen, run: PrepRun | null, now: number): Timeline {
  if (!run) return schedule(steps, kitchen);
  return schedule(steps, kitchen, { pins: pinsAt(steps, run, now), floor: now });
}

const handsOpen = (s: PrepStep, r: PrepStepRun | undefined) => s.active > 0 && r?.started !== undefined && r.handsDone === undefined;

/** Every step's status at minute `now`, read off the run and its timeline at that minute. */
export function statusesAt(steps: readonly PrepStep[], run: PrepRun | null, timeline: Timeline, now: number): Record<string, StepStatus> {
  const out: Record<string, StepStatus> = {};
  if (!run) {
    for (const s of steps) out[s.id] = "todo";
    return out;
  }
  const someOpen = steps.some((s) => handsOpen(s, run.steps[s.id]));
  for (const s of steps) {
    const r = run.steps[s.id];
    const p: Placement | undefined = timeline.placements[s.id];
    if (r?.done !== undefined) out[s.id] = "done";
    else if (handsOpen(s, r)) out[s.id] = "doing";
    else if (!p || p.start > now) out[s.id] = "todo";
    else if (s.active > 0 && r?.started === undefined) out[s.id] = someOpen ? "todo" : "doing";
    else if (p.end <= now) out[s.id] = "done";
    else out[s.id] = p.handsEnd > now ? "doing" : "waiting";
  }
  return out;
}

function ancestors(steps: readonly PrepStep[], id: string): string[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const walk = (x: string) => {
    for (const a of byId.get(x)?.after ?? []) {
      if (seen.has(a) || !byId.has(a)) continue;
      seen.add(a);
      walk(a);
    }
  };
  walk(id);
  return [...seen];
}

export interface Rescheduled {
  run: PrepRun;
  timeline: Timeline;
  /** False when the event named no step, or a step it can no longer change (already done). */
  applied: boolean;
}

/**
 * One event at minute `at`: the run with it written in, and the timeline laid
 * out again from that minute.
 *
 * - started: the step began now. The steps it waits for are over by now, and
 *   a hands-on part the reader was on is over (one pair of hands).
 * - done: ends the part under way. A hands-on part ending starts the step's
 *   waiting, which the program times; a waiting part ending ends the step. A
 *   step never started is taken as started when the hands came free.
 * - more: the part under way needs `minutes` more from now (MORE_DEFAULT_MIN
 *   when not said); a waiting part already over is opened again.
 */
export function reschedule(
  steps: readonly PrepStep[],
  kitchen: Kitchen,
  run: PrepRun,
  event: StepEvent,
  at: number,
): Rescheduled {
  const byId = new Map(steps.map((s) => [s.id, s]));
  const step = byId.get(event.step);
  const before = planRun(steps, kitchen, run, at);
  const status = statusesAt(steps, run, before, at);
  const unchanged = (): Rescheduled => ({ run, timeline: before, applied: false });
  if (!step || run.steps[step.id]?.done !== undefined) return unchanged();
  if (event.event !== "more" && status[step.id] === "done") return unchanged();

  const runs: Record<string, PrepStepRun> = Object.fromEntries(Object.entries(run.steps).map(([k, v]) => [k, { ...v }]));
  const rec = (id: string) => (runs[id] ??= {});
  const placed = (id: string) => before.placements[id]!;

  const closeFully = (id: string) => {
    const r = rec(id);
    if (r.done !== undefined) return;
    const p = placed(id);
    r.started ??= Math.min(p.start, at);
    r.handsDone ??= Math.max(r.started, Math.min(p.handsEnd, at));
    r.done = Math.max(r.handsDone, Math.min(p.end, at));
  };
  // When a step nobody said started began: once its steps were over and the hands came free.
  const impliedStart = (s: PrepStep) => {
    const ready = Math.max(0, ...s.after.map((a) => runs[a]?.done ?? placed(a).end));
    const free = Math.max(0, ...Object.values(runs).flatMap((r) => (r.handsDone !== undefined && r.handsDone <= at ? [r.handsDone] : [])));
    return Math.min(at, Math.max(ready, free));
  };

  for (const a of ancestors(steps, step.id)) closeFully(a);
  const r = rec(step.id);
  switch (event.event) {
    case "started": {
      if (r.started !== undefined) break;
      if (step.active > 0) {
        for (const other of steps) {
          const o = runs[other.id];
          if (other.id === step.id || !handsOpen(other, o)) continue;
          o!.handsDone = at;
          if (other.wait === 0) o!.done = at;
        }
      }
      r.started = at;
      break;
    }
    case "done": {
      r.started ??= step.active > 0 ? impliedStart(step) : Math.min(placed(step.id).start, at);
      if (step.active > 0 && r.handsDone === undefined) {
        r.handsDone = Math.max(r.started, at);
        delete r.handsUntil;
        if (step.wait === 0) r.done = r.handsDone;
      } else {
        r.handsDone ??= r.started;
        r.done = Math.max(r.handsDone, at);
      }
      break;
    }
    case "more": {
      const m = typeof event.minutes === "number" && Number.isFinite(event.minutes) && event.minutes > 0 ? Math.min(Math.round(event.minutes), MAX_STEP_MIN) : MORE_DEFAULT_MIN;
      if (step.active > 0 && r.handsDone === undefined) {
        r.started ??= impliedStart(step);
        r.handsUntil = at + m;
      } else {
        const p = placed(step.id);
        r.started ??= Math.min(p.start, at);
        r.handsDone ??= Math.min(p.handsEnd, at);
        r.waitUntil = at + m;
      }
      break;
    }
  }
  const next: PrepRun = { ...run, steps: runs };
  return { run: next, timeline: planRun(steps, kitchen, next, at), applied: true };
}
