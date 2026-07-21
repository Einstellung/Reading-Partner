// Unit tests for the floating info-chat system prompts (src/info/chat.ts): the
// output-language wiring on both the briefing-level and article threads. Run:
// bun test.

import { expect, test } from "bun:test";
import { articleChatSystemPrompt, briefingChatSystemPrompt } from "../../src/info/chat";
import type { Briefing } from "../../src/info/types";

const BRIEFING: Briefing = {
  date: "2026-07-21",
  generatedAt: 0,
  overview: "A slow day.",
  items: {
    a1: { title: "Model X ships", url: "https://x.test", source: "qbitai", publishedAt: "2026-07-21" },
  },
  mustRead: [{ itemId: "a1", reason: "you track releases" }],
  oneLiners: [{ line: "Y raised a round." }],
  outOfLane: [],
  filtered: [],
};

test("briefingChatSystemPrompt pins output only when a language is set", () => {
  const pinned = briefingChatSystemPrompt(BRIEFING, "zh-CN");
  expect(pinned).toContain("All user-facing output must be written in 简体中文.");
  expect(briefingChatSystemPrompt(BRIEFING)).not.toContain("must be written in");
  expect(briefingChatSystemPrompt(BRIEFING, "auto")).not.toContain("must be written in");
});

test("articleChatSystemPrompt pins output only when a language is set", () => {
  const pinned = articleChatSystemPrompt("overview", "Title", "body", "pt");
  expect(pinned).toContain("All user-facing output must be written in Português.");
  expect(articleChatSystemPrompt("overview", "Title", "body")).not.toContain("must be written in");
});
