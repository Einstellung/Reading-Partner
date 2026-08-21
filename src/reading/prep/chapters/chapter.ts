// Per-chapter spine generation (docs/09). One unattended M6 tool loop per
// chapter: the model reads the chapter's page range, may look at figures that
// carry a result, and writes the chapter's spine — what it does, what it builds
// on, what it defines, where the load-bearing pages are.
//
// The reader of this text is the lecture entry, not a person. That is the whole
// difference from the lecture notes this pipeline used to write: labelled
// sections instead of prose, page anchors on every claim instead of a readable
// argument, and no attempt to be self-contained — the companion has the pages
// themselves when it teaches, and asks the spine what the chapter is for and how
// it hangs on the ones around it.
//
// Pure parts (prompts, tool building, emphasis-signal formatting) are exported
// for tests; the AI call is wired in live.ts.

import { Type, type ThinkingLevel } from "@earendil-works/pi-ai";
import type { AgentTool } from "../../../ai/agent";
import { runAgentTurn } from "../../../ai/agent";
import { formatPages, formatSearch } from "../../../fulltext/format";
import { buildFigureTools, type FigureImage } from "../../figures/tools";
import type { Figure } from "../../figures/types";
import type { Fulltext } from "../../../fulltext/types";
import { aiLanguageName, type AiLanguage } from "../../../platform/app/settings";
import type { BookChapter } from "../../chapters";
import type { SpineChapter } from "./types";

const CHAPTER_MAX_ROUNDS = 16;

// A detail signal: a place the user highlighted/underlined/annotated, and whether
// it was discussed with the AI (an AI-pen thread). Fed to the prompt only to
// gauge emphasis — never quoted into the note (docs/14).
export interface EmphasisSignal {
  page: number; // 1-based
  text: string;
  comment?: string;
  discussed?: boolean;
}

// Trim a snippet so a long highlight or chat message doesn't blow up the prompt.
function clip(text: string, max = 160): string {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : t.slice(0, max).trimEnd() + "…";
}

// One thread of the reader's conversation with the AI, anchored on a mark that
// falls on `page`. `createdAt` orders threads by recency when the block is
// trimmed. Roles come straight from the thread store (user / ai).
export interface ChatThread {
  page: number; // 1-based anchor page
  createdAt: number;
  messages: { role: "user" | "ai"; text: string }[];
}

// Per-message, per-thread, and whole-block caps so a long chat history can't
// crowd out the rest of the prompt (docs/14).
const CHAT_MSG_MAX = 600;
const CHAT_THREAD_MAX_MSGS = 6;
const CHAT_BLOCK_MAX = 8000;

// Format the reader's in-chapter conversations into a prompt block, or "" when
// none fall in [from, to]. Most recent threads first, so when the total cap
// trims the block it drops the oldest conversations. Each thread keeps its last
// few messages, clipped, tagged reader: / assistant:, under its anchor [p.N].
// The framing/instruction lives in chapterSystemPrompt; this is just the block.
export function formatChatThreads(threads: ChatThread[], from: number, to: number): string {
  const inRange = threads
    .filter((t) => t.page >= from && t.page <= to && t.messages.some((m) => m.text.trim()))
    .sort((a, b) => b.createdAt - a.createdAt);
  if (inRange.length === 0) return "";

  const blocks: string[] = [];
  let total = 0;
  for (const t of inRange) {
    const msgs = t.messages.filter((m) => m.text.trim()).slice(-CHAT_THREAD_MAX_MSGS);
    const lines = msgs.map(
      (m) => `${m.role === "user" ? "reader" : "assistant"}: ${clip(m.text, CHAT_MSG_MAX)}`,
    );
    const block = `[p.${t.page}]\n${lines.join("\n")}`;
    if (blocks.length > 0 && total + block.length + 2 > CHAT_BLOCK_MAX) break;
    blocks.push(block);
    total += block.length + 2;
  }
  return blocks.join("\n\n");
}

