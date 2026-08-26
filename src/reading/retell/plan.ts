// The record of the retell, laid out for the prompt.
//
// The record is what makes the retell survivable across sittings (docs/31: a
// retell has a life, it is prepared over several goes and returned to). It is also
// the deck's outline later, which is why a decision names points and a figure
// rather than prose. Where it lives, and in what order, belongs to the retell
// (reading/retell/outline.ts); this file only reads it back.

import { columns, segmentLabel, type TalkOutline } from "../talk";
import type { RetellChapter, RetellPlan } from "./types";

// The whole outline as something to read back to the reader when they ask what
// their retell looks like (read_retell_outline). Different from formatPlan, which is
// the model's working record: this one is the chapter view, which is what the
// tool is for, and it carries no instructions about what to do next.
export function formatOutline(
  chapters: readonly RetellChapter[],
  plan: RetellPlan | null,
): string {
  const decisions = plan?.decisions ?? [];
  if (decisions.length === 0) {
    return "No chapter has been settled yet, so there is no outline — the retell starts taking shape after the first chapter is recorded.";
  }
  const byChapter = new Map(decisions.map((d) => [d.chapter, d]));
  const included = decisions.filter((d) => d.include);
  const cut = decisions.filter((d) => !d.include);
  const undecided = chapters.filter((c) => !byChapter.has(c.index));

  const lines = ["The retell as it stands."];
  if (included.length) {
    const points = included.reduce((n, d) => n + d.points.length, 0);
    lines.push(
      "",
      `In the retell — ${included.length} chapter(s), ${points} point(s), in this order:`,
    );
    for (const d of included) {
      lines.push("", `${d.chapter}. ${d.title}`);
      for (const p of d.points) lines.push(`  - ${p}`);
      if (!d.points.length) lines.push("  (recorded as in, but with no points yet)");
      if (d.figure) lines.push(`  figure: ${d.figure}`);
      if (d.note) lines.push(`  note: ${d.note}`);
    }
  } else {
    lines.push("", "Nothing is in the retell yet — every chapter settled so far was cut.");
  }
  if (cut.length) {
    lines.push("", "Cut:");
    for (const d of cut) lines.push(`  ${d.chapter}. ${d.title}${d.note ? ` — ${d.note}` : ""}`);
  }
  if (undecided.length) {
    lines.push(
      "",
      `Not settled yet: ${undecided.map((c) => `${c.index}. ${c.title}`).join("; ")}.`,
    );
  }
  return lines.join("\n");
}

// The chapter the retell has not reached yet: the lowest one with no decision,
// or null when every chapter has one. No longer a pointer the model is handed —
// the retell walks ribs, not chapters — it is only how the turn picks which
// chapter note is worth inlining unasked (reading/retell/turn.ts). Not "the last
// one recorded plus one": the reader jumps around, and the gap is what is
// actually still unconsumed.
export function nextChapter(
  chapters: readonly RetellChapter[],
  plan: RetellPlan | null,
): number | null {
  const done = new Set((plan?.decisions ?? []).map((d) => d.chapter));
  for (const c of chapters) if (!done.has(c.index)) return c.index;
  return null;
}

