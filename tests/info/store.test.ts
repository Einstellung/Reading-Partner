// Briefing store date logic (src/info/store.ts). Only the pure date helpers are
// exercised here; the fs read/write paths need the Tauri plugin. Run: bun test.

import { expect, test } from "bun:test";
import { localDateString, todayLocal } from "../../src/info/store";

test("localDateString is local YYYY-MM-DD, zero-padded", () => {
  // Construct with local-time components so the assertion is timezone-agnostic.
  const d = new Date(2026, 0, 5, 23, 59); // Jan 5 2026, local
  expect(localDateString(d)).toBe("2026-01-05");
  const d2 = new Date(2026, 11, 31, 0, 0); // Dec 31 2026, local
  expect(localDateString(d2)).toBe("2026-12-31");
});

test("todayLocal matches localDateString(now)", () => {
  const now = new Date();
  expect(todayLocal(now)).toBe(localDateString(now));
});
