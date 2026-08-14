// Unit tests for system-prompt assembly (src/platform/app/context.ts). Pure string building.
// Run: bun test.

import { expect, test } from "bun:test";
import { buildSystemPrompt, readerProfileSection, type BooklistItem } from "../src/platform/app/context";
import { languageInstruction } from "../src/platform/app/settings";

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
    toolNames: ["read_pages", "search_topic"],
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

test("the observation snapshot appends the same way for a book-level prompt", () => {
  // The opening context is buildSystemPrompt + the observation section (App
  // joins them); the join is orthogonal to bookLevel, so a snapshot still lands.
  const out =
    buildSystemPrompt({ ...base, bookLevel: true }) +
    "\n\n" +
    "## Observations\n- reading-position: on chapter 5";
  expect(out).toContain("about the book as a whole");
  expect(out).toContain("## Observations");
  expect(out).toContain("reading-position: on chapter 5");
});

// Against languageInstruction rather than a retyped copy of its wording: a
// reworded directive should not be a test edit, and `not.toContain` on a
// hand-copied fragment goes quietly vacuous the moment the wording moves.
test("aiLanguage appends the output-language instruction, auto adds nothing", () => {
  const plain = buildSystemPrompt(base);
  expect(buildSystemPrompt({ ...base, aiLanguage: "ja" })).toBe(
    `${plain}\n\n${languageInstruction("ja")}`,
  );
  // Auto (and unset) leave the prompt without a pinning instruction.
  expect(buildSystemPrompt({ ...base, aiLanguage: "auto" })).toBe(plain);
});

test("readerProfileSection injects the profile and depth guidance, empty when unset", () => {
  const section = readerProfileSection("Background: strong in ML, new to robotics.");
  expect(section).toContain("Background: strong in ML, new to robotics.");
  expect(section).toMatch(/match the depth to their background/i);
  expect(readerProfileSection("")).toBe("");
  expect(readerProfileSection("   ")).toBe("");
  expect(readerProfileSection("", "   ")).toBe("");
});

test("the AI's guesses go in as guesses, and never as a depth verdict", () => {
  const guesses = "- Wants the era, not the method | basis: trends.pdf marks | since: 2026-08-01";
  const section = readerProfileSection("Background: strong in ML.", guesses);
  expect(section).toContain("Background: strong in ML.");
  expect(section).toContain("Wants the era, not the method");
  expect(section).toMatch(/nobody confirmed them/i);
  expect(section).toMatch(/hypothesis to test/i);
  // The self-fulfilling loop this guard exists for: a guess drawn from what the
  // reader highlighted must not come back as a verdict on what they can handle.
  expect(section).toMatch(/never pitch depth from a guess/i);
  // Guesses alone still produce a section; the declared half is not required.
  expect(readerProfileSection("", guesses)).toContain("Wants the era, not the method");
});

// The paragraph is rendered from the names of the tools actually wired, because
// read_annotations is mounted only when some material carries a mark: on a book
// with no marks the old fixed paragraph promised a tool that answers "unknown
// tool", and one empty call teaches the model to stop reaching for any of them.
test("the tools paragraph names the tools that were mounted, and only those", () => {
  const withTools = buildSystemPrompt({
    ...base,
    toolNames: ["read_pages", "search_topic", "find_paper"],
  });
  expect(withTools).toContain("read_pages(from, to)");
  expect(withTools).toContain("search_topic(query)");
  expect(withTools).toContain("Answer from the current passage by default");
  expect(withTools).toContain("cite the");
  // Mounted but not described here: find_paper carries its own paragraph, and a
  // second mention would be a second place to keep true.
  expect(withTools).not.toContain("find_paper");
  // Not mounted, so not announced.
  expect(withTools).not.toContain("read_annotations");
});

test("no described tool means no tools paragraph at all", () => {
  expect(buildSystemPrompt({ ...base, toolNames: [] })).not.toContain("Tools:");
  // A turn that mounted only tools with paragraphs of their own is the same case.
  expect(buildSystemPrompt({ ...base, toolNames: ["find_paper"] })).not.toContain("Tools:");
  expect(buildSystemPrompt(base)).not.toContain("Tools:");
});

test("read_annotations is announced exactly when it is mounted", () => {
  const marked = buildSystemPrompt({ ...base, toolNames: ["read_pages", "read_annotations"] });
  expect(marked).toContain("read_annotations(material)");
  expect(buildSystemPrompt({ ...base, toolNames: ["read_pages"] })).not.toContain(
    "read_annotations",
  );
});
