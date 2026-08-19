// Context assembly (docs/02 first segment, docs/09): given where the reader is,
// what they marked, what of the book was loaded for this turn, and which tools
// were mounted, produce the system prompt. Pure.
//
// One prompt. There used to be two — the reading companion's and the classroom's
// — and what separated them was which materials had been gathered, which is a
// fact about the turn and not about the model's job. Everything either of them
// said is here, and every block is attached by data: a block whose material was
// not gathered is not mentioned at all, so the prompt never describes something
// the model was not given.
//
// Block order is load-bearing. Everything that holds still between two turns of
// the same conversation comes first and everything that moves comes last,
// because a provider's prompt cache matches on a prefix: one line that changes
// with the reader's scrolling, placed early, invalidates every token after it.
// Measured before the reorder — two questions three minutes apart in one thread
// read 2,061 tokens from cache, with "- Page: 132" sitting above the lot.

import { languageInstruction, type AiLanguage } from "./settings";

// One material in the topic booklist injected into the prompt.
export interface BooklistItem {
  label: string;
  pageCount: number;
  annotationCount: number;
  fulltextAvailable: boolean;
  isCurrent: boolean;
}

export interface ReadingContext {
  topicName: string;
  fileName: string;
  pageLabel: string | null;
  selectionText: string;
  selectionComment?: string | null;
  chapterTitle?: string | null;
  surroundingText?: string | null;
  // Explicitly false only when the current book has no usable text layer; adds a
  // line telling the model it can't page through or search this book.
  fulltextAvailable?: boolean;
  materials?: BooklistItem[];
  // The visual-aid block (reading/diagrams/prompt.ts): the figure catalog plus
  // when to cite a figure, draw one, or do neither. Ordered around the reader's
  // page, so it counts as volatile and sits after the position.
  figureCatalog?: string;
  // The names of the tools actually mounted for this call. The tools paragraph
  // is generated from it and appears only when it names something.
  toolNames?: readonly string[];
  // The book-level thread (docs/03: the top-bar AI button). No passage was
  // marked, so every selection-derived part is dropped and the intro changes.
  //
  // An aside sets this too, because its parent does: the stable half below is
  // the parent's byte for byte, which is what makes a turn on an aside a cache
  // read instead of a second copy of the inlined chapter. What the aside is
  // gets said in the volatile half, next to the question.
  bookLevel?: boolean;
  // A side conversation off the thread above (docs/03), and where its span came
  // from: the reader's selection inside a chat message, or a mark they drew on
  // the page while the lesson ran. The span itself rides `selectionText`, in the
  // slot a marked passage goes in — tier 0, never dropped (reading/ladder.ts).
  aside?: { from: "chat" | "mark" };
  aiLanguage?: AiLanguage;

  // --- the stable half, in cache order (docs/09) ---

  // Whether prep notes are attached, which is the only thing that makes
  // [paper-slug p.N] a citation the reader can click. With no notes the rule is
  // an invitation to make a slug up, which is what it was being used for.
  citePaperSlugs?: boolean;
  // The book's chapters with their page ranges (reading/lecture).
  chapterTable?: string;
  // The book's text, or one chapter of it, page by page under its anchors.
  inlineBody?: string;
  // The pre-read reference papers' notes, in full.
  prepNotes?: string;
  // One paragraph per chapter: what it covers, what it builds on, what uses it.
  chapterSpine?: string;
  // The reader's own whole-book outline, from their notes.
  spineOverview?: string;
  // Who the reader is (declared) and what has been guessed about them.
  profile?: string;
  // Paragraphs belonging to individual tools, each written where its tool is.
  toolPrompts?: readonly string[];

  // --- the volatile half ---

  // The chapter this conversation is parked on, as a phrase (`chapter 3
  // "Coding Attention Mechanisms", p.64-107`). Book-level threads only.
  focusLabel?: string;
  // The AI's observations of this reader, plus what to do with them.
  observations?: string;
  // The prep list: every nominated reference and what exists of it.
  prepStatus?: string;
  // The page images riding this turn's message.
  pageWindow?: string;
  // The last thing before the question: what this turn is actually carrying.
  loaded?: string;
}

