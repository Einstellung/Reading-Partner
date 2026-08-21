// The two blocks a lecture turn adds to the prompt that nothing else produces:
// the book's chapter spine, and the statement of what this turn is actually
// carrying. Pure.

import { estimateTextTokens } from "../../budget";
import type { TableChapter } from "../chapters";
import type { InlineMode } from "./inline";

// --- the chapter spine (docs/09: 章脉络) ---
//
// One paragraph per chapter, written by the spine pass: what the chapter covers,
// which earlier chapter it builds on, which later chapter uses it. Loaded by
// data — present when that pass has run, absent when it has not, and a lecture
// turn never waits for it. The contract with the pass that writes it is this
// shape and nothing else, so where it is stored can move without touching a
// prompt.
export interface ChapterOutline {
  // Position in the book's chapter table, 1-based.
  index: number;
  // The number printed in the title, when it has one.
  number: number | null;
  title: string;
  startPage: number;
  endPage: number;
  // The paragraph itself, as written.
  body: string;
}

// What the whole spine may cost. A dozen chapters at a paragraph each is one to
// two thousand tokens per chapter; this holds that and refuses a pass that
// wrote essays.
export const OUTLINE_BUDGET_TOKENS = 20_000;
// The most one chapter's paragraph may contribute, so a single long one cannot
// eat the budget the other eleven need.
export const OUTLINE_CHAPTER_CHARS = 2_400;

function clipParagraph(body: string, max: number): string {
  const text = body.trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const para = cut.lastIndexOf("\n\n");
  return (para > max * 0.5 ? cut.slice(0, para) : cut).trimEnd() + "\n…";
}

// The spine as the prompt carries it, in reading order, under the budget. ""
// when the pass has written nothing yet, which is the normal state on a book
// nobody has prepped and is not an error anywhere.
export function chapterOutlineSection(
  outlines: readonly ChapterOutline[],
  budget = OUTLINE_BUDGET_TOKENS,
): string {
  const usable = outlines
    .filter((o) => o.body.trim() !== "")
    .sort((a, b) => a.index - b.index);
  if (usable.length === 0) return "";

  const blocks: string[] = [];
  let spent = 0;
  for (const o of usable) {
    const body = clipParagraph(o.body, OUTLINE_CHAPTER_CHARS);
    const head =
      o.number === null
        ? `--- ${o.title} (p.${o.startPage}-${o.endPage}) ---`
        : `--- Chapter ${o.number}: ${o.title} (p.${o.startPage}-${o.endPage}) ---`;
    const cost = estimateTextTokens(`${head}\n${body}`);
    if (spent + cost > budget) continue;
    spent += cost;
    blocks.push(`${head}\n${body}`);
  }
  if (blocks.length === 0) return "";

  return [
    "The spine of this book, chapter by chapter — what each one covers, what it",
    "builds on, what later chapters use it for. Written from the book, not by the",
    "reader. Use it to answer questions about order and route (where to start,",
    "whether a chapter can be skipped, what a chapter assumes); cite the book's own",
    "pages for anything you assert about content.",
    "",
    blocks.join("\n\n"),
  ].join("\n");
}

// --- what this turn is carrying ---

export interface TurnLoad {
  mode: InlineMode;
  bookName: string;
  pageCount: number;
  // The chapter inlined this turn, when mode is "chapter".
  chapter: TableChapter | null;
  // How many body pages went in, when mode is "whole".
  bodyPages?: number;
  // Counts of the other blocks, so the sentence describes the prompt rather than
  // the app's intentions.
  outlines?: number;
  prepNotes?: number;
  hasChapterTable?: boolean;
  // How far the pass that writes the spine has got, when it is under way. Absent
  // when no run exists and when one has finished, which are both "nothing to
  // say".
  spine?: { done: number; total: number };
  // This turn is an aside (docs/03, reading/aside.ts), and where its span came
  // from. The stable half of the prompt above is the parent lesson's verbatim,
  // so this is where the model is told which of the two it is answering.
  //
  // `lessonReplayed` is whether any of the parent conversation actually survived
  // into this turn's messages. It does not on an aside long enough to fill the
  // history on its own, on one the budget's tight rung cut back, or on one whose
  // parent is gone — and a sentence about a stretch that is not there is the
  // thing this block exists not to do.
  aside?: { from: "chat" | "mark"; lessonReplayed?: boolean };
}

