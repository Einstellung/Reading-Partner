// The nightly increment's clock (docs/info/88 「排队」). The anchor is 01:00
// local time and the judgement is the one the 05:00 round makes
// (info/program/daily.ts): which night's 01:00 has most recently gone by, and
// whether this machine has run it. A night's runs are keyed by that date, so a
// second ask meets the run already there. Reading starts 0 to 40 minutes after
// the anchor, at an offset fixed per device and night, and stops at 04:40; a
// machine that slept through 01:00 and wakes before 04:40 catches up, one that
// wakes later leaves the night unread.
//
// Pure; the timer and the files are runs-live.ts's.

import type { TopicSearch } from "./types";
import { localDay } from "./x-progress";

export const NIGHT_ANCHOR_HOUR = 1;
export const NIGHT_END = { hour: 4, minute: 40 };
export const NIGHT_SPREAD_MS = 40 * 60_000;

/** The local date of the most recent 01:00 that has gone by. */
export function lastNightAnchor(now: number): string {
  const at = new Date(now);
  if (at.getHours() < NIGHT_ANCHOR_HOUR) at.setDate(at.getDate() - 1);
  return localDay(at.getTime());
}

function at(night: string, hour: number, minute: number): number {
  const [y, m, d] = night.split("-").map(Number);
  return new Date(y, m - 1, d, hour, minute, 0, 0).getTime();
}

/** 04:40 of the night: reading ends here whatever is left. */
export function nightEndAt(night: string): number {
  return at(night, NIGHT_END.hour, NIGHT_END.minute);
}

/** Where in the 40 minutes after the anchor reading starts, the same on every tick of the night. */
export function nightOffsetMs(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % NIGHT_SPREAD_MS;
}

/** When this device starts reading on the night. */
export function nightStartAt(night: string, deviceId: string): number {
  return at(night, NIGHT_ANCHOR_HOUR, 0) + nightOffsetMs(`${deviceId}:${night}`);
}

/** Whole nights from `from` to `to` (local dates). */
export function nightsBetween(from: string, to: string): number {
  const utc = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** The last night, and whether now is inside this device's reading window of it. */
export function inNightWindow(now: number, deviceId: string): { night: string; open: boolean } {
  const night = lastNightAnchor(now);
  return { night, open: now >= nightStartAt(night, deviceId) && now < nightEndAt(night) };
}

export interface NightConditions {
  collecting: boolean;
  webview: boolean;
  sessionValid: boolean;
  /** Why X may not be read tonight (halt.ts), or null. */
  gate: string | null;
  searches: readonly TopicSearch[];
}

export type NightPlan = { dispatch: TopicSearch[] } | { wait: string };

/** The night's increments, one per active search in the order they were made, or why none. */
export function planNight(c: NightConditions): NightPlan {
  if (!c.collecting) return { wait: "not the collector" };
  if (!c.webview) return { wait: "no webview fetch here" };
  if (c.gate) return { wait: c.gate };
  if (!c.sessionValid) return { wait: "no X session" };
  const active = c.searches.filter((s) => s.status === "active").sort((a, b) => a.createdAt - b.createdAt);
  if (active.length === 0) return { wait: "no active topic search" };
  return { dispatch: active };
}
