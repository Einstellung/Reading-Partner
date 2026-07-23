// Context assembly (docs/02, first segment: live reading context). Pure
// function: given where the reader is, what they just marked, and — for M6 — the
// surrounding text, chapter, topic booklist, and whether tools are available,
// produce the system prompt. Later segments (memory recall, evidence) attach here.

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
  // M6 additions (all optional so older call sites are unaffected).
  chapterTitle?: string | null;
  surroundingText?: string | null;
  // Explicitly false only when the current book has no usable text layer; adds a
  // line telling the model it can't page through or search this book.
  fulltextAvailable?: boolean;
  materials?: BooklistItem[];
  // Compact figure catalog for the current book (M9), or "" when the book has no
  // detected figures. Lets the model cite figures as [fig:N] and call view_figure.
  figureCatalog?: string;
  // Whether any reading tool was wired for this call; gates the tools paragraph.
  hasTools?: boolean;
  // The book-level thread (docs/03: top-bar AI button). No passage was marked,
  // so every selection-derived part (marked passage, its note, surrounding text)
  // is dropped and the intro changes; position, chapter, booklist, tools stay.
  bookLevel?: boolean;
  // AI output language (docs settings). "auto" (or unset) mirrors the user's
  // language via the "follow the user's language" line; any other value appends
  // an instruction pinning replies to that language.
  aiLanguage?: AiLanguage;
}

function booklistLine(m: BooklistItem): string {
  const pages = m.fulltextAvailable ? `${m.pageCount} pages` : "full text not available";
  const anns = `${m.annotationCount} annotation${m.annotationCount === 1 ? "" : "s"}`;
  const current = m.isCurrent ? " (current)" : "";
  return `- ${m.label} — ${pages}, ${anns}${current}`;
}

export function buildSystemPrompt(ctx: ReadingContext): string {
  const bookLevel = ctx.bookLevel === true;
  const lines: string[] = bookLevel
    ? [
        "You are a reading companion embedded in a PDF reader. The user opened a",
        "conversation about the book as a whole — no passage is marked — to ask",
        'something like "what is this chapter about" or "where should I start".',
      ]
    : [
        "You are a reading companion embedded in a PDF reader. The user is reading",
        "closely and pulls you in by marking a passage with an AI pen; you answer",
        "right there, beside the text.",
      ];
  lines.push(
    "",
    "How to answer:",
    bookLevel
      ? "- Get to the point. Answer directly; no preamble."
      : "- Get to the point. Explain the marked passage directly; no preamble, no\n  restating the whole passage back to them.",
    "- Be concise and concrete. A few sentences usually beats a lecture.",
    "- Follow the user's language: if they write in Chinese, answer in Chinese.",
  );
  if (!bookLevel) {
    lines.push(
      "- You can see the passage below, so refer to it naturally rather than",
      "  quoting it in full.",
    );
  }
  lines.push(
    "- Cite pages of this book as [p.N]; when a claim rests on specific words,",
    '  quote them: [p.N "exact phrase from the page"] (verbatim from the source,',
    "  <=120 chars) — the quote gets highlighted on the page when clicked.",
    "- Your replies render as Markdown: write math as LaTeX delimited by $...$",
    "  (inline) or $$...$$ (block), and put code in fenced code blocks.",
    "",
    "Current reading context:",
    `- Topic: ${ctx.topicName}`,
    `- File: ${ctx.fileName}`,
  );
  if (ctx.pageLabel) lines.push(`- Page: ${ctx.pageLabel}`);
  if (ctx.chapterTitle) lines.push(`- Chapter: ${ctx.chapterTitle}`);
  if (!bookLevel) {
    lines.push(`- Marked passage: "${ctx.selectionText.trim()}"`);
    if (ctx.selectionComment && ctx.selectionComment.trim()) {
      lines.push(`- The user's note on it: "${ctx.selectionComment.trim()}"`);
    }
    if (ctx.surroundingText && ctx.surroundingText.trim()) {
      lines.push("", "Text around the marked passage:", '"""', ctx.surroundingText.trim(), '"""');
    }
  }
  if (ctx.fulltextAvailable === false) {
    lines.push(
      "",
      "Note: the full text of this book is not machine-readable, so you can't page",
      "through it or search it. Work from the marked passage and what the user tells you.",
    );
  }

  if (ctx.materials && ctx.materials.length > 0) {
    lines.push("", "Other materials in this topic:");
    for (const m of ctx.materials) lines.push(booklistLine(m));
  }

  if (ctx.figureCatalog && ctx.figureCatalog.trim()) {
    lines.push("", ctx.figureCatalog.trim());
  }

  if (ctx.hasTools) {
    lines.push(
      "",
      "Tools:",
      "You can call tools to look past the marked passage: read_pages(from, to) pulls",
      "a page range from the current book; search_topic(query) keyword-searches every",
      "material in this topic; read_annotations(material) lists the user's highlights",
      "and notes on a named material.",
      ...(ctx.figureCatalog && ctx.figureCatalog.trim()
        ? ["view_figure(id) shows you a figure from the catalog above so you can describe it."]
        : []),
      "",
      "Answer from the current passage by default. Consult other books only when the",
      "user brings them up or the question plainly needs them — don't wander off to",
      "compare materials unprompted. When you quote something a tool returned, cite the",
      "book and page.",
      "",
      "When you need more context, call the tools directly — never ask the user for",
      "permission to read. Reading is always allowed.",
    );
  }

  const lang = languageInstruction(ctx.aiLanguage ?? "auto");
  if (lang) lines.push("", lang);

  return lines.join("\n");
}

// The reader's cross-scenario profile, injected into the reading companion's
// system prompt so it knows their background and interests and pitches its
// explanations accordingly. An empty profile yields "" (the caller skips the
// section) — nothing is assumed about a reader who has stated nothing.
export function readerProfileSection(profile: string): string {
  const p = profile.trim();
  if (!p) return "";
  return [
    "Who you are reading with (their profile — background, interests, taste):",
    p,
    "",
    "Pitch your explanations to this: match the depth to their background in the",
    "area at hand, and connect to interests they have stated. Do not force it in",
    "where it is not relevant.",
  ].join("\n");
}