// What an aside's turn is, as a fact about this turn — the same footing as
// everything else here, and not a claim about what happened earlier. The reader
// is in a lesson, pulled one thing out of it, and goes back when this is
// settled. Says nothing about how long the answer should be: that is the
// question's to decide, whichever door the reader came in by (docs/09).
function asideStatement(from: "chat" | "mark", lessonReplayed: boolean): string {
  const opening =
    from === "chat"
      ? [
          "This turn is a side conversation off a lesson on this book. The reader pulled one",
          "sentence out of the lesson and asked about it; the lesson is still open and they",
          "go back to it after. The passage is in the reading context above — refer to it",
          "rather than quoting it back in full.",
        ]
      : [
          "This turn is a side conversation off a lesson on this book. The reader marked a",
          "passage on the page mid-lesson and asked about it; the lesson is still open and",
          "they go back to it after. The passage is in the reading context above — refer to",
          "it rather than quoting it back in full.",
        ];
  return [
    ...opening,
    ...(lessonReplayed
      ? ["The messages replayed to you open on the stretch of the lesson this broke off from."]
      : ["None of the lesson itself is replayed to you; what follows is this side conversation alone."]),
    "Answer what they asked here — do not restart the lesson and do not recap it.",
  ].join("\n");
}

// The line docs/09 requires: what the model has this turn, as a statement about
// this prompt.
//
// Written as a fact about the present because the failure it exists for is a
// model contradicting the prompt from its own transcript. Measured: a turn whose
// prompt said the whole book was in context still told the reader "I have
// exactly the same thing as before", because it had said so twice already and
// the prompt only described a state, never a change. A claim about the past
// ("you read this chapter last turn") would be worse than useless — tool results
// and page images do not survive into the next turn, so it would be false.
export function turnLoadStatement(load: TurnLoad): string {
  const has: string[] = [];
  if (load.mode === "whole") {
    const pages = load.bodyPages ?? load.pageCount;
    has.push(
      `the full text of "${load.bookName}" — ${pages} of its ${load.pageCount} pages, above, page by page`,
    );
  } else if (load.mode === "chapter" && load.chapter) {
    const c = load.chapter;
    const name = c.number === null ? `"${c.title}"` : `chapter ${c.number} ("${c.title}")`;
    has.push(`the full text of ${name}, p.${c.startPage}-${c.endPage}, above, page by page`);
  }
  if (load.hasChapterTable) has.push("this book's chapter table with page ranges");
  if (load.outlines) has.push(`the chapter spine, ${load.outlines} chapter(s) of it`);
  if (load.prepNotes) has.push(`${load.prepNotes} prep note(s) on reference papers`);

  const lines = ["What you have in this turn's prompt, as of this turn:"];
  if (has.length === 0) {
    lines.push(
      `- No text from "${load.bookName}" itself. Everything you say about a page has to`,
      "  come from read_chapter / read_pages / search_topic first.",
    );
  } else {
    for (const item of has) lines.push(`- ${item}`);
    if (load.mode !== "whole") {
      lines.push(
        `- Nothing else of "${load.bookName}". Any other page has to be read with`,
        "  read_chapter / read_pages / search_topic before you describe it.",
      );
    }
  }
  // The spine's progress, stated as a fact and nothing else. What one chapter
  // covers is in the book's pages and does not wait on any of this; what one
  // chapter takes from another is written only after every chapter is. Which of
  // those the reader asked about is the model's judgement, the same judgement it
  // already makes about how long an answer should be — a prompt that decided in
  // advance would have every reader waiting for material half of them do not
  // need.
  if (load.spine) {
    lines.push(
      `- The chapter spine for this book is still being written: ${load.spine.done} of its`,
      `  ${load.spine.total} chapters are in, and the links between chapters — what one builds`,
      "  on, what a later one takes from it — are written only once every chapter is.",
      "  A chapter's own content does not wait on this; it comes from the book's own",
      "  pages. Let the question decide whether any of that is worth saying, the way",
      "  the question decides the length of an answer.",
    );
  }
  lines.push(
    "This describes this turn only. What a tool returned in an earlier turn, and any",
    "page image sent with one, are gone — do not reason from having seen them.",
  );
  // First, because it says what this turn is; the list after it says what it holds.
  if (!load.aside) return lines.join("\n");
  const said = asideStatement(load.aside.from, load.aside.lessonReplayed === true);
  return `${said}\n\n${lines.join("\n")}`;
}
