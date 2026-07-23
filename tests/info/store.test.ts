// Briefing store date logic (src/info/store.ts) plus the item-snapshot leaning.
// Only the pure helpers are exercised here; the fs read/write paths need the
// Tauri plugin. Run: bun test.

import { expect, test } from "bun:test";
import { leanItems, localDateString, todayLocal } from "../../src/info/store";
import type { InfoItem } from "../../src/info/types";

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

test("leanItems drops heavy contentHtml but keeps triage inputs", () => {
  const items: InfoItem[] = [
    {
      id: "1", source: "s", sourceName: "S", title: "T", url: "u", publishedAt: "",
      summary: "sum", summaryOnly: true, textContent: "body", contentHtml: "<p>heavy</p>",
    },
  ];
  const lean = leanItems(items);
  expect(lean[0].contentHtml).toBeUndefined();
  expect(lean[0].textContent).toBe("body");
  expect(lean[0].summary).toBe("sum");
  expect(lean[0].summaryOnly).toBe(true);
  expect(lean[0].sourceName).toBe("S");
});
