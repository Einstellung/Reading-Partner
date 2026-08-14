// Classroom-mode context assembly, pure. The prompt is two parts: a stable
// prefix (role + the survey's body pages with page markers) that holds still
// between turns of the same book — so provider prompt caching can hold it — and
// a variable tail (current position, prep notes, prep status, citation/tool
// instructions) appended after it. The prefix moves once, when the prep plan
// lands and its chapter table changes which pages count as body.

import { estimateTextTokens } from "../../budget";
import { toolLines } from "../../platform/app/context";
import type { Fulltext } from "../../fulltext/types";
import { requalifyNoteAnchors } from "./anchors";
import { stripModelAsides } from "./notes";
import { paperPriority } from "./scheduler";
import type { PrepChapter, PrepPaper, PrepState } from "./types";

export interface ClassroomNote {
  slug: string;
  title: string;
  body: string;
}

export interface ClassroomContext {
  topicName: string;
  surveyName: string;
  fulltext: Fulltext;
  pageLabel: string | null;
  chapterTitle: string | null;
  selectionText: string;
  selectionComment?: string | null;
  notes: ClassroomNote[];
  prep: PrepState | null;
  // The names of the tools actually mounted for this call. The tools paragraph
  // is generated from it, so the prompt promises exactly what is wired.
  toolNames?: readonly string[];
  // Compact figure catalog for the survey (M9), or "" when none detected.
  figureCatalog?: string;
  // Whether the caller appends its observation snapshot after this prompt. Only
  // gates the one line that points at it (see below).
  hasObservations?: boolean;
  // False when the survey did not fit the model's context window and the caller
  // dropped the inlined body (src/budget). The prefix then points at read_pages
  // instead, and the tools paragraph stops claiming the survey is already there.
  // Defaults to true.
  inlineSurvey?: boolean;
}

// --- which pages of the survey are the survey ---
//
// The closing reference list is not course material: it is a few hundred
// bibliography entries, and on the survey this was measured against (22 pages,
// IEEE two-column) pages 16-22 were 63,490 of 146,742 characters — 43% of the
// book, spent on the one part of it nobody reads in order. Worse, it is the
// material the model abbreviates into paper slugs that do not exist.
//
// Cutting it wrong costs body text, so the test is deliberately hard to pass and
// every way of failing it lands on "keep the whole book":
//
//   1. The plan's chapter table, non-empty. It is evidence, not a veto: without
//      it there is nothing saying where the body ends, and lazy prep means a
//      class can start before the plan lands (docs/09). Use PrepState.chapters,
//      the table the prep run produced — the one in notes-*/state.json is a
//      different table and is wrong here.
//   2. A references heading ("REFERENCES", also "R EFERENCES" once the extractor
//      has been at the small caps) somewhere in the book. The LAST one, since a
//      paper's own reference list can be quoted earlier.
//   3. No chapter starts after the heading page.
//   4. Every page after the heading page reads as a list of numbered entries, all
//      the way to the last page. A run that stops short is a run we have misread.
//   5. Those entry numbers run strictly upward across the whole stretch. This is
//      the one that separates "the bibliography continues here" from "a table
//      quotes citations": measured, the survey's list runs 1→291 in order over
//      seven pages, while the two classification-table pages that passed the
//      density test on their own print each citation twice (8,8,95,95,96,…).
//
// The heading page itself is kept whole: the body's last paragraphs are usually
// on it, and one page is not worth the risk of cutting them. Its own entries are
// left out of the number sequence for the same reason — body prose above them
// can wrap a citation onto a line of its own.

const ENTRY_MARKER = /^\s*\[(\d{1,4})\]/;
const REFERENCE_HEADING = /^(REFERENCES?|BIBLIOGRAPHY|参考文献)$/;

// Thresholds, from the measured survey. Reference pages there ran 21-49 entry
// markers, 186-388 chars per entry, 0.15-0.32 of their lines starting an entry;
// body pages ran at most 8 markers, at least 598 chars per marker, at most 0.09
// of their lines. All three have to hold, so a body page that wraps a handful of
// citations onto their own lines is not mistaken for a bibliography — but a
// dense table of cited methods can still pass all three, which is what rule 5 is
// for.
const MIN_ENTRIES = 10;
const MAX_CHARS_PER_ENTRY = 500;
const MIN_ENTRY_LINE_SHARE = 0.12;

// The citation numbers of the lines that open an entry, in page order.
function entryNumbers(page: string): number[] {
  const out: number[] = [];
  for (const line of page.split("\n")) {
    const m = ENTRY_MARKER.exec(line);
    if (m) out.push(Number(m[1]));
  }
  return out;
}

