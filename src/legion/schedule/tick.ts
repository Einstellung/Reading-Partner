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
import { dueSchedules, registeredSchedules, type DueSchedule, type Schedule } from "./schedule";

export interface ScheduleTickDeps {
  deviceId: string;
  now?: number;
  /** Defaults to everything registered. */
  schedules?: readonly Schedule[];
  claims?: () => Promise<DeviceClaim[]>;
  fired?: FiredStore;
  bells?: BellStore;
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
