// The calendar day on the device's own clock, "YYYY-MM-DD". Pure, and imports
// nothing, so anything above platform can date by it.
//
// Local rather than UTC because every caller is dating something a person would
// place on a calendar: the conversation an observation was distilled from, the
// night a dream pass ran, the day a book was deleted. At UTC+8 an hour of
// late-night reading falls on the previous UTC day, so all of those would be
// written up as having happened the day before.
export function localDate(now: number): string {
  const d = new Date(now);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
