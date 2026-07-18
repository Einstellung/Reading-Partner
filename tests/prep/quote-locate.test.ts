// Unit tests for quote locating (src/prep/quote-locate.ts). Run: bun test.

import { expect, test } from "bun:test";
import { locateQuote, normalizeForMatch } from "../../src/prep/quote-locate";

test("normalizeForMatch folds case, whitespace, ligatures and diacritics", () => {
  expect(normalizeForMatch("  The\tQuick\nBrown  ")).toBe("the quick brown");
  expect(normalizeForMatch("ﬁle")).toBe("file"); // fi ligature -> "fi"
  expect(normalizeForMatch("café")).toBe("cafe"); // combining acute dropped
});

test("locates a quote and returns the exact original substring", () => {
  const page = "Section 2. The model converges quickly under mild assumptions.";
  const hit = locateQuote(page, "model converges quickly");
  expect(hit).not.toBeNull();
  expect(hit!.text).toBe("model converges quickly");
});

test("matches across whitespace and case drift, returning verbatim page text", () => {
  // Extraction split the phrase across a line break; the quote uses one space.
  const page = "gradient\ndescent   is Stable here";
  const hit = locateQuote(page, "gradient descent is stable");
  expect(hit).not.toBeNull();
  // The returned text is sliced from the original, preserving its whitespace/case.
  expect(hit!.text).toBe("gradient\ndescent   is Stable");
});

test("matches through a ligature in the page text", () => {
  const hit = locateQuote("the classiﬁer output", "classifier");
  expect(hit).not.toBeNull();
  expect(hit!.text).toBe("classiﬁer");
});

test("returns null when the quote is not on the page", () => {
  expect(locateQuote("nothing relevant here", "quantum entanglement")).toBeNull();
});

test("rejects a too-short quote", () => {
  expect(locateQuote("a page of text", "a")).toBeNull();
  expect(locateQuote("a page of text", "   ")).toBeNull();
});
