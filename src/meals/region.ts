// Which BMI cut points and fat range apply (nutrition/targets.ts Region). Never
// asked of the reader: it follows the host's time zone, and this is the one
// place that reads it.

import type { Region } from "./nutrition/targets";

// Mainland China's zones, current and legacy spellings.
const CN_ZONES: ReadonlySet<string> = new Set([
  "Asia/Shanghai",
  "Asia/Chongqing",
  "Asia/Chungking",
  "Asia/Harbin",
  "Asia/Urumqi",
  "Asia/Kashgar",
  "PRC",
]);

/** The region a time zone name stands for. */
export function regionForTimeZone(timeZone: string | undefined): Region {
  return timeZone && CN_ZONES.has(timeZone) ? "CN" : "other";
}

/** The region of the machine this runs on. */
export function hostRegion(): Region {
  let timeZone: string | undefined;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    timeZone = undefined;
  }
  return regionForTimeZone(timeZone);
}
