// Calendar days: the day on the device's own clock as "YYYY-MM-DD", and the
// arithmetic between such days. Pure, and imports nothing, so anything can date
// by it.
//
// Local rather than UTC because every caller is dating something a person would
// place on a calendar: the conversation an observation was distilled from, the
// night a dream pass ran, the day a book was deleted. At UTC+8 an hour of
// late-night reading falls on the previous UTC day, so all of those would be
// written up as having happened the day before.
//
// The arithmetic reads a date string at midnight UTC. The string is already a
// local calendar day, not an instant; going through UTC keeps a daylight-saving
// boundary from adding or losing an hour between two of them.

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The local calendar day `now` falls on, "YYYY-MM-DD". */
export function localDate(now: number): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A "YYYY-MM-DD" date as whole days since 1970-01-01. Null if it is not one. */
export function dayNumber(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS);
}

function fromDayNumber(n: number): string {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}

/** The date `n` days after `date` (before, when negative). Returns `date` unchanged if unparseable. */
export function addDays(date: string, n: number): string {
  const d = dayNumber(date);
  return d === null ? date : fromDayNumber(d + n);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. Null if either is not a date. */
export function daysBetween(from: string, to: string): number | null {
  const a = dayNumber(from);
  const b = dayNumber(to);
  return a === null || b === null ? null : b - a;
}

/** ISO weekday of a date: Monday 1 … Sunday 7. 0 when unparseable. */
export function isoWeekday(date: string): number {
  const d = dayNumber(date);
  if (d === null) return 0;
  // 1970-01-01 was a Thursday (4).
  return ((((d + 3) % 7) + 7) % 7) + 1;
}
