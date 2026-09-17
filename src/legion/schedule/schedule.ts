// The times of day something is owed, and which machine owes it (docs/55).
//
// What a schedule produces when it comes due is a `wake` bell, never a run:
// what to do about the hour is the soul's decision, and legion only knows that
// the hour has gone by and whose hour it is.
//
// Registered in code, like a kind's capabilities: the domain that owns the
// nightly work registers its schedule at startup. There is no schedule file,
// so nothing has to be migrated when a time changes.
//
// Two devices both reaching the hour produce one bell, by two things together:
// the election narrows it to the machine that won the schedule's kind, and the
// anchor it last fired for — kept on disk, per device (fired.ts) — keeps that
// machine from firing twice for the same hour.
//
// The judgement is deliberately not "is it five o'clock now". A machine that
// was asleep at five, or whose timers a backgrounded webview never ran, has to
// catch the hour up when it comes back rather than sit the day out; a machine
// awake all day has to act once and not once per tick. So the question asked is
// which anchor has most recently gone by, and whether this device has fired for
// that one yet. A missed anchor becomes a late bell, a long sleep becomes one
// bell on the way out, and a clock that jumps cannot produce two.

import { capabilitiesFor, electAmong, type DeviceClaim } from "../claim";

/** A daily time, local to the machine. */
export interface DailyAt {
  daily: { hour: number; minute?: number };
}

/**
 * The cron subset: `m h * * *` and `m h * * d`, with `d` a single day of the
 * week, 0 being Sunday. Everything else — lists, ranges, steps, days of the
 * month — is not read, and a schedule carrying one never comes due.
 */
export interface CronAt {
  cron: string;
}

export type ScheduleAt = DailyAt | CronAt;

export interface Schedule {
  id: string;
  /**
   * The kind whose election decides which machine acts on this hour. The
   * schedule does not create a run of that kind — it is how "one machine, not
   * both" is answered without a second rule.
   */
  kind: string;
  at: ScheduleAt;
  /** The brief the wake bell carries: a reference, as everything else is. */
  brief: string;
  /**
   * Capabilities beyond what the kind already asks for, for an hour that needs
   * more of a machine than the work usually does.
   */
  requires?: readonly string[];
}

const registry = new Map<string, Schedule>();

/** Register a schedule. Registering the same id again replaces it. */
export function registerSchedule(schedule: Schedule): void {
  registry.set(schedule.id, schedule);
}

export function registeredSchedules(): Schedule[] {
  return [...registry.values()];
}

// --- when ---------------------------------------------------------------

interface Anchor {
  hour: number;
  minute: number;
  /** 0-6, Sunday first, or null for every day. */
  weekday: number | null;
}

function parseAt(at: ScheduleAt): Anchor | null {
  if ("daily" in at) {
    const { hour, minute = 0 } = at.daily;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
    if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
    return { hour, minute, weekday: null };
  }
  const parts = at.cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [m, h, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*") return null;
  const minute = Number(m);
  const hour = Number(h);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) return null;
  if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
  if (dow === "*") return { hour, minute, weekday: null };
  const weekday = Number(dow);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  return { hour, minute, weekday };
}

/**
 * The most recent moment this schedule was due, at or before `now`, in local
 * time. Null for a time nothing can read.
 */
export function lastAnchor(at: ScheduleAt, now: number): number | null {
  const spec = parseAt(at);
  if (spec === null) return null;
  const when = new Date(now);
  when.setHours(spec.hour, spec.minute, 0, 0);
  if (when.getTime() > now) when.setDate(when.getDate() - 1);
  if (spec.weekday === null) return when.getTime();
  // At most a week back: one of the seven is the weekday asked for.
  for (let i = 0; i < 7; i += 1) {
    if (when.getDay() === spec.weekday) return when.getTime();
    when.setDate(when.getDate() - 1);
  }
  return null;
}

// --- who ----------------------------------------------------------------

/** The device that acts on this schedule, or null when no machine can. */
export function electForSchedule(
  schedule: Schedule,
  claims: readonly DeviceClaim[],
  now: number,
): string | null {
  const kindNeeds = capabilitiesFor(schedule.kind);
  // A kind nobody registered has no machine that may run it, and an hour whose
  // work nothing claims is an hour nobody acts on.
  if (kindNeeds === null) return null;
  const needs = [...new Set([...kindNeeds, ...(schedule.requires ?? [])])];
  return electAmong(needs, claims, now)?.deviceId ?? null;
}

// --- due ----------------------------------------------------------------

export interface DueSchedule {
  schedule: Schedule;
  /** The moment it was due, which is what gets written down as fired. */
  anchor: number;
  /**
   * `fire` — ring the wake bell and write the anchor down.
   * `arm`  — write the anchor down and spend nothing. This device has just met
   *          the schedule for the first time (a fresh install, or the build
   *          that introduced it), and it owes nothing for an hour that went by
   *          before it could know there was one.
   */
  action: "fire" | "arm";
}

/**
 * What this device should do about the schedules, now. Arming does not ask who
 * won: the record is this device's own, and a machine that wrote nothing down
 * while another one was firing would fire for an hour long past the first time
 * it took over.
 */
export function dueSchedules(
  schedules: readonly Schedule[],
  lastFiredAt: Readonly<Record<string, number>>,
  claims: readonly DeviceClaim[],
  now: number,
  deviceId: string,
): DueSchedule[] {
  const out: DueSchedule[] = [];
  for (const schedule of schedules) {
    const anchor = lastAnchor(schedule.at, now);
    if (anchor === null) continue;
    const fired = lastFiredAt[schedule.id];
    if (fired === undefined) {
      out.push({ schedule, anchor, action: "arm" });
      continue;
    }
    // Any anchor but the one written down is an hour owed, one ahead of it
    // included: a clock corrected backwards past a firing leaves a stamp from
    // an hour that has not happened, and the honest reading of that is one bell
    // now, at the time the machine currently believes in.
    if (fired === anchor) continue;
    if (electForSchedule(schedule, claims, now) !== deviceId) continue;
    out.push({ schedule, anchor, action: "fire" });
  }
  return out;
}