function looksLikeReferenceList(page: string): boolean {
  const lines = page.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return false;
  const entries = entryNumbers(page).length;
  if (entries < MIN_ENTRIES) return false;
  if (page.length / entries > MAX_CHARS_PER_ENTRY) return false;
  return entries / lines.length >= MIN_ENTRY_LINE_SHARE;
}

function hasReferenceHeading(page: string): boolean {
  return page
    .split("\n")
    .some((l) => REFERENCE_HEADING.test(l.replace(/\s+/g, "").toUpperCase()));
}

// How many leading pages of the survey are body, and so get inlined. Equal to
// the page count whenever the reference list cannot be identified with
// confidence — keeping a bibliography costs tokens, cutting a chapter costs the
// class.
export function surveyBodyPageCount(ft: Fulltext, chapters: readonly PrepChapter[] = []): number {
  const pages = ft.pages;
  const n = pages.length;
  if (n < 3 || chapters.length === 0) return n;

  let heading = -1;
  for (let i = 0; i < n; i++) if (hasReferenceHeading(pages[i])) heading = i;
  if (heading < 0 || heading === n - 1) return n;

  for (const c of chapters) if (c.startPage > heading + 1) return n;

  let last = 0;
  for (let i = heading + 1; i < n; i++) {
    if (!looksLikeReferenceList(pages[i])) return n;
    for (const num of entryNumbers(pages[i])) {
      if (num <= last) return n;
      last = num;
    }
  }

  return heading + 1;
}

// The page-by-page survey body, the part of the prefix that carries the book.
// Exported so a caller can price dropping it before it builds the prompt.
export function classroomSurveyBody(ft: Fulltext, chapters: readonly PrepChapter[] = []): string {
  const kept = surveyBodyPageCount(ft, chapters);
  const lines: string[] = [];
  for (let i = 0; i < kept; i++) {
    lines.push(`=== Page ${i + 1} ===`, ft.pages[i]);
  }
  if (kept < ft.pages.length) {
    lines.push(
      "",
      `[Pages ${kept + 1}-${ft.pages.length} are the survey's numbered reference list and are`,
      "not reproduced here; read_pages still reaches them. A [n] marker in the body",
      "is a citation number, never a paper slug — the slugs are the ones in the prep",
      "list below, and there are no others.]",
    );
  }
  return lines.join("\n");
}

// The stable prefix: everything before the per-turn context. Depends on the
// survey and on the plan's chapter table, neither of which moves turn to turn,
// so its string identity survives across them.
export function classroomPromptPrefix(
  surveyName: string,
  ft: Fulltext,
  inlineSurvey = true,
  chapters: readonly PrepChapter[] = [],
): string {
  const lines = [
    "You are a reading companion in classroom mode: you have pre-read this",
    inlineSurvey
      ? "survey's load-bearing references and digested the survey itself, and you"
      : "survey's load-bearing references, and you",
    "teach by walking the user through the survey — the book they picked as their",
    "textbook. Do not fix in advance how much they know: start where their",
    "questions start, and adjust to how they answer.",
    "",
    "How to teach:",
    "- Follow the survey's own structure; it is the syllabus.",
    "- Get to the point. Answer the question asked; no preamble, no recap of what",
    "  you said last turn.",
    "- Be concise and concrete. A few sentences usually beats a lecture — when a",
    "  point genuinely needs building, build it, but reach for that length because",
    "  the point needs it, not by default.",
    "- Answer the question they asked, not three more. Don't write the section's",
    "  lecture notes when they asked about one line.",
    "- Explain in plain terms; expand jargon on first use.",
    "- Explaining a point a second time means changing the angle, not the wording:",
    "  go down to the mechanism — what produces what, what reads what — and start",
    "  from something they already have. The same paragraph reworded is not a",
    "  second explanation.",
    "- You may examine them. After a load-bearing point, ask them to put it back in",
    "  their own words, or ask what they think follows from it. Once, and then move",
    "  on — checking whether it landed, not running an exam, so don't test them",
    "  every turn. Ending a turn with \"shall we go on to §X\" is not examining;",
    "  that is just how a turn ends.",
    "- Ground every claim in the text. Cite survey pages as [p.N]; when a claim",
    '  leans on specific words, quote them: [p.N "exact phrase from the page"]',
    "  (verbatim from the source, <=120 chars) — the quote gets highlighted on",
    "  the page when clicked. When you draw on a pre-read reference paper, cite it",
    "  as [paper-slug p.N] using the slug from the prep notes. These citations",
    "  become clickable links.",
    "- Follow the user's language: if they write in Chinese, answer in Chinese.",
    "- Your replies render as Markdown: math as $...$ / $$...$$, code fenced.",
    "",
  ];
  if (inlineSurvey) {
    const whole = surveyBodyPageCount(ft, chapters) === ft.pages.length;
    lines.push(
      whole
        ? `The full survey ("${surveyName}"), page by page:`
        : `The survey ("${surveyName}"), page by page, minus its closing reference list:`,
      classroomSurveyBody(ft, chapters),
    );
  } else {
    lines.push(
      `The survey ("${surveyName}") runs ${ft.pages.length} pages. It is too long to`,
      "hold in your context, so it is NOT reproduced here: read what you need with",
      "read_pages(from, to), starting around the reader's current position. Do not",
      "describe a page you have not read.",
    );
  }
  return lines.join("\n");
}

