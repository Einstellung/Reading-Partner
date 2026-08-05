// The decision file's pure operations: create, merge one decision in, and lay
// the whole thing out for the prompt.
//
// The file is what makes the rehearsal survivable across sittings (docs/31: a
// talk has a life, it is prepared over several goes and returned to). It is also
// the deck's outline later, which is why a decision names points and a figure
// rather than prose.

import type { RehearsalChapter, RehearsalDecision, RehearsalPlan } from "./types";
import { REHEARSAL_VERSION } from "./types";

export function createPlan(bookId: string, now: number): RehearsalPlan {
  return { version: REHEARSAL_VERSION, bookId, createdAt: now, updatedAt: now, decisions: [] };
}

// Replace this chapter's decision, or add it, keeping the list in chapter order.
// Replacing rather than appending is the point: the reader comes back to a
// chapter and changes their mind, and the file has to end up saying the new
// thing, not both things.
export function upsertDecision(plan: RehearsalPlan, decision: RehearsalDecision): RehearsalPlan {
  const rest = plan.decisions.filter((d) => d.chapter !== decision.chapter);
  const decisions = [...rest, decision].sort((a, b) => a.chapter - b.chapter);
  return { ...plan, decisions, updatedAt: decision.updatedAt };
}

export function decisionFor(
  plan: RehearsalPlan | null,
  chapter: number,
): RehearsalDecision | undefined {
  return plan?.decisions.find((d) => d.chapter === chapter);
}

// A load-time repair: a file whose version this build does not know is treated
// as absent by the store, but a known-version file may still have been written
// by a shorter-lived shape. Anything unusable is dropped rather than crashing
// the turn — a lost decision is re-made in one exchange.
export function normalizePlan(plan: RehearsalPlan): RehearsalPlan {
  const seen = new Set<number>();
  const decisions: RehearsalDecision[] = [];
  for (const d of plan.decisions ?? []) {
    const chapter = Math.round(Number(d?.chapter));
    if (!Number.isFinite(chapter) || chapter < 1 || seen.has(chapter)) continue;
    seen.add(chapter);
    decisions.push({
      chapter,
      title: typeof d.title === "string" ? d.title : "",
      include: !!d.include,
      points: Array.isArray(d.points) ? d.points.filter((p) => typeof p === "string") : [],
      ...(typeof d.figure === "string" && d.figure ? { figure: d.figure } : {}),
      ...(typeof d.note === "string" && d.note ? { note: d.note } : {}),
      updatedAt: Number.isFinite(d.updatedAt) ? d.updatedAt : plan.updatedAt,
    });
  }
  decisions.sort((a, b) => a.chapter - b.chapter);
  return { ...plan, decisions };
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
