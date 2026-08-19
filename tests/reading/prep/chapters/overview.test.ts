// Unit tests for the chapter-graph prompt builders (src/reading/notes/overview.ts):
// the output-language wiring and the shape the second pass is asked for.
// Run: bun test.

import { expect, test } from "bun:test";
import { overviewSystemPrompt, overviewUserMessage } from "../../../../src/reading/prep/chapters/overview";

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

test("overviewSystemPrompt asks for the graph, drawn from the spines alone", () => {
  const p = overviewSystemPrompt();
  for (const section of ["## Through-line", "## Chapters", "## Entry points"]) {
    expect(p).toContain(section);
  }
  expect(p).toContain("needs:");
  expect(p).toContain("feeds:");
  // The second pass never re-reads the book, and must not invent an edge to
  // make an appendix look connected.
  expect(p).toMatch(/the book is not in front of you/);
  expect(p).toMatch(/feeds: nothing later/);
});

test("overviewUserMessage lists the spines by chapter number", () => {
  const msg = overviewUserMessage([
    { index: 1, title: "Setup", body: "## Covers\nx" },
    { index: 2, title: "Method", body: "## Covers\ny" },
  ]);
  expect(msg).toContain("=== ch.1 Setup ===");
  expect(msg).toContain("=== ch.2 Method ===");
  expect(msg).toContain("Write the chapter graph now.");
});
