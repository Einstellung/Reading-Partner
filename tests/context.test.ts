// Unit tests for system-prompt assembly (src/platform/app/context.ts). Pure string building.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  buildSystemPrompt,
  readerProfileSection,
  LECTURE_QUIZ,
  type BooklistItem,
} from "../src/platform/app/context";
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
  expect(out).not.toContain("The materials in this topic");
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
  expect(out).toContain("The materials in this topic:");
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
  expect(out).toContain("The materials in this topic:");
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
  expect(withTools).toContain("Answer from the book the reader is in by default");
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

// --- one prompt, loaded by data (docs/09) ---

// The order is what a provider's prompt cache matches on: everything that holds
// still between two turns of a conversation before anything that moves. Measured
// before the reorder, two questions three minutes apart in one thread read 2,061
// tokens from cache, because the position line sat above the whole prompt.
test("everything stable comes before everything that moves", () => {
  const out = buildSystemPrompt({
    ...base,
    toolNames: ["read_pages"],
    chapterTable: "CHAPTER TABLE",
    inlineBody: "INLINE BODY",
    prepNotes: "PREP NOTES",
    chapterSpine: "CHAPTER SPINE",
    spineOverview: "NOTES OVERVIEW",
    profile: "PROFILE",
    toolPrompts: ["TOOL PROMPT"],
    figureCatalog: "FIGURES",
    observations: "OBSERVATIONS",
    prepStatus: "PREP STATUS",
    pageWindow: "PAGE WINDOW",
    loaded: "LOADED THIS TURN",
  });
  const at = (needle: string) => out.indexOf(needle);
  const stable = ["TOOL PROMPT", "PROFILE", "CHAPTER TABLE", "INLINE BODY", "PREP NOTES", "CHAPTER SPINE", "NOTES OVERVIEW"];
  const volatile = ["- Page: 12", "FIGURES", "OBSERVATIONS", "PREP STATUS", "PAGE WINDOW"];
  for (const s of stable) {
    for (const v of volatile) expect(at(s)).toBeLessThan(at(v));
  }
  // The body sits above the notes and the spine, and the statement of what this
  // turn holds is the last thing before the question.
  expect(at("CHAPTER TABLE")).toBeLessThan(at("INLINE BODY"));
  expect(at("INLINE BODY")).toBeLessThan(at("PREP NOTES"));
  expect(at("LOADED THIS TURN")).toBe(out.length - "LOADED THIS TURN".length);
});

// A block whose material was not gathered is not mentioned: a prompt that
// describes what the turn does not have is how a model came to describe pages it
// could not see.
test("a block with no material is not mentioned", () => {
  const out = buildSystemPrompt(base);
  for (const absent of [
    "This book's chapters",
    'The prep list',
    'The spine of this book',
    "in this turn's prompt",
    'page by page',
  ]) {
    expect(out).not.toContain(absent);
  }
});

// The slug citation rule only works when there are slugs to cite. Without the
// notes it is an invitation to invent one, which is what it was being used for.
test("the paper-slug citation rule rides with the prep notes and not otherwise", () => {
  expect(buildSystemPrompt({ ...base, citePaperSlugs: true })).toContain("[paper-slug p.N]");
  expect(buildSystemPrompt(base)).not.toContain("[paper-slug p.N]");
});

// docs/09: the entry decides the range of the question, never the shape of the
// answer. Nothing in either prompt may say "book level is long, a mark is short".
test("neither entry hardwires how long an answer should be", () => {
  for (const bookLevel of [true, false]) {
    const out = buildSystemPrompt({ ...base, bookLevel });
    expect(out).toContain("Let the question set the length");
    expect(out).not.toContain("A few sentences usually beats a lecture");
    expect(out).not.toContain("lecture notes when they asked about one line");
  }
});

test("a chapter in focus outranks the page the reader is scrolled to", () => {
  const focused = buildSystemPrompt({
    ...base,
    bookLevel: true,
    focusLabel: 'chapter 3 ("Coding Attention Mechanisms"), p.64-107',
  });
  expect(focused).toContain("This conversation is on chapter 3");
  expect(focused).toContain("not the page above");
  // With no focus, the book-level thread is told the same thing about scrolling
  // in the general form.
  const loose = buildSystemPrompt({ ...base, bookLevel: true });
  expect(loose).toContain("Where the reader is scrolled to is not the subject");
});

// docs/09 leaves the quiz undecided. One constant turns it off everywhere; this
// pins that it is one place and not several.
test("the quiz is one block behind one constant", () => {
  const out = buildSystemPrompt(base);
  const asks = out.includes("you may close with one question");
  expect(asks).toBe(LECTURE_QUIZ);
  if (LECTURE_QUIZ) {
    expect(out).toContain("One question, never two");
    expect(out).toContain("judge it in a sentence and move");
  }
});
