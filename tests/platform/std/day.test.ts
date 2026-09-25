import { afterEach, describe, expect, test } from "bun:test";
import { addDays, dayNumber, daysBetween, isoWeekday, localDate } from "../../../src/platform/std/day";

// Run the zone-dependent cases in a zone with daylight saving, then put the
// process's zone back so no other file sees it.
const ORIGINAL_TZ = process.env.TZ;
function inZone(tz: string): void {
  process.env.TZ = tz;
}
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

describe("localDate", () => {
  test("reads the device's clock, not UTC", () => {
    inZone("Asia/Shanghai");
    // 23:30 on the 17th in Shanghai is 15:30 UTC the same day; 00:30 on the
    // 18th is still the 17th in UTC.
    expect(localDate(Date.UTC(2026, 6, 17, 15, 30))).toBe("2026-07-17");
    expect(localDate(Date.UTC(2026, 6, 17, 16, 30))).toBe("2026-07-18");
  });

  test("the last and first minutes around a DST change stay on their own days", () => {
    inZone("America/New_York");
    // Spring forward on 2026-03-08: 02:00 EST jumps to 03:00 EDT.
    expect(localDate(new Date(2026, 2, 7, 23, 59).getTime())).toBe("2026-03-07");
    expect(localDate(new Date(2026, 2, 8, 0, 0).getTime())).toBe("2026-03-08");
    expect(localDate(new Date(2026, 2, 8, 23, 59).getTime())).toBe("2026-03-08");
    // Fall back on 2026-11-01: 02:00 EDT repeats as 01:00 EST, a 25-hour day.
    expect(localDate(new Date(2026, 10, 1, 23, 59).getTime())).toBe("2026-11-01");
    expect(localDate(new Date(2026, 10, 2, 0, 0).getTime())).toBe("2026-11-02");
  });

  test("pads month and day", () => {
    expect(localDate(new Date(2026, 0, 5, 12).getTime())).toBe("2026-01-05");
  });
});

describe("dayNumber", () => {
  test("counts days from the epoch", () => {
    expect(dayNumber("1970-01-01")).toBe(0);
    expect(dayNumber("1970-01-02")).toBe(1);
    expect(dayNumber("1969-12-31")).toBe(-1);
  });

  test("is null for anything not YYYY-MM-DD", () => {
    expect(dayNumber("")).toBeNull();
    expect(dayNumber("not-a-date")).toBeNull();
    expect(dayNumber("2026-9-5")).toBeNull();
    expect(dayNumber("2026-09-05T00:00")).toBeNull();
    expect(dayNumber("2026-13-01")).toBeNull();
  });
});

describe("addDays", () => {
  test("walks the calendar across month, year and leap day", () => {
    expect(addDays("2026-09-13", -2)).toBe("2026-09-11");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
    expect(addDays("2025-12-31", 1)).toBe("2026-01-01");
    expect(addDays("2026-09-13", 0)).toBe("2026-09-13");
  });

  test("a DST weekend is a day like any other, in any zone", () => {
    for (const tz of ["America/New_York", "Europe/Berlin", "Australia/Sydney"]) {
      inZone(tz);
      expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
      expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
      expect(addDays("2026-03-28", 2)).toBe("2026-03-30");
      expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
      expect(addDays("2026-10-31", 2)).toBe("2026-11-02");
      expect(addDays("2026-04-04", 1)).toBe("2026-04-05");
      expect(addDays("2026-04-05", 1)).toBe("2026-04-06");
    }
  });

  test("hands back an unparseable date unchanged", () => {
    expect(addDays("not-a-date", 3)).toBe("not-a-date");
  });
});

describe("daysBetween", () => {
  test("counts whole days, negative when going back", () => {
    expect(daysBetween("2026-08-08", "2026-08-11")).toBe(3);
    expect(daysBetween("2026-08-11", "2026-08-11")).toBe(0);
    expect(daysBetween("2026-08-12", "2026-08-11")).toBe(-1);
  });

  test("a span across a DST change is still whole days", () => {
    inZone("America/New_York");
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
    inZone("Europe/Berlin");
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
  });

  test("is null when either end is not a date", () => {
    expect(daysBetween("not-a-date", "2026-08-11")).toBeNull();
    expect(daysBetween("2026-08-11", "")).toBeNull();
  });
});

describe("isoWeekday", () => {
  test("Monday is 1 and Sunday is 7", () => {
    expect(isoWeekday("2026-09-21")).toBe(1);
    expect(isoWeekday("2026-09-25")).toBe(5);
    expect(isoWeekday("2026-09-27")).toBe(7);
    expect(isoWeekday("1970-01-01")).toBe(4);
    expect(isoWeekday("1969-12-29")).toBe(1);
  });

  test("0 when unparseable", () => {
    expect(isoWeekday("someday")).toBe(0);
  });
});
