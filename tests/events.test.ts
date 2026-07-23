// Unit tests for the local event log (src/events.ts): line format and the
// injected-append logger. Run: bun test.

import { expect, test } from "bun:test";
import { createEventLogger, formatEventLine } from "../src/app/events";

test("formatEventLine emits one JSON line with ts and type first-class", () => {
  const line = formatEventLine("page-nav", { from: 3, to: 4, dwellMs: 1200 }, 1750000000000);
  expect(line.endsWith("\n")).toBe(true);
  expect(JSON.parse(line)).toEqual({ ts: 1750000000000, type: "page-nav", from: 3, to: 4, dwellMs: 1200 });
});

test("logger appends per topic with the injected clock; payload defaults empty", async () => {
  const appended: { topicId: string; line: string }[] = [];
  const log = createEventLogger(async (topicId, line) => {
    appended.push({ topicId, line });
  }, () => 42);

  log("topic-a", "call-start", { threadId: "t1" });
  log("topic-b", "memory-tab-open");
  await Promise.resolve();

  expect(appended).toHaveLength(2);
  expect(appended[0].topicId).toBe("topic-a");
  expect(JSON.parse(appended[0].line)).toEqual({ ts: 42, type: "call-start", threadId: "t1" });
  expect(JSON.parse(appended[1].line)).toEqual({ ts: 42, type: "memory-tab-open" });
});

test("a failing append never throws out of the logger", async () => {
  const log = createEventLogger(async () => {
    throw new Error("disk gone");
  });
  expect(() => log("t", "call-end", { threadId: "x" })).not.toThrow();
  // Let the rejected promise settle through the internal catch.
  await new Promise((r) => setTimeout(r, 0));
});
