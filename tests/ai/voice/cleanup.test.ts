// Unit tests for the cleanup pass (src/ai/voice/cleanup.ts): glossary building,
// the system prompt, and the degrade-to-raw fallback behavior. The model runner
// is injected. Run: bun test.

import { expect, test } from "bun:test";
import {
  buildCleanupSystemPrompt,
  buildGlossary,
  cleanupTranscript,
  glossaryTerms,
  type CleanupModel,
  type CleanupRunner,
} from "../../../src/ai/voice/cleanup";

const model: CleanupModel = { providerId: "anthropic", modelId: "claude", reasoning: "low" };

test("buildGlossary joins the title and outline titles, de-duplicated", () => {
  const g = buildGlossary({
    title: "Attention Is All You Need",
    outline: [{ title: "Introduction" }, { title: "Attention" }, { title: "Introduction" }],
  });
  expect(g).toBe("Attention Is All You Need; Introduction; Attention");
});

test("buildGlossary stays within the ~300 char cap", () => {
  const outline = Array.from({ length: 100 }, (_, i) => ({ title: `Chapter number ${i}` }));
  const g = buildGlossary({ title: "Book", outline });
  expect(g.length).toBeLessThanOrEqual(300);
});

test("buildGlossary is empty when there is no book", () => {
  expect(buildGlossary({})).toBe("");
  expect(buildGlossary({ title: null, outline: [] })).toBe("");
});

// The same list in the other shape: iOS sends the terms themselves as
// contextualStrings (docs/15), so the two must be the one list under the one cap.
test("glossaryTerms is what buildGlossary joins", () => {
  const source = {
    title: "Attention Is All You Need",
    outline: Array.from({ length: 100 }, (_, i) => ({ title: `Chapter number ${i}` })),
  };
  expect(glossaryTerms({ title: "Book", outline: [{ title: "One" }, { title: "One" }] })).toEqual([
    "Book",
    "One",
  ]);
  expect(glossaryTerms(source).join("; ")).toBe(buildGlossary(source));
  expect(glossaryTerms({})).toEqual([]);
});

test("buildCleanupSystemPrompt includes the glossary only when present", () => {
  const withG = buildCleanupSystemPrompt("Transformer; BERT");
  expect(withG).toContain("Glossary");
  expect(withG).toContain("Transformer; BERT");
  expect(buildCleanupSystemPrompt("")).not.toContain("Glossary");
});

test("cleanupTranscript returns the cleaned text on success", async () => {
  const run: CleanupRunner = async (_m, _sys, user) => `cleaned: ${user}`;
  expect(await cleanupTranscript("  um hello  ", "", model, run)).toBe("cleaned: um hello");
});

test("cleanupTranscript falls back to the raw transcript when the call fails", async () => {
  const run: CleanupRunner = async () => {
    throw new Error("provider down");
  };
  expect(await cleanupTranscript("  raw words ", "", model, run)).toBe("raw words");
});

test("cleanupTranscript skips the call (returns raw) when there is no model", async () => {
  let called = false;
  const run: CleanupRunner = async () => {
    called = true;
    return "should not run";
  };
  expect(await cleanupTranscript("  raw ", "", null, run)).toBe("raw");
  expect(called).toBe(false);
});

test("cleanupTranscript falls back to raw when the model returns nothing", async () => {
  const run: CleanupRunner = async () => "   ";
  expect(await cleanupTranscript("keep me", "", model, run)).toBe("keep me");
});
