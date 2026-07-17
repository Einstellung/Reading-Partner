// Unit tests for system-prompt assembly (src/context.ts). Pure string building.
// Run: bun test.

import { expect, test } from "bun:test";
import { buildSystemPrompt, type BooklistItem } from "../src/context";

const base = {
  topicName: "what makes JITs fast",
  fileName: "sea-of-nodes.pdf",
  pageLabel: "12",
  selectionText: "  the semantics in SSA form  ",
};

test("base prompt carries the reading context and trims the marked passage", () => {
  const out = buildSystemPrompt(base);
  expect(out).toContain("- Topic: what makes JITs fast");
  expect(out).toContain("- File: sea-of-nodes.pdf");
  expect(out).toContain("- Page: 12");
  expect(out).toContain('- Marked passage: "the semantics in SSA form"');
  // No M6 sections when their fields are absent.
  expect(out).not.toContain("Text around the marked passage");
  expect(out).not.toContain("Other materials in this topic");
  expect(out).not.toContain("Tools:");
  expect(out).not.toContain("machine-readable");
});

test("chapter and surrounding text appear only when provided", () => {
  const out = buildSystemPrompt({
    ...base,
    chapterTitle: "5. Global Value Numbering",
    surroundingText: "GVN folds redundant expressions across the graph.",
  });
  expect(out).toContain("- Chapter: 5. Global Value Numbering");
  expect(out).toContain("Text around the marked passage:");
  expect(out).toContain("GVN folds redundant expressions across the graph.");
});

test("an unreadable current book states the limitation", () => {
  const out = buildSystemPrompt({ ...base, fulltextAvailable: false });
  expect(out).toContain("not machine-readable");
  // The affirmative case adds no such note.
  expect(buildSystemPrompt({ ...base, fulltextAvailable: true })).not.toContain("not machine-readable");
});

test("the topic booklist renders one line per material with counts", () => {
  const materials: BooklistItem[] = [
    { label: "Book A.pdf", pageCount: 210, annotationCount: 1, fulltextAvailable: true, isCurrent: false },
    { label: "Scan B.pdf", pageCount: 0, annotationCount: 0, fulltextAvailable: false, isCurrent: false },
  ];
  const out = buildSystemPrompt({ ...base, materials });
  expect(out).toContain("Other materials in this topic:");
  expect(out).toContain("- Book A.pdf — 210 pages, 1 annotation");
  expect(out).toContain("- Scan B.pdf — full text not available, 0 annotations");
});

test("the book-level prompt drops every selection-derived part but keeps position", () => {
  const materials: BooklistItem[] = [
    { label: "Book A.pdf", pageCount: 210, annotationCount: 1, fulltextAvailable: true, isCurrent: false },
  ];
  const out = buildSystemPrompt({
    ...base,
    bookLevel: true,
    selectionText: "the semantics in SSA form",
    selectionComment: "confusing",
    chapterTitle: "5. Global Value Numbering",
    surroundingText: "GVN folds redundant expressions across the graph.",
    materials,
    hasTools: true,
  });
  // No passage, note, or surrounding text.
  expect(out).not.toContain("Marked passage");
  expect(out).not.toContain("the semantics in SSA form");
  expect(out).not.toContain("The user's note on it");
  expect(out).not.toContain("Text around the marked passage");
  // Position, chapter, booklist and tools all survive.
  expect(out).toContain("- Topic: what makes JITs fast");
  expect(out).toContain("- File: sea-of-nodes.pdf");
  expect(out).toContain("- Page: 12");
  expect(out).toContain("- Chapter: 5. Global Value Numbering");
  expect(out).toContain("Other materials in this topic:");
  expect(out).toContain("read_pages(from, to)");
  // Intro reflects the whole-book framing, not the marked-passage one.
  expect(out).toContain("about the book as a whole");
  expect(out).not.toContain("marking a passage with an AI pen");
});

test("the memory snapshot appends the same way for a book-level prompt", () => {
  // The opening context is buildSystemPrompt + the memory section (App joins
  // them); the join is orthogonal to bookLevel, so a snapshot still lands.
  const out =
    buildSystemPrompt({ ...base, bookLevel: true }) + "\n\n" + "## Memory\n- reading-position: on chapter 5";
  expect(out).toContain("about the book as a whole");
  expect(out).toContain("## Memory");
  expect(out).toContain("reading-position: on chapter 5");
});

test("the tools paragraph and cross-book rule appear only with hasTools", () => {
  const withTools = buildSystemPrompt({ ...base, hasTools: true });
  expect(withTools).toContain("read_pages(from, to)");
  expect(withTools).toContain("search_topic(query)");
  expect(withTools).toContain("read_annotations(material)");
  expect(withTools).toContain("Answer from the current passage by default");
  expect(withTools).toContain("cite the");
  expect(buildSystemPrompt({ ...base, hasTools: false })).not.toContain("Tools:");
});