// The emphasis block for the chapter's page range, or "" when nothing falls in
// it. Two buckets: places discussed with the AI (weightier) and places merely
// marked. The prompt frames both as "spend more depth here", not as content.
export function formatEmphasisSignals(
  signals: EmphasisSignal[],
  from: number,
  to: number,
): string {
  const inRange = signals.filter((s) => s.page >= from && s.page <= to && s.text.trim());
  if (inRange.length === 0) return "";
  const discussed = inRange.filter((s) => s.discussed);
  const marked = inRange.filter((s) => !s.discussed);
  const lines: string[] = [
    "Reader emphasis signals for this chapter (the reader lingered here, so give",
    "these more depth). Do NOT quote or reference these directly; use them only to",
    "decide what to expand:",
  ];
  for (const s of discussed) {
    lines.push(`- discussed [p.${s.page}]: ${clip(s.text)}${s.comment ? ` — ${clip(s.comment, 80)}` : ""}`);
  }
  for (const s of marked) {
    lines.push(`- marked [p.${s.page}]: ${clip(s.text)}${s.comment ? ` — ${clip(s.comment, 80)}` : ""}`);
  }
  return lines.join("\n");
}

// The book's chapter table, with the one being written marked. Every chapter is
// written in parallel, so a chapter cannot be handed the spines of the chapters
// before it — but "builds on" still has to name them by number, and the numbers
// have to be the ones the rest of the app uses. The table is what makes that
// possible: the chapter's own back-references supply the content, this supplies
// the numbering.
export function formatChapterTable(chapters: BookChapter[], current: number): string {
  if (chapters.length === 0) return "";
  const lines = ["The book's chapters:"];
  for (const c of chapters) {
    const mark = c.index === current ? ">" : " ";
    lines.push(`${mark} ch.${c.index} ${c.title} — p.${c.startPage}-${c.endPage}`);
  }
  return lines.join("\n");
}

export function chapterSystemPrompt(params: {
  bookName: string;
  chapter: SpineChapter;
  chapters?: BookChapter[];
  figureCatalog?: string;
  emphasis?: string;
  chats?: string;
  instruction?: string;
  aiLanguage?: AiLanguage;
}): string {
  const { bookName, chapter, chapters, figureCatalog, emphasis, chats, instruction, aiLanguage } =
    params;
  const lines = [
    "You are preparing a book for a reading companion that teaches it a chapter at",
    "a time. What you write is read by that companion, not by a person: it is",
    "loaded into the companion's context before it talks about this chapter,",
    "alongside as much of the chapter's own pages as fit. So write it for lookup —",
    "no opening line, no closing line, no praise of the book, nothing the pages",
    "themselves already say better.",
    `The book is "${bookName}". Write the spine of one chapter of it.`,
    "",
    `Chapter ${chapter.index}: ${chapter.title}`,
    `Pages ${chapter.startPage}-${chapter.endPage} (1-based).`,
  ];
  if (chapters && chapters.length > 0) {
    lines.push("", formatChapterTable(chapters, chapter.index));
  }
  if (figureCatalog && figureCatalog.trim()) lines.push("", figureCatalog.trim());
  if (emphasis && emphasis.trim()) lines.push("", emphasis.trim());
  if (chats && chats.trim()) {
    lines.push(
      "",
      "The reader's conversations with you while reading this chapter follow. They",
      "are an emphasis signal only — they say where the reader slowed down, which is",
      "worth a line in Landmarks. Do not quote them and do not carry their content",
      "into the spine.",
      "",
      chats.trim(),
    );
  }
  if (instruction && instruction.trim()) {
    lines.push("", `The reader asked for this revision: ${instruction.trim()}`);
  }
  // The output language is templated into the "write it in ___" line, not pinned
  // by an appended instruction, so the prompt holds one language directive:
  // "auto" keeps English, a set language replaces it.
  const lang = aiLanguageName(aiLanguage ?? "auto") ?? "English";
  lines.push(
    "",
    "Read the chapter's pages with the tools before writing (read_pages, and",
    `search_book / view_figure as needed). Then write it in ${lang} as markdown,`,
    "200-350 words, in exactly these four sections and in this order:",
    "",
    "## Covers",
    "What the chapter does: the claims it makes, the machinery it builds, the order",
    "it goes in. Name things the way the book names them. Anchor every claim to a",
    "page marker in the exact form [p.N] (N is the 1-based page).",
    "",
    "## Builds on",
    "Which earlier chapters this one stands on and what it takes from each, one per",
    "line as `ch.N — what is carried over [p.N]`. Take this from the chapter's own",
    "back-references and from the chapter table above; never from a guess about a",
    "chapter you have not read. Write `nothing — this chapter opens the book` when",
    "it stands alone.",
    "",
    "## Introduces",
    "The terms, notation and results defined here that a later chapter has to know,",
    "one per line as `term [p.N] — one clause`.",
    "",
    "## Landmarks",
    "Two to four page ranges worth reading in full, one per line as `p.N-M — what",
    "is there`. Cite a figure that carries a result as [fig:N].",
    "",
    "Output only those four sections.",
  );
  return lines.join("\n");
}