// --- which prep notes ride along ---

// The token cap on the inlined prep notes. Roughly what the survey itself costs
// (the measured book: 22 pages, ~37k tokens), which is the right order — the
// notes are the shelf beside the textbook, not a second textbook. At the note
// sizes the digest produces (~1k tokens each) it holds about forty of them,
// twice the list that survey nominated. Papers keep arriving (every pasted link
// mints one), so the bound is on tokens rather than on a paper count.
//
// This cap is the whole of what bounds the notes on the model the reader is on.
// The ladder's rung below it is not a second line of defence there: fitToBudget
// gives nothing up until the call is within a hair of the window, which on a 1M
// model means 991,808 tokens, and a classroom turn on the measured survey is
// about 39k. The rung is for the narrow windows in the catalog (128k, 200k) and
// for a prep list that has grown past anything measured here.
export const CLASSROOM_NOTE_BUDGET = 40_000;

// What the ladder's "prep-notes-trim" rung leaves: the same list under a quarter
// of the budget. Not "only this chapter's citations" — the chapter number comes
// from the reader's scroll position, which is the witness this whole change
// stopped trusting, and on the real survey it left 2 notes on p.12 and 1 on p.15.
// A smaller budget gives up the same far end of the same queue, only sooner.
export const CLASSROOM_NOTE_BUDGET_TIGHT = CLASSROOM_NOTE_BUDGET / 4;

// A note's stored body turned into the text that goes in the prompt. It exists
// so there is one answer to "what does this note cost": whatever cleaning a note
// gets on the way out of storage happens here, ahead of selectClassroomNotes,
// and never between pricing and printing.
//
// Must stay idempotent. It is applied twice on purpose — once where turn.ts
// builds a ClassroomNote and once where the body is printed below — so that no
// path can put text in the prompt that was never priced.
//
// The two steps: the writer's asides dropped, and every page anchor named with
// the paper it belongs to, so a citation copied out of a note cannot land in the
// survey's page namespace. Both are idempotent — a second pass finds no asides,
// and an anchor that already names its paper parses as one and is left alone.
// Pricing the raw body instead of this one ran 16,156 tokens priced against
// 19,506 printed over the real survey's 17 notes, 21% past what the cap was told.
export function classroomNoteBody(body: string, slug: string): string {
  return requalifyNoteAnchors(stripModelAsides(body), slug);
}

export interface NoteSelection {
  // The chapter the reader is in (scheduler.chapterIndexForPage).
  chapter: number;
  chapterCount: number;
  budget?: number;
}

// The notes to inline, in order, under the cap. Which chapter the reader is
// parked on no longer decides *whether* a note rides along — it decides the
// order they are given up in, and only once the cap bites.
//
// The order is scheduler.paperPriority, the same judgement the prep queue makes:
// user-added first, then this chapter's citations, then the chapters ahead in
// order, then the ones already behind. A note that does not fit is passed over
// and the walk continues, rather than ending the list: one oversized note (a
// pasted article's digest can be several times a paper's) must not cost every
// note behind it.
export function selectClassroomNotes(
  notes: readonly ClassroomNote[],
  papers: readonly PrepPaper[],
  sel: NoteSelection,
): ClassroomNote[] {
  const bySlug = new Map(papers.map((p) => [p.slug, p]));
  const ranked = notes
    .map((note) => ({ note, paper: bySlug.get(note.slug) }))
    .filter((x): x is { note: ClassroomNote; paper: PrepPaper } => x.paper !== undefined)
    .sort(
      (a, b) =>
        paperPriority(a.paper, sel.chapter, sel.chapterCount) -
        paperPriority(b.paper, sel.chapter, sel.chapterCount),
    );

  const budget = sel.budget ?? CLASSROOM_NOTE_BUDGET;
  const out: ClassroomNote[] = [];
  let spent = 0;
  for (const { note } of ranked) {
    const cost = estimateTextTokens(`${note.slug}${note.title}${note.body}`);
    if (spent + cost > budget) continue;
    spent += cost;
    out.push(note);
  }
  return out;
}

// --- the prep status list ---

