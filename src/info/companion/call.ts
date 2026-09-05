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
  ProfileUpdateCardData,
} from "../briefing/cards";
import type { ProbeConfirmCardData } from "../sources/source-cards";
import type { InfoSnapshot, RunStart } from "../briefing/pipeline";
import type { RequestOutcome } from "../briefing/reader";
import type { Briefing } from "../briefing/types";

// Info threads hang off a per-day pseudo-book, so a day's briefing, article and
// onboarding conversations file together.
export function infoBookId(dateKey: string): string {
  return `info-${dateKey}`;
}

// First-run onboarding: the AI opens the conversation itself, kicked by this
// synthetic user turn (never rendered — it only seeds the streaming reply).
export const OPENING_KICKOFF = "(The user just opened onboarding — greet them and begin.)";

// The voice call's opening line (docs/33 "被召唤的语音会话", docs/45). Same shape
// as OPENING_KICKOFF and equally synthetic — it is never rendered and never
// spoken, it only kicks the greeting. What it asks for is a greeting and a
// question, not the briefing read out: the call is a companion that was summoned
// and not a player with a script (docs/33 "不播稿").
export const VOICE_OPENING_KICKOFF =
  "(The user just opened the voice call — you are speaking aloud, so keep it short. " +
  "Greet them, give ONE sentence on what today's briefing amounts to, and ask what they " +
  "want to hear about. Do not read the briefing out and do not list the items.)";

// The one briefing card's stable id: the progress card, then in place the ready
// or failed card, all address this id through upsertCardRow.
export const BRIEFING_CARD_ID = "briefing";

// The briefing jobs the one card tracks: "first" is the onboarding first
// briefing; the two the AI can also ask for are "full" (re-collect + triage) and
// "retriage" (re-sort today's cached items with the current profile). "joined"
// is none of them — it is what a start that found a run already going tracks
// instead, so the card says what it is actually showing (see trackedJob).
export type BriefingJob = BriefingScope | "first" | "joined";

// Progress-card heading per job; "first" keeps the onboarding default copy.
function progressTitle(job: BriefingJob): string | undefined {
  if (job === "retriage") return "Re-running today's triage";
  if (job === "full") return "Regenerating today's briefing";
  if (job === "joined") return "A briefing run is already going";
  return undefined;
}

// Ready-card heading and note per job; "first" keeps the onboarding default copy.
function readyCopy(job: BriefingJob): { title?: string; note?: string } {
  if (job === "retriage") return { title: "Briefing updated", note: "Re-triaged today's items with your updated profile." };
  if (job === "full") return { title: "Briefing regenerated", note: "Re-collected every source and re-triaged." };
  if (job === "joined") return { title: "Briefing updated", note: "The run that was already going has finished." };
  return {};
}

// The job a start attempt ends up tracking. A refused start must not keep the
// label of the job it asked for: what it is watching now is somebody else's run,
// possibly a different job entirely, and calling its result "regenerated" would
// tell the reader their request ran when it never started.
export function trackedJob(job: BriefingJob, start: RunStart): BriefingJob {
  return start === "busy" ? "joined" : job;
}

// The job a start can actually ask the pipeline for. Only "joined" is not one:
// nothing can re-run somebody else's run, so a Retry on a joined card starts one
// of our own, and a full collection is the only honest reading of "the run that
// was going failed — do it again".
export function runnableJob(job: BriefingJob): BriefingJob {
  return job === "joined" ? "full" : job;
}

// The scope the pipeline is asked for. Only a re-triage is its own scope; every
// other job is a full collect + triage, including the "first" of onboarding.
export function askScope(job: BriefingJob): BriefingScope {
  return runnableJob(job) === "retriage" ? "retriage" : "full";
}

// What a start attempt does to the one briefing card, decided from the outcome
// the view answered with before anything is drawn.
//
// A run started here gets the card. A start refused because one was already
// going does NOT get a card of its own — nothing would ever update it, which is
// how a regenerate came to sit on its first frame while the run it collided with
// went on without it. It takes over the same card id instead, since that run's
// progress is what the user asked to see, and the card opens on its real phase
// and settles with it.
//
// And on a reader nothing runs here at all (docs/36): the request is written for
// the collecting machine to pick up on its next sync, and there is no card —
// there is no run on this device to show the progress of, and no honest estimate
// of when the other machine will have one.
export type BriefingJobPlan =
  // Left for the collecting machine. `job` is what to say happened.
  | { kind: "asked"; job: BriefingJob }
  // A run to watch, on the one card id, whether we started it or joined it.
  | { kind: "started"; job: BriefingJob; cardId: string; card: BriefingProgressCardData };

