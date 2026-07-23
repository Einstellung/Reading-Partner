// Unit tests for the overview system prompt builder (src/notes/overview.ts):
// the output-language wiring. Run: bun test.

import { expect, test } from "bun:test";
import { overviewSystemPrompt } from "../../src/notes/overview";

test("overviewSystemPrompt keeps the English default on auto and replaces it on a set language", () => {
  const auto = overviewSystemPrompt("auto");
  expect(auto).toContain("Write in English as markdown");
  expect(auto).not.toContain("must be written in");
  const pinned = overviewSystemPrompt("de");
  // The language is templated into the one "Write in ___" line, not appended.
  expect(pinned).toContain("Write in Deutsch as markdown");
  expect(pinned).not.toContain("Write in English as markdown");
  expect(pinned).not.toContain("must be written in");
});