// The tools a reading turn can mount that have no prompt paragraph of their own,
// and the single line each gets. Written down once and rendered from the names
// actually wired, because a prompt that lists a tool unconditionally is a prompt
// that lies: read_annotations is mounted only when some material carries a mark
// (reading/context.ts), so on a book with no marks the model was being told to
// call a tool that answers "unknown tool" — and one empty call is enough to
// teach it to stop reaching for any of them.
//
// Absent on purpose: add_source, find_paper, research_literature, the
// saved-article pair and the observation tools. Each carries its own paragraph
// wherever it is mounted, and a second mention here would be a second place to
// keep true.
const TOOL_LINE: Record<string, string> = {
  read_pages: "read_pages(from, to) — a page range of the book the reader is in.",
  read_chapter:
    "read_chapter(...) — one whole chapter of the book the reader is in, in a single" +
    " call. Its schema says whether it takes a chapter number or a page range.",
  search_topic: "search_topic(query) — keyword search across every material in this topic.",
  read_annotations:
    "read_annotations(material) — the reader's highlights and notes on one named material.",
  read_paper: "read_paper(slug, from, to) — pages of a pre-read reference paper's full text.",
  read_note: "read_note(slug) — a pre-read paper's whole prep note.",
  view_figure: "view_figure(id) — shows you a figure so you can describe what it depicts.",
};

// The described tools among `names`, in the table's order, as prompt lines.
// Empty when the call mounted none of them, which is what gates the paragraph.
export function toolLines(names: readonly string[]): string[] {
  const mounted = new Set(names);
  return Object.entries(TOOL_LINE)
    .filter(([name]) => mounted.has(name))
    .map(([, line]) => `- ${line}`);
}

function booklistLine(m: BooklistItem): string {
  const pages = m.fulltextAvailable ? `${m.pageCount} pages` : "full text not available";
  const anns = `${m.annotationCount} annotation${m.annotationCount === 1 ? "" : "s"}`;
  const current = m.isCurrent ? " (current)" : "";
  return `- ${m.label} — ${pages}, ${anns}${current}`;
}

// How to answer — the same job whichever door the reader came in by. What the
// entry decides is the range of the question, never the shape of the answer:
// "what is an attention head" deserves the long answer inside a marked passage,
// and "how many pages is chapter 3" deserves one line at book level.
function teachingRules(bookLevel: boolean): string[] {
  const lines = [
    "How to answer:",
    bookLevel
      ? "- Get to the point. Answer the question asked; no preamble, no recap of what\n  you said last turn."
      : "- Get to the point. Explain the marked passage directly; no preamble, no\n  restating the whole passage back to them.",
    "- Let the question set the length. A question with a one-line answer gets a",
    "  line. A point that has to be built gets built, at whatever length the building",
    "  takes — and when the reader asks to be taught a stretch of the book, teach it",
    "  as a block. Neither the door they came in by nor the size of what you were",
    "  handed decides this.",
    "- Follow the book's own structure when you walk through it; it is the syllabus.",
    "- Explain in plain terms; expand jargon on first use. Do not fix in advance how",
    "  much they know: start where their questions start, and adjust to how they",
    "  answer.",
  ];
  if (!bookLevel) {
    lines.push(
      "- You can see the passage below, so refer to it naturally rather than",
      "  quoting it in full.",
    );
  }
  return lines;
}

