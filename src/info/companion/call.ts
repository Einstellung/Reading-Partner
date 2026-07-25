// The React-free half of the info call (docs/16/17): which thread the companion
// writes to, the synthetic turns it injects on the user's behalf, and the one
// briefing card's progress -> ready/failed lifecycle. The component owns state,
// effects and the pipeline subscription; the mapping from a pipeline snapshot to
// a card payload and a thread note lives here, tested without React.

import type { BriefingScope } from "./companion-tools";
import type {
  BriefingFailedCardData,
  BriefingProgressCardData,
  BriefingReadyCardData,
  ProbeConfirmCardData,
  ProfileUpdateCardData,
} from "../briefing/cards";
import type { InfoSnapshot } from "../briefing/pipeline";
import type { Briefing } from "../briefing/types";

// Info threads hang off a per-day pseudo-book, so a day's briefing, article and
// onboarding conversations file together.
export function infoBookId(dateKey: string): string {
  return `info-${dateKey}`;
}

// First-run onboarding: the AI opens the conversation itself, kicked by this
// synthetic user turn (never rendered — it only seeds the streaming reply).
export const OPENING_KICKOFF = "(The user just opened onboarding — greet them and begin.)";

// The one briefing card's stable id: the progress card, then in place the ready
// or failed card, all address this id through upsertCardRow.
export const BRIEFING_CARD_ID = "briefing";

// The three briefing jobs the one card tracks: "first" is the onboarding first
// briefing; the two the AI can also ask for are "full" (re-collect + triage) and
// "retriage" (re-sort today's cached items with the current profile).
export type BriefingJob = BriefingScope | "first";

// Progress-card heading per job; "first" keeps the onboarding default copy.
function progressTitle(job: BriefingJob): string | undefined {
  if (job === "retriage") return "Re-running today's triage";
  if (job === "full") return "Regenerating today's briefing";
  return undefined;
}

// Ready-card heading and note per job; "first" keeps the onboarding default copy.
function readyCopy(job: BriefingJob): { title?: string; note?: string } {
  if (job === "retriage") return { title: "Briefing updated", note: "Re-triaged today's items with your updated profile." };
  if (job === "full") return { title: "Briefing regenerated", note: "Re-collected every source and re-triaged." };
  return {};
}

// The note injected into the thread when a job settles, so the AI's next turn
// answers from the new briefing rather than the one it still has in context.
function completionNote(job: BriefingJob, b: Briefing): string {
  const worth = b.mustRead.length + b.outOfLane.length;
  const verb = job === "retriage" ? "re-sorted" : job === "full" ? "regenerated" : "generated";
  return (
    `Today's briefing has been ${verb}. Overview: ${b.overview} — worth your time: ${worth}, ` +
    `one-liners: ${b.oneLiners.length}, filtered: ${b.filtered.length}. Answer from this updated ` +
    `briefing now, not the earlier one.`
  );
}

function failureNote(job: BriefingJob, error: string | null): string {
  const verb = job === "retriage" ? "re-triage" : "regeneration";
  return `The briefing ${verb} failed: ${error || "unknown error"}.`;
}

// The progress card for a job. Before the pipeline has reported anything (the
// card appears the moment the job starts) the phase comes from the job itself —
// a re-triage never fetches; afterwards it comes from the snapshot.
export function briefingProgressCard(job: BriefingJob, s: InfoSnapshot | null): BriefingProgressCardData {
  const phase = s
    ? s.phase === "fetching"
      ? "fetching"
      : "triaging"
    : job === "retriage"
      ? "triaging"
      : "fetching";
  return {
    kind: "briefing-progress",
    phase,
    collect: s?.collect ?? null,
    triage: s?.activity
      ? {
          startedAt: s.activity.startedAt,
          chars: s.activity.chars,
          attempt: s.activity.attempt,
          attempts: s.activity.attempts,
        }
      : null,
    title: progressTitle(job),
  };
}

// What the one briefing card should show for a snapshot, plus — once the job
// settles — the note the thread carries about the outcome.
export type BriefingJobUpdate =
  | { status: "running"; card: BriefingProgressCardData }
  | { status: "ready"; card: BriefingReadyCardData; note: string }
  | { status: "failed"; card: BriefingFailedCardData; note: string };

export function briefingJobUpdate(job: BriefingJob, s: InfoSnapshot): BriefingJobUpdate {
  if (s.running) return { status: "running", card: briefingProgressCard(job, s) };
  const b = s.briefing;
  if (b) {
    return {
      status: "ready",
      card: {
        kind: "briefing-ready",
        date: b.date,
        worth: b.mustRead.length + b.outOfLane.length,
        oneLiners: b.oneLiners.length,
        filtered: b.filtered.length,
        ...readyCopy(job),
      },
      note: completionNote(job, b),
    };
  }
  return {
    status: "failed",
    card: { kind: "briefing-failed", message: s.error || "The briefing could not be generated." },
    note: failureNote(job, s.error),
  };
}

// The synthetic turns reporting a card gesture the AI did not make itself: the
// user added a trialed source, or applied a drafted profile change.
export function sourceAddedNote(card: ProbeConfirmCardData): string {
  return `Added "${card.descriptor.name}" to my sources.`;
}

export function profileAppliedNote(card: ProfileUpdateCardData): string {
  return `Applied the profile update: ${card.summary}.`;
}