// A rib and a block's first line reduced to the same shape, so the same words
// written once into the backbone and once as a heading compare equal. Markdown
// markers and punctuation go, case goes; CJK carries no spaces, so nothing here
// may depend on word boundaries.
function normalizeLine(text: string): string {
  return text
    .replace(/[#*_`>\-—–:.,;!?"'()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Below this a containment match means nothing — two ribs that share the word
// "the" are not the same rib. Measured in columns rather than characters: a rib
// written in Chinese is often two ideographs, which says as much as an English
// word of four letters and would never clear a floor counted in characters.
const MATCH_FLOOR = 4;

// Which block of the note gives a rib, counting from 1, or null when none does.
// Read off the block's own first line rather than guessed from its position: the
// block written for a rib is headed with that rib (prompt.ts, "Head the block
// with the rib it gives"), an opening block belongs to no rib at all, and one rib
// can run to several blocks.
function blockForRib(rib: string, labels: readonly string[]): number | null {
  const want = normalizeLine(rib);
  if (!want) return null;
  for (const [i, label] of labels.entries()) {
    const have = normalizeLine(label);
    if (!have) continue;
    if (have === want) return i + 1;
    if (have.includes(want) && columns(want) >= MATCH_FLOOR) return i + 1;
    if (want.includes(have) && columns(have) >= MATCH_FLOOR) return i + 1;
  }
  return null;
}

// The record of the retell so far, as the model reads it at the top of every
// turn. This is what makes "start from where it stands" answerable, and which
// stage the retell is in is read off it: no through-line on the talk means the
// reader has not yet given the whole thing back, so the retell is still at its
// opening or in the macro pass; a through-line means it is on the ribs.
//
// It says nothing about which chapter comes next, and there is no such thing. A
// record that named one turned every reply into a chapter march: a reader who
// asked for something else got agreement in prose and the march back on the next
// turn. The chapters are here as an audit — where to open the book, what the talk
// has actually used — and the note's blocks are the progress, because a block
// exists for a rib exactly when the reader has given that rib.
export function formatPlan(
  chapters: readonly RetellChapter[],
  plan: RetellPlan | null,
  outline: TalkOutline | null,
): string {
  const spine = outline?.spine ?? null;
  const backbone = spine?.backbone ?? [];
  const thesis = spine?.thesis?.trim() ?? "";
  const hasSpine = !!thesis || backbone.length > 0;
  const segments = outline?.segments ?? [];
  const labels = segments.map(segmentLabel);

  const lines = ["Where the retell stands."];

  if (!hasSpine) {
    lines.push(
      "",
      "The talk has no through-line yet: the reader has not given the whole thing",
      "back, so nothing about the parts is settled and nothing goes in the note.",
      "If the conversation above is empty, this is the opening — hand them their",
      "trail back and ask for the whole thing, end to end, from memory.",
      // The record only knows what was written, so on the turn right after the
      // opening it still reads as having no spine. Without this the model asks
      // for the one-minute version a second time.
      "If the opening has already happened above, do not do it again: you are in",
      "the macro pass, working the through-line and the backbone out with them.",
    );
  } else {
    lines.push("", `Through-line: ${thesis || "(not written yet)"}`);
    if (spine?.audience) lines.push(`Audience: ${spine.audience}`);
    if (backbone.length) {
      lines.push("", "The backbone, and which ribs the reader has actually given:");
      for (const [i, rib] of backbone.entries()) {
        const at = blockForRib(rib, labels);
        lines.push(`  ${i + 1}. ${rib} — ${at === null ? "not given yet" : `given (block ${at})`}`);
      }
    }
  }

  if (segments.length) {
    lines.push("", `The note — ${segments.length} block(s), in the order they are given:`);
    for (const [i, label] of labels.entries()) lines.push(`  ${i + 1}. ${label}`);
  } else if (hasSpine) {
    lines.push("", "No block of the note is written yet.");
  }

  const decisions = plan?.decisions ?? [];
  const settled = new Set(decisions.map((d) => d.chapter));
  const untouched = chapters.filter((c) => !settled.has(c.index));
  lines.push(
    "",
    "The chapters, as an audit — where to open the book, and what the talk has",
    "taken from it. Not a queue: do not walk them in order, and do not ask the",
    "reader to settle one no rib has reached.",
  );
  for (const d of decisions) {
    lines.push(`  ${d.chapter}. ${d.title} — ${d.include ? "in the talk" : "cut"}`);
    for (const p of d.points) lines.push(`     - ${p}`);
    if (d.figure) lines.push(`     figure: ${d.figure}`);
    if (d.note) lines.push(`     note: ${d.note}`);
  }
  if (untouched.length) {
    lines.push(`  Untouched: ${untouched.map((c) => `${c.index}. ${c.title}`).join("; ")}.`);
  }
  if (!decisions.length && !untouched.length) lines.push("  (no chapters)");
  return lines.join("\n");
}
