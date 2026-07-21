// Unit tests for the overview system prompt builder (src/notes/overview.ts):
// the output-language wiring. Run: bun test.

import { expect, test } from "bun:test";
import { overviewSystemPrompt } from "../../src/notes/overview";

test("overviewSystemPrompt keeps the English default on auto and pins on a set language", () => {
  const auto = overviewSystemPrompt("auto");
  expect(auto).toContain("Write in English as markdown");
  expect(auto).not.toContain("must be written in");
  const pinned = overviewSystemPrompt("de");
  expect(pinned).toContain("All user-facing output must be written in Deutsch.");
});
