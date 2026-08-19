
// The prep side of a reading turn's context, pure: where a document's body ends
// and its closing reference list begins, which prep notes ride along under a
// token cap, and the two blocks they are printed as.
//
// No prompt of its own any more (docs/09, 2026-08-19: classroom stopped being a
// mode and there is one prompt, in platform/app/context.ts). What is left here
// is what the prep pipeline knows and nothing else does, attached to a turn by
// data — a book with no prep run contributes none of it.

import { estimateTextTokens } from "../../../budget";
import type { Fulltext } from "../../../fulltext/types";
import { requalifyNoteAnchors } from "../anchors";
import { stripModelAsides } from "./notes";
import { paperPriority } from "./scheduler";
import type { PrepChapter, PrepPaper, PrepState } from "./types";

export interface ClassroomNote {
  slug: string;
  title: string;
  body: string;
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

// The notes block: every note this turn carries, in full. "" when it carries
// none, which is what keeps the block off a turn with no prep run.
export function prepNotesSection(notes: readonly ClassroomNote[]): string {
  if (notes.length === 0) return "";
  const lines = ["Prep notes on this document's references, in full:"];
  for (const n of notes) {
    lines.push("", `--- ${n.slug}: ${n.title} ---`, classroomNoteBody(n.body, n.slug));
  }
  lines.push(
    "",
    "Every page anchor in these notes already names its paper: copy it as it",
    "stands, e.g. [paper-slug p.3]. A bare [p.3] means a page of the book the",
    "reader is in.",
  );
  return lines.join("\n");
}

// The prep list: every reference nominated for this document and what exists of
// each. `inContext` is the slugs whose notes this turn actually carries, so the
// list cannot claim a note is in front of the model when it is not.
export function prepStatusSection(
  prep: PrepState | null,
  inContext: ReadonlySet<string>,
): string {
  if (!prep || prep.papers.length === 0) return "";
  const lines = [
    "The prep list — every reference nominated for this document, and what you have",
    "of each. These slugs are the only ones read_paper and read_note accept; never",
    "make one up from a reference-list entry.",
  ];
  for (const p of prep.papers) lines.push(paperLine(p, inContext.has(p.slug)));
  return lines.join("\n");
}