// The loop's kickoff message; the model pulls the chapter's pages itself.
export function chapterKickoff(chapter: SpineChapter): string {
  return (
    `Write the spine for chapter ${chapter.index} ("${chapter.title}"), pages ` +
    `${chapter.startPage}-${chapter.endPage}. Read the pages with read_pages first, ` +
    "then write it."
  );
}

// read_pages / search_book over the whole book (the chapter is a page range the
// prompt scopes to), plus view_figure when the book has figures. Mirrors the M6
// reading tools.
export function buildChapterTools(params: {
  fulltext: Fulltext;
  figures: Figure[];
  modelSupportsImages: boolean;
  renderImage: (figure: Figure) => Promise<FigureImage | null>;
}): AgentTool[] {
  const { fulltext, figures, modelSupportsImages, renderImage } = params;
  const tools: AgentTool[] = [
    {
      name: "read_pages",
      description:
        "Read a 1-based, inclusive page range of the book (at most 10 pages per call).",
      parameters: Type.Object({
        from: Type.Number({ description: "First page (1-based)." }),
        to: Type.Number({ description: "Last page (1-based, inclusive)." }),
      }),
      execute: async (args) =>
        formatPages(fulltext, Math.round(Number(args.from)), Math.round(Number(args.to))),
    },
    {
      name: "search_book",
      description: "Keyword-search the book's full text. Returns ranked snippets with pages.",
      parameters: Type.Object({
        query: Type.String({ description: "Search terms." }),
      }),
      execute: async (args) =>
        formatSearch(String(args.query), [{ label: "book", fulltext, annotations: [] }]),
    },
  ];
  tools.push(...buildFigureTools({ figures, modelSupportsImages, renderImage }));
  return tools;
}

export interface ChapterModel {
  providerId: string;
  modelId: string;
  reasoning?: ThinkingLevel;
}

// Run the chapter tool loop and resolve with the note body. Errors reject.
// onProgress reports the cumulative received character count (drives the
// pipeline's stall watchdog and liveness counter). signal aborts the call.
export function runSpineChapter(params: {
  bookName: string;
  chapter: SpineChapter;
  chapters?: BookChapter[];
  tools: AgentTool[];
  model: ChapterModel;
  figureCatalog?: string;
  emphasis?: string;
  chats?: string;
  instruction?: string;
  aiLanguage?: AiLanguage;
  signal?: AbortSignal;
  onProgress?: (chars: number) => void;
}): Promise<string> {
  const { bookName, chapter, chapters, tools, model, figureCatalog, emphasis, chats, instruction, aiLanguage, signal, onProgress } =
    params;
  const systemPrompt = chapterSystemPrompt({
    bookName,
    chapter,
    chapters,
    figureCatalog,
    emphasis,
    chats,
    instruction,
    aiLanguage,
  });

  return new Promise<string>((resolve, reject) => {
    let chars = 0;
    const bump = (t: string) => {
      chars += t.length;
      onProgress?.(chars);
    };
    void runAgentTurn({
      providerId: model.providerId as any,
      modelId: model.modelId,
      systemPrompt,
      messages: [{ role: "user", text: chapterKickoff(chapter) }],
      tools,
      signal,
      reasoning: model.reasoning,
      maxRounds: CHAPTER_MAX_ROUNDS,
      purpose: "chapter-note",
      telemetry: { surface: "notes" },
      onDelta: bump,
      onThinking: bump,
      onToolStart: () => {},
      onToolEnd: () => {},
      onDone: (text) => {
        const t = text.trim();
        if (t) resolve(t);
        else reject(new Error("chapter note came back empty"));
      },
      onError: (message) => reject(new Error(message)),
    });
  });
}
