// Feedback log parsing (src/info/feedback.ts). The append/load fs paths need the
// Tauri plugin; the pure JSONL parse is tested here. Run: bun test.

import { expect, test } from "bun:test";
import { parseFeedbackLog } from "../../src/memory/feedback";

test("parseFeedbackLog reads valid lines and skips corrupt ones", () => {
  const log = [
    JSON.stringify({ ts: 1, itemId: "a", title: "A", action: "opened" }),
    "",
    "{ this is not json",
    JSON.stringify({ ts: 2, itemId: "b", title: "B", action: "dismissed", category: "vendor PR" }),
    JSON.stringify({ nope: true }), // missing itemId/action -> skipped
  ].join("\n");
  const events = parseFeedbackLog(log);
  expect(events.length).toBe(2);
  expect(events[0].itemId).toBe("a");
  expect(events[1].category).toBe("vendor PR");
});

test("parseFeedbackLog on empty input", () => {
  expect(parseFeedbackLog("")).toEqual([]);
  expect(parseFeedbackLog("\n\n")).toEqual([]);
});
