// The memory paragraph of a reading turn's prompt: three blocks in a fixed
// order (docs/48, 消费侧).
//
//   1. the standing profile statements — what is held to be true about this
//      reader. Always there, because how they want things explained is
//      triggered by the act of explaining and has no wording in common with the
//      material, so nothing retrieves it.
//   2. what is still open in this book, decided from the links (open-stuck.ts).
//   3. the observations retrieval brought back, minus the ones a standing
//      statement has already read.
//
// Pure, and given the snapshot retrieval already built rather than doing any
// selecting of its own: what comes back is reading/lecture/stuck.ts's judgement
// and is not changed here.

import { mentionedIds } from "../observations/links";
import { openStuckPoints } from "../observations/open-stuck";
import { observationPromptSection } from "../observations/select";
import type { Observation } from "../observations/types";
import { coveredObservationIds } from "../statements/links";
import type { Statement } from "../statements/types";

export interface MemorySectionInput {
  // Every statement there is. Superseded ones and concerns are dropped here:
  // a concern is what the reader is watching for, whose consumers are the info
  // triage and the nightly pass, and it is not what this conversation is.
  statements: readonly Statement[];
  // This topic's observations, whole — the open-stuck decision reads bodies.
  observations: readonly Observation[];
  // The book the conversation is in, which is what "still open" is scoped to.
  bookId: string;
  // The snapshot retrieval built for this turn (lectureObservationSnapshot):
  // one `- [type] summary (…, id m-…)` line per observation, some followed by
  // the observation's body.
  observationSnapshot: string;
  // Whether the observation tools ride this turn, which decides whether the
  // block explains them.
  hasObservationTools: boolean;
}

export function memorySection(input: MemorySectionInput): string {
  const covered = coveredObservationIds(input.statements);
  const blocks = [
    profileBlock(input.statements),
    openBlock(input.observations, input.bookId),
    observationPromptSection(
      dropCoveredObservations(input.observationSnapshot, covered),
      input.hasObservationTools,
    ),
  ];
  return blocks.filter((b) => b !== "").join("\n\n");
}

// The reader's own statements before the concluded ones, each keeping the order
// it was handed in. Not because one is truer: they are not equally revisable —
// what the reader said about themselves is theirs to take back, what was
// concluded is a reading of their behaviour — and the model acts on the first
// thing it reads.
//
// Every line carries its id so the model can name one when it acts on it, and
// so the reader can be told which line to argue with.
function profileBlock(statements: readonly Statement[]): string {
  const standing = statements.filter(
    (s) => s.kind === "profile" && !s.supersededBy && s.text.trim() !== "",
  );
  if (standing.length === 0) return "";
  const ordered = [
    ...standing.filter((s) => s.author === "reader"),
    ...standing.filter((s) => s.author !== "reader"),
  ];
  return [
    "What is known about this reader — what they have said about themselves first,",
    "then what has been concluded from how they read:",
    ...ordered.map((s) => `- ${s.text.trim()} (id ${s.id})`),
    "",
    "Pitch your explanations to these: match the depth to the background they state,",
    "explain things the way they have asked to have them explained, and connect to an",
    "interest only where it is actually relevant.",
  ].join("\n");
}

// What this book has left open. Summaries only — the body is a tool call away,
// and this block is a list of what to watch for rather than the material.
function openBlock(observations: readonly Observation[], bookId: string): string {
  const open = openStuckPoints(observations, bookId);
  if (open.length === 0) return "";
  return [
    "Still open in this book — stuck points nothing has recorded this reader getting",
    "past yet:",
    ...open.map((o) => `- ${o.summary.trim()} (id ${o.id})`),
    "",
    "One of these closes on evidence from the reader — they answer it, they say it",
    "back, they say they have it — and not on your having explained it again. Some of",
    "them are stale for that reason, so check where they are before re-explaining one",
    "rather than opening with the same ground twice.",
  ].join("\n");
}

// The head of one snapshot entry (memory/observations/files.ts). Matched rather
// than any line starting with "- " because a body carried under an entry is
// markdown and can hold a bullet list of its own.
const ENTRY_HEAD = /^- \[[a-z-]+\] /;

// Drop the entries a standing statement already rests on, bodies and all: what
// has been read is in the statement above, and carrying the evidence for it
// into every turn as well is what the two layers exist to stop (docs/48).
//
// Reachable all the same — observation_search and observation_read see the
// whole store, and the statement carries the ids.
export function dropCoveredObservations(
  snapshot: string,
  covered: ReadonlySet<string>,
): string {
  if (snapshot === "" || covered.size === 0) return snapshot;
  const kept: string[] = [];
  // Whether the entry currently being read was dropped; its body and the blank
  // line after it follow it out.
  let dropping = false;
  for (const line of snapshot.split("\n")) {
    if (ENTRY_HEAD.test(line)) {
      dropping = mentionedIds(line).some((id) => covered.has(id));
      if (dropping) continue;
    } else if (dropping) {
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n").trim();
}
