// Unit tests for the paper-or-book judgement (src/fulltext/citations.ts).
// The numbers in the "measured library" test are the ones the real documents
// produce (docs/09; re-measured against the author's library on 2026-08-19),
// reproduced here as synthetic text with the same citation-per-character ratio —
// the point of the test is that the threshold sits clear of both groups.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  citationDensity,
  documentShape,
  MIN_MEASURABLE_CHARS,
  PAPER_CITATION_DENSITY,
} from "../../src/fulltext/citations";
import { FULLTEXT_VERSION, type Fulltext } from "../../src/fulltext/types";

// A document of `chars` characters carrying `citations` inline markers.
function doc(citations: number, chars: number): Fulltext {
  const body = "x".repeat(Math.max(0, chars - citations * 4));
  const marks = Array.from({ length: citations }, (_, i) => `[${(i % 99) + 1}]`).join("");
  return { version: FULLTEXT_VERSION, status: "ok", pages: [body + marks], outline: [] };
}

test("counts bare markers per 10,000 characters, whitespace excluded", () => {
  const d = citationDensity(["see [12] and [15]\n\n   more text"]);
  expect(d.citations).toBe(2);
  // "see[12]and[15]moretext" — 22 characters.
  expect(d.chars).toBe(22);
  expect(d.per10k).toBeCloseTo(909, 0);
});

// A list, a range, a footnote marker with a letter and a four-digit number in
// brackets are all left out: the bare form alone separates the two groups, and
// the wider pattern picks up a programming book's array indices.
test("brackets that are not bare citation markers are not counted", () => {
  const d = citationDensity(["[see note] [12a] [] [1234] [13, 15] [12-15] plain [7]"]);
  expect(d.citations).toBe(1);
});

test("the measured library lands on either side of the threshold with room to spare", () => {
  // citations, characters, and what the document is.
  const library: [string, number, number, "paper" | "book"][] = [
    ["embodied-AI survey, bilingual layout", 814, 86_021, "paper"], // 94.6 / 10k
    ["the same survey, English original", 721, 125_340, "paper"], // 57.5
    ["Build a Large Language Model from Scratch", 46, 238_935, "book"], // 1.9
    ["A Brief History of Intelligence", 12, 214_292, "book"], // 0.6
    ["Hands-On Large Language Models", 10, 179_289, "book"], // 0.6
  ];
  for (const [name, citations, chars, shape] of library) {
    const ft = doc(citations, chars);
    expect(`${name}: ${documentShape(ft)}`).toBe(`${name}: ${shape}`);
  }
  // The gap the threshold sits in: no document measured falls between 2 and 57.
  const densities = library.map(([, c, chars]) => (c / chars) * 10_000);
  const books = densities.filter((d) => d < PAPER_CITATION_DENSITY);
  const papers = densities.filter((d) => d >= PAPER_CITATION_DENSITY);
  expect(Math.max(...books)).toBeLessThan(PAPER_CITATION_DENSITY / 5);
  expect(Math.min(...papers)).toBeGreaterThan(PAPER_CITATION_DENSITY * 5);
});

test("a document with too little text, or no text layer, is not judged", () => {
  expect(documentShape(doc(30, MIN_MEASURABLE_CHARS - 1))).toBe("unknown");
  expect(documentShape({ status: "no-text-layer", pages: [] })).toBe("unknown");
  expect(citationDensity([]).per10k).toBe(0);
});
