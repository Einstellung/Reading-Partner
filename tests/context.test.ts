// Unit tests for system-prompt assembly (src/platform/app/context.ts). Pure string building.
// Run: bun test.

import { expect, test } from "bun:test";
import {
  buildSystemPrompt,
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
  expect(out).toContain("- Page open on screen: 12");
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
    toolPrompts: ["TOOL PROMPT"],
    figureCatalog: "FIGURES",
    observations: "OBSERVATIONS",
    prepStatus: "PREP STATUS",
    pageWindow: "PAGE WINDOW",
    loaded: "LOADED THIS TURN",
  });
  const at = (needle: string) => out.indexOf(needle);
  const stable = ["TOOL PROMPT", "CHAPTER TABLE", "INLINE BODY", "PREP NOTES", "CHAPTER SPINE", "NOTES OVERVIEW"];
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

// A quoted citation renders as a block of the book's own words only when it
// stands alone; inside a sentence it degrades to a chip and the reader sees
// nothing of the page. The rule states the consequence, and it states it the
// same way whichever door the turn came in by — the quote is what the reader
// reads, not a debug affordance that a mark thread could do without.
test("the citation rule makes a quote stand alone and says what a buried one costs", () => {
  for (const bookLevel of [true, false]) {
    const out = buildSystemPrompt({ ...base, bookLevel, citePaperSlugs: true });
    expect(out).toContain("[p.N]");
    expect(out).toMatch(/as its own paragraph/);
    expect(out).toMatch(/not inside a sentence/);
    expect(out).toMatch(/collapses to a small chip/);
    expect(out).toMatch(/Quote verbatim/);
    expect(out).toContain("200");
    // The slug form takes a quote on the same terms.
    expect(out).toMatch(/\[paper-slug p\.N "the sentence"\] alone/);
  }
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
  // The chapter says what the talking is about, so the page line stops at the
  // page: the two sentences would otherwise say the same thing twice.
  expect(focused).not.toContain("the conversation decides that");
  // With no focus, the page line is where that gets said.
  const loose = buildSystemPrompt({ ...base, bookLevel: true });
  expect(loose).toContain("not what to talk about; the conversation decides that");
});

// --- asides (docs/03) ---
//
// An aside borrows its parent's stable half verbatim. A provider's prompt cache
// matches on a prefix, so one differing word in the first block turns a read of
// the inlined chapter into a second write of it — measured at ~82k tokens on a
// chapter-inlined turn. Everything the aside is gets said below the position.
test("an aside's stable half is the lesson's, byte for byte", () => {
  const shared = {
    ...base,
    bookLevel: true,
    toolNames: ["read_pages", "search_topic"],
    toolPrompts: ["TOOL PROMPT"],
    materials: [
      { label: "Book A.pdf", pageCount: 210, annotationCount: 1, fulltextAvailable: true, isCurrent: true },
    ],
    chapterTable: "CHAPTER TABLE",
    inlineBody: "INLINE BODY",
    prepNotes: "PREP NOTES",
    chapterSpine: "CHAPTER SPINE",
    spineOverview: "NOTES OVERVIEW",
    citePaperSlugs: true,
  };
  const lesson = buildSystemPrompt(shared);
  const aside = buildSystemPrompt({ ...shared, aside: { from: "chat" } });
  // Up to the first volatile block, the two prompts are the same string.
  const upTo = (out: string): string => out.slice(0, out.indexOf("Current reading context:"));
  expect(upTo(aside)).toBe(upTo(lesson));
  expect(upTo(aside)).toContain("INLINE BODY");
  expect(aside).not.toBe(lesson);
});

test("a chat-span aside names the span for what it is and carries no page text", () => {
  const out = buildSystemPrompt({
    ...base,
    bookLevel: true,
    aside: { from: "chat" },
    selectionText: "  the semantics in SSA form  ",
    surroundingText: "GVN folds redundant expressions across the graph.",
  });
  expect(out).toContain('taken by the reader out of something you');
  expect(out).toContain('wrote earlier in the lesson: "the semantics in SSA form"');
  expect(out).not.toContain("Marked passage");
  // The text around a page has nothing to do with words out of a reply.
  expect(out).not.toContain("Text around the marked passage");
});

// Rebuilt every turn from the stored span, so it may not point at anything the
// model can still see: the reader goes on talking here, and the message the span
// came out of can be trimmed off the replayed history altogether.
test("the span is named without pointing at a message", () => {
  const out = buildSystemPrompt({ ...base, bookLevel: true, aside: { from: "chat" } });
  // The anchor line itself, not the teaching rules above it.
  const anchor = out.slice(out.indexOf("- The subject of this side conversation"));
  expect(anchor).toContain('"the semantics in SSA form"');
  for (const pointer of ["last answer", "last turn", "the message above", "just now", "just wrote"]) {
    expect(`${pointer}: ${anchor.includes(pointer)}`).toBe(`${pointer}: false`);
  }
});

// Both aside flavours state the chapter as a fact about the lesson. The line the
// lesson gets hands the subject to the chapter and takes it away from the page,
// and an aside's subject is neither: it is the passage below.
test("an aside states its parent's chapter without claiming to be about it", () => {
  const focusLabel = 'chapter 3 ("Coding Attention Mechanisms"), p.64-107';
  for (const from of ["chat", "mark"] as const) {
    const out = buildSystemPrompt({ ...base, bookLevel: true, focusLabel, aside: { from } });
    expect(out).toContain("- The lesson this came out of is on chapter 3");
    expect(out).not.toContain("what it is about");
    expect(out).not.toContain("the conversation decides that");
  }
  // The lesson's own line is untouched.
  const lesson = buildSystemPrompt({ ...base, bookLevel: true, focusLabel });
  expect(lesson).toContain("This conversation is on chapter 3");
  expect(lesson).toContain("what it is about");
});

