// Triage prompt assembly + strict-JSON validation (src/info/triage.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import {
  formatFeedbackTail,
  parseTriageResult,
  triageSystemPrompt,
  triageUserMessage,
} from "../../src/info/triage";
import type { FeedbackEvent, InfoItem } from "../../src/info/types";

const ITEMS: InfoItem[] = [
  {
    id: "jiqizhixin-a1",
    source: "jiqizhixin",
    title: "World model paper",
    url: "https://x/1",
    publishedAt: "2026-07-20",
    textContent: "A long body ".repeat(500),
  },
  {
    id: "qbitai-b2",
    source: "qbitai",
    title: "Vendor keynote recap",
    url: "https://x/2",
    publishedAt: "2026-07-20",
    summary: "recap",
  },
];

const FEEDBACK: FeedbackEvent[] = [
  { ts: 1, itemId: "old1", title: "Old vendor thing", action: "dismissed", category: "vendor PR" },
  { ts: 2, itemId: "old2", title: "A paper", action: "opened" },
];

test("triageUserMessage embeds profile, feedback tail, and trims item text", () => {
  const msg = triageUserMessage("I like papers", FEEDBACK, ITEMS, { textChars: 100 });
  expect(msg).toContain("I like papers");
  expect(msg).toContain("dismissed: \"Old vendor thing\" [vendor PR]");
  expect(msg).toContain("jiqizhixin-a1");
  // Text trimmed to 100 chars, not the full 6000.
  const bodyLine = msg.split("\n").find((l) => l.startsWith("text: A long body")) ?? "";
  expect(bodyLine.length).toBeLessThan(140);
});

test("formatFeedbackTail caps to the last N and handles empty", () => {
  expect(formatFeedbackTail([])).toContain("no reactions");
  const many: FeedbackEvent[] = Array.from({ length: 40 }, (_, i) => ({
    ts: i,
    itemId: `i${i}`,
    title: `t${i}`,
    action: "opened",
  }));
  const tail = formatFeedbackTail(many, 30);
  expect(tail.split("\n").length).toBe(30);
  expect(tail).toContain("t39");
  expect(tail).not.toContain("t9\"");
});

test("parseTriageResult accepts valid JSON, drops unknown/duplicate ids", () => {
  const validIds = new Set(["jiqizhixin-a1", "qbitai-b2"]);
  const reply = JSON.stringify({
    overview: "Slow day, one real paper.",
    mustRead: [{ itemId: "jiqizhixin-a1", reason: "Right in your world-model lane." }],
    oneLiners: [{ itemId: "qbitai-b2", line: "Vendor X shipped a bigger model." }],
    outOfLane: [
      { itemId: "jiqizhixin-a1", reason: "dup, should be dropped as already used? no — separate tier" },
      { itemId: "ghost", reason: "unknown id" },
    ],
    filtered: [{ itemId: "qbitai-b2", category: "duplicate coverage" }],
  });
  const out = parseTriageResult(reply, validIds);
  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.result.overview).toContain("Slow day");
  expect(out.result.mustRead[0].itemId).toBe("jiqizhixin-a1");
  // outOfLane capped to 1 and unknown id removed.
  expect(out.result.outOfLane.length).toBe(1);
  expect(out.result.filtered[0].category).toBe("duplicate coverage");
});

test("parseTriageResult tolerates a markdown fence and prose", () => {
  const reply = "Sure:\n```json\n" + JSON.stringify({ overview: "ok", mustRead: [], oneLiners: [], outOfLane: [], filtered: [] }) + "\n```";
  const out = parseTriageResult(reply, new Set());
  expect(out.ok).toBe(true);
});

test("parseTriageResult fails on no JSON or missing overview", () => {
  expect(parseTriageResult("no json here", new Set()).ok).toBe(false);
  expect(parseTriageResult(JSON.stringify({ mustRead: [] }), new Set()).ok).toBe(false);
});

test("triageSystemPrompt keeps the English default on auto, pins on a set language", () => {
  const auto = triageSystemPrompt("auto");
  expect(auto).toContain("Write the overview, reasons, and one-liners in English");
  expect(auto).not.toContain("All user-facing output must be written in");
  const pinned = triageSystemPrompt("ko");
  expect(pinned).toContain("Respond in 한국어.");
  expect(pinned).toContain("All user-facing output must be written in 한국어.");
});
