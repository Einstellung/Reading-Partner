// The record of the rehearsal, laid out for the prompt.
//
// The record is what makes the rehearsal survivable across sittings (docs/31: a
// talk has a life, it is prepared over several goes and returned to). It is also
// the deck's outline later, which is why a decision names points and a figure
// rather than prose. Where it lives, and in what order, belongs to the talk
// (reading/talks/outline.ts); this file only reads it back.

import type { RehearsalChapter, RehearsalDecision, RehearsalPlan } from "./types";

export function decisionFor(
  plan: RehearsalPlan | null,
  chapter: number,
): RehearsalDecision | undefined {
  return plan?.decisions.find((d) => d.chapter === chapter);
}

// The whole outline as something to read back to the reader when they ask what
// their talk looks like (read_talk_outline). Different from formatPlan, which is
// the model's working record: this one is ordered as the talk will run, says
// what is still undecided, and carries no instructions about what to do next.
export function formatOutline(
  chapters: readonly RehearsalChapter[],
  plan: RehearsalPlan | null,
): string {
  const decisions = plan?.decisions ?? [];
  if (decisions.length === 0) {
    return "No chapter has been settled yet, so there is no outline — the talk starts taking shape after the first chapter is recorded.";
  }
  const byChapter = new Map(decisions.map((d) => [d.chapter, d]));
  const included = decisions.filter((d) => d.include);
  const cut = decisions.filter((d) => !d.include);
  const undecided = chapters.filter((c) => !byChapter.has(c.index));

  const lines = ["The talk as it stands."];
  if (included.length) {
    const points = included.reduce((n, d) => n + d.points.length, 0);
    lines.push(
      "",
      `In the talk — ${included.length} chapter(s), ${points} point(s), in this order:`,
    );
    for (const d of included) {
      lines.push("", `${d.chapter}. ${d.title}`);
      for (const p of d.points) lines.push(`  - ${p}`);
      if (!d.points.length) lines.push("  (recorded as in, but with no points yet)");
      if (d.figure) lines.push(`  figure: ${d.figure}`);
      if (d.note) lines.push(`  note: ${d.note}`);
    }
  } else {
    lines.push("", "Nothing is in the talk yet — every chapter settled so far was cut.");
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

// The chapter the rehearsal is up to: the lowest chapter with no decision yet,
// or null when every chapter has one. Not "the last one recorded plus one" —
// the reader may jump around, and the gap is what is actually left to do.
export function nextChapter(
  chapters: readonly RehearsalChapter[],
  plan: RehearsalPlan | null,
): number | null {
  const done = new Set((plan?.decisions ?? []).map((d) => d.chapter));
  for (const c of chapters) if (!done.has(c.index)) return c.index;
  return null;
}

// The record of the rehearsal so far, as the model reads it at the top of every
// turn. This is what makes "start from where it stands" answerable.
export function formatPlan(
  chapters: readonly RehearsalChapter[],
  plan: RehearsalPlan | null,
): string {
  const decisions = plan?.decisions ?? [];
  const next = nextChapter(chapters, plan);
  if (decisions.length === 0) {
    return [
      "Where the rehearsal stands: nothing recorded yet.",
      "If the conversation so far is empty, this is the opening: lay out the",
      "skeleton, get the reader to confirm or correct the spine and say which",
      "thread they want the talk to follow, then start at chapter 1.",
      // The record only knows about recorded chapters, so on the turn right after
      // the opening it still says "nothing recorded". Without this the model lays
      // the skeleton out a second time.
      "If the opening has already happened in the conversation above, do not do it",
      "again — carry on with chapter 1.",
    ].join("\n");
  }
  const lines = ["Where the rehearsal stands — what has been recorded so far:"];
  for (const d of decisions) {
    lines.push("", `Chapter ${d.chapter}. ${d.title} — ${d.include ? "in the talk" : "cut"}`);
    for (const p of d.points) lines.push(`  - ${p}`);
    if (d.figure) lines.push(`  figure: ${d.figure}`);
    if (d.note) lines.push(`  note: ${d.note}`);
  }
  lines.push(
    "",
    next === null
      ? "Every chapter has a decision. Do not re-walk them: ask what the reader wants to revisit, or go over the shape of the talk as a whole."
      : `Next up: chapter ${next}. Pick up there — the chapters above are settled unless the reader reopens one.`,
  );
  return lines.join("\n");
}
