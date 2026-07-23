// The digest system prompt's output-language wiring (src/prep/digest.ts):
// the language is templated into the "Write the note in ___" line, so the
// prompt holds a single language directive. Run: bun test.

import { expect, test } from "bun:test";
import { digestSystemPrompt } from "../../src/prep/digest";
import type { PrepPaper } from "../../src/prep/types";

const PAPER: PrepPaper = {
  slug: "world-models",
  title: "World Models",
  authors: ["A. Author"],
  year: 2024,
  arxivId: null,
  citedInChapters: [1],
  reason: "foundational reference",
  status: "done",
};

test("digestSystemPrompt writes the paper note in English by default", () => {
  const auto = digestSystemPrompt(PAPER, "A Survey");
  expect(auto).toContain("Write the note in English, 300-600 words");
});

test("digestSystemPrompt templates a set language into the paper note line", () => {
  const zh = digestSystemPrompt(PAPER, "A Survey", "", false, "zh-CN");
  expect(zh).toContain("Write the note in 简体中文, 300-600 words");
  expect(zh).not.toContain("Write the note in English");
});

test("digestSystemPrompt templates a set language into the article note line", () => {
  const ja = digestSystemPrompt(PAPER, "A Survey", "", true, "ja");
  expect(ja).toContain("日本語, 300-600 words of markdown");
  expect(ja).not.toContain("English, 300-600 words of markdown");
});