export function briefingJobPlan(
  job: BriefingJob,
  outcome: RequestOutcome,
  s: InfoSnapshot | null,
): BriefingJobPlan {
  const asked = runnableJob(job);
  if (outcome === "asked") return { kind: "asked", job: asked };
  const tracked = trackedJob(asked, outcome);
  return {
    kind: "started",
    job: tracked,
    cardId: BRIEFING_CARD_ID,
    card: briefingProgressCard(tracked, s),
  };
}

// The note injected into the thread when a job settles, so the AI's next turn
// answers from the new briefing rather than the one it still has in context.
function completionNote(job: BriefingJob, b: Briefing): string {
  const worth = b.mustRead.length + b.outOfLane.length;
  const verb =
    job === "retriage" ? "re-sorted" : job === "full" ? "regenerated" : job === "joined" ? "updated" : "generated";
  // The screened-out count belongs in the note for the same reason it belongs in
  // the chat prompt (docs/35): "filtered: 3" over a day of four hundred headlines
  // would otherwise read as a quiet day.
  const screened = b.screen?.dropped
    ? `, screened out before fetching: ${b.screen.dropped} of ${b.screen.discovered} discovered`
    : "";
  return (
    `Today's briefing has been ${verb}. Overview: ${b.overview} — worth your time: ${worth}, ` +
    `one-liners: ${b.oneLiners.length}, filtered: ${b.filtered.length}${screened}. Answer from ` +
    `this updated briefing now, not the earlier one.`
  );
}

function failureNote(job: BriefingJob, error: string | null): string {
  const verb = job === "retriage" ? "re-triage" : job === "joined" ? "run" : "regeneration";
  return `The briefing ${verb} failed: ${error || "unknown error"}.`;
}

// What the thread says when the request went to another machine (docs/36). No
// progress card and no estimate: the round trip is an upload, then whenever the
// collector next syncs, then the collecting itself, and a countdown over three
// unknowns is a number that would be wrong.
export function askSentNote(job: BriefingJob, status?: string): string {
  const what = job === "retriage" ? "re-sort today's items" : "collect a fresh briefing";
  return (
    `I have asked the computer that collects your sources to ${what}. It will pick the request ` +
    `up the next time it syncs, and the new briefing will appear here when it is done. Nothing ` +
    `is running on this device.` +
    // Whatever is known about that machine, so the sentence is not a promise
    // made on its behalf. A request it never picks up expires in six hours.
    (status ? ` ${status}` : "")
  );
}

export const ASK_FAILED_NOTE =
  "I could not leave the request for the collecting computer — the file could not be written. " +
  "Nothing has been asked for.";

// The progress card for a job. Before the pipeline has reported anything (the
// card appears the moment the job starts) the phase comes from the job itself —
// a re-triage never fetches; afterwards it comes from the snapshot.
export function briefingProgressCard(job: BriefingJob, s: InfoSnapshot | null): BriefingProgressCardData {
  const phase =
    s && s.phase !== "idle" ? s.phase : job === "retriage" ? "triaging" : "discovering";
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
    stopping: s?.stopping ?? false,
    title: progressTitle(job),
  };
}

// What the one briefing card should show for a snapshot, plus — once the job
// settles — the note the thread carries about the outcome.
// `persist` is what the thread does with the settled card and its note. Ready is
// a durable outcome: written to disk so a reopen shows the briefing exists (the
// progress card it replaced was never persisted). A failure stays in-session —
// retry needs the live pipeline — and so does its note, so a reopen does not
// replay a failure that is over.
export type BriefingJobUpdate =
  | { status: "running"; card: BriefingProgressCardData }
  | { status: "ready"; card: BriefingReadyCardData; note: string; persist: boolean }
  | { status: "failed"; card: BriefingFailedCardData; note: string; persist: boolean };

export function briefingJobUpdate(job: BriefingJob, s: InfoSnapshot): BriefingJobUpdate {
  if (s.running) return { status: "running", card: briefingProgressCard(job, s) };
  // The error decides the outcome, not the presence of a briefing: a failed run
  // leaves the pipeline holding the PREVIOUS briefing, so a failed re-triage
  // would otherwise announce "Briefing updated" over the old one's counts.
  const b = s.error ? null : s.briefing;
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
      persist: true,
    };
  }
  return {
    status: "failed",
    card: { kind: "briefing-failed", message: s.error || "The briefing could not be generated." },
    note: failureNote(job, s.error),
    persist: false,
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