// The subject is a passage on a page, so the page is where that passage sits and
// the line that hands the subject elsewhere cannot ride. It still does for a
// span out of a reply, where the page is only what the reader has open.
test("an aside drawn on the page is not told to ignore the page", () => {
  const drawn = buildSystemPrompt({ ...base, bookLevel: true, aside: { from: "mark" } });
  expect(drawn).toContain("- Page: 12");
  expect(drawn).not.toContain("the conversation decides that");
  const span = buildSystemPrompt({ ...base, bookLevel: true, aside: { from: "chat" } });
  expect(span).toContain("- Page open on screen: 12");
  expect(span).toContain("the conversation decides that");
});

// The shared opening says only what is true of all three doors, and hands the
// reading context the job of saying which one this is.
test("the shared opening is true whether or not a passage is named below", () => {
  const lesson = buildSystemPrompt({ ...base, bookLevel: true });
  expect(lesson).toContain("Where the reading context below names a passage");
  // Nothing in it asserts that no passage is marked.
  expect(lesson).not.toContain("no passage is marked");
  expect(buildSystemPrompt({ ...base, bookLevel: true, aside: { from: "mark" } })).toContain(
    "that passage is its subject",
  );
});

test("an aside drawn on the page is a marked passage like any other", () => {
  const out = buildSystemPrompt({
    ...base,
    bookLevel: true,
    aside: { from: "mark" },
    selectionComment: "confusing",
    surroundingText: "GVN folds redundant expressions across the graph.",
  });
  expect(out).toContain('- Marked passage: "the semantics in SSA form"');
  expect(out).toContain('- The user\'s note on it: "confusing"');
  expect(out).toContain("Text around the marked passage:");
  expect(out).not.toContain("taken by the reader out of something you");
});

// The lesson itself is unchanged by any of this.
test("the book-level thread still carries nothing selection-derived", () => {
  const out = buildSystemPrompt({ ...base, bookLevel: true, surroundingText: "around" });
  expect(out).not.toContain("Marked passage");
  expect(out).not.toContain("taken by the reader out of something you");
  expect(out).not.toContain("Text around the marked passage");
});

// The entry leads the reader through a chapter; it does not examine them
// (docs/09, dropped 2026-08-19). Pinned so a quiz cannot come back by accident.
test("nothing in the prompt examines the reader", () => {
  for (const bookLevel of [true, false]) {
    const out = buildSystemPrompt({ ...base, bookLevel });
    for (const phrase of [
      "close with one question",
      "One question, never two",
      "checks whether it landed",
      "in their own words",
    ]) {
      expect(`${phrase}: ${out.includes(phrase)}`).toBe(`${phrase}: false`);
    }
  }
});

// --- the classroom's premise (docs/09, 2026-08-20) ---
//
// The reader has read none of this book and may never read more than a little of
// it. The AI is how they get at it; the book is what the AI draws on and where
// they go when they want to see something themselves. Pinned in both directions:
// the premise is stated, and the wording written for a reader working through
// the book on their own cannot come back.
test("the book-level prompt states that the reader has not read the book", () => {
  const out = buildSystemPrompt({ ...base, bookLevel: true });
  expect(out).toContain("Assume they have read none of it");
  expect(out).toContain("- They have not read this book.");
  expect(out).not.toContain("pointed at where to start");
  // The reading companion's own reader is the one who is reading.
  const mark = buildSystemPrompt(base);
  expect(mark).not.toContain("They have not read this book");
  expect(mark).toContain("The user is reading");
});

test("the book-level prompt refuses to address the reader as someone who read it", () => {
  const out = buildSystemPrompt({ ...base, bookLevel: true });
  expect(out).toContain("Say what a page says instead of pointing at");
  expect(out).toContain("gets restated in one line before you build on it");
  expect(out).toContain("Don't ask them what they made of a passage");
  // Grounding is untouched by any of it: every claim still carries a page.
  expect(out).toContain("Ground every claim in the text");
});

// The shape of the answer the reader accepted twice (docs/09: 09:22 and 09:26).
// It lived in the chapter chip's user message until the chips were dropped, so
// the prompt is now the only place that carries it.
test("how to teach a stretch of the book survived the chips", () => {
  const out = buildSystemPrompt({ ...base, bookLevel: true });
  for (const clause of [
    "Asked to teach a stretch of the book: compress it",
    "go heavier where an",
    "which parts they can skip",
    "one passage or figure worth their own eyes",
  ]) {
    expect(`${clause}: ${out.includes(clause)}`).toBe(`${clause}: true`);
  }
});

// The page at book level is where they happen to have the book open. Saying it
// as bare progress ("- Page: 132") is what let the model read the classroom as a
// conversation with someone 132 pages in.
test("the page a book-level thread reports is not read as progress", () => {
  const out = buildSystemPrompt({ ...base, bookLevel: true });
  expect(out).toContain("- Page open on screen: 12");
  expect(out).toContain("not how far they have");
  expect(out).not.toContain("- Page: 12");
  // A marked passage sits on its page, and that page is stated plainly.
  expect(buildSystemPrompt(base)).toContain("- Page: 12");
});
