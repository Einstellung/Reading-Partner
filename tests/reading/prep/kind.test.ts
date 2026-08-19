// Which kind of prep material the panel is showing (src/reading/prep/kind.ts).
// Run: bun test.

import { expect, test } from "bun:test";
import { prepKind } from "../../../src/reading/prep/kind";

test("with nothing prepped, the measurement decides", () => {
  expect(prepKind({ papers: false, chapters: false, shape: "paper" })).toBe("papers");
  expect(prepKind({ papers: false, chapters: false, shape: "book" })).toBe("chapters");
});

test("too little text to measure lands on chapters, the cheaper dead end", () => {
  expect(prepKind({ papers: false, chapters: false, shape: "unknown" })).toBe("chapters");
});

test("material on disk outranks the measurement, in both directions", () => {
  // A book the classifier now calls a paper, already prepped by chapter: the
  // panel must keep showing the spines rather than an empty paper list.
  expect(prepKind({ papers: false, chapters: true, shape: "paper" })).toBe("chapters");
  expect(prepKind({ papers: true, chapters: false, shape: "book" })).toBe("papers");
});

test("a document that somehow has both falls back to the measurement", () => {
  expect(prepKind({ papers: true, chapters: true, shape: "paper" })).toBe("papers");
  expect(prepKind({ papers: true, chapters: true, shape: "book" })).toBe("chapters");
});