// The model cannot tell "all three sources were asked and this paper is not on
// any of them" from "the network dropped" unless the reason is in front of it,
// and it answers the reader's "why don't you have that one" either way. Clipped:
// a whole stack trace in a status line is the same failure as no reason at all.
const REASON_CHARS = 80;

function shortReason(error: string | undefined): string {
  const one = (error ?? "").replace(/\s+/g, " ").trim();
  if (!one) return "no reason recorded";
  return one.length > REASON_CHARS ? `${one.slice(0, REASON_CHARS - 1)}…` : one;
}

// One line of the prep list. `inContext` comes from the notes this turn actually
// carries — the same array the bodies above are printed from, so the list cannot
// claim a note is in front of the model when it is not.
function paperLine(p: PrepPaper, inContext: boolean): string {
  const head = `- ${p.slug} — ${p.title}${p.year ? ` (${p.year})` : ""}`;
  if (inContext) {
    return p.status === "abstract-only"
      ? `${head} [note below — from the abstract only, no full text]`
      : `${head} [note below]`;
  }
  switch (p.status) {
    case "done":
    case "abstract-only":
      return `${head} [note ready, not in this turn's context — read_note("${p.slug}")]`;
    case "failed":
      return `${head} [no full text: ${shortReason(p.error)}]`;
    case "skipped":
      return `${head} [skipped]`;
    default:
      return `${head} [still being prepped]`;
  }
}

export function buildClassroomSystemPrompt(ctx: ClassroomContext): string {
  const inlineSurvey = ctx.inlineSurvey !== false;
  const chapters = ctx.prep?.chapters ?? [];
  const lines: string[] = [
    classroomPromptPrefix(ctx.surveyName, ctx.fulltext, inlineSurvey, chapters),
  ];

  lines.push("", "Current position:", `- Topic: ${ctx.topicName}`);
  if (ctx.pageLabel) lines.push(`- Page: ${ctx.pageLabel}`);
  if (ctx.chapterTitle) lines.push(`- Chapter: ${ctx.chapterTitle}`);
  if (ctx.selectionText.trim()) {
    lines.push(`- Marked passage: "${ctx.selectionText.trim()}"`);
  }
  if (ctx.selectionComment && ctx.selectionComment.trim()) {
    lines.push(`- The user's note on it: "${ctx.selectionComment.trim()}"`);
  }
  lines.push(
    "- Where the reader is scrolled to is not what the class is about. Take the",
    "  subject from the conversation, not from the page number.",
  );

  if (ctx.notes.length > 0) {
    lines.push("", "Prep notes on the survey's references, in full:");
    for (const n of ctx.notes) {
      lines.push("", `--- ${n.slug}: ${n.title} ---`, classroomNoteBody(n.body, n.slug));
    }
    lines.push(
      "",
      "Every page anchor in these notes already names its paper: copy it as it",
      "stands, e.g. [paper-slug p.3]. A bare [p.3] means a page of the survey.",
    );
  }

  if (ctx.prep && ctx.prep.papers.length > 0) {
    const inContext = new Set(ctx.notes.map((n) => n.slug));
    lines.push(
      "",
      "The prep list — every reference nominated for this survey, and what you have",
      "of each. These slugs are the only ones read_paper and read_note accept; never",
      "make one up from a reference-list entry.",
    );
    for (const p of ctx.prep.papers) lines.push(paperLine(p, inContext.has(p.slug)));
  }

  if (ctx.figureCatalog && ctx.figureCatalog.trim()) {
    lines.push("", ctx.figureCatalog.trim());
  }

  // Temporary, and meant to be easy to delete (docs/09: what the observation
  // layer recorded should reach the teaching, not just sit there). It adds no
  // field, no store and no consumer of its own — it points at the observation
  // snapshot the caller already appends below this prompt. The observation layer
  // is going to be redesigned; when it is, this block goes with it.
  if (ctx.hasObservations) {
    lines.push(
      "",
      "Your observations of this reader, below, include what they got stuck on. When",
      "you are about to explain one of those again, change the angle or the example.",
    );
  }

  const toolList = toolLines(ctx.toolNames ?? []);
  if (toolList.length > 0) {
    lines.push(
      "",
      "Tools:",
      // The claim has to track the prefix, down to the reference list. Left
      // standing after the body was dropped, it tells the model it can see a
      // book it cannot, and it invents the pages.
      inlineSurvey
        ? surveyBodyPageCount(ctx.fulltext, chapters) === ctx.fulltext.pages.length
          ? "The survey is already fully in your context above."
          : "The survey's body is already in your context above; its closing reference list is not."
        : "The survey is not in your context: read it with read_pages.",
      "When a question goes deeper than the prep notes, call tools instead of",
      "guessing. Mounted this turn:",
      ...toolList,
      "Call tools directly — never ask permission to read.",
    );
  }

  return lines.join("\n");
}
