// One look at the clock: what is due on this device, and the bell it rings.
//
// The only side effects in this directory. Everything it decides comes from
// schedule.ts, which is pure; what is here is the order — ring, then write down
// — and it is that way round because ringing twice for one anchor leaves one
// bell (the bell's id is the schedule and the anchor) while a bell that was
// never rung because the record went first is an hour silently skipped.

import { appBells, type BellStore } from "../bell";
import { appClaims, type DeviceClaim } from "../claim";
import { appFired, type FiredStore } from "./fired";
import { dueJobs, jobFiredKey, registeredNightlyJobs, type NightlyJob } from "./jobs";
import { dueSchedules, registeredSchedules, type DueSchedule, type Schedule } from "./schedule";

export interface ScheduleTickDeps {
  deviceId: string;
  now?: number;
  /** Defaults to everything registered. */
  schedules?: readonly Schedule[];
  claims?: () => Promise<DeviceClaim[]>;
  fired?: FiredStore;
  bells?: BellStore;
  /** Defaults to every nightly job registered (jobs.ts). */
  jobs?: readonly NightlyJob[];
}

/** A wake bell's id: one per schedule per anchor, so a second ring is the same bell. */
export function wakeBellId(scheduleId: string, anchor: number): string {
  return `wake-${scheduleId}-${anchor}`;
}

/**
 * Ring for whatever this device owes, and say what was dealt with. Never
 * rejects on a bell that would not write: an hour that could not be rung for is
 * late, and it must not take the tick down with it.
 */
export async function runScheduleTick(deps: ScheduleTickDeps): Promise<DueSchedule[]> {
  const now = deps.now ?? Date.now();
  const due = await ringSchedules(deps, now);
  await runNightlyJobs(deps, now);
  return due;
}

async function ringSchedules(deps: ScheduleTickDeps, now: number): Promise<DueSchedule[]> {
  const schedules = deps.schedules ?? registeredSchedules();
  if (schedules.length === 0) return [];
  const fired = deps.fired ?? appFired();
  const claims = await (deps.claims ?? (() => appClaims().readAll()))().catch(
    () => [] as DeviceClaim[],
  );
  const due = dueSchedules(schedules, await fired.read(), claims, now, deps.deviceId);
  const bells = deps.bells ?? appBells();
  for (const item of due) {
    if (item.action === "fire") {
      try {
        await bells.ring(
          "wake",
          { scheduleId: item.schedule.id, brief: item.schedule.brief },
          { id: wakeBellId(item.schedule.id, item.anchor), at: item.anchor },
        );
      } catch (e) {
        console.warn(`failed to ring for the schedule ${item.schedule.id}`, e);
        continue;
      }
    }
    await fired.record(item.schedule.id, item.anchor);
  }
  return due;
}

// The anchor is written down before the job runs, the other way round from a
// bell: running a job twice for one night is a second full pass, and a job that
// failed is late by a night rather than retried on every five-minute tick. Two
// ticks can overlap (a foreground edge lands while the timer's is running), so a
// job already running in this process is skipped rather than started twice.
const runningJobs = new Set<string>();

async function runNightlyJobs(deps: ScheduleTickDeps, now: number): Promise<void> {
  const jobs = (deps.jobs ?? registeredNightlyJobs()).filter((j) => !runningJobs.has(j.id));
  if (jobs.length === 0) return;
  for (const job of jobs) runningJobs.add(job.id);
  try {
    const fired = deps.fired ?? appFired();
    for (const item of dueJobs(jobs, await fired.read(), now)) {
      await fired.record(jobFiredKey(item.job.id), item.anchor);
      if (item.action !== "run") continue;
      try {
        await item.job.run();
      } catch (e) {
        console.warn(`the nightly job ${item.job.id} failed`, e);
      }
    }
  } finally {
    for (const job of jobs) runningJobs.delete(job.id);
  }
}
