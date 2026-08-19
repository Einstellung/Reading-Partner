// The morning round (docs/35): at 05:00 local time the machine holding the
// collector claim refreshes the day's briefing, so a desktop nobody has touched
// since yesterday still has one waiting when its owner wakes up and opens a
// phone (docs/36).
//
// Opening the app was the only trigger there was, which works for a device
// somebody picks up and does nothing at all for the device that actually
// collects: a PC left running crosses midnight with no foreground event, no
// mount, and no claim being taken, so nothing ever asks it for today's briefing.
//
// The judgement here is deliberately not "is it five o'clock now". A machine
// that was suspended at five, or whose timers a backgrounded webview never ran,
// has to catch the round up when it comes back rather than sit out the day; a
// machine that is awake all day has to run it once and not once per wake. So the
// question asked is which anchor has most recently gone by, and whether that one
// has been run yet. A missed anchor becomes a late round, a long sleep becomes a
// single round on the way out, and a clock that jumps cannot produce two.
//
// Pure: the clock arrives as a number and the local timezone does the rest. The
// timer, the settings, the claim and the pipeline are the assembly's business
// (live.ts).

import { localDateString } from "./store";

// Five in the morning: late enough that the overnight feeds have published,
// early enough to be there before the reader is. Not a setting — a briefing has
// one time it should be ready by, and it is not a thing worth a screen.
export const DAILY_ANCHOR_HOUR = 5;

// How often the assembly re-asks. Only a hint, like the collector's schedule
// (collector.ts): the answer comes from the clock and the recorded date, never
// from the timer having fired, so a tick that a suspended process never ran
// costs lateness and nothing else. Five minutes because being a few minutes late
// to the anchor is invisible and a tick that finds nothing due is a date
// comparison.
export const DAILY_TICK_MS = 5 * 60_000;

// The local date of the most recent anchor that has gone by: today's once the
// hour is up, yesterday's before that.
//
// Naming an anchor by a date rather than by an instant is what makes the
// comparison below survive the clock. A DST shift and a corrected clock both
// change what wall-clock 05:00 was worth in milliseconds; neither changes which
// day it belonged to. It is also why the anchor is "hour >= 5" and not "hour ==
// 5": a spring-forward that swallows the hour still leaves the day with an
// anchor that has gone by.
export function lastAnchorDate(now: number): string {
  const at = new Date(now);
  if (at.getHours() < DAILY_ANCHOR_HOUR) at.setDate(at.getDate() - 1);
  return localDateString(at);
}

// What the tick should do about the morning round.
//
//   run  — the anchor that has gone by has not been run for. Refresh the day.
//   arm  — nothing has ever been recorded: this machine has just met the anchor
//          for the first time (a fresh install, or the upgrade to the build that
//          has one). It records the anchor without spending anything, because it
//          owes no round for a morning that went by before it could know there
//          was one.
//   none — this machine has already run for the anchor that has gone by, or the
//          next one has not arrived.
export type DailyAction = "run" | "arm" | "none";

export function dailyAction(now: number, lastRunDate: string | null): DailyAction {
  // Adopting the *last* anchor rather than today's date is what keeps a machine
  // first started at 03:00 from marking a five o'clock that is still two hours
  // away as done.
  if (lastRunDate === null) return "arm";
  // Any date but this one means the round is owed, a date ahead of it included:
  // a clock corrected backwards past a recorded round leaves a stamp from a day
  // that has not happened, and the honest reading of that is one round now at
  // the time the machine currently believes in, not a machine that refuses to
  // brief until the calendar catches up.
  return lastRunDate === lastAnchorDate(now) ? "none" : "run";
}