function citationRules(citePaperSlugs: boolean): string[] {
  const lines = [
    "- Ground every claim in the text. Cite pages of this book as [p.N]; when a claim",
    '  rests on specific words, quote them: [p.N "exact phrase from the page"]',
    "  (verbatim from the source, <=120 chars) — the quote gets highlighted on the",
    "  page when clicked.",
  ];
  if (citePaperSlugs) {
    lines.push(
      "- When you draw on a pre-read reference paper, cite it as [paper-slug p.N],",
      "  using a slug from the prep list. These citations become clickable links.",
    );
  }
  lines.push(
    "- Follow the user's language: if they write in Chinese, answer in Chinese.",
    "- Your replies render as Markdown: write math as LaTeX delimited by $...$",
    "  (inline) or $$...$$ (block), and put code in fenced code blocks.",
  );
  return lines;
}

export function buildSystemPrompt(ctx: ReadingContext): string {
  const bookLevel = ctx.bookLevel === true;
  const blocks: string[] = [];
  const push = (text: string | null | undefined): void => {
    const t = (text ?? "").trim();
    if (t) blocks.push(t);
  };

  push(
    (bookLevel
      ? [
          // Three conversations share this block, because an aside borrows its
          // parent's stable half verbatim to keep the cache prefix and then
          // prints the passage it was opened on a few blocks below. So it says
          // only what is true of all three, and hands the reading context the
          // job of saying which one this is. "— no passage is marked —" used to
          // sit in the second line and could not survive that; the last sentence
          // is what replaced it, and it is vacuous on the lesson's own turns,
          // where nothing below names a passage.
          "You are a reading companion embedded in a PDF reader. The user opened a",
          "conversation about the book as a whole — to be taught part of it, to be",
          "pointed at where to start, or to ask what a chapter holds. Where the",
          "reading context below names a passage, this turn is a side conversation",
          "off that one and that passage is its subject.",
        ]
      : [
          "You are a reading companion embedded in a PDF reader. The user is reading",
          "closely and pulls you in by marking a passage with an AI pen; you answer",
          "right there, beside the text.",
        ]
    ).join("\n"),
  );
  push([...teachingRules(bookLevel), ...citationRules(ctx.citePaperSlugs === true)].join("\n"));

  const toolList = toolLines(ctx.toolNames ?? []);
  if (toolList.length > 0) {
    push(
      [
        "Tools:",
        "You can call tools to look past what you were handed. Mounted this turn:",
        ...toolList,
        "",
        "Answer from the book the reader is in by default. Consult other materials only",
        "when the user brings them up or the question plainly needs them — don't wander",
        "off to compare materials unprompted. When you quote something a tool returned,",
        "cite the book and page.",
        "",
        "When you need more context, call the tools directly — never ask the user for",
        "permission to read. Reading is always allowed.",
      ].join("\n"),
    );
  }
  for (const p of ctx.toolPrompts ?? []) push(p);
  push(ctx.profile);

  if (ctx.materials && ctx.materials.length > 0) {
    push(["The materials in this topic:", ...ctx.materials.map(booklistLine)].join("\n"));
  }
  push(ctx.chapterTable);
  push(ctx.inlineBody);
  push(ctx.prepNotes);
  push(ctx.chapterSpine);
  push(ctx.spineOverview);

  // --- everything below here moves from turn to turn ---

  const position: string[] = [
    "Current reading context:",
    `- Topic: ${ctx.topicName}`,
    `- File: ${ctx.fileName}`,
  ];
  if (ctx.pageLabel) position.push(`- Page: ${ctx.pageLabel}`);
  if (ctx.chapterTitle) position.push(`- Chapter: ${ctx.chapterTitle}`);
  // Which chapter the talking is about, and what it is not. An aside states the
  // chapter as a fact about the lesson it hangs off and stops there: what it is
  // about is the passage below, so the two lines that hand the subject to the
  // chapter, or take it away from the page, would both be false here.
  if (ctx.focusLabel && ctx.aside) {
    position.push(`- The lesson this came out of is on ${ctx.focusLabel}.`);
  } else if (ctx.focusLabel) {
    position.push(
      `- This conversation is on ${ctx.focusLabel}. That, and not the page above, is`,
      "  what it is about; the reader can be scrolled anywhere while you talk.",
    );
  } else if (bookLevel && ctx.aside?.from !== "mark") {
    position.push(
      "- Where the reader is scrolled to is not the subject. Take that from the",
      "  conversation, not from the page number.",
    );
  }
  // What this conversation is anchored on. A chat-span aside's anchor is words
  // out of a reply, not out of the book, so it is named for what it is; every
  // other anchored conversation — a mark thread, an aside drawn on the page — is
  // a marked passage and says so.
  //
  // Said without pointing at a message. The reader goes on talking here and this
  // block is rebuilt every turn, so "your last answer" would be a different
  // answer by the second one, and the message the span came out of may not be in
  // the replayed history at all.
  if (ctx.aside?.from === "chat") {
    position.push(
      `- The subject of this side conversation, taken by the reader out of something you`,
      `  wrote earlier in the lesson: "${ctx.selectionText.trim()}"`,
    );
  } else if (!bookLevel || ctx.aside) {
    position.push(`- Marked passage: "${ctx.selectionText.trim()}"`);
    if (ctx.selectionComment && ctx.selectionComment.trim()) {
      position.push(`- The user's note on it: "${ctx.selectionComment.trim()}"`);
    }
  }
  push(position.join("\n"));

  // Page-anchored, so it rides only where there is a page: a chat-span aside's
  // span came out of a reply and the text around the reader's scroll position
  // has nothing to do with it.
  const pageAnchored = !bookLevel || ctx.aside?.from === "mark";
  if (pageAnchored && ctx.surroundingText && ctx.surroundingText.trim()) {
    push(["Text around the marked passage:", '"""', ctx.surroundingText.trim(), '"""'].join("\n"));
  }
  if (ctx.fulltextAvailable === false) {
    push(
      [
        "Note: the full text of this book is not machine-readable, so you can't page",
        "through it or search it. Work from what is above and what the user tells you.",
      ].join("\n"),
    );
  }

  push(ctx.figureCatalog);
  push(ctx.observations);
  push(ctx.prepStatus);
  push(ctx.pageWindow);
  push(languageInstruction(ctx.aiLanguage ?? "auto"));
  // Last, so it is the nearest thing to the reader's question (docs/09).
  push(ctx.loaded);

  return blocks.join("\n\n");
}

