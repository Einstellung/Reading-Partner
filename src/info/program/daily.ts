// The morning round (docs/35): at 05:00 local time the machine holding the
// collector claim refreshes the day's briefing, so a desktop nobody has touched
// since yesterday still has one waiting when its owner wakes up and opens a
// phone (docs/36).
//
// What is left in this file is the anchor: which day's five o'clock has most
// recently gone by. Whether that one has been collected for is no longer a
// judgement anybody makes — the round is a run named after its anchor, and the
// run store hands back the run that is already there (docs/55 step 12).
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
// timer, the settings, the claim and the run are the assembly's business
// (live.ts).

import { localDateString } from "../collect/store";
import { COLLECT_KIND } from "../briefer/handoff";
import { registerSchedule } from "../../legion/schedule";
import { NIGHTLY_COLLECT_ENABLED } from "./nightly-collect";

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

// The round as a schedule (docs/55): the hour is declared once, here, and which
// machine acts on it is the election for `collect`. What legion does about the
// hour is ring a wake bell, so that the soul knows the night is being worked; the
// round itself is a run the tick in live.ts delegates.
export const DAILY_ROUND_SCHEDULE = "info-daily-round";

/**
 * Register the round's schedule, unless the nightly collection is switched off
 * (nightly-collect.ts): the bell's brief says a collect run has been delegated,
 * which would be untrue with the round not running.
 */
export function registerMorningRound(enabled: boolean = NIGHTLY_COLLECT_ENABLED): boolean {
  if (!enabled) return false;
  registerSchedule({
    id: DAILY_ROUND_SCHEDULE,
    kind: COLLECT_KIND,
    at: { daily: { hour: DAILY_ANCHOR_HOUR } },
    brief:
      "The morning briefing round is due. The collect run for it has been delegated by the daily tick on this device and will report when it settles; say something to the reader only if there is something worth saying.",
  });
  return true;
}
