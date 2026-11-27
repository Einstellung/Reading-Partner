// The times of day something is owed (docs/55).
//
// What a schedule produces when it comes due is a `wake` bell, never a run:
// what to do about the hour is the soul's decision, and legion only knows that
// the hour has gone by.
//
// Registered in code, like a kind's capabilities: the domain that owns the
// nightly work registers its schedule at startup. There is no schedule file,
// so nothing has to be migrated when a time changes.
//
// The anchor a device last fired for — kept on disk, per device (fired.ts) —
// keeps it from firing twice for the same hour. Nothing picks one device among
// several: each device that is up at the hour rings, under the same bell id.
// No schedule is registered today.
//
// The judgement is deliberately not "is it five o'clock now". A machine that
// was asleep at five, or whose timers a backgrounded webview never ran, has to
// catch the hour up when it comes back rather than sit the day out; a machine
// awake all day has to act once and not once per tick. So the question asked is
// which anchor has most recently gone by, and whether this device has fired for
// that one yet. A missed anchor becomes a late bell, a long sleep becomes one
// bell on the way out, and a clock that jumps cannot produce two.

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
  at: ScheduleAt;
  /** The brief the wake bell carries: a reference, as everything else is. */
  brief: string;
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

/** What this device should do about the schedules, now. */
export function dueSchedules(
  schedules: readonly Schedule[],
  lastFiredAt: Readonly<Record<string, number>>,
  now: number,
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
    out.push({ schedule, anchor, action: "fire" });
  }
  return out;
}