// The reader's cross-scenario profile, injected into the reading companion's
// system prompt so it knows their background and interests and pitches its
// explanations accordingly. Empty on both counts yields "" (the caller skips the
// section) — nothing is assumed about a reader who has stated nothing.
//
// The two halves arrive separately and stay separate here. `declared` is what the
// reader said about themselves; `guesses` is what the AI inferred on its own
// (observation/profile/guess.ts), which is wrong often enough that a prompt must not be
// able to act on it as a fact. The caller splits them (profileForPrompt) —
// platform/app imports nothing, so the parsing lives in the domain that owns
// the format.
export function readerProfileSection(declared: string, guesses = ""): string {
  const p = declared.trim();
  const g = guesses.trim();
  if (!p && !g) return "";
  const lines: string[] = [];
  if (p) {
    lines.push(
      "Who you are reading with (their profile — background, interests, taste, in",
      "their own words):",
      p,
      "",
      "Pitch your explanations to this: match the depth to their background in the",
      "area at hand, and connect to interests they have stated. Do not force it in",
      "where it is not relevant.",
    );
  }
  if (g) {
    if (lines.length) lines.push("");
    lines.push(
      "Guesses you have made about this reader. These are your own inferences,",
      "drawn from what they read and mark. Nobody confirmed them and some of them",
      "are wrong:",
      g,
      "",
      "Treat each as a hypothesis to test against this conversation, not as",
      "something the reader told you. Never pitch depth from a guess: how much this",
      "reader can handle is decided by what they have actually said about their",
      "background and by how this conversation is going, never by something you",
      "inferred from what they happened to highlight. If a guess is wrong, the",
      "conversation will show it — follow the conversation.",
    );
  }
  return lines.join("\n");
}
