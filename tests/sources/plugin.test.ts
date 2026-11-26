// The helpers every source plugin shares (src/sources/plugin.ts, docs/69).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  daysBefore,
  queryInt,
  queryString,
  queryStrings,
} from "../../src/sources/plugin";
import { formatSignals } from "../../src/sources/item";

test("query helpers read loosely typed fields", () => {
  const q = { a: " x ", b: ["p", " q ", 3, ""], c: 4.7, d: -1, e: "" };
  expect(queryString(q, "a")).toBe("x");
  expect(queryString(q, "e")).toBeUndefined();
  expect(queryString(q, "zz")).toBeUndefined();
  expect(queryStrings(q, "b")).toEqual(["p", "q"]);
  expect(queryStrings(q, "a")).toEqual(["x"]);
  expect(queryStrings(q, "zz")).toEqual([]);
  expect(queryInt(q, "c")).toBe(4);
  expect(queryInt(q, "d")).toBeUndefined();
});

test("daysBefore walks the calendar in UTC", () => {
  expect(daysBefore("2026-09-13", 2)).toBe("2026-09-11");
  expect(daysBefore("2026-03-01", 1)).toBe("2026-02-28");
  expect(daysBefore("2026-01-01", 1)).toBe("2025-12-31");
  expect(daysBefore("2026-09-13", 0)).toBe("2026-09-13");
});

test("formatSignals says only what it has", () => {
  expect(formatSignals(undefined)).toBe("");
  expect(formatSignals({})).toBe("");
  expect(formatSignals({ stars: 1240, starsPeriod: 310 })).toBe("★ 1240 (+310)");
  expect(formatSignals({ starsPeriod: 12 })).toBe("★ +12");
  expect(formatSignals({ upvotes: 87, citations: 12, influentialCitations: 3, tags: ["code", "weights"] })).toBe(
    "↑ 87 · cites 12 (3 influential) · code, weights",
  );
});
