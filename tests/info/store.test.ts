// Briefing store date logic (src/info/briefing/store.ts) plus the item-snapshot
// leaning and the inlined-HTML merge. Only the pure helpers are exercised here;
// the fs read/write paths need the Tauri plugin. Run: bun test.

import { expect, test } from "bun:test";
import {
  leanItems,
  localDateString,
  mergeInlinedHtml,
  staleDailyFiles,
  todayLocal,
} from "../../src/info/briefing/store";
import type { InfoItem } from "../../src/info/briefing/types";

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

test("staleDailyFiles keeps every one of today's files, run checkpoint included", () => {
  const names = [
    "briefing-2026-07-25.json",
    "info-articles-2026-07-25.json",
    "info-items-2026-07-25.json",
    "info-run-2026-07-25.json",
  ];
  expect(staleDailyFiles(names, "2026-07-25")).toEqual([]);
});

test("staleDailyFiles returns every file of an older day, run checkpoint included", () => {
  const names = [
    "briefing-2026-07-22.json",
    "info-articles-2026-07-22.json",
    "info-items-2026-07-22.json",
    // A run abandoned overnight: never resumable again, and the heaviest of the
    // four since it holds the article bodies.
    "info-run-2026-07-22.json",
  ];
  expect(staleDailyFiles(names, "2026-07-25")).toEqual(names);
});

test("staleDailyFiles never touches chat threads or the health sidecar", () => {
  const names = [
    "threads-info-2026-07-22.json",
    "threads-abc123.json",
    "info-source-health.json",
    "info-feedback.jsonl",
    "info-sources.json",
    "user-profile.md",
    "library.json",
    "topics.json",
    "annotations-abc123.json",
    "reading-state-abc123.json",
  ];
  expect(staleDailyFiles(names, "2026-07-25")).toEqual([]);
});

test("staleDailyFiles ignores names whose date suffix is malformed", () => {
  const names = [
    "briefing-2026-7-22.json",
    "briefing-2026-07-22.json.tmp",
    "briefing-2026-07-22.txt",
    "briefing-.json",
    "briefing-2026-07-22-old.json",
    "info-articles-yesterday.json",
    "info-items-2026-07-222.json",
  ];
  expect(staleDailyFiles(names, "2026-07-25")).toEqual([]);
});

test("staleDailyFiles on an empty listing is empty", () => {
  expect(staleDailyFiles([], "2026-07-25")).toEqual([]);
});

test("mergeInlinedHtml swaps contentHtml, preserves textContent", () => {
  const articles = { x: { contentHtml: "<p>old</p>", textContent: "old text" } };
  const merged = mergeInlinedHtml(articles, "x", "<p>new</p>");
  expect(merged.x).toEqual({ contentHtml: "<p>new</p>", textContent: "old text" });
  expect(articles.x.contentHtml).toBe("<p>old</p>"); // input not mutated
});

test("mergeInlinedHtml is a no-op (same reference) for an unknown item", () => {
  const articles = { x: { contentHtml: "<p>a</p>" } };
  expect(mergeInlinedHtml(articles, "y", "<p>b</p>")).toBe(articles);
});
