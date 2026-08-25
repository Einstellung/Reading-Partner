// The record of the retell, laid out for the prompt.
//
// The record is what makes the retell survivable across sittings (docs/31: a
// retell has a life, it is prepared over several goes and returned to). It is also
// the deck's outline later, which is why a decision names points and a figure
// rather than prose. Where it lives, and in what order, belongs to the retell
// (reading/retell/outline.ts); this file only reads it back.

import type { RetellChapter, RetellPlan } from "./types";

// The whole outline as something to read back to the reader when they ask what
// their retell looks like (read_retell_outline). Different from formatPlan, which is
// the model's working record: this one is ordered as the retell will run, says
// what is still undecided, and carries no instructions about what to do next.
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

// The chapter the retell is up to: the lowest chapter with no decision yet,
// or null when every chapter has one. Not "the last one recorded plus one" —
// the reader may jump around, and the gap is what is actually left to do.
export function nextChapter(
  chapters: readonly RetellChapter[],
  plan: RetellPlan | null,
): number | null {
  const done = new Set((plan?.decisions ?? []).map((d) => d.chapter));
  for (const c of chapters) if (!done.has(c.index)) return c.index;
  return null;
}

// The record of the retell so far, as the model reads it at the top of every
// turn. This is what makes "start from where it stands" answerable.
export function formatPlan(
  chapters: readonly RetellChapter[],
  plan: RetellPlan | null,
): string {
  const decisions = plan?.decisions ?? [];
  const next = nextChapter(chapters, plan);
  if (decisions.length === 0) {
    return [
      "Where the retell stands: nothing recorded yet.",
      "If the conversation so far is empty, this is the opening: lay out the",
      "skeleton, get the reader to confirm or correct the spine and say which",
      "thread they want the retell to follow, then start at chapter 1.",
      // The record only knows about recorded chapters, so on the turn right after
      // the opening it still says "nothing recorded". Without this the model lays
      // the skeleton out a second time.
      "If the opening has already happened in the conversation above, do not do it",
      "again — carry on with chapter 1.",
    ].join("\n");
  }
  const lines = ["Where the retell stands — what has been recorded so far:"];
  for (const d of decisions) {
    lines.push("", `Chapter ${d.chapter}. ${d.title} — ${d.include ? "in the retell" : "cut"}`);
    for (const p of d.points) lines.push(`  - ${p}`);
    if (d.figure) lines.push(`  figure: ${d.figure}`);
    if (d.note) lines.push(`  note: ${d.note}`);
  }
  lines.push(
    "",
    next === null
      ? "Every chapter has a decision. Do not re-walk them: ask what the reader wants to revisit, or go over the shape of the retell as a whole."
      : `Next up: chapter ${next}. Pick up there — the chapters above are settled unless the reader reopens one.`,
  );
  return lines.join("\n");
}
