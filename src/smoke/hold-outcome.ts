// Reading a hold's outcome from outside the composer, for the interactive bench
// (dictation-bench.tsx). The bench watches the shipped Composer without
// modifying it, so it never learns directly which of the three landing zones a
// finger came up over — it infers it, and this is the inference.
//
// The three signals it has, and why each one is trustworthy:
//
//   sent          the composer called its own onSend prop. Only a release on
//                 the bar does that (HoldToTalk's `send` effect goes straight
//                 through), so it settles the question by itself.
//   keyboardBack  a textarea is where the hold bar was. The composer swaps
//                 itself back to keyboard mode in exactly one place — the
//                 `insert` effect, which is a release over Edit — because
//                 asking to edit is asking for the thing you edit with.
//   heard         what the plugin streamed while the finger was down. A level
//                 is emitted fifteen times a second for as long as the audio
//                 engine is running, whether or not anyone is speaking, so a
//                 hold with no levels at all had no microphone, not a quiet
//                 room. That is the difference between a cancel that worked
//                 and a bar that did nothing, which is the whole reason the
//                 bench counts them.
//
// A cancel is the fall-through and has to be: it is defined by producing
// nothing. Everything that could have produced something is ruled out first.
//
// The fourth signal comes from the plugin rather than from the gesture: a press
// that arrived while the indicator probe was parked is refused outright, and
// from the outside that is indistinguishable from the microphone being broken.
// It is read first, because it explains every other signal being empty.

import { FINISH_TIMEOUT_MS } from "../ai/voice/hold-machine";

// The plugin's stream for one hold, counted rather than kept. The bench never
// keeps the words: the bar hides its transcript while the finger is down on
// purpose (docs/15), and a running commentary above it would turn speaking into
// proofreading and change the thing being judged.
export interface Heard {
  // From pointerdown to pointerup.
  ms: number;
  levels: number;
  volatiles: number;
  finals: number;
  // Loudest level seen, 0..1.
  peak: number;
}

export const NO_HEARD: Heard = { ms: 0, levels: 0, volatiles: 0, finals: 0, peak: 0 };

export type HoldOutcome = "sent" | "edit" | "cancel" | "short" | "silent" | "refused";

// How long after the finger lifts to wait before calling a hold cancelled. The
// composer's own flush window plus room for the IPC round trip and the commit
// that arms it; anything that was going to arrive has arrived by then.
export const RESOLVE_MS = FINISH_TIMEOUT_MS + 700;

// Under this, a release is a press that never became a hold: the recognizer is
// still starting, the machine goes arming -> aborting, and no text was ever
// possible. Worth saying out loud, because it feels identical to a cancel from
// the outside — nothing happens either way.
export const TOO_SHORT_MS = 400;

export function classifyHold(signals: {
  sent: boolean;
  keyboardBack: boolean;
  heard: Heard;
  // The plugin never opened the microphone: the indicator probe had it
  // (indicator-probe.ts). Nothing else about the press means anything then.
  refused?: boolean;
}): HoldOutcome {
  if (signals.refused) return "refused";
  if (signals.sent) return "sent";
  if (signals.keyboardBack) return "edit";
  if (signals.heard.levels === 0) {
    return signals.heard.ms < TOO_SHORT_MS ? "short" : "silent";
  }
  return "cancel";
}
