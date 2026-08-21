// When preparation starts, and which of the two kinds starts. Pure.
//
// There is no switch (docs/09). Two things start preparation, and each one is
// something the reader did that means it:
//
//   "mark"  — a mark landed in this document. A mark is the sign that the
//             document is being read rather than flipped through, so this
//             trigger keeps that gate: nothing marked, nothing spent.
//   "entry" — the blackboard button in the top bar. Pressing it is the intent by
//             itself, so the mark gate does not apply to it. Without this, a
//             document nobody had marked answered the lecture entry with nothing
//             prepared at all, which is the hole it exists to close.
//
// Neither can start a second run. Which kind a document gets is prepKind's one
// answer, there is one pipeline per document per kind, and both triggers reach
// it through the same idempotent ensureStarted — so what is decided here is
// whether to reach for it and which one, never how many.

import { prepKind, type PrepKind, type PrepPresence } from "./kind";

export type PrepTrigger = "mark" | "entry";

export interface PrepTriggerInput {
  trigger: PrepTrigger;
  // The document's text is extracted and readable. Both pipelines are built on
  // it, so nothing starts without it.
  textReady: boolean;
  // Whether the reader has marked anything in this document.
  marked: boolean;
  // Which runs already exist, and what the text measures as (./kind.ts).
  presence: PrepPresence;
}

export type PrepTriggerDecision =
  | { start: true; kind: PrepKind }
  // Why nothing starts, for a caller that wants to say so and for the tests.
  | { start: false; why: "no-text" | "unmarked" };

export function prepTriggerDecision(input: PrepTriggerInput): PrepTriggerDecision {
  if (!input.textReady) return { start: false, why: "no-text" };
  // A run that exists is picked up by either trigger, marks or no marks: the
  // spend was agreed to once already, and half a document's material is worth
  // less than all of it.
  const started = input.presence.papers || input.presence.chapters;
  if (input.trigger === "mark" && !started && !input.marked) {
    return { start: false, why: "unmarked" };
  }
  return { start: true, kind: prepKind(input.presence) };
}
